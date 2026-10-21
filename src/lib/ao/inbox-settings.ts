import 'server-only'
import { openMailboxPassword } from './credentials'
import type { AoInboxSettings } from './imap'
import { resolveImapHost } from './imap-host'
import type { AoSource } from './sources'

/** Connexion à une boîte : serveur vérifié (adresses publiques seulement), mot de passe déchiffré au dernier moment. */
export async function inboxSettingsFor(source: AoSource): Promise<AoInboxSettings> {
  const endpoint = await resolveImapHost(source.host)
  return { ...endpoint, user: source.username, password: openMailboxPassword(source), mailbox: source.mailbox }
}
