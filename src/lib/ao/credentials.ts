import 'server-only'
import { keyFromBase64, seal, unseal } from '@/lib/crypto-box'
import type { AoSource } from './sources'
import { mailboxSecretContext } from './tenancy'

// Mots de passe des boîtes AO, chiffrés en base avec AO_CREDENTIALS_KEY (variable serveur, jamais NEXT_PUBLIC_).
// Chaque mot de passe est lié à sa boîte, son serveur et son identifiant (mailboxSecretContext).

const key = () => keyFromBase64(process.env.AO_CREDENTIALS_KEY, 'AO_CREDENTIALS_KEY')

/** Erreur explicite si la clé manque ou est invalide : appelé en début de passage, pour qu'il échoue en entier. */
export function assertCredentialsKey(): void {
  key()
}

export function sealMailboxPassword(source: Pick<AoSource, '$id' | 'host' | 'username'>, password: string): string {
  return seal(password, key(), mailboxSecretContext(source))
}

export function openMailboxPassword(source: Pick<AoSource, '$id' | 'host' | 'username' | 'passwordSealed'>): string {
  try {
    return unseal(source.passwordSealed, key(), mailboxSecretContext(source))
  } catch (err) {
    // Clé changée, ou serveur / identifiant modifiés sans nouveau mot de passe : le message d'origine (« unable to
    // authenticate data ») ne dirait rien à l'organisation.
    throw new Error('Mot de passe de la boîte illisible (clé de chiffrement changée, ou serveur modifié) : ressaisissez-le.', { cause: err })
  }
}
