'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { updateApplicationStatus, updateApplicationCard, deleteApplication, getJobById } from '@/lib/appwrite/jobs'
import { logFunnelEvent, getFunnelEvents, getStagesForJob, replaceStages, ensureColumns } from '@/lib/appwrite/funnel'
import { alignToColumn, columnOf, currentIndex, funnelForCandidate, sanitizeFunnel, serializeFunnel, STEP_TYPES, type FunnelStep, type StepResult, type StepStatus } from '@/lib/candidate-funnel'
import { callLLM } from '@/lib/ai/llm-router'
import { sanitizeStageInputs } from '@/lib/funnel-config'
import { screenAllApplications, sendInterviewInvitationEmail } from '@/app/recruiter/screening/actions'
import { getInterviewPrefillData, generateInterviewQuestions, createInterviewSession, type InterviewQuestion } from '@/app/recruiter/interviews/actions'
import type { FunnelStage, FunnelEvent } from '@/types'
import { revalidatePath } from 'next/cache'

export async function requireRecruiter() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Error('Non autorisé')
  return user
}

// Le candidat vient de changer de colonne : son statut de phase est remis à zéro et son funnel suit (les étapes qui précèdent sont « passées »).
async function syncFunnelToColumn(applicationId: string, columnSlug: string): Promise<void> {
  try {
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    const patch: Record<string, unknown> = { stageStatus: null }
    const f = funnelForCandidate(app.funnelJson, columnSlug)
    if (f.saved) patch.funnelJson = serializeFunnel(alignToColumn(f.steps, columnSlug))
    await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, patch)
  } catch { /* le funnel n'est jamais un obstacle au déplacement */ }
}

export async function moveApplicationStage(
  applicationId: string,
  jobId: string,
  stageSlug: string,
): Promise<{ error?: string }> {
  try {
    const user = await requireRecruiter()
    await updateApplicationStatus(applicationId, stageSlug)
    await syncFunnelToColumn(applicationId, stageSlug)
    await logFunnelEvent(applicationId, stageSlug, 'stage_change', undefined, `${user.firstName} ${user.lastName}`)
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    revalidatePath('/recruiter/dashboard')
    revalidatePath('/candidate/dashboard')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors du déplacement' }
  }
}

// Trace « X a contacté Y sur WhatsApp » dans l'historique d'équipe (jamais bloquant, jamais de contenu du message).
export async function logWhatsAppContactAction(applicationId: string): Promise<{ error?: string }> {
  try {
    const user = await requireRecruiter()
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    if (app.tenantId !== user.tenantId) return { error: 'Non autorisé' }
    await logFunnelEvent(applicationId, (app.status as string) || 'pending', 'contact', 'WhatsApp', `${user.firstName} ${user.lastName}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function saveFunnelStagesAction(
  jobId: string,
  stages: { slug: string; label: string; color: string; autoAction?: FunnelStage['autoAction']; statuses?: string[] }[],
): Promise<{ stages?: FunnelStage[]; error?: string }> {
  try {
    const user = await requireRecruiter()
    const job = await getJobById(jobId)
    if (!job || (job.tenantId !== user.tenantId && job.tenantId !== '')) return { error: 'Offre introuvable.' }

    // Le pipeline concerné est celui de l'offre (pipeline par défaut si aucun pipeline personnalisé ne lui est affecté).
    const current = await getStagesForJob(user.tenantId!, jobId)
    const keep = new Map(current.stages.map(s => [s.slug, s.statuses]))
    const parsed = sanitizeStageInputs(stages.map(s => ({ ...s, statuses: s.statuses ?? keep.get(s.slug) ?? [] })))
    if (!parsed.stages) return { error: parsed.error }

    const saved = await replaceStages(user.tenantId!, current.pipeline?.id ?? null, parsed.stages)
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    revalidatePath('/recruiter/funnel')
    return { stages: saved }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement des étapes' }
  }
}

// Statut d'un candidat à l'intérieur de sa phase (ex. « Planifié », « À recontacter »). Vide = aucun statut.
export async function setApplicationStageStatusAction(applicationId: string, jobId: string, status: string): Promise<{ error?: string }> {
  try {
    const user = await requireRecruiter()
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    if (app.tenantId !== user.tenantId) return { error: 'Non autorisé' }
    const { stages } = await getStagesForJob(user.tenantId!, app.jobId as string)
    const stage = stages.find(s => s.slug === app.status)
    const value = status.trim()
    if (value && !(stage?.statuses ?? []).includes(value)) return { error: 'Statut non proposé pour cette phase.' }
    await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, { stageStatus: value || null })
    await logFunnelEvent(applicationId, app.status as string, 'stage_change', value ? `Statut : ${value}` : 'Statut retiré', `${user.firstName} ${user.lastName}`)
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la mise à jour du statut' }
  }
}

export async function updateApplicationCardAction(
  applicationId: string,
  jobId: string,
  data: { tags: string[]; note: string },
): Promise<{ error?: string }> {
  try {
    await requireRecruiter()
    await updateApplicationCard(applicationId, { tags: data.tags, note: data.note || undefined })
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la mise à jour' }
  }
}

export async function deleteApplicationAction(applicationId: string, jobId: string): Promise<{ error?: string }> {
  try {
    await requireRecruiter()
    await deleteApplication(applicationId)
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    revalidatePath('/recruiter/dashboard')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la suppression' }
  }
}

// Re-scores a single candidate against the job — the same AI screening used for bulk
// screening, just triggered for one card without leaving the pipeline. Also moves the
// card into the "screening" stage so the Kanban reflects that it's been screened.
export async function launchScreeningAction(applicationId: string, jobId: string, stageSlug?: string): Promise<{ score?: number; recommendation?: string; summary?: string; error?: string }> {
  try {
    const user = await requireRecruiter()
    const { results, errors } = await screenAllApplications(jobId, [applicationId])
    if (errors.length > 0) return { error: errors[0] }
    // Phase de destination : celle demandée, sinon la phase « screening » de CE pipeline. Sans phase de ce type, la candidature ne bouge pas
    // (avant, le statut « screening » était écrit en dur : sur un funnel personnalisé la carte n'avait plus de colonne et disparaissait).
    const { stages } = await getStagesForJob(user.tenantId!, jobId)
    const target = (stageSlug && stages.some(s => s.slug === stageSlug) ? stageSlug : undefined)
      ?? stages.find(s => s.autoAction === 'screening')?.slug ?? stages.find(s => s.slug === 'screening')?.slug
    if (target) { await updateApplicationStatus(applicationId, target); await syncFunnelToColumn(applicationId, target) }
    await logFunnelEvent(applicationId, target ?? 'screening', 'screening', results[0] ? `Score: ${results[0].score}/100` : undefined)
    revalidatePath(`/recruiter/pipeline/${jobId}`)
    return { score: results[0]?.score, recommendation: results[0]?.recommendation, summary: results[0]?.summary }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors du screening' }
  }
}

// Generates interview questions and creates the session — same "prepare" step as the
// screening results page's interview module, so the recruiter reviews/edits the questions
// before anything is sent. createInterviewSession moves the application to "interview"
// internally; that's undone immediately below — the card must only actually move once the
// invite is really sent (see sendInterviewInviteAction), not just because a session was
// generated and possibly cancelled. Can be run again for the same candidate (illimited
// interviews) — each run creates its own session.
export async function prepareInterviewAction(applicationId: string, jobId: string): Promise<
  { sessionId: string; questions: InterviewQuestion[]; candidateName: string; candidateEmail: string; jobTitle: string } | { error: string }
> {
  try {
    await requireRecruiter()
    const { databases } = createAdminClient()
    const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    const previousStatus = appDoc.status as string

    const prefill = await getInterviewPrefillData(applicationId)
    if ('error' in prefill) return { error: prefill.error }

    const questions = await generateInterviewQuestions(prefill.jobTitle, prefill.jobDescription, prefill.jobSkills.split(', '), prefill.cvSummary)
    if ('error' in questions) return { error: questions.error }

    const session = await createInterviewSession(applicationId, jobId, prefill.candidateName, prefill.candidateEmail, prefill.jobTitle, questions)
    if ('error' in session) return { error: session.error }
    await updateApplicationStatus(applicationId, previousStatus)

    revalidatePath(`/recruiter/pipeline/${jobId}`)
    return { sessionId: session.sessionId, questions, candidateName: prefill.candidateName, candidateEmail: prefill.candidateEmail, jobTitle: prefill.jobTitle }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la préparation de l\'entretien' }
  }
}

// Recruiter closed the review modal without sending — the prepared session is discarded
// so it never shows up as a phantom "entretien en cours" on the card.
export async function cancelInterviewAction(sessionId: string): Promise<void> {
  try {
    await requireRecruiter()
    const { databases } = createAdminClient()
    await databases.deleteDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
  } catch { /* best-effort cleanup */ }
}

// Explicit, separate "send" step — only fires once the recruiter has reviewed the
// questions and confirmed, never automatically from prepareInterviewAction. Only now does
// the card actually move into the target stage (e.g. "Entretien").
export async function sendInterviewInviteAction(params: {
  applicationId: string
  jobId: string
  sessionId: string
  candidateEmail: string
  candidateName: string
  jobTitle: string
  targetStage: string
  // The exact questions the recruiter validated in the review step (after edits/deletions)
  // and the optional custom title — persisted on the session before the invite goes out, so
  // the candidate gets precisely what was reviewed, not the originally generated set.
  questions: InterviewQuestion[]
  title?: string
}): Promise<{ error?: string }> {
  try {
    const user = await requireRecruiter()
    const questions = params.questions
      .map(q => ({ ...q, text: q.text.trim() }))
      .filter(q => q.text.length > 0)
    if (questions.length === 0) return { error: 'Gardez au moins une question avant d\'envoyer' }

    const { databases } = createAdminClient()
    const session = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, params.sessionId)
    if (session.tenantId !== user.tenantId || session.applicationId !== params.applicationId) return { error: 'Non autorisé' }
    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, params.sessionId, {
      questions: JSON.stringify(questions),
      title: params.title?.trim().slice(0, 120) || null,
    })

    const res = await sendInterviewInvitationEmail({
      applicationId: params.applicationId, candidateEmail: params.candidateEmail, sessionId: params.sessionId,
      jobTitle: params.jobTitle, candidateName: params.candidateName, mediaMode: 'video',
    })
    if (res.error) return { error: res.error }
    await updateApplicationStatus(params.applicationId, params.targetStage)
    await syncFunnelToColumn(params.applicationId, params.targetStage)
    await logFunnelEvent(params.applicationId, params.targetStage, 'interview')
    revalidatePath(`/recruiter/pipeline/${params.jobId}`)
    revalidatePath('/recruiter/dashboard')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

export async function renameInterviewAction(sessionId: string, title: string): Promise<{ error?: string }> {
  try {
    const user = await requireRecruiter()
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    if (doc.tenantId !== user.tenantId) return { error: 'Non autorisé' }
    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId, { title: title.trim().slice(0, 120) || null })
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors du renommage' }
  }
}

export async function getEventsAction(applicationId: string): Promise<FunnelEvent[]> {
  try {
    await requireRecruiter()
    return await getFunnelEvents(applicationId)
  } catch {
    return []
  }
}

// ── Funnel du candidat : étapes, résultats, comptes rendus, validation humaine ────────────────────

async function ownApplication(applicationId: string, jobId: string) {
  const user = await requireRecruiter()
  const { databases } = createAdminClient()
  const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
  if (app.tenantId !== user.tenantId || app.jobId !== jobId) throw new Error('Non autorisé')
  return { user, app, databases }
}

/** Colonne du pipeline qui correspond à une étape (la colonne « screening » / « interview » peut porter un autre identifiant). */
function columnFor(step: FunnelStep, stages: FunnelStage[]): string {
  if (step.type === 'screening') return stages.find(s => s.autoAction === 'screening')?.slug ?? columnOf(step)
  if (step.type === 'ai_interview') return stages.find(s => s.autoAction === 'interview')?.slug ?? columnOf(step)
  return columnOf(step)
}

export type FunnelResult = { funnel?: FunnelStep[]; stages?: FunnelStage[]; next?: { id: string; label: string; column: string; autoAction?: string } | null; error?: string }

async function persist(applicationId: string, jobId: string, tenantId: string, steps: FunnelStep[]): Promise<FunnelStage[]> {
  const { databases } = createAdminClient()
  const { pipeline } = await getStagesForJob(tenantId, jobId)
  // Le funnel « génère » le pipeline : les colonnes qui manquent pour ses types d'étapes sont créées.
  const stages = await ensureColumns(tenantId, pipeline?.id ?? null, steps.map(columnOf))
  await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, { funnelJson: serializeFunnel(steps) })
  revalidatePath(`/recruiter/pipeline/${jobId}`)
  return stages
}

/** Enregistre le funnel personnalisé d'un candidat (étapes, ordre, nombre). Une étape déjà validée ne peut pas être supprimée. */
export async function saveCandidateFunnelAction(applicationId: string, jobId: string, steps: unknown): Promise<FunnelResult> {
  try {
    const { user, app } = await ownApplication(applicationId, jobId)
    const parsed = sanitizeFunnel(steps)
    if (!parsed.steps) return { error: parsed.error }
    const stored = funnelForCandidate(app.funnelJson, app.status as string)
    const kept = new Set(parsed.steps.map(s => s.id))
    if (stored.saved && stored.steps.some(s => s.status === 'validated' && !kept.has(s.id))) return { error: 'Une étape déjà validée ne peut pas être supprimée.' }
    const stages = await persist(applicationId, jobId, user.tenantId!, parsed.steps)
    await logFunnelEvent(applicationId, app.status as string, 'stage_change', `Funnel personnalisé : ${parsed.steps.map(s => s.label).join(' → ')}`.slice(0, 1900), `${user.firstName} ${user.lastName}`)
    return { funnel: parsed.steps, stages }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement du funnel' }
  }
}

interface StepPatch { status?: StepStatus; result?: StepResult; report?: string; reportBy?: 'ai' | 'manual' }

function applyPatch(step: FunnelStep, patch: StepPatch): FunnelStep {
  const next: FunnelStep = { ...step }
  if (patch.status && patch.status !== 'validated' && patch.status !== 'skipped') next.status = patch.status
  if (patch.result !== undefined) next.result = patch.result || undefined
  if (patch.report !== undefined) {
    const r = patch.report.trim().slice(0, 1200)
    next.report = r || undefined
    next.reportBy = r ? (patch.reportBy === 'ai' ? 'ai' : 'manual') : undefined
  }
  return next
}

/** Statut, résultat et compte rendu d'une étape en cours (sans la valider). */
export async function saveStepProgressAction(applicationId: string, jobId: string, stepId: string, patch: StepPatch): Promise<FunnelResult> {
  try {
    const { user, app } = await ownApplication(applicationId, jobId)
    const f = funnelForCandidate(app.funnelJson, app.status as string)
    const step = f.steps.find(s => s.id === stepId)
    if (!step) return { error: 'Étape introuvable.' }
    if (step.status === 'validated') return { error: 'Cette étape est déjà validée.' }
    const steps = f.steps.map(s => (s.id === stepId ? applyPatch(s, patch) : s))
    const stages = await persist(applicationId, jobId, user.tenantId!, steps)
    return { funnel: steps, stages }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement de l\'étape' }
  }
}

/** Validation humaine de l'étape en cours : obligatoire avant de passer à la suivante. Renvoie l'étape suivante (et sa colonne). */
export async function validateStepAction(applicationId: string, jobId: string, stepId: string, patch: StepPatch): Promise<FunnelResult> {
  try {
    const { user, app } = await ownApplication(applicationId, jobId)
    const f = funnelForCandidate(app.funnelJson, app.status as string)
    const idx = f.steps.findIndex(s => s.id === stepId)
    if (idx < 0) return { error: 'Étape introuvable.' }
    if (idx !== currentIndex(f.steps)) return { error: 'Seule l’étape en cours peut être validée.' }
    const merged = applyPatch(f.steps[idx], patch)
    if (!merged.result) return { error: 'Choisissez un résultat (favorable, réservé ou défavorable) avant de valider.' }
    const who = `${user.firstName} ${user.lastName}`.trim()
    const steps = f.steps.map((s, i) => (i === idx ? { ...merged, status: 'validated' as StepStatus, validatedAt: new Date().toISOString(), validatedBy: who } : s))
    const stages = await persist(applicationId, jobId, user.tenantId!, steps)
    const ni = currentIndex(steps)
    const nextStep = ni >= 0 ? steps[ni] : null
    const column = nextStep ? columnFor(nextStep, stages) : null
    await logFunnelEvent(applicationId, columnFor(merged, stages), 'stage_change', `Étape validée : ${merged.label} (${merged.result === 'positive' ? 'favorable' : merged.result === 'neutral' ? 'réservé' : 'défavorable'})`, who)
    return {
      funnel: steps, stages,
      next: nextStep && column ? { id: nextStep.id, label: nextStep.label, column, autoAction: stages.find(s => s.slug === column)?.autoAction } : null,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la validation' }
  }
}

const REPORT_SYSTEM = `Tu es un assistant de recrutement. Rédige un COMPTE RENDU D'ÉTAPE en français, factuel et professionnel, de 80 à 140 mots, en 3 courts paragraphes : « Synthèse », « Points forts », « Points de vigilance ». Termine par une ligne « Recommandation : » (favorable, réservée ou défavorable) cohérente avec le résultat indiqué.
Appuie-toi UNIQUEMENT sur les éléments fournis. N'invente aucun fait. S'il y a peu d'éléments, rédige un compte rendu court et termine par « À compléter par le recruteur ». Pas de markdown, pas d'emoji.`

/** Compte rendu d'étape proposé par l'IA à partir de ce que l'on sait du candidat (screening, entretien IA, notes). Rien n'est enregistré : le recruteur relit, corrige, valide. */
export async function generateStepReportAction(applicationId: string, jobId: string, stepId: string, draft?: { result?: StepResult; notes?: string }): Promise<{ report?: string; error?: string }> {
  try {
    const { app, databases } = await ownApplication(applicationId, jobId)
    const f = funnelForCandidate(app.funnelJson, app.status as string)
    const step = f.steps.find(s => s.id === stepId)
    if (!step) return { error: 'Étape introuvable.' }
    const job = await getJobById(jobId)

    // Ce que l'on sait déjà : screening IA et dernier entretien IA analysé
    const facts: string[] = []
    if (typeof app.aiScore === 'number') facts.push(`Screening IA : score ${app.aiScore}/100. ${(app.aiSummary as string) ?? ''}`.trim())
    try {
      const { Query } = await import('node-appwrite')
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [Query.equal('applicationId', applicationId), Query.orderDesc('$createdAt'), Query.limit(3)])
      for (const d of res.documents) {
        const a = d.analysis ? JSON.parse(d.analysis as string) as { overallScore?: number; summary?: string; recommendation?: string } : null
        if (a?.summary) facts.push(`Entretien IA : score ${a.overallScore ?? '?'}/100, recommandation ${a.recommendation ?? '?'}. ${a.summary}`)
      }
    } catch { /* les entretiens IA sont un plus */ }
    const prior = f.steps.filter(s => s.status === 'validated' && s.report).map(s => `${s.label} : ${s.report}`).slice(-3)
    const resultLabel = draft?.result === 'positive' ? 'favorable' : draft?.result === 'neutral' ? 'réservé' : draft?.result === 'negative' ? 'défavorable' : 'non précisé'

    const content = [
      `Poste : ${job?.title ?? ''}`,
      `Étape : ${step.label} (${STEP_TYPES[step.type].description})`,
      `Résultat indiqué par le recruteur : ${resultLabel}`,
      draft?.notes?.trim() ? `Notes du recruteur : ${draft.notes.trim().slice(0, 800)}` : '',
      (app.note as string) ? `Note sur la candidature : ${(app.note as string).slice(0, 400)}` : '',
      facts.length ? `Éléments connus :\n${facts.join('\n').slice(0, 1800)}` : '',
      prior.length ? `Comptes rendus des étapes précédentes :\n${prior.join('\n').slice(0, 900)}` : '',
    ].filter(Boolean).join('\n')
    const { content: text } = await callLLM([{ role: 'user', content }], REPORT_SYSTEM)
    const report = text.replace(/\*\*/g, '').trim().slice(0, 1200)
    if (!report) return { error: 'L’IA n’a pas pu rédiger de compte rendu. Réessayez.' }
    return { report }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la génération du compte rendu' }
  }
}
