import { createHash } from 'node:crypto'
import { Query } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import { briefCriteriaPrompt, briefQuestionsPrompt, evaluationPrompt, outreachPrompt } from '../mbc-search/prompts'
import { OUTREACH_CHANNELS, outreachNeedText, outreachPersonSchema, outreachPersonText, readCriteria, type MbcCriteria, type MbcRevealed } from '../mbc-search/rules'
import type { CollectStats } from './collect-scoring'
import { briefFor } from './collect-jobs'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'
import { FAKE_FIRST_NAMES, FAKE_LAST_NAMES } from './pseudonymize'

// Demandes de MBC Search (ADR 0063) : besoins enregistrés (`mbc_searches.brief`, critères `criteriaJson`) et besoins
// écrits d'après des offres réelles (briefFor, comme pour la rédaction d'une offre), profils révélés (`mbc_reveals`)
// sans nom, e-mail, lien ni photo. Les stratégies et l'ajustement des critères suivent la réponse « besoin → critères »
// (mbcFollowUpItems) ; la comparaison des intitulés suit l'évaluation d'un profil, comme dans l'application.

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)
const choose = <T,>(list: readonly T[], seed: string): T => list[hash(seed) % list.length]

/** Messages du recruteur dans la conversation, après la première recherche. */
const REFINE_MESSAGES = [
  'Élargis à toute l’Île-de-France.', 'Ajoute la compétence Kubernetes.', 'Seulement des profils seniors.',
  'Retire la contrainte de localisation, le télétravail est possible.', 'Je veux uniquement des profils avec une adresse e-mail.',
  'Cherche aussi les intitulés en anglais.', 'Plutôt des profils du secteur bancaire.', 'Enlève Java, ce n’est pas obligatoire.',
] as const

function parseJson<T>(raw: unknown): T | null {
  try { return JSON.parse(str(raw)) as T } catch { return null }
}

/** Profil révélé sans ce qui identifie la personne : nom inventé, ni e-mail, ni lien, ni photo, ni téléphone. */
function anonymousProfile(p: MbcRevealed, seed: string): MbcRevealed {
  return {
    ...p, name: `${choose(FAKE_FIRST_NAMES, `${seed}:f`)} ${choose(FAKE_LAST_NAMES, `${seed}:l`)}`, email: '', emailStatus: '', linkedinUrl: '', photoUrl: '', phone: undefined,
    headline: maskLeftoverContacts(str(p.headline)),
    experiences: (p.experiences ?? []).map(e => ({ ...e, description: maskLeftoverContacts(str(e.description)) })),
  }
}

export async function collectMbcSearch(project: string, limits: { inventedBriefs: number }): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const [searches, reveals, jobs] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.MBC_SEARCHES, [Query.select(['$id', 'brief', 'criteriaJson'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.MBC_REVEALS, [Query.select(['$id', 'profileJson'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.select(['$id', 'title', 'description', 'skills', 'location', 'contractType', 'remote', 'salary'])]),
  ])
  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string) => { (stats.tasks[task] ??= { kept: 0, skipped: {} }).kept++ }
  const items: DatasetItem[] = []
  const add = (task: DatasetItem['ctx'], prompt: { system: string; user: string }, group: string) => {
    items.push({ id: itemId(task.task, textKey(prompt.system), textKey(prompt.user)), group, project, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], ctx: task })
    note(task.task)
  }

  // Besoins : ceux des recherches enregistrées, puis des besoins écrits d'après des offres (peu de recherches réelles).
  const saved = searches.map(s => ({ brief: maskLeftoverContacts(str(s.brief)).trim(), criteria: readCriteria(parseJson<Record<string, unknown>>(s.criteriaJson) ?? {}) }))
    .filter(s => s.brief)
  const invented = jobs.filter(j => str(j.title).trim())
    .sort((a, b) => hash(`mbc:${project}:${a.$id}`) - hash(`mbc:${project}:${b.$id}`)).slice(0, limits.inventedBriefs)
    .map(j => ({ brief: briefFor(j), criteria: null as MbcCriteria | null }))
  for (const { brief } of [...saved, ...invented]) {
    const group = `besoin:${textKey(brief)}`
    add({ task: 'mbc-brief-criteria', brief, refineMessage: choose(REFINE_MESSAGES, brief) }, briefCriteriaPrompt(brief), group)
    add({ task: 'mbc-questions' }, briefQuestionsPrompt(brief), group)
  }

  // Évaluation et message d'approche : profils révélés, face au besoin d'une recherche enregistrée (ses critères).
  const withCriteria = saved.filter((s): s is { brief: string; criteria: MbcCriteria } => s.criteria !== null)
  const profiles = reveals.map(r => parseJson<MbcRevealed>(r.profileJson)).filter((p): p is MbcRevealed => !!p && Array.isArray(p.experiences))
  if (withCriteria.length) {
    profiles.forEach((profile, i) => {
      const search = withCriteria[hash(`eval:${i}`) % withCriteria.length]
      const person = anonymousProfile(profile, `${project}:${i}`)
      const group = `profil:${textKey(JSON.stringify(person.experiences))}`
      const evaluation = evaluationPrompt({ brief: search.brief, criteria: search.criteria, profile: person })
      add({ task: 'mbc-evaluation', judged: evaluation.judged, cvText: evaluation.cvText }, evaluation, group)
      const recruiter = `${choose(FAKE_FIRST_NAMES, `rec:${i}`)} ${choose(FAKE_LAST_NAMES, `rec:${i}`)}`
      const firstName = person.name.split(' ')[0]
      const outreachPerson = outreachPersonSchema.parse({
        firstName, title: str(person.title).slice(0, 200), company: str(person.company).slice(0, 200),
        experiences: person.experiences.slice(0, 8).map(e => ({ title: str(e.title).slice(0, 200), company: str(e.company).slice(0, 200) })),
      })
      add({ task: 'mbc-outreach' }, outreachPrompt({ need: outreachNeedText(search.brief, search.criteria), recruiter, person: outreachPersonText(outreachPerson), channel: choose(OUTREACH_CHANNELS, `canal:${i}`) }), group)
    })
  }
  stats.info.push(`${saved.length} besoin(s) enregistré(s), ${invented.length} écrit(s) d'après des offres, ${profiles.length} profil(s) révélé(s)`)
  return { items, stats }
}
