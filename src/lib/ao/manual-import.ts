// Import manuel d'un document d'appels d'offres par l'admin (/api/admin/extract-jobs) : message envoyé à l'IA, avec les
// consignes AO_EXTRACTION_PROMPT (prompt.ts) seules, et lecture de sa réponse. Pur : un script reproduit exactement
// l'appel de la route et relit une réponse comme elle (exemples d'affinage).

import { parseModelJson } from '@/lib/ai/model-json'
import { placeUnlabeledDates } from './dates'

/** Message de l'utilisateur : le texte du document (extractTextFromFile), 40 000 caractères au plus. */
export function manualImportRequest(text: string): string {
  return `Voici le texte du document d'appels d'offres :\n\n${text.slice(0, 40000)}`
}

/**
 * Offres lues dans la réponse de l'IA : un tableau JSON, éventuellement entre balises ```. Les dates citées sans libellé
 * sont placées selon leur jour, comme pour AO Offers (placeUnlabeledDates ; `now` donne l'année manquante) ; aucune
 * autre validation. Lève si la réponse n'est pas un tableau JSON : la route répond alors 500 avec ce message.
 */
export function parseManualImportResponse(content: string, now: Date) {
  let raw = content.trim()
  raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  const parsed = parseModelJson(raw) as Record<string, unknown>[]

  if (!Array.isArray(parsed)) throw new Error('Réponse LLM invalide : attendu un tableau')
  // Même règle qu'AO Offers : les dates citées sans libellé sont placées selon leur jour (lundi : démarrage).
  return parsed.map(job => {
    if (!job || typeof job !== 'object') return job
    const { otherDates, ...rest } = job
    const unlabeled = Array.isArray(otherDates) ? otherDates.map(String) : []
    const labeled = { startDate: typeof rest.startDate === 'string' ? rest.startDate : '', deadline: typeof rest.deadline === 'string' ? rest.deadline : '' }
    return { ...rest, ...placeUnlabeledDates(labeled, unlabeled, now) }
  })
}
