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

/**
 * Documents dont `attribute` vaut l'une des `values` (doublons et valeurs vides écartés), par lots de 100 — Appwrite
 * refuse davantage de valeurs dans un `Query.equal` — et chaque lot lu en entier. `queries` : filtres ajoutés à chaque lot.
 */
export async function listAllByValues(
  databases: Pick<Databases, 'listDocuments'>, databaseId: string, collectionId: string,
  attribute: string, values: string[], queries: string[],
): Promise<Models.Document[]> {
  const unique = [...new Set(values.filter(Boolean))]
  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += 100) batches.push(unique.slice(i, i + 100))
  const pages = await Promise.all(batches.map(batch =>
    listAllDocuments(databases, databaseId, collectionId, [...queries, Query.equal(attribute, batch)])))
  return pages.flat()
}
