// Limites des modèles Word « Format ESN » (ADR 0010), sans dépendance : importées par le serveur (template-check.ts)
// et par la fenêtre de dépôt de l'admin, qui les vérifie avant l'envoi.

// Un export français + anglais est un .zip d'environ deux fois le modèle : à 2 Mo, il reste sous la limite de 4,5 Mo des
// réponses des fonctions Vercel (et le dépôt sous celle des requêtes).
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024

/** Taille de l'attribut `mapJson` de la collection (scripts/setup-cv-export-storage.mjs) ; une cartographie fait ~3 Ko. */
export const MAX_MAP_LENGTH = 20_000

export const TEMPLATE_TOO_LARGE = 'Modèle trop lourd : 2 Mo au plus (réduisez ou compressez les images du modèle).'
