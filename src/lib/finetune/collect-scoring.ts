import { createHash } from 'node:crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import { mapLimit } from '../concurrency'
import { criteriaSystemPrompt, criteriaUserMessage } from '../criteria-scoring'
import { criteriaCounts, offerCriteria, offerDetails, scoringSystemPrompt, scoringUserMessage, type ActiveScale } from '../match-scoring'
import { defaultCriteriaSet, type OfferCriteriaSet } from '../offer-criteria'
import { loadOfferCriteria } from '../offer-criteria-store'
import { aoSourceContext, finalOfferDetails, readCvForScoring, type OfferForMatching } from '../sourcing-core'
import { OFFERS_PER_CALL, VIVIER_MATCHING_SYSTEM, vivierMatchingPrompt, type OfferToScore } from '../vivier-matching'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'
import { keepsRealName, personFromFullName, pseudonymize, type Person } from './pseudonymize'

// Demandes des tâches de notation (ADR 0063), tirées des offres et des CV réels d'un projet, en lecture seule : paires
// CV × offre de la base candidats, des viviers et des candidatures, comme l'application les note. Noms remplacés par des
// noms inventés, coordonnées masquées (pseudonymize.ts, maskLeftoverContacts) avant d'être confiés à l'enseignant.

/** Nombre de demandes par tâche et par projet (avant le retrait des doublons DEV / production). */
export interface ScoringLimits {
  matching: number
  final: number
  criteria: number
  vivierBatch: number
}

export interface CollectStats {
  tasks: Record<string, { kept: number; skipped: Record<string, number> }>
  /** Faits utiles à la lecture des comptes (offres à critères…). */
  info: string[]
}

/** Offre retenue : un titre et une description assez longue pour juger un CV. */
const MIN_DESCRIPTION = 150
const CONCURRENCY = 4

/** Ordre de tirage stable : mêmes exemples à chaque export d'un même projet. */
const rank = (seed: string, id: string) => createHash('sha256').update(`${seed}:${id}`).digest('hex')
function sample<T>(items: T[], n: number, seed: string, idOf: (t: T) => string): T[] {
  return [...items].sort((a, b) => rank(seed, idOf(a)).localeCompare(rank(seed, idOf(b)))).slice(0, n)
}

interface CvSource {
  id: string
  fileId: string
  bucket: string
  person: Person
  tenantId: string
  /** Offre du vivier (CV importé pour une offre) ; '' : vivier général ou base candidats. */
  jobId: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

type CvText = { text: string } | { skip: string }

/** Textes de CV lus une fois : texte de la notation, noms inventés, coordonnées restantes masquées. */
class CvTexts {
  private cache = new Map<string, Promise<CvText>>()
  read(src: CvSource): Promise<CvText> {
    const cached = this.cache.get(src.fileId)
    if (cached) return cached
    const text = readCvForScoring(src.fileId, src.bucket).then(
      (raw): CvText => {
        if (!raw) return { skip: 'CV sans texte' }
        const t = maskLeftoverContacts(pseudonymize(raw, [src.person]))
        return keepsRealName(t, src.person) ? { skip: 'nom resté après remplacement' } : { text: t }
      },
      // Fichier supprimé ou illisible : compté, la paire suivante est tirée.
      (err: unknown): CvText => ({ skip: `CV illisible (${err instanceof Error ? err.message.slice(0, 60) : 'erreur'})` }),
    )
    this.cache.set(src.fileId, text)
    return text
  }
}

/** Offres lues une fois, avec leurs précisions (lieu, clients du score final, contexte d'un AO). */
class Offers {
  private cache = new Map<string, Promise<OfferForMatching>>()
  of(job: Models.Document, scale: ActiveScale): Promise<OfferForMatching> {
    const key = `${scale}:${job.$id}`
    let offer = this.cache.get(key)
    if (!offer) {
      offer = (async () => ({
        title: str(job.title), skills: Array.isArray(job.skills) ? job.skills.filter((s): s is string => typeof s === 'string') : [],
        description: maskLeftoverContacts(str(job.description)),
        details: scale === 'final' ? await finalOfferDetails(job) : offerDetails(job),
        sourceContext: maskLeftoverContacts(await aoSourceContext(job)),
      }))()
      this.cache.set(key, offer)
    }
    return offer
  }
}

/** Demande « notation sur le barème » : exactement ce que cvScorer envoie (sourcing-core.ts). */
function scoringItem(project: string, scale: ActiveScale, offer: OfferForMatching, cvText: string): DatasetItem {
  const criteria = offerCriteria(offer.skills, offer.description)
  const task = scale === 'matching' ? 'scoring-matching' : 'scoring-final'
  return {
    id: itemId(task, textKey(cvText), textKey(scoringUserMessage(offer, criteria, ''))), group: textKey(cvText), project,
    system: scoringSystemPrompt(scale, criteriaCounts(criteria)),
    messages: [{ role: 'user', content: scoringUserMessage(offer, criteria, cvText) }],
    ctx: { task, scale, skills: offer.skills, description: offer.description, cvText },
  }
}

/** Demande « notation sur critères » : exactement ce que criteriaScorer envoie. */
function criteriaItem(project: string, offer: OfferForMatching, set: OfferCriteriaSet, cvText: string): DatasetItem {
  return {
    id: itemId('scoring-criteria', textKey(cvText), textKey(criteriaUserMessage(offer, set, ''))), group: textKey(cvText), project,
    system: criteriaSystemPrompt(set),
    messages: [{ role: 'user', content: criteriaUserMessage(offer, set, cvText) }],
    ctx: { task: 'scoring-criteria', set, cvText },
  }
}

/** Demande du vivier général : un CV et 5 offres numérotées, comme scoreCvAgainstOffers (matching-core.ts). */
function vivierItem(project: string, offers: OfferToScore[], cvText: string): DatasetItem {
  return {
    id: itemId('vivier-batch', textKey(cvText), ...offers.map(o => textKey(`${o.title}\n${o.description}`))), group: textKey(cvText), project,
    system: VIVIER_MATCHING_SYSTEM,
    messages: [{ role: 'user', content: vivierMatchingPrompt(cvText, offers) }],
    ctx: { task: 'vivier-batch', offers, cvText },
  }
}

const toScore = (job: Models.Document): OfferToScore => ({
  $id: job.$id, title: str(job.title), skills: Array.isArray(job.skills) ? job.skills.filter((s): s is string => typeof s === 'string') : [],
  location: str(job.location), description: maskLeftoverContacts(str(job.description)),
  remote: str(job.remote) || undefined, salary: typeof job.salary === 'number' ? job.salary : undefined, contractType: str(job.contractType) || undefined,
})

/**
 * Demandes des tâches de notation d'un projet. Paires tirées de façon stable : notations déjà faites de la base candidats
 * (job_matches), CV des viviers d'offres, paires au hasard (surtout des CV qui ne correspondent pas : l'élève doit aussi
 * savoir dire non), candidatures pour le score final, offres à critères, vivier général (CV × 5 offres de son
 * organisation). Un CV sans nom connu est écarté : son nom resterait dans les exemples.
 */
export async function collectScoring(project: string, limits: ScoringLimits): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const seed = `mbc-ft:${project}`
  const [jobDocs, users, viviers, apps, matches] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.select(['$id', 'tenantId', 'title', 'description', 'skills', 'location', 'contractType', 'remote', 'salary', 'companyName'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'), Query.select(['$id', 'firstName', 'lastName', 'cvFileId', 'tenantId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.isNotNull('cvFileId'), Query.select(['$id', 'candidateName', 'cvFileId', 'tenantId', 'jobId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [Query.isNotNull('cvFileId'), Query.select(['$id', 'jobId', 'candidateId', 'cvFileId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [Query.select(['$id', 'jobId', 'candidateId'])]),
  ])
  const jobs = new Map(jobDocs.filter(j => str(j.title).trim() && str(j.description).length >= MIN_DESCRIPTION).map(j => [j.$id, j]))
  const jobList = [...jobs.values()]
  const named = (p: Person) => !!(p.first.trim() || p.last.trim())
  const candidates = new Map(users.map(u => [u.$id, { id: u.$id, fileId: str(u.cvFileId), bucket: BUCKETS.CVS, person: { first: str(u.firstName), last: str(u.lastName) }, tenantId: str(u.tenantId), jobId: '' } satisfies CvSource]))
  const vivierCvs: CvSource[] = viviers.map(v => ({ id: v.$id, fileId: str(v.cvFileId), bucket: BUCKETS.VIVIER_CVS, person: personFromFullName(str(v.candidateName)), tenantId: str(v.tenantId), jobId: str(v.jobId) }))
  const allCvs = [...candidates.values(), ...vivierCvs].filter(c => c.fileId && named(c.person))

  const texts = new CvTexts()
  const offers = new Offers()
  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string, reason?: string) => {
    const s = (stats.tasks[task] ??= { kept: 0, skipped: {} })
    if (reason) s.skipped[reason] = (s.skipped[reason] ?? 0) + 1
    else s.kept++
  }
  const items: DatasetItem[] = []

  // Matching : notations de la base candidats, CV des viviers d'offres, puis paires au hasard pour compléter.
  type Pair = { key: string; cv: CvSource; job: Models.Document }
  const pairOf = (cv: CvSource | undefined, jobId: string): Pair[] => {
    const job = jobs.get(jobId)
    return cv && job && named(cv.person) ? [{ key: `${cv.fileId}:${jobId}`, cv, job }] : []
  }
  const fromMatches = matches.flatMap(m => pairOf(candidates.get(str(m.candidateId)), str(m.jobId)))
  const fromViviers = vivierCvs.filter(v => v.jobId).flatMap(v => pairOf(v, v.jobId))
  const random = sample(allCvs, limits.matching, `${seed}:rnd-cv`, c => c.fileId).flatMap((cv, i) => {
    const job = jobList.length ? sample(jobList, 1, `${seed}:rnd-job:${i}`, j => j.$id)[0] : undefined
    return job ? [{ key: `${cv.fileId}:${job.$id}`, cv, job }] : []
  })
  const matchingPairs = [
    ...sample(fromMatches, Math.round(limits.matching * 0.4), `${seed}:jm`, p => p.key),
    ...sample(fromViviers, Math.round(limits.matching * 0.3), `${seed}:vo`, p => p.key),
  ]
  const seen = new Set(matchingPairs.map(p => p.key))
  for (const p of random) if (matchingPairs.length < limits.matching && !seen.has(p.key)) { matchingPairs.push(p); seen.add(p.key) }
  await mapLimit(matchingPairs, CONCURRENCY, async p => {
    const cv = await texts.read(p.cv)
    if ('skip' in cv) return note('scoring-matching', cv.skip)
    items.push(scoringItem(project, 'matching', await offers.of(p.job, 'matching'), cv.text))
    note('scoring-matching')
  })

  // Score final : candidatures (CV déposé avec la candidature, nom du compte candidat).
  const finalPairs = sample(apps.flatMap(a => {
    const user = candidates.get(str(a.candidateId))
    const job = jobs.get(str(a.jobId))
    return user && job ? [{ key: a.$id, cv: { ...user, fileId: str(a.cvFileId) }, job }] : []
  }), limits.final, `${seed}:final`, p => p.key)
  await mapLimit(finalPairs, CONCURRENCY, async p => {
    const cv = await texts.read(p.cv)
    if ('skip' in cv) return note('scoring-final', cv.skip)
    items.push(scoringItem(project, 'final', await offers.of(p.job, 'final'), cv.text))
    note('scoring-final')
  })

  // Notation sur critères : offres qui ont des critères (ADR 0061), 3 CV chacune (ses notations, sinon au hasard).
  // Lecture impossible : comptée et affichée (une panne ne doit pas passer pour « aucune offre à critères »).
  const loaded = await mapLimit(jobList, 8, async job => {
    try { return { job, set: await loadOfferCriteria(job.$id) } } catch { note('scoring-criteria', 'critères illisibles'); return { job, set: null } }
  })
  const withCriteria = loaded.filter((x): x is { job: Models.Document; set: OfferCriteriaSet } => x.set !== null)
  // Peu d'offres ont encore leurs critères (fonction récente) : complétées par des offres aux critères par défaut, ceux
  // que l'application leur donne à la publication quand ni l'AO ni l'IA n'en proposent (defaultCriteriaSet).
  const withDefaults = sample(jobList.filter(j => !withCriteria.some(w => w.job.$id === j.$id)), Math.max(0, Math.ceil(limits.criteria / 3) - withCriteria.length), `${seed}:crit-default`, j => j.$id)
    .map(job => ({ job, set: defaultCriteriaSet({ title: str(job.title), skills: Array.isArray(job.skills) ? job.skills.filter((x): x is string => typeof x === 'string') : [], location: str(job.location) || undefined }) }))
  stats.info.push(`${withCriteria.length} offre(s) à critères sur ${jobList.length}, ${withDefaults.length} aux critères par défaut`)
  const criteriaPairs = sample([...withCriteria, ...withDefaults].flatMap(({ job, set }) => {
    const own = fromMatches.filter(p => p.job.$id === job.$id).map(p => p.cv)
    const cvs = own.length >= 3 ? own : [...own, ...sample(allCvs, 3 - own.length, `${seed}:crit:${job.$id}`, c => c.fileId)]
    return cvs.slice(0, 3).map(cv => ({ key: `${cv.fileId}:${job.$id}`, cv, job, set }))
  }), limits.criteria, `${seed}:criteria`, p => p.key)
  await mapLimit(criteriaPairs, CONCURRENCY, async p => {
    const cv = await texts.read(p.cv)
    if ('skip' in cv) return note('scoring-criteria', cv.skip)
    items.push(criteriaItem(project, await offers.of(p.job, 'matching'), p.set, cv.text))
    note('scoring-criteria')
  })

  // Vivier général : un CV et 5 offres de son organisation (au hasard parmi toutes si elle en a moins).
  const batchCvs = sample(allCvs, limits.vivierBatch, `${seed}:batch`, c => c.fileId)
  await mapLimit(batchCvs, CONCURRENCY, async cv => {
    const own = jobList.filter(j => cv.tenantId && str(j.tenantId) === cv.tenantId)
    const pool = own.length >= OFFERS_PER_CALL ? own : jobList
    const chosen = sample(pool, OFFERS_PER_CALL, `${seed}:batch:${cv.fileId}`, j => j.$id)
    if (chosen.length < OFFERS_PER_CALL) return note('vivier-batch', 'pas assez d’offres')
    const text = await texts.read(cv)
    if ('skip' in text) return note('vivier-batch', text.skip)
    items.push(vivierItem(project, chosen.map(toScore), text.text))
    note('vivier-batch')
  })

  return { items, stats }
}
