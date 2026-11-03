import { isDocumentId } from './access'

// Suppression de plusieurs offres AO à la fois (sélection du tableau des appels d'offres) : règles pures, testées.
// Le contrôle de chaque offre (organisation de la session, offre publiée refusée) reste celui de deleteAoOfferOf.

/**
 * Offres par envoi : le navigateur envoie la sélection par lots. Le navigateur exécute les Server Actions une par une :
 * un lot de 10 (environ 5 s) ne retient pas longtemps les autres actions de la section (« Préparer la publication »…).
 */
export const BULK_DELETE_MAX = 10
/** Suppressions menées en même temps (chacune : contrôle d'accès, commentaires, offre, détails, ligne d'index). */
export const BULK_DELETE_CONCURRENCY = 4

export interface BulkDeleteResult {
  deleted: string[]
  /** Offres non supprimées, avec la raison à montrer (publiée, introuvable, erreur d'Appwrite). */
  failed: { id: string; error: string }[]
}

/** Sélection reçue du navigateur : un tableau d'identifiants de documents, BULK_DELETE_MAX au plus, doublons retirés. */
export function parseBulkDeleteIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Aucune offre sélectionnée.' }
  if (raw.length > BULK_DELETE_MAX) return { ok: false, error: `Sélection trop grande : ${BULK_DELETE_MAX} offres au plus par envoi.` }
  if (!raw.every(isDocumentId)) return { ok: false, error: 'Sélection invalide : rechargez la page.' }
  return { ok: true, ids: [...new Set(raw)] }
}

/**
 * Supprime chaque offre avec `deleteOne`, `concurrency` à la fois. Une offre refusée ou en échec n'arrête pas les
 * autres : elle est rapportée avec sa raison. Résultats dans l'ordre de `ids`.
 */
export async function deleteEach(
  ids: string[], deleteOne: (id: string) => Promise<{ error?: string }>, concurrency = BULK_DELETE_CONCURRENCY,
): Promise<BulkDeleteResult> {
  const outcomes: { error?: string }[] = new Array(ids.length)
  let next = 0
  async function worker() {
    while (next < ids.length) {
      const i = next++
      outcomes[i] = await deleteOne(ids[i]).catch((err: unknown) => ({
        error: `Suppression impossible : ${err instanceof Error ? err.message : String(err)}`,
      }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
  const result: BulkDeleteResult = { deleted: [], failed: [] }
  ids.forEach((id, i) => {
    const { error } = outcomes[i]
    if (error) result.failed.push({ id, error })
    else result.deleted.push(id)
  })
  return result
}

/** Fin d'une suppression groupée, telle que le navigateur l'a vue (lots envoyés l'un après l'autre). */
export interface BulkDeleteOutcome {
  /** Offres de la sélection. */
  total: number
  deleted: number
  /** Offres refusées par le serveur (titre et raison). */
  failed: { title: string; error: string }[]
  /** Envoi refusé en entier par le serveur (session expirée…) : les lots suivants ne sont pas partis. */
  stopped: string
  /**
   * Lot sans réponse (connexion coupée, délai) : le serveur a pu en supprimer une partie, on ne sait pas laquelle. La
   * liste rechargée fait foi.
   */
  interrupted: boolean
}

const s = (n: number) => (n > 1 ? 's' : '')

/** Message de fin de la suppression groupée ; les offres non supprimées restent cochées dans la liste. */
export function bulkDeleteNotice(o: BulkDeleteOutcome): { tone: 'ok' | 'error'; text: string } {
  const done = `${o.deleted} offre${s(o.deleted)} supprimée${s(o.deleted)}`
  const reasons = o.failed.length
    ? ` — ${o.failed.slice(0, 3).map(f => `« ${f.title} » : ${f.error}`).join(' ; ')}${o.failed.length > 3 ? ' ; …' : ''}`
    : ''
  if (o.interrupted) {
    return { tone: 'error', text: `${done}, puis suppression interrompue (connexion coupée ou session expirée) : la liste rechargée montre les offres restantes, toujours cochées${reasons}` }
  }
  const left = o.total - o.deleted
  if (left === 0) return { tone: 'ok', text: `${done}.` }
  return {
    tone: 'error',
    text: `${done} ; ${left} non supprimée${s(left)}, restée${s(left)} cochée${s(left)}${o.stopped ? ` — arrêt : ${o.stopped}` : ''}${reasons}`,
  }
}
