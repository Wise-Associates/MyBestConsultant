import { COLLECTIONS } from '@/lib/appwrite/config'
import { handledUidsOf, nextCheckpoint, planRead, type ReadPlan } from './checkpoint'
import { buildEmailContent, extractOffersFromEmail } from './extract'
import { RetryLater, type ExtractionContext } from './extractors/types'
import { DUPLICATE_WINDOW_DAYS, offerFingerprint } from './fingerprint'
import { aoInboxSettings, withAoInbox, type AoInbox, type AoInboxSettings, type InboxEnvelope } from './imap'
import { TruncatedAnswerError } from './parse'
import {
  MAX_ATTEMPTS, createAoEmail, createAoOffer, findAoDuplicate, findAoEmailByMessageId,
  incrementAoSources, listRetryableAoEmails, nextStepFor, purgeAoRecords, settledMessageIds, updateAoEmail,
} from './repo'
import { acquireSyncLock, checkpointIdFor, getCheckpoint, releaseSyncLock, saveCheckpoint, takeDailyVisionCall } from './state'

// Lecture planifiée de la boîte AO (route /api/cron/ao-inbox appelée par un planificateur, ou bouton
// « Synchroniser » de l'admin). Un seul passage à la fois (verrou, state.ts). Chaque passage ne lit que le
// courrier arrivé depuis le point de reprise, plus les e-mails à réessayer ; une fois par jour, un rattrapage
// relit 7 jours (checkpoint.ts). Chaque e-mail est enregistré en base AVANT d'être traité (index unique sur
// le Message-ID) : il n'est jamais traité deux fois, et une erreur est réessayée 3 fois au plus.

const DAY_MS = 86_400_000
/** Durée de conservation des e-mails et offres AO (les offres publiées restent en ligne). */
const RETENTION_DAYS = 365
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
/** Au-delà, l'e-mail est probablement une liste d'offres à importer à la main (Offres → Importer). */
const MAX_OFFERS_PER_EMAIL = 20
/** Lectures d'images / PDF scannés par l'IA, par e-mail et par jour (coût borné : tout expéditeur peut écrire). */
const MAX_VISION_CALLS_PER_EMAIL = 3
const MAX_VISION_CALLS_PER_DAY = 50
/** Marge gardée avant la fin du budget : on ne commence pas un e-mail qu'on n'aurait pas le temps de finir. */
const SAFETY_MARGIN_MS = 30_000
/** Temps gardé pour l'extraction des offres après la lecture des pièces jointes. */
const EXTRACTION_RESERVE_MS = 45_000
const MAX_LLM_WAIT_MS = 120_000
/** En dessous, l'extraction des offres n'a pas le temps d'aboutir : l'e-mail est repris plus tard. */
const MIN_LLM_WAIT_MS = 20_000

/** Erreur qu'un nouvel essai ne corrigerait pas : l'e-mail est abandonné tout de suite. */
class PermanentError extends Error {}

export interface AoSyncReport {
  /** false : identifiants IMAP absents, rien n'a été lu. */
  configured: boolean
  /** true : une autre synchronisation était en cours, ce passage n'a rien fait. */
  skipped: boolean
  /** incremental : courrier nouveau seulement ; reconcile : rattrapage des 7 derniers jours. */
  mode: ReadPlan['mode'] | null
  /** E-mails nouveaux (ou à réessayer) à traiter. */
  pending: number
  processed: number
  offersCreated: number
  duplicates: number
  noOffer: number
  failed: number
  /** E-mails laissés pour le passage suivant (limite de nombre ou de temps atteinte). */
  remaining: number
  errors: string[]
}

export interface AoSyncOptions {
  now?: Date
  /** Nombre maximal d'e-mails traités par passage (le budget de temps limite aussi). */
  maxEmails?: number
  /** Temps au-delà duquel on ne commence plus de nouvel e-mail (la fonction a une durée limitée). */
  budgetMs?: number
  /** Origine du passage, enregistrée avec le verrou (diagnostic). */
  holder?: string
}

export async function syncAoInbox({ now = new Date(), maxEmails = 25, budgetMs = 240_000, holder = 'cron' }: AoSyncOptions = {}): Promise<AoSyncReport> {
  const report: AoSyncReport = { configured: false, skipped: false, mode: null, pending: 0, processed: 0, offersCreated: 0, duplicates: 0, noOffer: 0, failed: 0, remaining: 0, errors: [] }
  const settings = aoInboxSettings()
  if (!settings) return report
  report.configured = true
  if (!COLLECTIONS.AO_EMAILS || !COLLECTIONS.AO_OFFERS || !COLLECTIONS.AO_STATE) {
    throw new Error('APPWRITE_COLLECTION_AO_EMAILS / _AO_OFFERS / _AO_STATE non définies : créez les collections (npm run ao:setup) et ajoutez ces variables.')
  }
  const lock = await acquireSyncLock(holder, now)
  if (!lock) {
    report.skipped = true
    return report
  }
  try {
    await runSync(report, settings, { now, maxEmails, budgetMs })
  } finally {
    await releaseSyncLock(lock)
  }
  return report
}

async function runSync(
  report: AoSyncReport,
  settings: AoInboxSettings,
  { now, maxEmails, budgetMs }: { now: Date; maxEmails: number; budgetMs: number },
): Promise<void> {
  const startedAt = Date.now()
  const timeLeft = () => budgetMs - (Date.now() - startedAt)

  await purgeAoRecords(new Date(now.getTime() - RETENTION_DAYS * DAY_MS))
  const checkpointId = checkpointIdFor(`${settings.host}|${settings.user}|${settings.mailbox}`)
  const checkpoint = await getCheckpoint(checkpointId)

  await withAoInbox(settings, async inbox => {
    const plan = planRead(checkpoint, inbox.uidValidity, now)
    report.mode = plan.mode
    const candidates = plan.mode === 'reconcile' ? await inbox.listSince(plan.since) : await inbox.listAfter(plan.afterUid)
    // Le rattrapage relit la fenêtre entière, nouveaux essais compris ; sinon on les cherche en base.
    const retries = plan.mode === 'incremental' ? await retryEnvelopes(inbox, now) : []

    // Un même Message-ID peut apparaître deux fois (copie, renvoi) : on ne le traite qu'une fois.
    const envelopes = [...new Map([...retries, ...candidates].map(e => [e.messageId, e])).values()].sort((a, b) => a.uid - b.uid)
    const settled = await settledMessageIds(envelopes.map(e => e.messageId), now)
    const todo = envelopes.filter(e => !settled.has(e.messageId))
    report.pending = todo.length

    // Suivi par Message-ID : deux copies d'un même message (UID différents) sont traitées ensemble.
    const handledIds = new Set(settled)
    for (const envelope of todo) {
      if (report.processed + report.failed >= maxEmails || timeLeft() < SAFETY_MARGIN_MS) break
      handledIds.add(envelope.messageId)
      // Le premier e-mail du passage a tout le budget : lui ne peut pas être reporté faute de temps.
      const canDefer = report.processed + report.failed > 0
      await processEnvelope(inbox, envelope, report, now, timeLeft, canDefer)
    }
    report.remaining = todo.filter(e => !handledIds.has(e.messageId)).length
    const handledUids = handledUidsOf(candidates, handledIds)
    await saveCheckpoint(checkpointId, nextCheckpoint(checkpoint, inbox.uidValidity, plan, candidates.map(c => c.uid), handledUids, inbox.uidNext, now))
  })
}

/**
 * Enveloppes des e-mails à réessayer, relues par UID. Le Message-ID est revérifié : si la boîte a été
 * reconstruite entre-temps, l'UID désigne un autre message et l'e-mail sera repris par le rattrapage.
 */
async function retryEnvelopes(inbox: AoInbox, now: Date): Promise<InboxEnvelope[]> {
  const emails = await listRetryableAoEmails(now)
  if (!emails.length) return []
  const expected = new Map(emails.map(e => [e.uid, e.messageId]))
  return (await inbox.listUids([...expected.keys()])).filter(e => expected.get(e.uid) === e.messageId)
}

async function processEnvelope(
  inbox: AoInbox,
  envelope: InboxEnvelope,
  report: AoSyncReport,
  now: Date,
  timeLeft: () => number,
  canDefer: boolean,
): Promise<void> {
  const claimed = await claim(envelope, now, report)
  if (!claimed) return
  const { emailId } = claimed
  let { attempts } = claimed

  try {
    if (envelope.size > MAX_MESSAGE_BYTES) throw new PermanentError('Message trop volumineux (plus de 25 Mo) : à traiter à la main.')
    const message = await inbox.read(envelope.uid)
    let visionCalls = 0
    const ctx: ExtractionContext = {
      deadline: Date.now() + timeLeft() - EXTRACTION_RESERVE_MS,
      canDefer,
      reserveVisionCall: async () => {
        if (visionCalls >= MAX_VISION_CALLS_PER_EMAIL || !(await takeDailyVisionCall(now, MAX_VISION_CALLS_PER_DAY))) return false
        visionCalls++
        return true
      },
    }
    const content = await buildEmailContent(message, ctx)
    await updateAoEmail(emailId, {
      fromAddress: message.fromAddress.slice(0, 320),
      fromName: message.fromName.slice(0, 200),
      subject: message.subject.slice(0, 500),
      receivedAt: message.receivedAt.toISOString(),
      attachments: content.attachments.map(a => a.slice(0, 255)),
    })

    const llmWait = Math.min(MAX_LLM_WAIT_MS, timeLeft() - 10_000)
    if (llmWait < MIN_LLM_WAIT_MS) throw new RetryLater('plus assez de temps pour l\'extraction : e-mail repris au prochain passage', !canDefer)
    const extracted = content.text.trim().length < 50 ? [] : (await extractOffersFromEmail(content.text, llmWait)).offers
    const offers = extracted.slice(0, MAX_OFFERS_PER_EMAIL)
    let created = 0
    let duplicates = 0
    const seen = new Set<string>()
    for (const offer of offers) {
      const fingerprint = offerFingerprint(offer)
      if (seen.has(fingerprint)) { duplicates++; continue } // même offre dans le corps et une pièce jointe
      seen.add(fingerprint)
      const duplicate = await findAoDuplicate(fingerprint, new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS))
      if (duplicate) {
        await incrementAoSources(duplicate)
        duplicates++
      } else {
        await createAoOffer(offer, { fingerprint, emailId })
        created++
      }
    }

    const notes = [
      content.skipped.length ? `Pièces jointes ignorées : ${content.skipped.join(', ')}` : '',
      extracted.length > MAX_OFFERS_PER_EMAIL ? `${extracted.length} offres trouvées, seules les ${MAX_OFFERS_PER_EMAIL} premières sont reprises : importez le document depuis « Offres ».` : '',
    ].filter(Boolean)
    await updateAoEmail(emailId, {
      status: offers.length ? 'processed' : 'no_offer',
      offerCount: created,
      duplicateCount: duplicates,
      error: notes.join(' — ').slice(0, 1000),
    })
    report.processed++
    report.offersCreated += created
    report.duplicates += duplicates
    if (!offers.length) report.noOffer++
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof PermanentError || err instanceof TruncatedAnswerError) attempts = MAX_ATTEMPTS
    // Reporté faute de temps dans ce passage : l'e-mail n'y est pour rien, l'essai n'est pas compté.
    if (err instanceof RetryLater && !err.countsAsAttempt) attempts -= 1
    await updateAoEmail(emailId, { status: 'failed', attempts, error: message.slice(0, 1000) }).catch(() => undefined)
    report.failed++
    report.errors.push(message)
  }
}

/**
 * Réserve un e-mail pour ce passage : création, ou nouvel essai si son état relu l'autorise.
 * Renvoie null s'il est déjà traité, en cours ailleurs, ou abandonné.
 */
async function claim(envelope: InboxEnvelope, now: Date, report: AoSyncReport): Promise<{ emailId: string; attempts: number } | null> {
  const existing = await findAoEmailByMessageId(envelope.messageId)
  if (existing) {
    const step = nextStepFor(existing, now)
    if (step === 'abandon') {
      await updateAoEmail(existing.$id, { status: 'failed', error: `Abandonné après ${MAX_ATTEMPTS} essais interrompus : à traiter à la main.` })
    }
    if (step !== 'retry') return null
    await updateAoEmail(existing.$id, { status: 'processing', attempts: existing.attempts + 1 })
    return { emailId: existing.$id, attempts: existing.attempts + 1 }
  }
  try {
    const email = await createAoEmail({ messageId: envelope.messageId, uid: envelope.uid, receivedAt: envelope.receivedAt.toISOString() })
    return { emailId: email.$id, attempts: 1 }
  } catch (err) {
    // 409 : un autre passage vient de le prendre. Toute autre erreur est signalée.
    if ((err as { code?: number }).code !== 409) report.errors.push(`Enregistrement de l'e-mail impossible : ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
