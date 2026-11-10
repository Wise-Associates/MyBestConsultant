// E-mails et téléphones retirés d'un texte avant de l'envoyer à l'IA, qui n'en a pas besoin : modèle CV déposé
// (cv-export/inspect.ts) et CV noté pour une offre (cvTextForScoring, match-scoring.ts). Pur, testé dans
// cv-export/inspect.test.ts et match-scoring.test.ts.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Un téléphone a la forme d'un numéro : préfixe international (+33, 0033…), ou numéro français (0 et 9 chiffres, par
// paires ou d'un bloc). Une simple suite de chiffres ne suffit pas : « 2016 - 2018 - 2020 », des périodes sur une même
// ligne de CV, étaient masquées et l'IA ne voyait plus la durée des expériences (revue du 2026-11-10).
const PHONE_INTERNATIONAL = /(?:\+|\b00)\d[\d .()-]{7,}\d/g
// Paires séparées aussi par un retour à la ligne : l'en-tête d'un CV en PDF est souvent coupé au milieu du numéro.
const PHONE_FRENCH = /\b0\d(?:[ .\n-]?\d{2}){4}\b/g
const isPhone = (match: string) => match.replace(/\D/g, '').length >= 9

/** E-mails et numéros de téléphone d'un texte. */
export function contactsIn(text: string): string[] {
  return [
    ...(text.match(EMAIL) ?? []),
    ...[...(text.match(PHONE_INTERNATIONAL) ?? []), ...(text.match(PHONE_FRENCH) ?? [])].filter(isPhone),
  ]
}

/** Texte sans e-mail ni numéro de téléphone (marqueurs expliqués à l'IA). */
export function maskContacts(text: string): string {
  return text
    .replace(EMAIL, '‹e-mail masqué›')
    .replace(PHONE_INTERNATIONAL, m => (isPhone(m) ? '‹téléphone masqué›' : m))
    .replace(PHONE_FRENCH, '‹téléphone masqué›')
}
