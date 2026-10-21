import 'server-only'
import { simpleParser } from 'mailparser'
import { withAoInbox } from './imap'
import { inboxSettingsFor } from './inbox-settings'
import { isErased, type AoSource } from './sources'
import type { AoEmail } from './types'

// E-mails d'origine des offres AO, pour en vérifier l'authenticité (en-têtes, signature DKIM) : relus dans la boîte au
// moment du téléchargement, jamais conservés (décision du 2026-10-21 : pas de copie du contenu des e-mails en base).

const ORIGINAL_TIMEOUT_MS = 45_000

/** L'original ne peut pas être relu (boîte supprimée, e-mail supprimé ou déplacé) : message pour l'utilisateur. */
export class OriginalUnavailable extends Error {}

/** E-mail tel que reçu (.eml). Le Message-ID est revérifié : l'UID doit toujours désigner ce message. */
export async function fetchOriginal(email: Pick<AoEmail, 'uid' | 'messageId'>, source: AoSource): Promise<Buffer> {
  if (isErased(source)) throw new OriginalUnavailable('La boîte de cet e-mail a été supprimée : l\'original n\'est plus accessible.')
  return withAoInbox(await inboxSettingsFor(source), ORIGINAL_TIMEOUT_MS, async inbox => {
    const message = await inbox.source(email.uid)
    if (!message || message.messageId !== email.messageId) {
      throw new OriginalUnavailable('E-mail introuvable dans la boîte (supprimé ou déplacé) : l\'original n\'est plus accessible.')
    }
    return message.raw
  })
}

/** Une pièce jointe de l'e-mail d'origine, retrouvée par son nom (celui enregistré à la lecture de l'e-mail). */
export async function fetchOriginalAttachment(email: Pick<AoEmail, 'uid' | 'messageId'>, source: AoSource, filename: string): Promise<{ content: Buffer; contentType: string }> {
  const mail = await simpleParser(await fetchOriginal(email, source), { skipImageLinks: true, skipTextLinks: true })
  const attachment = mail.attachments.find(a => (a.filename || 'piece-jointe') === filename)
  if (!attachment) throw new OriginalUnavailable(`Pièce jointe « ${filename} » introuvable dans l'e-mail.`)
  return { content: attachment.content, contentType: attachment.contentType || 'application/octet-stream' }
}
