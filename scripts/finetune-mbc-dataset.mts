#!/usr/bin/env -S npx tsx
// Jeu d'affinage multi-tâches du 3B (ADR 0063) : demandes tirées des données réelles (consignes et messages construits par
// les fonctions mêmes de l'application), réponses d'un enseignant (Claude Sonnet 5.5, en lots à moitié prix) gardées si la
// lecture de l'application les accepte, puis répartition entraînement / contrôle / test. Le dossier de sortie contient des
// données personnelles (noms remplacés, coordonnées masquées, mais textes de CV) : hors de tout dépôt, supprimé après usage.
//   npm run finetune:mbc-dataset -- collect .env.dev --out <dossier>            → DEV : inputs-<projet>.jsonl (lecture seule)
//   npm run finetune:mbc-dataset -- collect .env.prod --prod --out <dossier>    → production (lecture seule)
//   npm run finetune:mbc-dataset -- teach --out <dossier>                       → coût estimé des demandes sans réponse
//   npm run finetune:mbc-dataset -- teach --out <dossier> --apply --max-usd 40  → envoi en lot (payant), clé
//        FT_ANTHROPIC_API_KEY lue dans le .env du déployeur (--key-env pour un autre fichier) ; relancer pour lire le
//        résultat d'un lot en cours, puis pour les comparaisons d'intitulés qui suivent les notations
//   npm run finetune:mbc-dataset -- split --out <dossier> [--classification <dossier>]
//        → train.jsonl, validation.jsonl, test.jsonl (format du déployeur), test-items.jsonl (évaluation) ; les exemples
//          de classification déjà répartis (ADR 0058) sont ajoutés tels quels, test inchangé
// Aucune donnée de CV ni valeur secrète n'est affichée : seulement des nombres.
import Anthropic from '@anthropic-ai/sdk'
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePrivateDir, readEnv, refuseGitOutDir, writePrivate } from './finetune-shared.mjs'
import {
  TASKS, TEACHER, chatExample, estimateCost, estimateTokens, followUpItems, splitOf, teacherAnswer, type DatasetItem,
} from '../src/lib/finetune/mbc-dataset'
import { claudeProblem, openAiProblem } from '../src/lib/ao/ai-failures'
import { mapLimit } from '../src/lib/concurrency'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const USAGE = 'Usage : npm run finetune:mbc-dataset -- collect <fichier .env> [--prod] [--tasks scoring,cv-export,assistant,interviews,jobs,content,ao,mbc-search] --out <dossier> | ' +
  'teach --out <dossier> [--sample N] [--apply --max-usd <dollars>] [--teacher openai] [--key-env <fichier>] | split --out <dossier> [--classification <dossier>]'
/** Familles de tâches exportées par `collect` (--tasks), et leurs demandes par projet (avant le retrait des doublons). */
const FAMILIES = {
  scoring: async (project: string) => (await import('../src/lib/finetune/collect-scoring')).collectScoring(project, { matching: 160, final: 120, criteria: 80, vivierBatch: 60 }),
  'cv-export': async (project: string) => (await import('../src/lib/finetune/collect-cv')).collectCvExport(project, 50),
  assistant: async (project: string) => (await import('../src/lib/finetune/collect-assistant')).collectAssistant(project),
  interviews: async (project: string) => (await import('../src/lib/finetune/collect-interviews')).collectInterviews(project),
  jobs: async (project: string) => (await import('../src/lib/finetune/collect-jobs')).collectJobs(project),
  content: async (project: string) => (await import('../src/lib/finetune/collect-content')).collectContent(project, { cvProfile: 60, social: 60 }),
  ao: async (project: string) => (await import('../src/lib/finetune/collect-ao')).collectAo(project, { publication: 80, criteria: 60 }),
  'mbc-search': async (project: string) => (await import('../src/lib/finetune/collect-mbc-search')).collectMbcSearch(project, { inventedBriefs: 50 }),
}
type Family = keyof typeof FAMILIES

/** Prix estimés de GPT-4o par million de jetons (valeurs par défaut de Config IA, src/app/admin/llm-config/types.ts). */
const OPENAI = { model: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 } as const

const [command, ...args] = process.argv.slice(2)
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const outArg = option('--out')
if (!['collect', 'teach', 'split', 'eval'].includes(command ?? '') || !outArg) {
  console.error(USAGE)
  process.exit(1)
}
const outDir = resolve(outArg)
refuseGitOutDir(outDir)

const readJsonl = <T,>(path: string): T[] =>
  existsSync(path) ? readFileSync(path, 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T) : []

/** Demandes de tous les projets exportés, sans doublon (même CV et même offre en DEV et en production : une seule). */
function loadItems(): DatasetItem[] {
  const files = existsSync(outDir) ? readdirSync(outDir).filter(f => /^inputs-[\w-]+\.jsonl$/.test(f)).sort() : []
  const byId = new Map<string, DatasetItem>()
  for (const f of files) for (const item of readJsonl<DatasetItem>(join(outDir, f))) if (!byId.has(item.id)) byId.set(item.id, item)
  return [...byId.values()]
}

interface AnswerLine { id: string; answer?: string; reason?: string; inputTokens?: number; outputTokens?: number; teacher?: string }
const ANSWERS = () => join(outDir, 'answers.jsonl')
const BATCHES = () => join(outDir, 'batches.jsonl')
/** Dernière réponse enregistrée de chaque demande. */
const loadAnswers = () => new Map(readJsonl<AnswerLine>(ANSWERS()).map(a => [a.id, a]))

/**
 * Demandes connues : exportées, plus celles qui suivent une réponse acceptée dans l'application (comparaison des
 * intitulés après une notation, traduction après la lecture d'un CV), et ainsi de suite.
 */
function allItems(answers: Map<string, AnswerLine>): DatasetItem[] {
  const all: DatasetItem[] = []
  let wave = loadItems()
  while (wave.length) {
    all.push(...wave)
    wave = wave.flatMap(item => {
      const answer = answers.get(item.id)?.answer
      return answer ? followUpItems(item, answer) : []
    })
  }
  return all
}

function printCost(items: DatasetItem[]) {
  const lines = estimateCost(items)
  for (const l of lines) {
    console.log(`  ${TASKS[l.task].label.padEnd(40)} ${String(l.items).padStart(5)} demandes  ~${(l.inputTokens / 1e6).toFixed(2)} M jetons lus  ~${(l.outputTokens / 1e6).toFixed(2)} M écrits  ~${l.usd.toFixed(2)} $`)
  }
  const total = lines.reduce((s, l) => s + l.usd, 0)
  console.log(`  Total estimé (lot à moitié prix, ${TEACHER.model}) : ~${total.toFixed(2)} $`)
  return total
}

if (command === 'collect') {
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
  if (!file) { console.error(USAGE); process.exit(1) }
  const env = readEnv(file)
  const required = [
    'APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'APPWRITE_COLLECTION_JOBS', 'APPWRITE_COLLECTION_USERS',
    'APPWRITE_COLLECTION_VIVIER_CVS', 'APPWRITE_COLLECTION_APPLICATIONS', 'APPWRITE_COLLECTION_JOB_MATCHES', 'APPWRITE_STORAGE_CVS', 'APPWRITE_STORAGE_VIVIER_CVS',
  ]
  const missing = required.filter(name => !env[name])
  if (missing.length) { console.error(`Variables manquantes dans ${file} : ${missing.join(', ')}.`); process.exit(1) }
  // Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
  if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !args.includes('--prod')) {
    console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer (lecture seule).`)
    process.exit(1)
  }
  // Index de recherche jamais lu ni écrit ici ; les modules de l'application lisent leur configuration dans process.env.
  env.MEILI_URL = ''
  env.MEILI_API_KEY = ''
  Object.assign(process.env, env)
  const families = (option('--tasks') ?? Object.keys(FAMILIES).join(',')).split(',').map(f => f.trim())
  const unknown = families.filter(f => !(f in FAMILIES))
  if (unknown.length) { console.error(`--tasks : familles inconnues ${unknown.join(', ')} (connues : ${Object.keys(FAMILIES).join(', ')}).`); process.exit(1) }
  ensurePrivateDir(outDir)
  for (const family of families as Family[]) {
    const { items, stats } = await FAMILIES[family](env.APPWRITE_PROJECT_ID)
    const out = join(outDir, `inputs-${env.APPWRITE_PROJECT_ID}-${family}.jsonl`)
    writePrivate(`${out}.new`, items.map(i => JSON.stringify(i)).join('\n') + '\n')
    // Remplacement d'un export précédent de la même famille (writePrivate écrit un fichier neuf).
    renameSync(`${out}.new`, out)
    console.log(`Projet ${env.APPWRITE_PROJECT_ID}, ${family} : ${items.length} demandes écrites dans ${out}.`)
    for (const line of stats.info) console.log(`  ${line}`)
    for (const [task, s] of Object.entries(stats.tasks)) {
      const skipped = Object.entries(s.skipped).map(([r, n]) => `${n} ${r}`).join(', ')
      console.log(`  ${task.padEnd(18)} ${s.kept} gardées${skipped ? ` ; écartées : ${skipped}` : ''}`)
    }
    printCost(items)
  }
  process.exit(0)
}

if (command === 'teach') {
  let answers = loadAnswers()
  // Journal des lots : une ligne à l'envoi ({ batchId, ids }), une à la lecture du résultat ({ ended }).
  const log = readJsonl<{ batchId?: string; ended?: string }>(BATCHES())
  const done = new Set(log.map(b => b.ended).filter(Boolean))
  const running = log.filter((b): b is { batchId: string } => !!b.batchId && !done.has(b.batchId))

  const apply = args.includes('--apply')
  const needKey = apply || running.length > 0
  let client: Anthropic | null = null
  if (needKey) {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const keyFile = resolve(option('--key-env') ?? join(repoRoot, '..', 'nosana-llm-deployer', '.env'))
    const apiKey = existsSync(keyFile) ? readEnv(keyFile).FT_ANTHROPIC_API_KEY?.trim() : ''
    if (!apiKey) { console.error(`FT_ANTHROPIC_API_KEY absente de ${keyFile} : clé dédiée à l'affinage, jamais celle de Config IA.`); process.exit(1) }
    client = new Anthropic({ apiKey, maxRetries: 3 })
  }

  // Lots déjà envoyés : résultat lu s'ils sont finis.
  for (const b of running) {
    if (!client) break
    const batch = await client.messages.batches.retrieve(b.batchId)
    if (batch.processing_status !== 'ended') {
      const c = batch.request_counts
      console.log(`Lot ${b.batchId} en cours : ${c.succeeded} réussies, ${c.errored} en erreur, ${c.processing} en attente. Relancez plus tard.`)
      process.exit(0)
    }
    const byCustomId = new Map(allItems(loadAnswers()).map(i => [customId(i.id), i]))
    let accepted = 0
    let creditErrors = 0
    const reasons: Record<string, number> = {}
    for await (const result of await client.messages.batches.results(b.batchId)) {
      const item = byCustomId.get(result.custom_id)
      if (!item) continue
      let line: AnswerLine
      // Crédits épuisés en cours de lot : rien n'est noté, la demande reste à faire (repli sur OpenAI au prochain envoi).
      if (result.result.type === 'errored' && /billing|credit/i.test(JSON.stringify(result.result.error))) { creditErrors++; continue }
      if (result.result.type !== 'succeeded') line = { id: item.id, reason: `lot : ${result.result.type}` }
      else {
        const message = result.result.message
        const text = message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
        const usage = { inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), outputTokens: message.usage.output_tokens }
        if (message.stop_reason === 'refusal') line = { id: item.id, reason: 'refus de l’enseignant', ...usage }
        else if (message.stop_reason === 'max_tokens') line = { id: item.id, reason: 'réponse coupée', ...usage }
        else {
          const verdict = teacherAnswer(item.ctx, text)
          // L'élève répond sans réfléchir, dans la limite de l'application : une réponse plus longue n'est pas un modèle.
          if ('answer' in verdict && estimateTokens(verdict.answer) > TASKS[item.ctx.task].appMaxTokens) line = { id: item.id, reason: 'réponse plus longue que la limite de l’application', ...usage }
          else line = { id: item.id, ...verdict, ...usage, teacher: TEACHER.model }
        }
      }
      if (line.answer) accepted++
      else reasons[line.reason ?? '?'] = (reasons[line.reason ?? '?'] ?? 0) + 1
      appendFileSync(ANSWERS(), JSON.stringify(line) + '\n', { mode: 0o600 })
    }
    appendFileSync(BATCHES(), JSON.stringify({ ended: b.batchId, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
    console.log(`Lot ${b.batchId} lu : ${accepted} réponses gardées ; écartées : ${Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join(', ') || 'aucune'}.`)
    if (creditErrors) console.log(`  ${creditErrors} demandes refusées faute de crédits Claude : relancez « teach --apply » (repli sur OpenAI).`)
    answers = loadAnswers()
  }

  // --sample N : N demandes par tâche seulement (essai de bout en bout avant le lot complet).
  const sample = Number(option('--sample'))
  const perTask = new Map<string, number>()
  const pending = allItems(answers).filter(i => !answers.has(i.id)).filter(i => {
    if (!(sample > 0)) return true
    const n = perTask.get(i.ctx.task) ?? 0
    perTask.set(i.ctx.task, n + 1)
    return n < sample
  })
  if (!pending.length) {
    console.log('Toutes les demandes ont une réponse : passez à split.')
    process.exit(0)
  }
  console.log(`${pending.length} demandes sans réponse :`)
  const estimate = printCost(pending)
  if (!apply) { console.log('Estimation seulement : --apply --max-usd <dollars> pour envoyer le lot.'); process.exit(0) }
  const maxUsd = Number(option('--max-usd'))
  if (!(maxUsd > 0)) { console.error('--max-usd <dollars> exigé avec --apply.'); process.exit(1) }
  if (estimate > maxUsd) { console.error(`Estimation ${estimate.toFixed(2)} $ au-dessus de --max-usd ${maxUsd} : rien n'est envoyé.`); process.exit(1) }

  ensurePrivateDir(outDir)
  if (args.includes('--teacher') && option('--teacher') === 'openai') {
    await teachWithOpenAi(pending, maxUsd)
    process.exit(0)
  }
  let batch: Awaited<ReturnType<Anthropic['messages']['batches']['create']>>
  try {
    batch = await client!.messages.batches.create({
    requests: pending.map(item => ({
      custom_id: customId(item.id),
      params: {
        model: TEACHER.model,
        // Réflexion de l'enseignant en plus de la réponse ; refusée ensuite si la réponse seule dépasse la limite de l'application.
        max_tokens: Math.min(32000, TASKS[item.ctx.task].appMaxTokens + 8000),
        // Consignes communes à beaucoup de demandes (même barème) : en cache. Aucune quand l'application n'en envoie pas.
        ...(item.system ? { system: [{ type: 'text' as const, text: item.system, cache_control: { type: 'ephemeral' as const } }] } : {}),
        messages: item.messages,
        output_config: { effort: TASKS[item.ctx.task].effort },
      },
    })),
  })
  } catch (err) {
    // Demande de l'utilisateur (2026-11-25) : crédits Claude épuisés → OpenAI pour la suite.
    if (claudeProblem(err) !== 'credits') throw err
    console.log('Crédits Claude épuisés : réponses demandées à OpenAI.')
    await teachWithOpenAi(pending, maxUsd)
    process.exit(0)
  }
  appendFileSync(BATCHES(), JSON.stringify({ batchId: batch.id, ids: pending.map(i => i.id), at: new Date().toISOString() }) + '\n', { mode: 0o600 })
  console.log(`Lot ${batch.id} envoyé (${pending.length} demandes) : relancez « teach » pour lire le résultat (1 h le plus souvent, 24 h au plus).`)
  process.exit(0)
}

if (command === 'split') {
  const answers = loadAnswers()
  const items = allItems(answers).filter(i => answers.get(i.id)?.answer)
  const out: Record<'train' | 'validation' | 'test', string[]> = { train: [], validation: [], test: [] }
  const testItems: string[] = []
  const counts: Record<string, Record<string, number>> = {}
  for (const item of items) {
    const answer = answers.get(item.id)?.answer ?? ''
    const split = splitOf(item.group)
    out[split].push(JSON.stringify(chatExample(item, answer)))
    if (split === 'test') testItems.push(JSON.stringify({ ...item, teacher: answer }))
    const c = (counts[item.ctx.task] ??= { train: 0, validation: 0, test: 0 })
    c[split]++
  }
  // Classification (ADR 0058) : exemples déjà répartis, ajoutés tels quels (test inchangé pour comparer aux mesures passées).
  const classification = option('--classification')
  if (classification) {
    const c = (counts.classification = { train: 0, validation: 0, test: 0 })
    for (const split of ['train', 'validation', 'test'] as const) {
      for (const line of readFileSync(join(resolve(classification), `${split}.jsonl`), 'utf-8').split('\n').filter(l => l.trim())) {
        out[split].push(line)
        c[split]++
      }
    }
  }
  ensurePrivateDir(outDir)
  for (const split of ['train', 'validation', 'test'] as const) {
    const path = join(outDir, `${split}.jsonl`)
    if (existsSync(path)) { console.error(`${path} existe déjà : supprimez les fichiers d'une répartition précédente.`); process.exit(1) }
    writePrivate(path, out[split].join('\n') + '\n')
  }
  writePrivate(join(outDir, 'test-items.jsonl'), testItems.join('\n') + '\n')
  for (const [task, c] of Object.entries(counts)) console.log(`  ${task.padEnd(18)} entraînement ${c.train}, contrôle ${c.validation}, test ${c.test}`)
  process.exit(0)
}

if (command === 'eval') {
  const { judgeStudent, summarize } = await import('../src/lib/finetune/mbc-eval')
  type Test = import('../src/lib/finetune/mbc-eval').TestItem
  const url = (option('--url') ?? '').replace(/\/+$/, '')
  const model = option('--model') ?? ''
  const label = option('--label') ?? ''
  if (!/^https:\/\/[^\s]+\/v1$/.test(url) || !model || !/^[\w.-]+$/.test(label)) { console.error(USAGE); process.exit(1) }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const keyFile = resolve(option('--key-env') ?? join(repoRoot, '..', 'nosana-llm-deployer', '.env'))
  const apiKey = existsSync(keyFile) ? readEnv(keyFile).LLM_API_KEY?.trim() : ''
  if (!apiKey) { console.error(`LLM_API_KEY (clé de la passerelle du déploiement) absente de ${keyFile}.`); process.exit(1) }
  // Température de Config IA pour les modèles ajoutés (DEFAULT_OPEN_SOURCE_TEMPERATURE, ADR 0057).
  const temperature = Number(option('--temperature') ?? '0.15')
  const tasks = option('--tasks')?.split(',')
  const limit = Number(option('--limit') ?? 'Infinity')
  const perTask = new Map<string, number>()
  const tests = readJsonl<Test>(join(outDir, 'test-items.jsonl')).filter(t => !tasks || tasks.includes(t.ctx.task)).filter(t => {
    const n = perTask.get(t.ctx.task) ?? 0
    perTask.set(t.ctx.task, n + 1)
    return n < limit
  })
  console.log(`${tests.length} demandes de test, modèle « ${model} »…`)
  // Deux à la fois : les déploiements du 3B servent 2 requêtes simultanées (--max-num-seqs 2).
  const results = await mapLimit(tests, 2, async t => {
    const started = Date.now()
    const messages = [...(t.system ? [{ role: 'system', content: t.system }] : []), ...t.messages]
    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: TASKS[t.ctx.task].appMaxTokens, temperature }), signal: AbortSignal.timeout(300_000),
      })
      const latency = Date.now() - started
      if (!res.ok) return { task: t.ctx.task, valid: false, reason: `HTTP ${res.status}`, latencyMs: latency }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      return { id: t.id, ...judgeStudent(t, data.choices?.[0]?.message?.content ?? '', latency) }
    } catch (err) {
      return { task: t.ctx.task, valid: false, reason: err instanceof Error ? err.name : 'erreur', latencyMs: Date.now() - started }
    }
  })
  ensurePrivateDir(outDir)
  const summary = summarize(results)
  writePrivate(join(outDir, `eval-${label}-${Date.now()}.json`), JSON.stringify({ label, model, temperature, at: new Date().toISOString(), summary, results }, null, 1))
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`)
  for (const s of summary) {
    console.log(`  ${TASKS[s.task].label.padEnd(44)} ${String(s.items).padStart(4)}  valides ${pct(s.validRate).padStart(5)}  accord ${pct(s.agreement).padStart(5)}${s.meanScoreGap === null ? '' : `  écart ${s.meanScoreGap.toFixed(1)}`}${s.meanCoverage === null ? '' : `  CV repris ${pct(s.meanCoverage)}`}  ${(s.medianLatencyMs / 1000).toFixed(1)} s`)
  }
  process.exit(0)
}

/**
 * Repli sur OpenAI (crédits Claude épuisés, ou --teacher openai) : appels un par un (4 à la fois), même lecture des
 * réponses par l'application. Clé dédiée FT_OPENAI_API_KEY du .env du déployeur, jamais celle de Config IA (utilisée par
 * la production). Arrêt dès que le coût réel atteint --max-usd, ou au premier « crédits épuisés ».
 */
async function teachWithOpenAi(items: DatasetItem[], maxUsd: number) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const keyFile = resolve(option('--key-env') ?? join(repoRoot, '..', 'nosana-llm-deployer', '.env'))
  const apiKey = existsSync(keyFile) ? readEnv(keyFile).FT_OPENAI_API_KEY?.trim() : ''
  if (!apiKey) { console.error(`FT_OPENAI_API_KEY absente de ${keyFile} : clé OpenAI dédiée à l'affinage, jamais celle de Config IA.`); process.exit(1) }
  const model = option('--openai-model') ?? OPENAI.model
  const estimate = estimateCost(items).reduce((n, l) => n + ((l.inputTokens * OPENAI.inputPerMTok + l.outputTokens * OPENAI.outputPerMTok) / 1e6), 0)
  console.log(`OpenAI (${model}) : ${items.length} demandes, ~${estimate.toFixed(2)} $ (sans remise de lot).`)
  if (estimate > maxUsd) { console.error(`Estimation au-dessus de --max-usd ${maxUsd} : rien n'est envoyé.`); process.exit(1) }
  let spent = 0
  let stop = ''
  const counts = { accepted: 0, rejected: 0 }
  await mapLimit(items, 4, async item => {
    if (stop) return
    const messages = [...(item.system ? [{ role: 'system', content: item.system }] : []), ...item.messages]
    let res: Response
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: TASKS[item.ctx.task].appMaxTokens }), signal: AbortSignal.timeout(180_000),
      })
    } catch (err) {
      // Réseau ou délai : la demande reste à faire (pas de ligne), on continue avec les autres.
      console.warn('  OpenAI injoignable pour une demande :', err instanceof Error ? err.name : 'erreur')
      return
    }
    const body = await res.text()
    if (!res.ok) {
      const problem = openAiProblem(res.status, body)
      if (problem === 'credits' || problem === 'access') stop = problem === 'credits' ? 'crédits OpenAI épuisés' : 'clé OpenAI refusée'
      else console.warn(`  OpenAI ${res.status} pour une demande : à refaire au prochain envoi.`)
      return
    }
    const data = JSON.parse(body) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 }
    spent += (usage.inputTokens * OPENAI.inputPerMTok + usage.outputTokens * OPENAI.outputPerMTok) / 1e6
    if (spent >= maxUsd) stop = `plafond --max-usd ${maxUsd} atteint`
    const choice = data.choices?.[0]
    const line: AnswerLine = choice?.finish_reason === 'length'
      ? { id: item.id, reason: 'réponse coupée', ...usage, teacher: model }
      : { id: item.id, ...teacherAnswer(item.ctx, choice?.message?.content ?? ''), ...usage, teacher: model }
    if (line.answer) counts.accepted++
    else counts.rejected++
    appendFileSync(ANSWERS(), JSON.stringify(line) + '\n', { mode: 0o600 })
  })
  console.log(`OpenAI : ${counts.accepted} réponses gardées, ${counts.rejected} écartées, ~${spent.toFixed(2)} $ dépensés.${stop ? ` Arrêt : ${stop}.` : ''}`)
}

/** Identifiant d'une demande dans un lot : lettres, chiffres, « _ » et « - » seulement (64 au plus). */
function customId(id: string) { return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) }
