// Dernier sourcing d'un AO pas encore publié, enregistré en JSON dans `ao_offer_details.sourcing` (5 000 caractères).
// Le texte était coupé à 5 000 caractères : une coupe au milieu du JSON le rendait illisible, et le sourcing passait pour
// jamais fait (relevé le 2026-11-24 : 5 raisons d'environ 760 caractères faisaient déjà 4 100 caractères). Les raisons
// sont raccourcies, puis les derniers candidats retirés, jusqu'à ce que le JSON tienne entier. Pur, testé.

/** Taille de l'attribut `sourcing` (appwrite.config.json). */
export const SOURCING_MAX_CHARS = 5000

/** Longueurs essayées pour chaque raison, de la plus longue à rien. */
const REASON_STEPS = [600, 400, 250, 120, 0]

/** JSON du sourcing, entier et dans `max` caractères : raisons raccourcies, puis derniers candidats retirés. */
export function sourcingJson<R extends { candidates: { reason: string }[] }>(record: R, max = SOURCING_MAX_CHARS): string {
  const full = JSON.stringify(record)
  if (full.length <= max) return full
  for (const cut of REASON_STEPS) {
    const shorter = { ...record, candidates: record.candidates.map(c => ({ ...c, reason: [...c.reason].slice(0, cut).join('') })) }
    const text = JSON.stringify(shorter)
    if (text.length <= max) return text
  }
  // Sans raison, trop de candidats encore : les mieux notés d'abord (ordre de la liste), les derniers retirés.
  for (let keep = record.candidates.length - 1; keep >= 0; keep--) {
    const text = JSON.stringify({ ...record, candidates: record.candidates.slice(0, keep).map(c => ({ ...c, reason: '' })) })
    if (text.length <= max) return text
  }
  return JSON.stringify({ ...record, candidates: [] })
}
