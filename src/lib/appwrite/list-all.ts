import { Query, type Databases, type Models } from 'node-appwrite'

const PAGE = 500

/**
 * Tous les documents qui répondent à `queries`, lus par pages de 500 avec un curseur. Une seule requête plafonnée
 * (`Query.limit(100)`) faisait afficher « Mes offres (100) » à une organisation qui en avait davantage. `queries` ne doit
 * contenir ni `limit` ni curseur ; avec `Query.select`, garder `$id` (il sert de curseur).
 */
export async function listAllDocuments(
  databases: Pick<Databases, 'listDocuments'>, databaseId: string, collectionId: string, queries: string[],
): Promise<Models.Document[]> {
  const all: Models.Document[] = []
  let cursor: string | undefined
  for (;;) {
    const { documents } = await databases.listDocuments(databaseId, collectionId, [
      ...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    all.push(...documents)
    if (documents.length < PAGE) return all
    cursor = documents[documents.length - 1].$id
  }
}
