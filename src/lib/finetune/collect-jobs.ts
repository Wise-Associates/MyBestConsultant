import { createHash } from 'node:crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import { funnelForCandidate, type StepResult } from '../candidate-funnel'
import { jobDraftPrompt, jobImprovePrompt, type JobDraft } from '../job-draft-prompts'
import { improveImportedJobPrompt, jobImportPrompt, type ImprovableJobFields } from '../job-import-prompts'
import { outreachMessagePrompt } from '../outreach-prompt'
import { recommendationMessagePrompt } from '../recommendation-prompt'
import { stepReportPrompt, type InterviewAnalysisFacts } from '../step-report-prompt'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem, type TaskContext } from './mbc-dataset'
import { FAKE_FIRST_NAMES, FAKE_LAST_NAMES, keepsRealName, pseudonymize } from './pseudonymize'

// Demandes des offres (ADR 0063) : rédaction et amélioration d'une offre, import d'un texte d'offres, message d'approche,
// demande de recommandation, compte rendu d'étape. Le besoin tapé par le recruteur, sa demande d'amélioration, le texte
// collé et les destinataires d'une recommandation ne sont jamais enregistrés : ils sont écrits ici d'après des offres
// réelles, par des modèles de phrases variés (tirage stable). Noms des personnes : inventés.

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)
const choose = <T,>(list: readonly T[], seed: string): T => list[hash(seed) % list.length]
const pick = <T extends { $id: string },>(items: T[], n: number, seed: string) => [...items].sort((a, b) => hash(`${seed}:${a.$id}`) - hash(`${seed}:${b.$id}`)).slice(0, n)
const skillsOf = (job: Models.Document) => (Array.isArray(job.skills) ? job.skills.filter((s): s is string => typeof s === 'string') : [])

const CONTRACT_WORDS: Record<string, string[]> = {
  cdi: ['en CDI', 'CDI', 'poste en CDI'], cdd: ['en CDD', 'CDD de 6 mois'], freelance: ['freelance', 'en indépendant', 'free'],
  mission: ['en mission', 'mission de 6 mois', 'mission longue'],
}
const REMOTE_WORDS: Record<string, string[]> = {
  remote: ['full remote', '100 % télétravail'], hybrid: ['2 jours de télétravail', 'hybride'], onsite: ['sur site', 'présentiel'],
}

/** Besoin tel qu'un recruteur le tape (« Publier une offre » → « Générer l'annonce ») : court, plus ou moins soigné. */
export function briefFor(job: Models.Document): string {
  const seed = job.$id
  const title = str(job.title).trim()
  const location = str(job.location).trim()
  const contract = choose(CONTRACT_WORDS[str(job.contractType)] ?? [''], `${seed}:c`)
  const remote = choose(REMOTE_WORDS[str(job.remote)] ?? [''], `${seed}:r`)
  const skills = skillsOf(job).slice(0, 2 + (hash(`${seed}:n`) % 3))
  const pay = typeof job.salary === 'number' && job.salary > 0 ? (job.salary < 3000 ? `TJM ${job.salary} €` : `${Math.round(job.salary / 1000)} k€`) : ''
  const templates = [
    () => `Je cherche un ${title}${location ? ` à ${location}` : ''}${contract ? `, ${contract}` : ''}. Compétences : ${skills.join(', ')}.`,
    () => `Besoin d'un ${title.toLowerCase()} pour un client${location ? ` sur ${location}` : ''} — ${skills.join(' / ')}${remote ? ` — ${remote}` : ''}, démarrage ASAP`,
    () => `${title} H/F${location ? `, ${location}` : ''}${contract ? `, ${contract}` : ''}${pay ? `, ${pay}` : ''}`,
    () => `on recrute ${title.toLowerCase()} ${skills.length ? `(${skills.join(', ')})` : ''}${remote ? ` ${remote}` : ''}${pay ? ` ${pay}` : ''}`,
    () => `Poste : ${title}\nLieu : ${location || 'à définir'}\nStack : ${skills.join(', ')}\n${contract}${pay ? ` · ${pay}` : ''}`,
    () => `Pour une mission chez un grand compte, il nous faut un profil ${title}${skills.length ? ` maîtrisant ${skills.join(' et ')}` : ''}${remote ? `, ${remote}` : ''}.`,
  ]
  return choose(templates, `${seed}:t`)().replace(/\s+,/g, ',').trim()
}

/** Demandes d'amélioration (« Améliorer l'offre ») : ce que les recruteurs demandent le plus. */
const IMPROVE_REQUESTS = [
  'Rends l’annonce plus attractive pour les candidats.', 'Raccourcis la description, elle est trop longue.',
  'Ajoute une section sur les avantages et l’environnement de travail.', 'Mets l’accent sur le télétravail possible.',
  'Rends le ton plus direct et moins corporate.', 'Précise mieux le profil recherché et les années d’expérience.',
  'Structure la description avec des puces.', 'Ajoute les compétences qui manquent pour ce poste.',
  'Corrige les fautes et harmonise la mise en forme.', 'Insiste sur les missions techniques du poste.',
] as const

const draftOf = (job: Models.Document): JobDraft => ({
  title: str(job.title), description: maskLeftoverContacts(str(job.description)), skills: skillsOf(job), location: str(job.location),
  contractType: (['cdi', 'cdd', 'freelance', 'mission'].includes(str(job.contractType)) ? str(job.contractType) : '') as JobDraft['contractType'],
  remote: (['onsite', 'hybrid', 'remote'].includes(str(job.remote)) ? str(job.remote) : '') as JobDraft['remote'],
  salary: typeof job.salary === 'number' ? job.salary : null,
})

/** Champs dans l'ordre où le formulaire d'import les envoie (JSON.stringify garde l'ordre des clés). */
const importFieldsOf = (job: Models.Document): ImprovableJobFields => {
  const d = draftOf(job)
  return { title: d.title, description: d.description, skills: d.skills, location: d.location, contractType: d.contractType || 'mission', remote: d.remote || 'onsite', salary: d.salary }
}

/** Texte collé ou fichier importé : une ou plusieurs annonces mises bout à bout, comme un tableau d'offres copié. */
const adText = (job: Models.Document) =>
  [str(job.title), str(job.location) && `Lieu : ${str(job.location)}`, skillsOf(job).length ? `Compétences : ${skillsOf(job).join(', ')}` : '', maskLeftoverContacts(str(job.description))].filter(Boolean).join('\n')

const RESULTS: StepResult[] = ['positive', 'positive', 'neutral', 'negative']
const NOTES = [
  'Bon échange, à l’aise sur les sujets techniques.', 'Communication claire, motivé par le projet.',
  'Un peu juste sur l’expérience demandée.', 'Disponible rapidement, prétentions dans la cible.',
  'Manque d’exemples concrets sur la gestion d’équipe.', '', '',
] as const
const PERIODS = ['2019 – 2022', '2021 – 2023', 'depuis 2022', '2016 – 2020', 'en 2023'] as const

const fakeName = (seed: string) => ({ first: choose(FAKE_FIRST_NAMES, `${seed}:f`), last: choose(FAKE_LAST_NAMES, `${seed}:l`) })

export async function collectJobs(project: string): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const [jobDocs, apps, interviews, users] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.select(['$id', 'title', 'description', 'skills', 'location', 'contractType', 'remote', 'salary', 'companyName'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [Query.select(['$id', 'jobId', 'candidateId', 'status', 'aiScore', 'aiSummary', 'note', 'funnelJson'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.INTERVIEWS, [Query.select(['$id', 'applicationId', 'analysis'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.select(['$id', 'firstName', 'lastName'])]),
  ])
  const jobs = jobDocs.filter(j => str(j.title).trim() && str(j.description).length >= 150)
  const jobsById = new Map(jobs.map(j => [j.$id, j]))
  const people = new Map(users.map(u => [u.$id, { first: str(u.firstName), last: str(u.lastName) }]))
  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string, reason?: string) => {
    const s = (stats.tasks[task] ??= { kept: 0, skipped: {} })
    if (reason) s.skipped[reason] = (s.skipped[reason] ?? 0) + 1
    else s.kept++
  }
  const items: DatasetItem[] = []
  const add = (ctx: TaskContext, group: string, prompt: { system: string; user: string }) => {
    items.push({ id: itemId(ctx.task, textKey(prompt.system), textKey(prompt.user)), group, project, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], ctx })
    note(ctx.task)
  }
  const groupOf = (job: Models.Document) => `offre:${textKey(`${str(job.title)}\n${str(job.description)}`)}`

  for (const job of pick(jobs, 60, `draft:${project}`)) {
    // Un tiers : « Régénérer » (variante d'une annonce déjà proposée).
    const regenerate = hash(`${job.$id}:regen`) % 3 === 0
    add({ task: 'job-draft' }, groupOf(job), jobDraftPrompt({ need: briefFor(job), ...(regenerate ? { previousDraft: draftOf(job) } : {}) }))
  }
  for (const job of pick(jobs, 50, `improve:${project}`)) {
    add({ task: 'job-improve' }, groupOf(job), jobImprovePrompt({ request: choose(IMPROVE_REQUESTS, `${job.$id}:req`), currentDraft: draftOf(job) }))
  }
  for (const job of pick(jobs, 50, `import:${project}`)) {
    // Un tiers des textes contient plusieurs annonces.
    const extra = hash(`${job.$id}:multi`) % 3 === 0 ? pick(jobs, 2, `multi:${job.$id}`).filter(j => j.$id !== job.$id) : []
    const text = [job, ...extra].map(adText).join('\n\n---\n\n').slice(0, 15_000)
    const company = str(job.companyName) || `${choose(FAKE_FIRST_NAMES, job.$id)} ${choose(FAKE_LAST_NAMES, job.$id)}`
    add({ task: 'job-import' }, groupOf(job), jobImportPrompt({ text, filename: choose(['paste', 'offres.docx', 'besoin-client.pdf', 'offre.txt'], `${job.$id}:file`), defaultCompany: company }))
  }
  for (const job of pick(jobs, 40, `import-improve:${project}`)) {
    const fields = importFieldsOf(job)
    add({ task: 'job-import-improve', job: fields }, groupOf(job), improveImportedJobPrompt({ job: fields, request: choose(IMPROVE_REQUESTS, `${job.$id}:ireq`) }))
  }
  for (const job of pick(jobs, 60, `outreach:${project}`)) {
    const person = fakeName(job.$id)
    add({ task: 'outreach', jobTitle: str(job.title) }, groupOf(job), outreachMessagePrompt({ candidateFirstName: person.first, candidateLastName: person.last, jobTitle: str(job.title), jobSkills: skillsOf(job), jobLocation: str(job.location) }))
  }
  for (const job of pick(jobs, 40, `reco:${project}`)) {
    const candidate = fakeName(`${job.$id}:cand`)
    const recipient = fakeName(`${job.$id}:dest`)
    const withDetails = hash(`${job.$id}:det`) % 4 !== 0
    add({ task: 'recommendation' }, groupOf(job), recommendationMessagePrompt({
      candidateFirstName: candidate.first, candidateLastName: candidate.last, recipientName: `${recipient.first} ${recipient.last}`,
      ...(withDetails ? { recipientCompany: str(job.companyName) || undefined, experience: str(job.title), period: choose(PERIODS, `${job.$id}:p`) } : {}),
    }))
  }

  // Comptes rendus d'étape : candidatures réelles (screening, note, analyses d'entretien), nom du candidat remplacé.
  const analysesByApp = new Map<string, InterviewAnalysisFacts[]>()
  let unreadable = 0
  for (const i of interviews.filter(i => str(i.analysis).trim())) {
    let a: unknown
    try { a = JSON.parse(str(i.analysis)) } catch { unreadable++; continue }
    if (a && typeof a === 'object') analysesByApp.set(str(i.applicationId), [...(analysesByApp.get(str(i.applicationId)) ?? []), a as InterviewAnalysisFacts])
  }
  if (unreadable) stats.info.push(`${unreadable} analyse(s) d'entretien illisible(s), ignorée(s)`)
  const reportable = apps.filter(a => jobsById.has(str(a.jobId)) && (str(a.aiSummary).trim() || analysesByApp.has(a.$id)))
  for (const app of pick(reportable, 60, `report:${project}`)) {
    const person = people.get(str(app.candidateId)) ?? { first: '', last: '' }
    const clean = (s: string) => maskLeftoverContacts(pseudonymize(s, [person]))
    const { steps } = funnelForCandidate(app.funnelJson, str(app.status) || 'screening')
    const step = steps.find(s => s.status !== 'validated' && s.type !== 'hired') ?? steps[0]
    if (!step) { note('step-report', 'funnel vide'); continue }
    const analyses = (analysesByApp.get(app.$id) ?? []).slice(0, 3).map(a => ({ ...a, summary: a.summary ? clean(str(a.summary)) : a.summary }))
    const input = {
      jobTitle: str(jobsById.get(str(app.jobId))?.title), step: { label: step.label, type: step.type },
      funnelSteps: steps.map(s => ({ label: s.label, status: s.status, report: s.report ? clean(str(s.report)) : s.report })),
      result: choose(RESULTS, `${app.$id}:res`), notes: choose(NOTES, `${app.$id}:notes`),
      applicationNote: app.note ? clean(str(app.note)) : null, aiScore: typeof app.aiScore === 'number' ? app.aiScore : null,
      aiSummary: app.aiSummary ? clean(str(app.aiSummary)) : null, interviewAnalyses: analyses,
    }
    const prompt = stepReportPrompt(input)
    if (keepsRealName(prompt.user, person)) { note('step-report', 'nom resté après remplacement'); continue }
    add({ task: 'step-report' }, `candidature:${textKey(prompt.user)}`, prompt)
  }
  stats.info.push(`${reportable.length} candidature(s) avec screening ou entretien pour les comptes rendus`)
  return { items, stats }
}
