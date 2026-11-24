// Formes juridiques et mots génériques retirés d'un nom de société pour le comparer (empreinte d'une offre,
// fingerprint.ts) ou le masquer sous toutes ses variantes (anonymize.ts). Dans un fichier à part, sans dépendance :
// l'anonymisation tourne aussi dans le navigateur (aperçu du post LinkedIn, ADR 0058), fingerprint.ts non (node:crypto).
export const LEGAL_SUFFIXES = new Set(['sa', 'sas', 'sasu', 'sarl', 'eurl', 'snc', 'se', 'group', 'groupe', 'france'])
