/**
 * Corps d'une requête lu morceau par morceau et abandonné au-delà de `max` octets (la taille annoncée n'est pas crue) ;
 * null s'il est trop gros. Pour les routes appelées par nos robots (rapports de la veille, état du scraper).
 */
export async function readBoundedBody(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
