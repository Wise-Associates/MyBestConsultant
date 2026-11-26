import { parseCriteriaJudgements, criteriaJudgedScore } from '../criteria-scoring'
import { contentCoverage, contentOf, parseExtraction } from '../cv-export/cv-data'
import { parseModelJson } from '../ai/model-json'
import { judgedScore, offerCriteria, parseJudgements, parseTitleRelations } from '../match-scoring'
import { SOURCING_MIN_SCORE } from '../sourcing-rules'
import { parseVivierMatching, vivierScore } from '../vivier-matching'
import { cvTextOfRequest, teacherAnswer, type DatasetItem, type TaskId } from './mbc-dataset'

// Mesure d'un modèle élève sur les exemples de test (ADR 0063) : sa réponse lue par l'application (teacherAnswer), puis
// comparée à celle de l'enseignant, tâche par tâche. Règles pures, testées dans mbc-eval.test.ts.

export interface TestItem extends DatasetItem {
  /** Réponse de l'enseignant gardée pour cette demande. */
  teacher: string
}

export interface ItemResult {
  task: TaskId
  /** La lecture de l'application accepte la réponse de l'élève. */
  valid: boolean
  reason?: string
  /** Accord avec l'enseignant, de 0 à 1 (même décision « correspond », mêmes relations…) ; absent sans mesure d'accord. */
  agreement?: number
  /** Écart absolu de score avec l'enseignant (notations). */
  scoreGap?: number
  /** Part des mots du CV reprise dans le dossier (export CV), pour l'élève. */
  coverage?: number
  latencyMs: number
}

const json = (raw: string, open: '{' | '['): unknown => {
  const m = raw.match(open === '{' ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/)
  if (!m) return null
  try { return parseModelJson(m[0]) } catch { return null }
}
const matches = (score: number) => score >= SOURCING_MIN_SCORE

/** Score d'une notation (barème ou critères) tel que l'application le calcule, sans la comparaison des intitulés. */
function scoreOf(item: TestItem, raw: string): number | null {
  const ctx = item.ctx
  if (ctx.task === 'scoring-matching' || ctx.task === 'scoring-final') {
    const j = parseJudgements(json(raw, '{'), offerCriteria(ctx.skills, ctx.description), ctx.cvText, ctx.scale)
    return j ? judgedScore(j) : null
  }
  if (ctx.task === 'scoring-criteria') {
    const j = parseCriteriaJudgements(json(raw, '{'), ctx.set, ctx.cvText)
    return j ? criteriaJudgedScore(j, ctx.set) : null
  }
  return null
}

/** Réponse de l'élève à une demande de test, comparée à celle de l'enseignant. */
export function judgeStudent(item: TestItem, student: string, latencyMs: number): ItemResult {
  const task = item.ctx.task
  const verdict = teacherAnswer(item.ctx, student)
  if ('reason' in verdict) return { task, valid: false, reason: verdict.reason, latencyMs }
  const result: ItemResult = { task, valid: true, latencyMs }
  const ctx = item.ctx
  if (ctx.task === 'scoring-matching' || ctx.task === 'scoring-final' || ctx.task === 'scoring-criteria') {
    const s = scoreOf(item, verdict.answer)
    const t = scoreOf(item, item.teacher)
    if (s !== null && t !== null) {
      result.scoreGap = Math.abs(s - t)
      result.agreement = matches(s) === matches(t) ? 1 : 0
    }
  } else if (ctx.task === 'vivier-batch') {
    const s = parseVivierMatching(verdict.answer, ctx.offers, ctx.cvText) ?? []
    const t = new Map((parseVivierMatching(item.teacher, ctx.offers, ctx.cvText) ?? []).map(v => [v.jobId, vivierScore(v).score]))
    const pairs = s.flatMap(v => (t.has(v.jobId) ? [[vivierScore(v).score, t.get(v.jobId) ?? 0]] : []))
    if (pairs.length) {
      result.agreement = pairs.filter(([a, b]) => matches(a) === matches(b)).length / pairs.length
      result.scoreGap = pairs.reduce((n, [a, b]) => n + Math.abs(a - b), 0) / pairs.length
    }
  } else if (ctx.task === 'title-check') {
    const s = parseTitleRelations(verdict.answer, ctx.count, true)
    const t = parseTitleRelations(item.teacher, ctx.count, true)
    result.agreement = s.filter((r, i) => r === t[i]).length / ctx.count
  } else if (ctx.task === 'cv-export-extract') {
    result.coverage = contentCoverage(cvTextOfRequest(item), contentOf(parseExtraction(verdict.answer)))
  }
  return result
}

export interface TaskSummary {
  task: TaskId
  items: number
  validRate: number
  agreement: number | null
  meanScoreGap: number | null
  meanCoverage: number | null
  medianLatencyMs: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Résumé par tâche : réponses lisibles, accord avec l'enseignant (réponses lisibles seulement), temps médian. */
export function summarize(results: ItemResult[]): TaskSummary[] {
  const byTask = new Map<TaskId, ItemResult[]>()
  for (const r of results) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r])
  return [...byTask.entries()].map(([task, rs]) => ({
    task, items: rs.length,
    validRate: rs.filter(r => r.valid).length / rs.length,
    agreement: mean(rs.flatMap(r => (r.agreement === undefined ? [] : [r.agreement]))),
    meanScoreGap: mean(rs.flatMap(r => (r.scoreGap === undefined ? [] : [r.scoreGap]))),
    meanCoverage: mean(rs.flatMap(r => (r.coverage === undefined ? [] : [r.coverage]))),
    medianLatencyMs: median(rs.map(r => r.latencyMs)),
  }))
}
