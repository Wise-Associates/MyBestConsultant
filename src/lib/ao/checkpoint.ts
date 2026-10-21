// Point de reprise de la lecture de la boîte AO : chaque passage ne lit que les messages arrivés depuis
// le dernier lu (coût proportionnel au courrier nouveau, pas à la taille de la boîte). Une fois par jour,
// ou si la boîte a été reconstruite (UIDVALIDITY différent), un passage de « rattrapage » relit les
// 7 derniers jours et s'appuie sur les Message-ID déjà connus pour ne rien traiter deux fois.
// Règles pures (sans IMAP ni base), testées dans ao.test.ts.

export const LOOKBACK_DAYS = 7
export const RECONCILE_EVERY_MS = 24 * 3_600_000

export interface Checkpoint {
  /** UIDVALIDITY de la boîte au moment de l'enregistrement. */
  uidValidity: string
  /** Plus grand UID dont tous les messages précédents ont été pris en charge. */
  lastUid: number
  /** Dernier rattrapage complet (ISO), null s'il n'a jamais abouti. */
  reconciledAt: string | null
}

export type ReadPlan =
  | { mode: 'incremental'; afterUid: number }
  | { mode: 'reconcile'; since: Date }

export function planRead(checkpoint: Checkpoint | null, uidValidity: string, now: Date): ReadPlan {
  const due =
    !checkpoint ||
    checkpoint.uidValidity !== uidValidity ||
    !checkpoint.reconciledAt ||
    now.getTime() - new Date(checkpoint.reconciledAt).getTime() >= RECONCILE_EVERY_MS
  return due
    ? { mode: 'reconcile', since: new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3_600_000) }
    : { mode: 'incremental', afterUid: checkpoint.lastUid }
}

/**
 * Point de reprise après un passage. `candidateUids` : messages listés par le plan ; `handledUids` : ceux
 * qui n'ont plus besoin d'être relus (déjà connus, traités, en erreur enregistrée, pris par un autre passage).
 * Le point n'avance jamais au-delà du premier message laissé pour plus tard (limite de temps ou de nombre).
 * Le rattrapage n'est daté que s'il est allé au bout : sinon le passage suivant le reprend. Un rattrapage
 * complet amène le point au dernier message de la boîte (`uidNext - 1` à l'ouverture) : le courrier plus
 * ancien que la fenêtre de 7 jours est volontairement ignoré, y compris quand la fenêtre est vide.
 */
export function nextCheckpoint(
  previous: Checkpoint | null,
  uidValidity: string,
  plan: ReadPlan,
  candidateUids: number[],
  handledUids: Set<number>,
  uidNext: number,
  now: Date,
): Checkpoint {
  const sameBox = previous?.uidValidity === uidValidity
  let lastUid = sameBox && previous ? previous.lastUid : 0
  let complete = true
  for (const uid of [...candidateUids].sort((a, b) => a - b)) {
    if (!handledUids.has(uid)) { complete = false; break }
    lastUid = Math.max(lastUid, uid)
  }
  if (plan.mode === 'reconcile') {
    return complete
      ? { uidValidity, lastUid: Math.max(lastUid, uidNext - 1), reconciledAt: now.toISOString() }
      : { uidValidity, lastUid, reconciledAt: null }
  }
  return { uidValidity, lastUid, reconciledAt: sameBox && previous ? previous.reconciledAt : null }
}

/**
 * Ordre de traitement d'un passage : le courrier nouveau d'abord, puis les e-mails à réessayer, chacun par
 * UID croissant et chaque Message-ID une seule fois (copie, renvoi). Les e-mails en attente de l'IA (crédits
 * épuisés) sont réessayés à chaque passage sans limite d'essais : passés en premier, ils retiendraient le
 * courrier nouveau, alors qu'un e-mail sans pièce jointe scannée peut encore être traité.
 */
export function processingOrder<T extends { uid: number; messageId: string }>(candidates: T[], retries: T[]): T[] {
  const byUid = (a: T, b: T) => a.uid - b.uid
  const fresh = [...new Map(candidates.map(e => [e.messageId, e])).values()].sort(byUid)
  const freshIds = new Set(fresh.map(e => e.messageId))
  const again = [...new Map(retries.filter(e => !freshIds.has(e.messageId)).map(e => [e.messageId, e])).values()].sort(byUid)
  return [...fresh, ...again]
}

/**
 * UID des messages listés qui n'ont plus besoin d'être relus, à partir des Message-ID pris en charge :
 * deux copies d'un même message (UID différents, même Message-ID) comptent ensemble, sinon la copie
 * écartée bloquerait le point de reprise.
 */
export function handledUidsOf(candidates: { uid: number; messageId: string }[], handledMessageIds: Set<string>): Set<number> {
  return new Set(candidates.filter(c => handledMessageIds.has(c.messageId)).map(c => c.uid))
}
