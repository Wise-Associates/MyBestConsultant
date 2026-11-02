// E-mail au recruteur affecté à une offre ou à un appel d'offres, celui qui l'affecte en copie (demande du 2026-11-02).
// Règle et contenu purs, testés dans assignment-email.test.ts ; envoi : notifyAssignee (recruiter-assignment.ts).

/** Seulement un nouveau recruteur, autre que celui qui affecte : ni retrait, ni même choix, ni affectation à soi-même. */
export function shouldNotifyAssignee(previousId: string, nextId: string, assignerId: string): boolean {
  return !!nextId && nextId !== previousId && nextId !== assignerId
}

export interface AssignmentEmailInput {
  kind: 'job' | 'ao'
  title: string
  location: string
  assigneeName: string
  assignerName: string
  /** Adresse absolue de l'offre dans l'espace recruteur. */
  url: string
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const paragraph = 'margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;'
/** Intitulé borné dans l'objet : un intitulé d'AO peut être très long. */
const MAX_SUBJECT_TITLE = 120

/** Objet, titre et corps de l'e-mail (à envelopper par wrapEmailHtml). */
export function assignmentEmail(input: AssignmentEmailInput): { subject: string; heading: string; bodyHtml: string } {
  const ao = input.kind === 'ao'
  const title = input.title.trim() || 'Sans intitulé'
  const shortTitle = title.length > MAX_SUBJECT_TITLE ? `${title.slice(0, MAX_SUBJECT_TITLE - 1)}…` : title
  const what = ao ? 'l’appel d’offres' : 'l’offre'
  const url = escapeHtml(input.url)
  const bodyHtml = `
      <p style="${paragraph}">Bonjour ${escapeHtml(input.assigneeName)},</p>
      <p style="${paragraph}"><strong>${escapeHtml(input.assignerName)}</strong> vous a affecté ${what} <strong>« ${escapeHtml(title)} »</strong>${input.location.trim() ? ` (${escapeHtml(input.location.trim())})` : ''}. Vous en êtes désormais le recruteur responsable : consultez-${ao ? 'le' : 'la'} pour ${ao ? 'en suivre la publication et le sourcing' : 'en suivre les candidatures'}.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${url}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">${ao ? 'Voir l’appel d’offres' : 'Voir l’offre'}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px; font-size:12px; color:#9B9B9E; text-align:center;">Ou copiez ce lien : <a href="${url}" style="color:#E8A33D;">${url}</a></p>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">${escapeHtml(input.assignerName)} est en copie de cet e-mail.</p>`
  return {
    subject: `${input.assignerName} vous a affecté ${what} « ${shortTitle} »`,
    heading: ao ? 'Un appel d’offres vous est affecté' : 'Une offre vous est affectée',
    bodyHtml,
  }
}
