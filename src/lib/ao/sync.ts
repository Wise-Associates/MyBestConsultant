import { COLLECTIONS } from '@/lib/appwrite/config'
import { buildEmailContent, extractOffersFromEmail } from './extract'
import { DUPLICATE_WINDOW_DAYS, offerFingerprint } from './fingerprint'
import { aoInboxSettings, withAoInbox, type AoInboxSettings, type InboxEnvelope } from './imap'
import { TruncatedAnswerError } from './parse'
import {
  MAX_ATTEMPTS, createAoEmail, createAoOffer, findAoDuplicate, findAoEmailByMessageId,
  acquireSyncLock, incrementAoSources, nextStepFor, purgeAoRecords, releaseSyncLock, settledMessageIds, updateAoEmail,
} from './repo'

// Lecture planifiée de la boîte AO (Vercel Cron toutes les 5 minutes, ou bouton « Synchroniser » de l'admin).
// Chaque e-mail est enregistré en base AVANT d'être traité (index unique sur le Message-ID) et son état est
// relu juste avant chaque nouvel essai : un passage planifié et une synchronisation manuelle simultanés ne
// traitent pas le même e-mail. Une erreur est réessayée aux passages suivants, 3 fois au plus.

const DAY_MS = 86_400_000
/**
 * Fenêtre relue à chaque passage. Les e-mails déjà traités sont écartés par Message-ID ; relire 7 jours
 * permet de reprendre les e-mails en erreur ou laissés pour plus tard, même s'ils sont plus anciens que
 * les derniers traités. Un e-mail arrivé pendant une panne de plus de 7 jours ne serait pas relu.
 */
const LOOKBACK_DAYS = 7
/** Durée de conservation des e-mails et offres AO (les offres publiées restent en ligne). */
const RETENTION_DAYS = 365
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
/** Au-delà, l'e-mail est probablement une liste d'offres à importer à la main (Offres → Importer). */
const MAX_OFFERS_PER_EMAIL = 20
/** Marge gardée avant la fin du budget : on ne commence pas un e-mail qu'on n'aurait pas le temps de finir. */
const SAFETY_MARGIN_MS = 30_000
const MAX_LLM_WAIT_MS = 120_000

/** Erreur qu'un nouvel essai ne corrigerait pas : l'e-mail est abandonné tout de suite. */
class PermanentError extends Error {}

export interface AoSyncReport {
  /** false : identifiants IMAP absents, rien n'a été lu. */
  configured: boolean
  /** true : une autre synchronisation était en cours, ce passage n'a rien fait. */
  skipped: boolean
  /** E-mails nouveaux (ou à réessayer) trouvés dans la fenêtre lue. */
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
  /** Nombre maximal d'e-mails traités par passage. */
  maxEmails?: number
  /** Temps au-delà duquel on ne commence plus de nouvel e-mail (la fonction a une durée limitée). */
  budgetMs?: number
  /** Origine du passage, enregistrée avec le verrou (diagnostic). */
  holder?: string
}

export async function syncAoInbox({ now = new Date(), maxEmails = 8, budgetMs = 240_000, holder = 'cron' }: AoSyncOptions = {}): Promise<AoSyncReport> {
  const report: AoSyncReport = { configured: false, skipped: false, pending: 0, processed: 0, offersCreated: 0, duplicates: 0, noOffer: 0, failed: 0, remaining: 0, errors: [] }
  const settings = aoInboxSettings()
  if (!settings) return report
  report.configured = true
  if (!COLLECTIONS.AO_EMAILS || !COLLECTIONS.AO_OFFERS) {
    throw new Error('APPWRITE_COLLECTION_AO_EMAILS / APPWRITE_COLLECTION_AO_OFFERS non définies : créez les collections (npm run ao:setup) et ajoutez ces variables.')
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
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)

  await withAoInbox(settings, async inbox => {
    // Un même Message-ID peut apparaître deux fois dans la boîte (copie, renvoi) : on ne le traite qu'une fois.
    const envelopes = [...new Map((await inbox.list(since)).map(e => [e.messageId, e])).values()]
    const settled = await settledMessageIds(envelopes.map(e => e.messageId), now)
    const todo = envelopes.filter(e => !settled.has(e.messageId))
    report.pending = todo.length

    let handled = 0
    for (const envelope of todo) {
      if (report.processed + report.failed >= maxEmails || timeLeft() < SAFETY_MARGIN_MS) break
      handled++
      const claimed = await claim(envelope, now, report)
      if (!claimed) continue
      const { emailId } = claimed
      let { attempts } = claimed

      try {
        if (envelope.size > MAX_MESSAGE_BYTES) throw new PermanentError('Message trop volumineux (plus de 25 Mo) : à traiter à la main.')
        const message = await inbox.read(envelope.uid)
        const content = await buildEmailContent(message)
        await updateAoEmail(emailId, {
          fromAddress: message.fromAddress.slice(0, 320),
          fromName: message.fromName.slice(0, 200),
          subject: message.subject.slice(0, 500),
          receivedAt: message.receivedAt.toISOString(),
          attachments: content.attachments.map(a => a.slice(0, 255)),
        })

        const llmWait = Math.min(MAX_LLM_WAIT_MS, timeLeft() - 10_000)
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
        await updateAoEmail(emailId, { status: 'failed', attempts, error: message.slice(0, 1000) }).catch(() => undefined)
        report.failed++
        report.errors.push(message)
      }
    }
    report.remaining = todo.length - handled
  })
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
