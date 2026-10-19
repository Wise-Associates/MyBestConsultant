import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

// Accès à la boîte des appels d'offres (ao@wise-associates.fr chez IONOS) en IMAP sur TLS.
// La boîte est ouverte en LECTURE SEULE : aucun message n'est supprimé, déplacé ni marqué comme lu ;
// le suivi de ce qui a déjà été traité est fait en base (collection AO_EMAILS, par Message-ID).

export interface AoInboxSettings {
  host: string
  port: number
  user: string
  password: string
  mailbox: string
}

/** Paramètres lus dans l'environnement ; null tant que l'identifiant ou le mot de passe manque. */
export function aoInboxSettings(): AoInboxSettings | null {
  const user = process.env.AO_IMAP_USER?.trim()
  const password = process.env.AO_IMAP_PASSWORD
  if (!user || !password) return null
  return {
    host: process.env.AO_IMAP_HOST?.trim() || 'imap.ionos.fr',
    port: Number(process.env.AO_IMAP_PORT) || 993,
    user,
    password,
    mailbox: process.env.AO_IMAP_MAILBOX?.trim() || 'INBOX',
  }
}

export interface InboxEnvelope {
  uid: number
  messageId: string
  size: number
  receivedAt: Date
}

export interface InboxAttachment {
  filename: string
  content: Buffer
}

export interface InboxMessage {
  uid: number
  messageId: string
  fromAddress: string
  fromName: string
  subject: string
  receivedAt: Date
  text: string
  attachments: InboxAttachment[]
}

export interface AoInbox {
  /** Messages reçus depuis `since` (critère IMAP au jour près), du plus ancien au plus récent. */
  list(since: Date): Promise<InboxEnvelope[]>
  /** Télécharge et décode un message. */
  read(uid: number): Promise<InboxMessage>
}

const stripHtml = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()

/** Ouvre la boîte le temps de `work`, puis ferme la connexion (même en cas d'erreur). */
export async function withAoInbox<T>(settings: AoInboxSettings, work: (inbox: AoInbox) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock(settings.mailbox, { readOnly: true })
    try {
      // Sans Message-ID (rare), l'identifiant stable est le couple UIDVALIDITY + UID ; un Message-ID
      // anormalement long est remplacé par son empreinte (champ limité à 500 caractères en base).
      const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : '0'
      const idOf = (messageId: string | undefined, uid: number) => {
        const id = messageId?.trim()
        if (!id) return `uid:${uidValidity}:${uid}`
        return id.length <= 500 ? id : `sha256:${createHash('sha256').update(id).digest('hex')}`
      }

      return await work({
        async list(since) {
          const uids = (await client.search({ since }, { uid: true })) || []
          if (!uids.length) return []
          const envelopes: InboxEnvelope[] = []
          for await (const msg of client.fetch(uids.join(','), { uid: true, envelope: true, size: true, internalDate: true }, { uid: true })) {
            envelopes.push({
              uid: msg.uid,
              messageId: idOf(msg.envelope?.messageId, msg.uid),
              size: msg.size ?? 0,
              receivedAt: new Date(msg.internalDate ?? Date.now()),
            })
          }
          return envelopes.sort((a, b) => a.uid - b.uid)
        },
        async read(uid) {
          const msg = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true, internalDate: true }, { uid: true })
          if (!msg || !msg.source) throw new Error(`Message IMAP ${uid} introuvable`)
          const mail = await simpleParser(msg.source, { skipImageLinks: true, skipTextLinks: true })
          const from = mail.from?.value[0]
          return {
            uid,
            messageId: idOf(msg.envelope?.messageId, uid),
            fromAddress: from?.address ?? '',
            fromName: from?.name ?? '',
            subject: mail.subject ?? '',
            receivedAt: mail.date ?? new Date(msg.internalDate ?? Date.now()),
            text: mail.text?.trim() || (typeof mail.html === 'string' ? stripHtml(mail.html) : ''),
            // Les images intégrées au corps (logos, signatures) ne sont pas des pièces jointes utiles.
            attachments: mail.attachments
              .filter(a => !a.related)
              .map(a => ({ filename: a.filename || 'piece-jointe', content: a.content })),
          }
        },
      })
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}
