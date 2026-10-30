import sanitizeHtml from 'sanitize-html'

// Affichage d'un e-mail d'origine dans la page (panneau d'une offre AO). Son HTML vient d'un expéditeur extérieur :
// nettoyé ici (liste blanche de balises et d'attributs, aucun script, formulaire ni cadre), puis servi par la route avec
// une CSP « sandbox » (aucun script, origine opaque) dans un iframe lui-même sandboxé (aoOriginalResponse, http.ts).
// Images : seules les images intégrées à l'e-mail (cid:, converties en data: par mailparser) sont gardées ; les images
// distantes sont retirées, leur chargement préviendrait l'expéditeur (pixels de suivi) et révélerait notre adresse IP.

export interface EmailViewInput {
  subject: string
  from: string
  to: string
  cc: string
  date: Date | null
  /** HTML de l'e-mail (false : e-mail en texte seul). */
  html: string | false
  text: string
  attachments: string[]
}

/** Une image intégrée au-delà de cette taille est retirée : la réponse doit tenir sous les 4,5 Mo d'une fonction Vercel. */
const MAX_INLINE_IMAGE_CHARS = 1_500_000
/** Au-delà, le texte seul de l'e-mail est affiché à la place de son HTML. */
const MAX_HTML_CHARS = 3_500_000
/** Texte seul affiché au plus (l'échappement peut le quadrupler) ; la suite est dans le .eml. */
const MAX_TEXT_CHARS = 800_000
const INLINE_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML de l'e-mail nettoyé, avec le nombre d'images retirées (distantes, trop lourdes ou d'un format non affiché). */
export function sanitizeEmailHtml(html: string): { html: string; removedImages: number } {
  let removedImages = 0
  const clean = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'font', 'center'],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'dir', 'lang', 'title'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      font: ['face', 'size', 'color'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    // Liens ouverts dans un nouvel onglet, sans transmettre la page d'origine.
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }) },
    exclusiveFilter: frame => {
      if (frame.tag !== 'img') return false
      const src = frame.attribs.src ?? ''
      const keep = INLINE_IMAGE.test(src) && src.length <= MAX_INLINE_IMAGE_CHARS
      if (!keep) removedImages++
      return !keep
    },
  })
  return { html: clean, removedImages }
}

/** Texte seul, lisible tel quel (retours à la ligne gardés), borné à MAX_TEXT_CHARS (signalé dans `notes`). */
function textBlock(text: string, notes: string[]): string {
  if (text.length > MAX_TEXT_CHARS) notes.push('Texte trop long : seul le début est affiché. Téléchargez le .eml pour la version complète.')
  return `<pre class="mbc-text">${escapeHtml(text.slice(0, MAX_TEXT_CHARS))}</pre>`
}

/**
 * Page HTML complète de l'e-mail : en-tête (expéditeur, destinataires, date, objet, pièces jointes), puis son contenu.
 * Document à part (cadre à origine opaque) : les couleurs sont celles des tokens --admin-* de globals.css, recopiées.
 * `contain: paint` sur le contenu de l'e-mail : un élément en position fixe ou absolue y reste enfermé, l'expéditeur ne
 * peut pas recouvrir l'en-tête (De, Date, Objet) par un faux.
 */
export function emailViewDocument(mail: EmailViewInput): string {
  let body: string
  const notes: string[] = []
  if (mail.html) {
    const { html, removedImages } = sanitizeEmailHtml(mail.html)
    if (html.length > MAX_HTML_CHARS) {
      body = textBlock(mail.text, notes)
      notes.push('E-mail trop volumineux pour être affiché en HTML : texte seul. Téléchargez le .eml pour la version complète.')
    } else {
      body = html
      if (removedImages) notes.push(`${removedImages} image${removedImages > 1 ? 's' : ''} masquée${removedImages > 1 ? 's' : ''} (images distantes ou trop lourdes) : téléchargez le .eml pour les voir.`)
    }
  } else {
    body = textBlock(mail.text || '(e-mail sans texte)', notes)
  }
  const date = mail.date && !Number.isNaN(mail.date.getTime())
    ? mail.date.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' })
    : ''
  const rows: [string, string][] = [
    ['De', mail.from],
    ['À', mail.to],
    ['Cc', mail.cc],
    ['Date', date],
    ['Objet', mail.subject],
    ['Pièces jointes', mail.attachments.join(', ')],
  ]
  const meta = rows.filter(([, value]) => value).map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('')
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(mail.subject || 'E-mail d’origine')}</title>
<style>
body{margin:0;background:#fff;color:#2C2C2E;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.mbc-meta{padding:16px 20px;background:#F5F5F6;border-bottom:1px solid #E4E4E7}
.mbc-meta dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}
.mbc-meta dt{color:#6B6B70;font-size:12px;padding-top:1px}.mbc-meta dd{margin:0;overflow-wrap:anywhere}
.mbc-note{margin:10px 0 0;font-size:12px;color:#b45309}
.mbc-body{padding:20px;overflow-wrap:anywhere;contain:paint}.mbc-body img{max-width:100%;height:auto}
.mbc-text{white-space:pre-wrap;font:inherit;margin:0}
</style></head>
<body><header class="mbc-meta"><dl>${meta}</dl>${notes.map(n => `<p class="mbc-note">${escapeHtml(n)}</p>`).join('')}</header>
<main class="mbc-body">${body}</main></body></html>`
}

/** Page d'erreur affichée dans le cadre de l'e-mail (boîte injoignable, e-mail supprimé…). */
export function emailViewError(message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>E-mail indisponible</title>
<style>body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;color:#b91c1c;background:#fff}</style></head>
<body><p>${escapeHtml(message)}</p></body></html>`
}
