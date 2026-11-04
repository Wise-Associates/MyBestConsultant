/**
 * `fn` appliquée à chaque élément, `limit` à la fois au plus (appels d'IA d'une notation candidat par candidat : tous à
 * la fois dépasseraient les limites de débit du fournisseur). Résultats dans l'ordre de `items` ; `fn` gère ses erreurs.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
