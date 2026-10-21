import { COLLECTIONS } from '@/lib/appwrite/config'
import { handledUidsOf, nextCheckpoint, planRead, processingOrder, type ReadPlan } from './checkpoint'
import { buildEmailContent, extractOffersFromEmail } from './extract'
import { AiUnavailable, RetryLater, type ExtractionContext, type PassState } from './extractors/types'
import { DUPLICATE_WINDOW_DAYS, offerFingerprint } from './fingerprint'
import { aoInboxSettings, withAoInbox, type AoInbox, type AoInboxSettings, type InboxEnvelope } from './imap'
import { TruncatedAnswerError } from './parse'
import {
  createAoEmail, createAoOffer, findAoDuplicate, findAoEmailByMessageId,
  incrementAoSources, listRetryableAoEmails, nextStepFor, purgeAoRecords, settledMessageIds, updateAoEmail,
} from './repo'
import { MAX_ATTEMPTS, attemptsAfterFailure } from './attempts'
import { MAX_TABLE_ROWS } from './spreadsheet'
import {
  acquireSyncLock, checkpointIdFor, getCheckpoint, releaseDailyVisionCall, releaseSyncLock, saveCheckpoint, takeDailyTableOffers, takeDailyVisionCall,
} from './state'
import type { AoEmail, AoOfferFields } from './types'

// Lecture planifiée de la boîte AO (route /api/cron/ao-inbox appelée par un planificateur, ou bouton
// « Synchroniser » de l'admin). Un seul passage à la fois (verrou, state.ts). Chaque passage ne lit que le
// courrier arrivé depuis le point de reprise, plus les e-mails à réessayer ; une fois par jour, un rattrapage
// relit 7 jours (checkpoint.ts). Chaque e-mail est enregistré en base AVANT d'être traité (index unique sur
// le Message-ID) : il n'est jamais traité deux fois. Une erreur est reprise une seule fois, au passage suivant ; un e-mail
// en attente de l'IA (crédits épuisés) est repris à chaque passage, sans user cette reprise (attempts.ts).

const DAY_MS = 86_400_000
/** Durée de conservation des e-mails et offres AO (les offres publiées restent en ligne). */
const RETENTION_DAYS = 365
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
/**
 * Offres reprises au plus par e-mail : un tableau joint en apporte une par ligne (spreadsheet.ts). Tout
 * expéditeur peut écrire à la boîte : la limite borne la file « à valider » et les écritures d'un passage.
 */
const MAX_OFFERS_PER_EMAIL = 50
/**
 * Offres lues dans des tableaux joints, par jour : gratuites et instantanées, elles permettraient sinon à un envoi
 * en masse de noyer la file « à valider ». Au-delà, l'e-mail attend le lendemain (sans user ses essais).
 */
const MAX_TABLE_OFFERS_PER_DAY = 500
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
  /** E-mails laissés pour le passage suivant (limite de nombre ou de temps atteinte, ou IA indisponible). */
  remaining: number
  /**
   * true : l'IA n'est pas utilisable (crédits épuisés, clé refusée, sans repli) ; le passage s'est arrêté et
   * les e-mails attendent. Relancer tout de suite ne servirait à rien : un admin doit agir (Config IA).
   */
  aiUnavailable: boolean
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
  return underSyncLock(holder, now, (report, settings) => runSync(report, settings, { now, maxEmails, budgetMs }))
}

/**
 * Traite tout de suite un seul e-mail déjà enregistré (bouton « Réessayer » de l'admin), sous le même verrou que
 * les synchronisations, sans toucher au point de reprise. Il doit être réessayable (en erreur, essais restants :
 * voir manualRetryPatch) ; sinon le compte rendu est vide.
 */
export async function syncAoEmail(
  email: Pick<AoEmail, 'uid' | 'messageId'>,
  { now = new Date(), budgetMs = 150_000, holder = 'admin' }: Omit<AoSyncOptions, 'maxEmails'> = {},
): Promise<AoSyncReport> {
  return underSyncLock(holder, now, async (report, settings) => {
    const startedAt = Date.now()
    const timeLeft = () => budgetMs - (Date.now() - startedAt)
    await withAoInbox(settings, async inbox => {
      // Même vérification que pour les nouveaux essais : l'UID doit toujours désigner ce message.
      const [envelope] = (await inbox.listUids([email.uid])).filter(e => e.messageId === email.messageId)
      if (!envelope) throw new Error('E-mail introuvable dans la boîte AO (supprimé, ou boîte reconstruite) : à traiter à la main.')
      report.pending = 1
      await processEnvelope(inbox, envelope, report, { visionUnavailable: null, textUnavailable: false }, now, timeLeft, false)
    })
  })
}

/** Exécute `work` sous le verrou de synchronisation ; compte rendu `skipped` si un autre passage le détient. */
async function underSyncLock(
  holder: string,
  now: Date,
  work: (report: AoSyncReport, settings: AoInboxSettings) => Promise<void>,
): Promise<AoSyncReport> {
  const report: AoSyncReport = { configured: false, skipped: false, mode: null, pending: 0, processed: 0, offersCreated: 0, duplicates: 0, noOffer: 0, failed: 0, remaining: 0, aiUnavailable: false, errors: [] }
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
    await work(report, settings)
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

    // Courrier nouveau d'abord ; un même Message-ID (copie, renvoi) n'est traité qu'une fois.
    const envelopes = processingOrder(candidates, retries)
    const settled = await settledMessageIds(envelopes.map(e => e.messageId), now)
    const todo = envelopes.filter(e => !settled.has(e.messageId))
    report.pending = todo.length

    // Suivi par Message-ID : deux copies d'un même message (UID différents) sont traitées ensemble.
    const handledIds = new Set(settled)
    const pass: SyncPass = { visionUnavailable: null, textUnavailable: false }
    for (const envelope of todo) {
      if (report.processed + report.failed >= maxEmails || timeLeft() < SAFETY_MARGIN_MS) break
      // Extraction des offres impossible (crédits épuisés partout…) : tous les e-mails suivants échoueraient de
      // même, ils attendent. Une lecture des scans impossible, elle, n'arrête pas le passage : les e-mails qui
      // n'en ont pas besoin sont traités, les autres attendent sans nouvel appel (pass.visionUnavailable).
      if (pass.textUnavailable) break
      handledIds.add(envelope.messageId)
      // Le premier e-mail du passage a tout le budget : lui ne peut pas être reporté faute de temps.
      const canDefer = report.processed + report.failed > 0
      await processEnvelope(inbox, envelope, report, pass, now, timeLeft, canDefer)
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

/** État d'un passage partagé par ses e-mails : ce que l'IA ne peut plus faire jusqu'à la fin du passage. */
interface SyncPass extends PassState {
  textUnavailable: boolean
}

async function processEnvelope(
  inbox: AoInbox,
  envelope: InboxEnvelope,
  report: AoSyncReport,
  pass: SyncPass,
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
    // Enregistré avant la lecture des pièces jointes : un e-mail en attente de l'IA reste reconnaissable
    // (expéditeur, objet) dans la liste des e-mails en erreur de /admin/ao-offers.
    await updateAoEmail(emailId, {
      fromAddress: message.fromAddress.slice(0, 320),
      fromName: message.fromName.slice(0, 200),
      subject: message.subject.slice(0, 500),
      receivedAt: message.receivedAt.toISOString(),
    })
    let visionCalls = 0
    const ctx: ExtractionContext = {
      deadline: Date.now() + timeLeft() - EXTRACTION_RESERVE_MS,
      canDefer,
      pass,
      reserveVisionCall: async () => {
        if (visionCalls >= MAX_VISION_CALLS_PER_EMAIL || !(await takeDailyVisionCall(now, MAX_VISION_CALLS_PER_DAY))) return false
        visionCalls++
        return true
      },
      // Lecture refusée pour raison de compte, sans frais : sinon les e-mails en attente de crédits
      // épuiseraient en quelques passages le budget du jour, et seraient ensuite traités sans leurs pièces jointes.
      releaseVisionCall: async () => {
        visionCalls--
        await releaseDailyVisionCall(now)
      },
    }
    const content = await buildEmailContent(message, ctx)
    await updateAoEmail(emailId, { attachments: content.attachments.map(a => a.slice(0, 255)) })

    const tableOffers = content.tableOffers.slice(0, MAX_OFFERS_PER_EMAIL).length
    if (tableOffers && !(await takeDailyTableOffers(now, tableOffers, MAX_TABLE_OFFERS_PER_DAY))) {
      throw new RetryLater(`plafond du jour atteint pour les offres lues dans des tableaux (${MAX_TABLE_OFFERS_PER_DAY}) : e-mail repris dès que le plafond le permet`, false)
    }
    // Les offres des tableaux joints sont déjà lues ; l'IA ne lit que le texte restant, s'il y en a.
    let fromAi: AoOfferFields[] = []
    if (content.text.trim().length >= 50) {
      const llmWait = Math.min(MAX_LLM_WAIT_MS, timeLeft() - 10_000)
      if (llmWait < MIN_LLM_WAIT_MS) throw new RetryLater('plus assez de temps pour l\'extraction : e-mail repris au prochain passage', !canDefer)
      fromAi = (await extractOffersFromEmail(content.text, llmWait)).offers
    }
    const extracted = [...content.tableOffers, ...fromAi]
    const offers = extracted.slice(0, MAX_OFFERS_PER_EMAIL)
    let created = 0
    let duplicates = 0
    const seen = new Set<string>()
    for (const offer of offers) {
      const fingerprint = offerFingerprint(offer)
      if (seen.has(fingerprint)) { duplicates++; continue } // même offre dans le corps et une pièce jointe
      seen.add(fingerprint)
      const duplicate = await findAoDuplicate(fingerprint, new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS))
      // Créée par un essai interrompu de ce même e-mail : c'est la sienne, pas un doublon.
      if (duplicate?.emailId === emailId) { created++; continue }
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
      content.tableRowsSkipped ? `${content.tableRowsSkipped} ligne(s) de tableau sans intitulé ignorée(s)` : '',
      content.tablesTruncated ? `Tableau trop long : seules les ${MAX_TABLE_ROWS} premières lignes sont lues.` : '',
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
    attempts = attemptsAfterFailure(attempts, {
      final: err instanceof PermanentError || err instanceof TruncatedAnswerError,
      // Reporté faute de temps ou en attente de l'IA : l'e-mail n'y est pour rien, l'essai n'est pas compté.
      countsAsAttempt: !(err instanceof RetryLater) || err.countsAsAttempt,
    })
    if (err instanceof AiUnavailable) {
      report.aiUnavailable = true
      if (err.stage === 'text') pass.textUnavailable = true
    }
    await updateAoEmail(emailId, { status: 'failed', attempts, error: message.slice(0, 1000) }).catch((saveErr: unknown) => {
      // L'e-mail reste « processing » : il sera repris après 15 min, avec un essai de plus compté.
      const reason = saveErr instanceof Error ? saveErr.message : String(saveErr)
      console.error('AO: état d\'un e-mail en erreur non enregistré', emailId, reason)
      report.errors.push(`État d'un e-mail en erreur non enregistré : ${reason}`)
    })
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
