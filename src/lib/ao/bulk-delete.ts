import { isDocumentId } from './access'
import { isPastDeadline, offerDateCount } from './dates'
import type { AoOfferRow } from './filters'

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

/** Offre proposée par « Offres échues » : son titre et sa date limite telle qu'écrite, montrés à la confirmation. */
export interface ExpiredOffer {
  id: string
  title: string
  deadline: string
}

export interface ExpiredSearch {
  offers: ExpiredOffer[]
  /**
   * Offres à valider dont la date limite enregistrée est passée mais n'est peut-être pas la leur : écartées (décision
   * du 2026-11-03), à vérifier dans l'e-mail et à supprimer par la sélection.
   */
  uncertain: number
}

/**
 * « Offres échues » : offres à valider dont la date limite est passée, proposées à la suppression après relecture (la
 * date limite est lue par l'IA, parfois déduite d'une date sans libellé). Une date absente ou illisible ne rend jamais
 * une offre échue ; l'année d'une date écrite sans est celle de la réception de l'e-mail. La date limite est enregistrée
 * sur l'e-mail, une seule (la plus proche de ses offres) : elle n'est sûrement celle de l'offre que si l'e-mail n'en
 * apporte qu'une (`offersOfEmail` : offres créées et doublons), si l'offre n'a été reçue qu'une fois (un e-mail suivant
 * a pu reporter la date) et si le texte ne cite qu'une date. Sinon l'offre est écartée et comptée. Ordre de `rows` gardé.
 */
export function expiredToReview(
  rows: Pick<AoOfferRow, '$id' | 'title' | 'status' | 'jobId' | 'deadline' | 'receivedAt' | 'emailId' | 'sourceCount'>[],
  now: Date, offersOfEmail: (emailId: string) => number,
): ExpiredSearch {
  const search: ExpiredSearch = { offers: [], uncertain: 0 }
  for (const r of rows) {
    const received = new Date(r.receivedAt)
    if (r.status !== 'to_review' || r.jobId || !isPastDeadline(r.deadline, now, Number.isNaN(received.getTime()) ? now : received)) continue
    if (offersOfEmail(r.emailId) > 1 || r.sourceCount > 1 || offerDateCount(r.deadline) > 1) search.uncertain++
    else search.offers.push({ id: r.$id, title: r.title, deadline: r.deadline })
  }
  return search
}

/** Pourquoi des offres échues n'ont pas été proposées (fenêtre de confirmation, message quand aucune ne l'est). */
export function uncertainNote(n: number): string {
  const cause = '(e-mail à plusieurs offres, offre reçue plusieurs fois ou plusieurs dates citées)'
  return n > 1
    ? `${n} offres écartées : leur date limite n'est peut-être pas la leur ${cause}. Vérifiez-les dans l'e-mail, puis supprimez-les par la sélection.`
    : `${n} offre écartée : sa date limite n'est peut-être pas la sienne ${cause}. Vérifiez-la dans l'e-mail, puis supprimez-la par la sélection.`
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
