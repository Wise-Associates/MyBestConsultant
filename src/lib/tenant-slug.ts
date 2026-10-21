// Slug d'une organisation (adresse de sa page publique, /[slug]) : lisible, sans accents, unique (index unique en base).
// Deux organisations peuvent porter le même nom : la seconde reçoit « nom-2 », etc. Un nom tapé à l'inscription ne
// fait jamais entrer dans une organisation existante : les collègues la rejoignent par invitation (src/lib/team.ts).

const MAX_SLUG_LENGTH = 60
/** Essais avec un suffixe lisible (« -2 » à « -10 ») avant un suffixe aléatoire. */
export const READABLE_SLUG_ATTEMPTS = 10

/** « Société Générale (SG) » → « societe-generale-sg » ; « entreprise » si rien de lisible ne reste. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
  return slug || 'entreprise'
}

/** Slug à essayer au tour `attempt` (0, 1, 2…) ; `random` fournit un suffixe une fois les suffixes lisibles épuisés. */
export function slugCandidate(name: string, attempt: number, random: () => string): string {
  const base = slugify(name)
  if (attempt === 0) return base
  return attempt < READABLE_SLUG_ATTEMPTS ? `${base}-${attempt + 1}` : `${base}-${random()}`
}
