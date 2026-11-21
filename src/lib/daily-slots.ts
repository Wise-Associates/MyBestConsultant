// Places de quota du jour prises ensemble pour un même appel (session, organisation, plateforme) : en parallèle, un
// aller-retour vers Appwrite au lieu d'un par compteur (entretien vocal, ADR 0052). Testé dans daily-slots.test.ts.

/**
 * Prend une place pour chaque demande, toutes ou aucune : si l'une est refusée (plafond atteint), les places prises sont
 * rendues et `refused` liste les demandes refusées ; si l'une échoue (Appwrite), les places prises sont rendues puis
 * l'erreur est levée. Une place qui n'a pas pu être rendue est journalisée : elle compte jusqu'au lendemain.
 */
export async function takeAllSlots<R>(
  requests: readonly R[],
  take: (request: R) => Promise<string | null>,
  release: (slotId: string) => Promise<void>,
  log: Pick<Console, 'error'> = console,
): Promise<{ ok: boolean; refused: R[] }> {
  const results = await Promise.allSettled(requests.map(take))
  const taken = results.flatMap(r => (r.status === 'fulfilled' && r.value ? [r.value] : []))
  const refused = requests.filter((_, i) => { const r = results[i]; return r.status === 'fulfilled' && !r.value })
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (!failure && refused.length === 0) return { ok: true, refused: [] }
  await Promise.all(taken.map(id => release(id).catch(err => {
    log.error('[quotas] place non rendue, comptée jusqu\'au lendemain', id, err instanceof Error ? err.message : err)
  })))
  if (failure) throw failure.reason
  return { ok: false, refused }
}
