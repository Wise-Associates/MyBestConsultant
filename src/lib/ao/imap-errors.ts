import { ImapHostError } from './imap-host'

// Erreurs de connexion à une boîte, en messages pour l'organisation (test de connexion, état de la boîte) : les messages
// bruts d'imapflow, de Node ou de TLS (« Command failed », « ERR_TLS_… ») ne lui diraient rien.

const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ETIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'NoConnection'])
const BAD_CERTIFICATE = /^(ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(GET|VERIFY))/

/** Message affichable pour un échec de connexion ou de lecture ; `folder` : dossier demandé. */
export function mailboxErrorMessage(err: unknown, folder = 'INBOX'): string {
  if (err instanceof ImapHostError) return err.message
  const e = (err ?? {}) as { message?: string; code?: string; authenticationFailed?: boolean; serverResponseCode?: string }
  if (e.authenticationFailed || e.serverResponseCode === 'AUTHENTICATIONFAILED') {
    return 'Identifiant ou mot de passe refusé par le serveur. Gmail, Outlook : utilisez un mot de passe d\'application et vérifiez que l\'IMAP est activé.'
  }
  if (e.serverResponseCode === 'NONEXISTENT') return `Dossier « ${folder} » introuvable dans la boîte (INBOX pour la boîte de réception).`
  if (e.code && BAD_CERTIFICATE.test(e.code)) return 'Certificat TLS du serveur invalide pour ce nom : vérifiez le nom du serveur IMAP.'
  if (e.code && UNREACHABLE.has(e.code)) return 'Serveur IMAP injoignable sur le port 993 (IMAP sécurisé) : vérifiez son nom, ou réessayez plus tard.'
  // Nos propres erreurs (délai dépassé, mot de passe illisible) sont déjà rédigées pour l'utilisateur.
  if (e.message?.startsWith('Serveur IMAP trop lent') || e.message?.startsWith('Mot de passe de la boîte illisible')) return e.message
  return 'Connexion impossible : vérifiez le serveur, l\'identifiant et le mot de passe, ou réessayez plus tard.'
}
