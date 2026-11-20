// Corps de l'e-mail de prise de contact envoyé aux candidats les mieux notés pour une offre (sendOutreachEmailCore,
// sourcing-core.ts : à la création de l'offre et depuis /admin/sourcing). Demande du 2026-11-20 : le lien vers l'offre,
// et les réponses du candidat chez le recruteur qui a créé l'offre (Reply-To, ADR 0050). Pur, testé dans
// outreach-email.test.ts ; à envelopper par wrapEmailHtml.
import type { MailAddress } from '@/lib/smtp'

/**
 * Destinataire des réponses : le compte du recruteur qui a créé l'offre (jobs.postedBy), s'il existe encore, n'est pas
 * désactivé et a une adresse vérifiée ; sinon null (réponses à l'expéditeur). Une adresse non vérifiée (faute de frappe,
 * adresse d'un tiers à l'inscription) enverrait le CV et le téléphone du candidat à une boîte hors de l'organisation.
 */
export function creatorReplyTo(
  profile: Record<string, unknown> | null,
  account: { status: boolean; email: string; emailVerification: boolean } | null,
): MailAddress | null {
  if (!profile || !account?.status || !account.emailVerification || !account.email) return null
  const name = [profile.firstName, profile.lastName].filter(part => typeof part === 'string' && part.trim()).join(' ').trim()
  return { name, address: account.email }
}

export interface OutreachEmailInput {
  /** Message rédigé par l'IA, modifiable par l'admin : texte brut, un paragraphe par ligne. */
  message: string
  /** Adresse absolue de la page publique de l'offre. */
  jobUrl: string
  unsubscribeUrl: string
  /** Les réponses vont au recruteur qui a créé l'offre (Reply-To) : le candidat en est prévenu. */
  repliesToRecruiter: boolean
}

/** Aussi pour l'objet, repris en titre de l'e-mail (wrapEmailHtml ne l'échappe pas). */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const paragraph = 'margin:0 0 12px; font-size:14px; line-height:1.7; color:#3D4566;'

export function outreachEmailBody(input: OutreachEmailInput): string {
  const jobUrl = escapeHtml(input.jobUrl)
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl)
  const message = input.message
    .split('\n')
    .map(line => `<p style="${paragraph}">${line ? escapeHtml(line) : '&nbsp;'}</p>`)
    .join('')
  const replyNote = input.repliesToRecruiter
    ? `<p style="${paragraph}">Une question, ou cette mission vous intéresse ? Répondez simplement à cet e-mail : votre réponse arrivera directement chez le recruteur qui a publié l’offre.</p>`
    : ''
  return `${message}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#0B1D51;">
          <a href="${jobUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Postuler</a>
        </td></tr>
      </table>
      <p style="margin:0 0 20px; font-size:12px; color:#ADB5CC; text-align:center;">Ou copiez ce lien : <a href="${jobUrl}" style="color:#3D4566;">${jobUrl}</a></p>
      ${replyNote}
      <p style="margin:24px 0 0; font-size:12px; line-height:1.6; color:#ADB5CC;">Vous ne souhaitez plus recevoir ce type de proposition ? <a href="${unsubscribeUrl}" style="color:#ADB5CC;">Se désabonner</a>.</p>`
}
