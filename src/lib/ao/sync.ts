import { COLLECTIONS } from '@/lib/appwrite/config'
import { handledUidsOf, nextCheckpoint, planRead, processingOrder, type ReadPlan } from './checkpoint'
import { buildEmailContent, extractOffersFromEmail } from './extract'
import { AiUnavailable, RetryLater, type ExtractionContext, type PassState } from './extractors/types'
import { DUPLICATE_WINDOW_DAYS, offerFingerprint } from './fingerprint'
import { assertCredentialsKey } from './credentials'
import { inboxSettingsFor } from './inbox-settings'
import { withAoInbox, type AoInbox, type AoInboxSettings, type InboxEnvelope } from './imap'
import { citedClients, formatSender, originalSender, senderCompany } from './origin'
import { emailDeadline } from './dates'
import { TruncatedAnswerError } from './parse'
import {
  createAoEmail, createAoOffer, findAoDuplicate, findAoEmailByMessageId,
  hasAoEmails, incrementAoSources, listRetryableAoEmails, nextStepFor, purgeAoRecords, saveAoOfferDetails, settledMessageIds, updateAoEmail,
} from './repo'
import { MAX_ATTEMPTS, attemptsAfterFailure, canDeferEmail } from './attempts'
import { MAX_TABLE_ROWS } from './spreadsheet'
import {
  acquireSyncLock, checkpointIdFor, endFullRead, getCheckpoint, isFullReadPending, purgeDailyState, startFullRead, releaseDailyVisionCall, releaseSyncLock, saveCheckpoint, takeDailyTableOffers, takeDailyVisionCall,
} from './state'
import { getAoSource, listEnabledSources, loadOrganizations, recordSourceError, recordSourceSync, type AoOrganization, type AoSource } from './sources'
import { lockIdFor } from './tenancy'
import type { AoEmail, ExtractedOffer } from './types'

// Lecture planifiée des boîtes AO (route /api/cron/ao-inbox appelée par un planificateur, ou bouton « Synchroniser »)
// : celles de la plateforme et celles des organisations abonnées (sources.ts, ADR 0005). Une seule synchronisation à
// la fois par organisation (verrou, state.ts). Chaque boîte n'est lue que pour le courrier arrivé depuis son point de
// reprise, plus ses e-mails à réessayer ; une fois par jour, un rattrapage relit 7 jours (checkpoint.ts). Chaque e-mail est enregistré en base AVANT d'être traité (index unique sur
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
/** Lectures d'images / PDF scannés par l'IA, par e-mail et par jour et par organisation (coût borné : tout expéditeur peut écrire). */
const MAX_VISION_CALLS_PER_EMAIL = 3
const MAX_VISION_CALLS_PER_DAY = 50
/**
 * Temps de lecture d'une organisation dans un passage planifié : les suivantes ont leur tour, et celles qui n'ont pas
 * été lues passent en tête du passage suivant (boîtes les moins récemment lues d'abord).
 */
const ORGANIZATION_BUDGET_MS = 120_000
/** Marge gardée avant la fin du budget : on ne commence pas un e-mail qu'on n'aurait pas le temps de finir. */
const SAFETY_MARGIN_MS = 30_000
/** Temps gardé pour l'extraction des offres après la lecture des pièces jointes. */
const EXTRACTION_RESERVE_MS = 45_000
const MAX_LLM_WAIT_MS = 120_000
/** En dessous, l'extraction des offres n'a pas le temps d'aboutir : l'e-mail est repris plus tard. */
const MIN_LLM_WAIT_MS = 20_000
/** Temps qu'il faut au premier e-mail d'une boîte pour être traité quoi qu'il arrive (voir canDeferEmail). */
const FIRST_EMAIL_MIN_MS = SAFETY_MARGIN_MS + EXTRACTION_RESERVE_MS + MIN_LLM_WAIT_MS
/**
 * Durée maximale de la connexion à une boîte : un serveur IMAP choisi par une organisation qui répondrait au compte-gouttes
 * ne doit pas retenir le passage de toutes les autres (le délai d'inactivité de la connexion ne suffit pas).
 */
const MAILBOX_HARD_LIMIT_MS = 150_000

/** Erreur qu'un nouvel essai ne corrigerait pas : l'e-mail est abandonné tout de suite. */
class PermanentError extends Error {}

export interface AoSyncReport {
  /** false : aucune boîte active, rien n'a été lu. */
  configured: boolean
  /** true : une autre synchronisation des mêmes organisations était en cours, ce passage n'a rien fait. */
  skipped: boolean
  /** Boîtes lues (ou tentées) pendant le passage. */
  mailboxes: number
  /** Boîtes dont la lecture a échoué (serveur, mot de passe, délai) : détail dans `errors` et sur la boîte (lastError). */
  failedMailboxes: number
  /** Organisations non lues faute d'abonnement actif (ou supprimées) : l'erreur est notée sur leurs boîtes. */
  unentitled: number
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
  /** Organisation dont les boîtes sont lues (bouton « Synchroniser ») ; toutes si absent (passage planifié). */
  tenantId?: string
}

/** Une boîte et l'organisation qui la lit, le temps d'un passage. */
interface MailboxRun {
  source: AoSource
  org: AoOrganization
}

const emptyReport = (): AoSyncReport => ({
  configured: false, skipped: false, mailboxes: 0, failedMailboxes: 0, unentitled: 0, mode: null, pending: 0, processed: 0, offersCreated: 0, duplicates: 0,
  noOffer: 0, failed: 0, remaining: 0, aiUnavailable: false, errors: [],
})

/** Configuration du serveur : son absence fait échouer le passage en entier (et non boîte par boîte, en silence). */
function assertConfigured(): void {
  if (!COLLECTIONS.AO_EMAILS || !COLLECTIONS.AO_OFFERS || !COLLECTIONS.AO_STATE || !COLLECTIONS.AO_SOURCES || !COLLECTIONS.AO_OFFER_DETAILS) {
    throw new Error('APPWRITE_COLLECTION_AO_EMAILS / _AO_OFFERS / _AO_STATE / _AO_SOURCES / _AO_OFFER_DETAILS non définies : créez les collections (npm run ao:setup) et ajoutez ces variables.')
  }
  assertCredentialsKey()
}

export async function syncAoInbox({ now = new Date(), maxEmails = 25, budgetMs = 240_000, holder = 'cron', tenantId }: AoSyncOptions = {}): Promise<AoSyncReport> {
  const report = emptyReport()
  assertConfigured()
  const startedAt = Date.now()
  const timeLeft = () => budgetMs - (Date.now() - startedAt)
  // La conservation ne dépend d'aucune organisation : elle est appliquée par les passages planifiés.
  if (!tenantId) {
    await purgeAoRecords(new Date(now.getTime() - RETENTION_DAYS * DAY_MS))
    await purgeDailyState(new Date(now.getTime() - 7 * DAY_MS))
  }

  const sources = await listEnabledSources(tenantId)
  report.configured = sources.length > 0
  // Ordre des organisations : celle dont une boîte attend depuis le plus longtemps d'abord (sources déjà triées).
  const tenantIds = [...new Set(sources.map(s => s.tenantId))]
  const orgs = await loadOrganizations(tenantIds)
  // L'IA est la même pour toutes les boîtes : indisponible pour l'une, elle l'est pour toutes, le passage s'arrête.
  const pass: SyncPass = { visionUnavailable: null, textUnavailable: false }
  let attempted = 0
  let busy = 0
  for (const id of tenantIds) {
    if (timeLeft() < SAFETY_MARGIN_MS || pass.textUnavailable) break
    const org = orgs.get(id)
    const orgSources = sources.filter(s => s.tenantId === id)
    // Organisation supprimée ou sans abonnement actif : ses boîtes ne sont pas lues (l'IA est à nos frais).
    if (!org?.entitled) {
      report.unentitled++
      await noteNotRead(report, orgSources, org ? 'Abonnement inactif : cette boîte n\'est pas lue.' : 'Organisation introuvable : cette boîte n\'est pas lue.')
      continue
    }
    attempted++
    const lock = await acquireSyncLock(lockIdFor(id), holder, now)
    if (!lock) {
      busy++
      continue
    }
    try {
      const orgStartedAt = Date.now()
      const orgTimeLeft = tenantId ? timeLeft : () => Math.min(timeLeft(), ORGANIZATION_BUDGET_MS - (Date.now() - orgStartedAt))
      for (const source of orgSources) {
        if (orgTimeLeft() < SAFETY_MARGIN_MS || pass.textUnavailable) break
        await syncMailbox(report, { source, org }, pass, { now, maxEmails, timeLeft: orgTimeLeft })
      }
    } finally {
      await releaseSyncLock(lock)
    }
  }
  report.skipped = attempted > 0 && busy === attempted
  return report
}

/** Note sur les boîtes d'une organisation qu'elles ne sont pas lues (une seule écriture tant que la raison ne change pas). */
async function noteNotRead(report: AoSyncReport, sources: AoSource[], reason: string): Promise<void> {
  for (const source of sources.filter(s => s.lastError !== reason)) {
    await recordSourceError(source.$id, reason).catch((err: unknown) => {
      report.errors.push(`État de la boîte ${source.label} non enregistré : ${err instanceof Error ? err.message : String(err)}`)
    })
  }
}

/**
 * Traite tout de suite un seul e-mail déjà enregistré (bouton « Réessayer »), sous le verrou de son organisation,
 * sans toucher au point de reprise. `tenantId` : organisation de l'appelant ; un e-mail d'une autre organisation est
 * refusé. Il doit être réessayable (en erreur, essais restants : voir manualRetryPatch) ; sinon le compte rendu est vide.
 */
export async function syncAoEmail(
  email: Pick<AoEmail, 'uid' | 'messageId' | 'sourceId'>,
  { now = new Date(), budgetMs = 150_000, holder = 'admin', tenantId }: Omit<AoSyncOptions, 'maxEmails' | 'tenantId'> & { tenantId: string },
): Promise<AoSyncReport> {
  const report = emptyReport()
  assertConfigured()
  const source = email.sourceId ? await getAoSource(email.sourceId) : null
  if (!source || source.tenantId !== tenantId) throw new Error('E-mail introuvable dans vos boîtes : rechargez la page.')
  if (!source.enabled) throw new Error(`La boîte ${source.label} est désactivée : réactivez-la pour réessayer.`)
  const org = (await loadOrganizations([tenantId])).get(tenantId)
  if (!org?.entitled) throw new Error('Abonnement inactif : les boîtes de cette organisation ne sont plus lues.')
  report.configured = true
  const lock = await acquireSyncLock(lockIdFor(tenantId), holder, now)
  if (!lock) {
    report.skipped = true
    return report
  }
  try {
    const startedAt = Date.now()
    const timeLeft = () => budgetMs - (Date.now() - startedAt)
    await withAoInbox(await inboxSettingsFor(source), MAILBOX_HARD_LIMIT_MS, async inbox => {
      // Même vérification que pour les nouveaux essais : l'UID doit toujours désigner ce message.
      const [envelope] = (await inbox.listUids([email.uid])).filter(e => e.messageId === email.messageId)
      if (!envelope) throw new Error('E-mail introuvable dans la boîte (supprimé, ou boîte reconstruite) : à traiter à la main.')
      report.pending = 1
      await processEnvelope(inbox, envelope, report, { visionUnavailable: null, textUnavailable: false }, now, timeLeft, false, { source, org })
    })
  } finally {
    await releaseSyncLock(lock)
  }
  return report
}

/**
 * Lit une boîte. Son échec (serveur injoignable, mot de passe refusé, délai dépassé…) est journalisé, noté sur la boîte
 * (lastError, affiché à son organisation et à l'admin) et compté dans le compte rendu ; il n'empêche pas la lecture des
 * autres boîtes.
 */
async function syncMailbox(
  report: AoSyncReport,
  run: MailboxRun,
  pass: SyncPass,
  options: { now: Date; maxEmails: number; timeLeft: () => number },
): Promise<void> {
  report.mailboxes++
  // Tentative notée AVANT la lecture : si la fonction est arrêtée en cours (délai de la plateforme), la boîte passe
  // quand même en fin de file au passage suivant, au lieu de bloquer toutes les autres en tête de file.
  const startedAt = new Date()
  let error = 'Lecture interrompue avant la fin (délai dépassé) : elle reprendra au prochain passage.'
  try {
    await recordSourceSync(run.source.$id, { at: startedAt, error })
    await readMailbox(report, run, pass, await inboxSettingsFor(run.source), options)
    error = ''
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    report.failedMailboxes++
    report.errors.push(`${run.source.label} : ${error}`)
    console.error('AO: lecture de boîte échouée', run.source.$id, run.org.tenantId, error)
  }
  await recordSourceSync(run.source.$id, { at: startedAt, error }).catch((saveErr: unknown) => {
    const reason = saveErr instanceof Error ? saveErr.message : String(saveErr)
    console.error('AO: état de la boîte non enregistré', run.source.$id, reason)
    report.errors.push(`État de la boîte ${run.source.label} non enregistré : ${reason}`)
  })
}

async function readMailbox(
  report: AoSyncReport,
  run: MailboxRun,
  pass: SyncPass,
  settings: AoInboxSettings,
  { now, maxEmails, timeLeft }: { now: Date; maxEmails: number; timeLeft: () => number },
): Promise<void> {
  const checkpointId = checkpointIdFor(run.source.$id)
  let checkpoint = await getCheckpoint(checkpointId)
  // Boîte sans aucun e-mail suivi (nouvelle, ou historique effacé) : lecture complète, pas seulement les 7 derniers
  // jours ; l'ancien point de reprise est ignoré (il dirait que tout a déjà été lu).
  if (!(await hasAoEmails(run.source.$id)) && !(await isFullReadPending(run.source.$id))) {
    await startFullRead(run.source.$id)
    checkpoint = null
  }
  const fullRead = await isFullReadPending(run.source.$id)

  await withAoInbox(settings, Math.min(MAILBOX_HARD_LIMIT_MS, Math.max(timeLeft(), 0)), async inbox => {
    const plan = planRead(checkpoint, inbox.uidValidity, now, fullRead)
    // Plusieurs boîtes par passage : un seul rattrapage suffit pour que le compte rendu le signale.
    if (report.mode !== 'reconcile') report.mode = plan.mode
    const candidates = plan.mode === 'reconcile' ? await inbox.listSince(plan.since) : await inbox.listAfter(plan.afterUid)
    // Le rattrapage relit la fenêtre entière, nouveaux essais compris ; sinon on les cherche en base.
    const retries = plan.mode === 'incremental' ? await retryEnvelopes(inbox, run.source.$id, now) : []

    // Courrier nouveau d'abord ; un même Message-ID (copie, renvoi) n'est traité qu'une fois.
    const envelopes = processingOrder(candidates, retries)
    const settled = await settledMessageIds(run.source.$id, envelopes.map(e => e.messageId), now)
    const todo = envelopes.filter(e => !settled.has(e.messageId))
    report.pending += todo.length

    // Suivi par Message-ID : deux copies d'un même message (UID différents) sont traitées ensemble.
    const handledIds = new Set(settled)
    let handled = 0
    for (const envelope of todo) {
      if (handled >= maxEmails || timeLeft() < SAFETY_MARGIN_MS) break
      // Extraction des offres impossible (crédits épuisés partout…) : tous les e-mails suivants échoueraient de
      // même, ils attendent. Une lecture des scans impossible, elle, n'arrête pas le passage : les e-mails qui
      // n'en ont pas besoin sont traités, les autres attendent sans nouvel appel (pass.visionUnavailable).
      if (pass.textUnavailable) break
      handledIds.add(envelope.messageId)
      await processEnvelope(inbox, envelope, report, pass, now, timeLeft, canDeferEmail(handled, timeLeft(), FIRST_EMAIL_MIN_MS), run)
      handled++
    }
    report.remaining += todo.filter(e => !handledIds.has(e.messageId)).length
    const handledUids = handledUidsOf(candidates, handledIds)
    const next = nextCheckpoint(checkpoint, inbox.uidValidity, plan, candidates.map(c => c.uid), handledUids, inbox.uidNext, now)
    await saveCheckpoint(checkpointId, next)
    // Rattrapage allé au bout : la lecture complète est terminée, les passages suivants reprennent le rythme normal.
    if (fullRead && next.reconciledAt) await endFullRead(run.source.$id)
  })
}

/**
 * Enveloppes des e-mails à réessayer, relues par UID. Le Message-ID est revérifié : si la boîte a été
 * reconstruite entre-temps, l'UID désigne un autre message et l'e-mail sera repris par le rattrapage.
 */
async function retryEnvelopes(inbox: AoInbox, sourceId: string, now: Date): Promise<InboxEnvelope[]> {
  const emails = await listRetryableAoEmails(sourceId, now)
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
  { source, org }: MailboxRun,
): Promise<void> {
  const claimed = await claim(source.$id, envelope, now, report)
  if (!claimed) return
  const { emailId } = claimed
  let { attempts } = claimed

  try {
    if (envelope.size > MAX_MESSAGE_BYTES) throw new PermanentError('Message trop volumineux (plus de 25 Mo) : à traiter à la main.')
    const message = await inbox.read(envelope.uid)
    const origin = originalSender(message, source.ownDomains)
    // Enregistré avant la lecture des pièces jointes : un e-mail en attente de l'IA reste reconnaissable
    // (expéditeur, objet) dans la liste des e-mails en erreur de /admin/candidats.
    await updateAoEmail(emailId, {
      fromAddress: message.fromAddress.slice(0, 320),
      fromName: message.fromName.slice(0, 200),
      origin: origin ? formatSender(origin) : '',
      subject: message.subject.slice(0, 500),
      receivedAt: message.receivedAt.toISOString(),
    })
    let visionCalls = 0
    const ctx: ExtractionContext = {
      deadline: Date.now() + timeLeft() - EXTRACTION_RESERVE_MS,
      canDefer,
      pass,
      reserveVisionCall: async () => {
        if (visionCalls >= MAX_VISION_CALLS_PER_EMAIL || !(await takeDailyVisionCall(org.tenantId, now, MAX_VISION_CALLS_PER_DAY))) return false
        visionCalls++
        return true
      },
      // Lecture refusée pour raison de compte, sans frais : sinon les e-mails en attente de crédits
      // épuiseraient en quelques passages le budget du jour, et seraient ensuite traités sans leurs pièces jointes.
      releaseVisionCall: async () => {
        visionCalls--
        await releaseDailyVisionCall(org.tenantId, now)
      },
    }
    const content = await buildEmailContent(message, ctx)
    await updateAoEmail(emailId, { attachments: content.attachments.map(a => a.slice(0, 255)) })

    const tableOffers = content.tableOffers.slice(0, MAX_OFFERS_PER_EMAIL).length
    if (tableOffers && !(await takeDailyTableOffers(org.tenantId, now, tableOffers, MAX_TABLE_OFFERS_PER_DAY))) {
      throw new RetryLater(`plafond du jour atteint pour les offres lues dans des tableaux (${MAX_TABLE_OFFERS_PER_DAY}) : e-mail repris dès que le plafond le permet`, false)
    }
    // Les offres des tableaux joints sont déjà lues ; l'IA ne lit que le texte restant, s'il y en a.
    let fromAi: ExtractedOffer[] = []
    const aiOrigin = content.bodyIncluded ? origin : null
    if (content.text.trim().length >= 50) {
      const llmWait = Math.min(MAX_LLM_WAIT_MS, timeLeft() - 10_000)
      if (llmWait < MIN_LLM_WAIT_MS) throw new RetryLater('plus assez de temps pour l\'extraction : e-mail repris au prochain passage', !canDefer)
      fromAi = (await extractOffersFromEmail(content.text, llmWait, aiOrigin, org.name, message.receivedAt)).offers
    }
    const read = [...content.tableOffers, ...fromAi]
    // Enregistrés avant la création des offres : une offre ne doit jamais exister sans ce qui permet de la publier
    // anonymisée (clients cités), même si la suite du traitement échoue.
    await updateAoEmail(emailId, { citedClients: citedClients(read), deadline: emailDeadline(read.map(o => o.deadline), message.receivedAt) })
    // Le client est l'entreprise de l'expéditeur d'origine, pour toutes les offres de l'e-mail (origin.ts). Les noms
    // lus par l'IA ne comptent que si elle avait la signature sous les yeux (corps de l'e-mail confié).
    const company = senderCompany(origin, aiOrigin ? fromAi.map(o => o.companyName) : [], { name: org.name, ownDomains: source.ownDomains })
    const extracted = company === null ? read : read.map(o => ({ ...o, companyName: company }))
    const offers = extracted.slice(0, MAX_OFFERS_PER_EMAIL)
    let created = 0
    let duplicates = 0
    const seen = new Set<string>()
    for (const offer of offers) {
      const fingerprint = offerFingerprint(offer, org.tenantId)
      if (seen.has(fingerprint)) { duplicates++; continue } // même offre dans le corps et une pièce jointe
      seen.add(fingerprint)
      const duplicate = await findAoDuplicate(fingerprint, new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS))
      const details = offer.engagement || offer.technologies.length ? { engagement: offer.engagement, technologies: offer.technologies } : null
      // Créée par un essai interrompu de ce même e-mail : c'est la sienne, pas un doublon (ses détails ont pu manquer).
      if (duplicate?.emailId === emailId) {
        if (details) await saveAoOfferDetails(duplicate.$id, details)
        created++
        continue
      }
      if (duplicate) {
        await incrementAoSources(duplicate)
        duplicates++
      } else {
        const saved = await createAoOffer(offer, { fingerprint, emailId })
        if (details) await saveAoOfferDetails(saved.$id, details)
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
async function claim(sourceId: string, envelope: InboxEnvelope, now: Date, report: AoSyncReport): Promise<{ emailId: string; attempts: number } | null> {
  const existing = await findAoEmailByMessageId(sourceId, envelope.messageId)
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
    const email = await createAoEmail({ sourceId, messageId: envelope.messageId, uid: envelope.uid, receivedAt: envelope.receivedAt.toISOString() })
    return { emailId: email.$id, attempts: 1 }
  } catch (err) {
    // 409 : un autre passage vient de le prendre. Toute autre erreur est signalée.
    if ((err as { code?: number }).code !== 409) report.errors.push(`Enregistrement de l'e-mail impossible : ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
