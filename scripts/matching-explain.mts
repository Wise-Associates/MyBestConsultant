#!/usr/bin/env -S npx tsx
// Explique la note d'un CV pour une offre (Matching IA, ADR 0028 et 0029), SANS RIEN ÉCRIRE : lit l'offre et le CV, les
// fait juger par l'IA du « Matching IA » de Config IA avec exactement le code de l'application (cvScorer, sourcing-core.ts :
// la notation des candidatures, de la base candidats et du vivier de l'offre),
// puis affiche les jugements, leurs preuves, le score calculé et son plafond, à côté du score enregistré aujourd'hui.
// Sert à vérifier un score contesté avant de le recalculer sur la page.
//   npm run matching:explain -- .env.dev --job <id de l'offre> --cv <id du fichier CV> [--final]
// Barème du matching par défaut (base candidats, viviers), ou les critères de l'offre si elle en a (ADR 0061) ; --final :
// score final d'une candidature (ADR 0036).
//   npm run matching:explain -- .env.prod --prod --job <…> --cv <…>    (production : lecture seule, un appel d'IA)
// L'identifiant du CV est celui de l'adresse /api/cv/<id>. Aucune valeur secrète n'est affichée ; les preuves citées par
// l'IA reprennent des expériences du CV (à ne pas copier hors de l'équipe).

import { readFileSync } from 'node:fs'

const DEV_PROJECT_ID = 'bestconsultant-dev'

/** Lecture d'un fichier .env : fins de ligne Windows, guillemets simples ou doubles, commentaire en fin de valeur. */
function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    const quoted = value.match(/^(['"])(.*)\1$/)
    if (quoted) value = quoted[2]
    else value = value.replace(/\s+#.*$/, '')
    env[m[1]] = value
  }
  return env
}

const args = process.argv.slice(2)
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const [file] = args
const jobId = option('--job')
const cvFileId = option('--cv')
if (!file || file.startsWith('--') || !jobId || !cvFileId) {
  console.error('Usage : npm run matching:explain -- <fichier .env> [--prod] --job <id de l\'offre> --cv <id du fichier CV> [--final]')
  process.exit(1)
}
const env = readEnv(file)
for (const name of [
  'APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'APPWRITE_COLLECTION_JOBS',
  'APPWRITE_COLLECTION_APPLICATIONS', 'APPWRITE_COLLECTION_USERS', 'APPWRITE_COLLECTION_JOB_MATCHES', 'APPWRITE_STORAGE_CVS',
]) {
  if (!env[name]) { console.error(`${name} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !args.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer (lecture seule).`)
  process.exit(1)
}
// Avant d'importer le code de l'application : il lit ses collections et ses clés dans process.env au chargement.
Object.assign(process.env, env)

const { Query } = await import('node-appwrite')
const { createAdminClient } = await import('../src/lib/appwrite/client')
const { DB_ID, COLLECTIONS } = await import('../src/lib/appwrite/config')
const { aoSourceContext, criteriaScorer, cvScorer, finalOfferDetails, readCvForScoring } = await import('../src/lib/sourcing-core')
const { loadOfferCriteria } = await import('../src/lib/offer-criteria-store')
const { criteriaBreakdown } = await import('../src/lib/criteria-scoring')
const { judgedResult, labelOf, offerDetails } = await import('../src/lib/match-scoring')
const scale = args.includes('--final') ? 'final' as const : 'matching' as const

const { databases } = createAdminClient()
let job: Awaited<ReturnType<typeof databases.getDocument>>
try {
  job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
} catch (err) {
  console.error(`Offre ${jobId} illisible : ${(err as Error).message}`)
  process.exit(1)
}
const cvText = await readCvForScoring(cvFileId)
if (!cvText) {
  console.error(`CV ${cvFileId} illisible (fichier introuvable, scanné ou vide) : rien à noter.`)
  process.exit(1)
}

// Score enregistré aujourd'hui pour ce CV sur cette offre (candidature ou base candidats), pour comparer.
const stored: string[] = []
const apps = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [Query.equal('jobId', jobId), Query.equal('cvFileId', cvFileId), Query.limit(5)])
for (const a of apps.documents) stored.push(`candidature : ${a.aiScore ?? 'non notée'}`)
const owners = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('cvFileId', cvFileId), Query.select(['$id']), Query.limit(5)])
if (owners.documents.length > 0) {
  const pool = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
    Query.equal('jobId', jobId), Query.equal('candidateId', owners.documents.map(o => o.$id)), Query.limit(5),
  ])
  for (const m of pool.documents) stored.push(`base candidats : ${m.score}`)
}

console.log(`Projet ${env.APPWRITE_PROJECT_ID} — offre « ${job.title} » — barème : ${scale === 'final' ? 'score final' : 'matching'}`)
console.log(`CV ${cvFileId} : ${cvText.length} caractères lus. Score enregistré aujourd'hui : ${stored.join(' ; ') || 'aucun'}.`)
console.log('Notation en cours (un appel d\'IA, rien n\'est enregistré)…\n')

const offer = {
  title: String(job.title ?? ''), skills: (job.skills as string[]) ?? [], description: String(job.description ?? ''),
  details: scale === 'final' ? await finalOfferDetails(job) : offerDetails(job),
  sourceContext: await aoSourceContext(job),
}
// Critères de l'offre (ADR 0061) : la notation « matching » de l'application se fait sur eux.
const criteriaSet = scale === 'matching' ? await loadOfferCriteria(job.$id) : null
// Toujours un vrai appel d'IA : le script montre ce que l'IA répond, jamais une notation gardée (ADR 0044).
const result = criteriaSet ? await criteriaScorer(offer, criteriaSet, { useCache: false })(cvText) : await cvScorer(offer, scale, { useCache: false })(cvText)
if (!result) {
  console.error('Réponse de l\'IA sans jugement lisible : relancez (l\'application laisserait ce CV à noter).')
  process.exit(1)
}

/**
 * Ce que l'IA a cité pour un élément (affichage seulement) : la ligne du CV, ou l'intitulé du poste. Le jugement affiché
 * est celui retenu après vérification dans le CV ; l'IA a pu répondre plus haut (« IA : oui »).
 */
const proofOf = (item: unknown, kept: string) => {
  const obj = item && typeof item === 'object' ? item as Record<string, unknown> : {}
  const said = typeof obj.exerce === 'string' ? obj.exerce : typeof obj.jugement === 'string' ? obj.jugement : ''
  const quote = [obj.intitule, obj.citation].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  return `${said && said !== kept ? ` (IA : ${said}, ramené après vérification dans le CV ou comparaison des intitulés)` : ''}${quote ? ` — cite : « ${quote.trim()} »` : ''}`
}
const answer = result.answer as Record<string, unknown>
const at = (key: string, i: number) => (Array.isArray(answer[key]) ? (answer[key] as unknown[])[i] : answer[key])

if ('set' in result) {
  // Critères de l'offre : chaque libellé, son jugement et sa preuve, puis le score aux poids des critères.
  const breakdown = criteriaBreakdown(result.reason, result.set)
  console.log('Critères de l\'offre (poids ; libellés : poids dans le critère, ★ requis) :')
  result.set.criteria.forEach((c, ci) => {
    console.log(`${c.name} (${c.weight}) : ${breakdown ? `${breakdown.parts[ci].percent} %` : ''}`)
    const values = c.id === 'poste' ? result.judgements.roles.map(r => r.fit) : result.judgements.criteria[ci].values
    const names = c.labels.length > 0 ? c.labels.map(l => `${l.label} (${l.weight}${l.required ? ' ★' : ''})`)
      : c.id === 'poste' ? result.judgements.roles.map(r => r.title || 'poste') : [c.labels.length ? '' : 'ensemble']
    values.forEach((v, k) => console.log(`  - ${names[k] ?? 'ensemble'} : ${v}${proofOf(at(c.id, k), v)}`))
  })
  console.log(`\nScore calculé : ${result.score}${breakdown?.cap ? ` (plafonné à ${breakdown.cap.value} : ${breakdown.cap.reason})` : ''}`)
  console.log(`Raison enregistrée : ${result.reason}`)
  process.exit(0)
}
const { judgements: j, criteria } = result

console.log('Poste (titre de l\'offre) :')
j.roles.forEach((r, i) => console.log(`  - ${r.title || 'poste'} : ${r.fit}${proofOf(at('poste', i), r.fit)}`))
console.log(`Exigences (tirées de la description${criteria.requirements.length ? '' : ' : aucune liste, jugement d\'ensemble'}) :`)
j.requirements.forEach((v, i) => console.log(`  ${i + 1}. ${criteria.requirements[i] ?? 'ensemble'} : ${v}${proofOf(at('exigences', i), v)}`))
console.log(`Compétences demandées${criteria.skills.length ? '' : ' (aucune liste, jugement d\'ensemble)'} :`)
j.skills.forEach((v, i) => console.log(`  ${i + 1}. ${criteria.skills[i] ?? 'ensemble'} : ${v}${proofOf(at('competences', i), v)}`))
console.log(Object.entries(j.fits).map(([key, fit]) => `${labelOf(scale, key as keyof typeof j.fits)} : ${fit}`).join(' · '))
const { cap } = judgedResult(j)
console.log(`\nScore calculé : ${result.score}${cap ? ` (plafonné à ${cap.value} : ${labelOf(scale, cap.key)} ${cap.level})` : ''}`)
console.log(`Raison affichée : ${result.reason}`)
console.log('Recommandations reçues par le candidat sur les expertises de l\'offre : bonus ajouté au score affiché (non calculé ici).')
