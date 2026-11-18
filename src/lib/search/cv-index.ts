import { cvSearchDocument } from './cv-search'
import { deleteCvDocuments, isSearchConfigured, upsertCvDocuments } from './meili'

// Mise à jour de l'index au fil de l'application (ADR 0044 phase 2) : un CV classé y entre, une classification effacée
// en sort. Jamais bloquant : un échec est journalisé et `npm run search:sync` remet l'index d'accord avec Appwrite.

/** Ajoute ou remplace le document d'un CV classé. */
export async function indexClassifiedCv(input: Parameters<typeof cvSearchDocument>[0]): Promise<void> {
  if (!isSearchConfigured()) return
  try {
    await upsertCvDocuments([cvSearchDocument(input)])
  } catch (err) {
    console.error('[recherche] CV non indexé, à rattraper par npm run search:sync', input.kind, input.sourceId, err instanceof Error ? err.message : err)
  }
}

/** Retire le document d'un CV supprimé (identifiant de sa classification). */
export async function removeCvFromIndex(id: string): Promise<void> {
  if (!isSearchConfigured()) return
  try {
    await deleteCvDocuments([id])
  } catch (err) {
    console.error('[recherche] CV supprimé encore dans l\'index, à rattraper par npm run search:sync', id, err instanceof Error ? err.message : err)
  }
}
