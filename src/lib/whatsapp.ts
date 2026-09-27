// Contact direct WhatsApp (Module 13) — pur, sans accès base.
// Principe : un candidat qui renseigne son numéro WhatsApp accepte d'être contacté par les recruteurs. Le
// recruteur clique, WhatsApp (application ou WhatsApp Web) s'ouvre sur SA conversation avec le candidat, message
// pré-rempli et modifiable ; il n'envoie qu'en appuyant sur « Envoyer » dans WhatsApp. Aucun envoi automatique :
// l'API WhatsApp Business n'est pas nécessaire (et l'envoi automatique en masse est interdit sans opt-in Meta).

const DEFAULT_COUNTRY = '33' // France : « 06 12 34 56 78 » → +33612345678

/** Normalise un numéro saisi librement en format international « +33612345678 », ou renvoie une erreur lisible. */
export function normalizeWhatsApp(input: string, defaultCountry: string = DEFAULT_COUNTRY): { e164?: string; error?: string } {
  const raw = (input ?? '').trim()
  if (!raw) return { e164: '' }
  if (/[a-z]/i.test(raw)) return { error: 'Le numéro ne doit contenir que des chiffres.' }
  let digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = defaultCountry + digits.slice(1) // format national → pays par défaut
  digits = digits.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return { error: 'Numéro invalide : saisissez-le au format international (ex. +33 6 12 34 56 78).' }
  return { e164: `+${digits}` }
}

/** Lien qui ouvre WhatsApp sur la conversation avec ce numéro, avec le texte pré-rempli. */
export function waLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, '')
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** « +33612345678 » → « +33 6 12 34 56 78 » (lisible ; les autres pays sont regroupés par 2-3 chiffres). */
export function formatWhatsApp(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.startsWith('33') && d.length === 11) return `+33 ${d[2]} ${d.slice(3).match(/.{2}/g)!.join(' ')}`
  return `+${d.slice(0, d.length > 11 ? 3 : 2)} ${d.slice(d.length > 11 ? 3 : 2).replace(/(\d{2,3})(?=\d)/g, '$1 ')}`
}

export interface WhatsAppVars { prenom: string; poste?: string; entreprise?: string; recruteur?: string }

export const WHATSAPP_TEMPLATES: { id: string; label: string; text: string }[] = [
  { id: 'first', label: 'Premier contact', text: 'Bonjour {prenom}, je suis {recruteur} de {entreprise}. J’ai découvert votre profil et je souhaiterais vous parler d’une opportunité : « {poste} ». Seriez-vous disponible pour en discuter quelques minutes ?' },
  { id: 'interview', label: 'Proposer un échange', text: 'Bonjour {prenom}, suite à votre candidature pour « {poste} » chez {entreprise}, j’aimerais vous proposer un échange. Quelles sont vos disponibilités cette semaine ?\n\n{recruteur}' },
  { id: 'reminder', label: 'Relance', text: 'Bonjour {prenom}, je me permets de revenir vers vous au sujet de « {poste} ». Êtes-vous toujours intéressé(e) ?\n\n{recruteur} — {entreprise}' },
  { id: 'free', label: 'Message libre', text: 'Bonjour {prenom}, ' },
]

/** Remplace les variables ; sans poste précis, « {poste} » devient « une opportunité » (CVthèque, matching…). */
export function fillTemplate(text: string, v: WhatsAppVars): string {
  return text
    .replace(/« \{poste\} »/g, v.poste ? `« ${v.poste} »` : 'une opportunité')
    .replace(/\{prenom\}/g, v.prenom || '')
    .replace(/\{entreprise\}/g, v.entreprise || 'notre société')
    .replace(/\{recruteur\}/g, v.recruteur || '')
    .replace(/ {2,}/g, ' ')
}
