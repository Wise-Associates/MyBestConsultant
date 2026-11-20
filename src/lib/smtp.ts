// Envoi d'e-mails par SMTP direct (ADR 0050), pour un e-mail dont les réponses doivent aller à une personne précise
// (en-tête Reply-To propre au message). Appwrite Messaging, qui envoie les autres e-mails de la plateforme, n'a qu'une
// adresse de réponse, commune à tous, réglée sur son fournisseur SMTP. Même serveur et même expéditeur que lui (SPF et
// DKIM du domaine). Pas de 'server-only' : les tests importent smtpSettings ; nodemailer (net, tls) ne peut de toute
// façon pas être embarqué dans le navigateur, le build échouerait.
import { createTransport } from 'nodemailer'

export interface MailAddress {
  name: string
  address: string
}

export interface SmtpSettings {
  host: string
  port: number
  user: string
  password: string
  /** Expéditeur, ex. « My Best Consultant <no-reply@mybestconsultant.fr> » : une adresse que le compte peut utiliser. */
  from: string
}

const REQUIRED = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']
const DEFAULT_PORT = 465

/** Réglages lus dans `env`, ou les variables absentes ou invalides : aucun envoi sans elles. */
export function smtpSettings(env: Record<string, string | undefined>): { settings: SmtpSettings } | { missing: string[] } {
  const missing = REQUIRED.filter(key => !env[key]?.trim())
  const port = env.SMTP_PORT?.trim() ? Number(env.SMTP_PORT.trim()) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SMTP_PORT')
  if (missing.length > 0) return { missing }
  return {
    settings: {
      host: env.SMTP_HOST!.trim(),
      port,
      user: env.SMTP_USER!.trim(),
      password: env.SMTP_PASSWORD!,
      from: env.SMTP_FROM!.trim(),
    },
  }
}

export const smtpConfigured = (): boolean => 'settings' in smtpSettings(process.env)

export interface SmtpEmail {
  to: MailAddress
  subject: string
  html: string
  /** Destinataire des réponses ; absent : l'expéditeur (SMTP_FROM). */
  replyTo?: MailAddress
}

/** Envoie l'e-mail ; lève si SMTP n'est pas configuré ou si le serveur refuse ou ne répond pas. */
export async function sendSmtpEmail(email: SmtpEmail): Promise<void> {
  const read = smtpSettings(process.env)
  if ('missing' in read) throw new Error(`Envoi impossible : SMTP non configuré (${read.missing.join(', ')})`)
  const { host, port, user, password, from } = read.settings
  const transport = createTransport({
    host,
    port,
    // 465 : TLS dès la connexion ; autre port (587) : passage en TLS (STARTTLS) exigé, jamais d'identifiants en clair.
    secure: port === 465,
    requireTLS: true,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  try {
    // Adresses passées en objets, jamais en texte : un nom saisi par un utilisateur n'est pas relu comme une adresse.
    await transport.sendMail({ from, to: email.to, replyTo: email.replyTo, subject: email.subject, html: email.html })
  } catch (e) {
    throw new Error(smtpErrorMessage(e))
  }
}

/**
 * Message d'une erreur d'envoi, sans le texte de la réponse du serveur, que nodemailer recopie dans son message et qui
 * contient souvent l'adresse refusée (« 550 <jean@…> : Recipient address rejected ») : il finit dans les journaux.
 */
export function smtpErrorMessage(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown }
  const details = [err.code, err.responseCode, err.command].filter(v => typeof v === 'string' || typeof v === 'number')
  return `Envoi SMTP impossible${details.length ? ` (${details.join(', ')})` : ''}`
}
