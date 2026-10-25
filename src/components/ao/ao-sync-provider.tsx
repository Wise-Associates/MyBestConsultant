'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { AoSyncPassResult } from '@/lib/ao/dashboard-types'
import type { AoOfferRow } from '@/lib/ao/filters'
import type { AoSyncReport } from '@/lib/ao/sync'
import { afterBatch } from '@/lib/ao/sync-loop'
import type { AoEmail } from '@/lib/ao/types'

// « Synchroniser maintenant » en arrière-plan. La boucle de petits passages vit dans le layout de l'espace (admin,
// recruteur), qui reste monté d'une page à l'autre : elle continue quand on quitte la page AO, et la page retrouve en
// revenant la progression, le bouton « Arrêter » et le message de fin. Ailleurs, un bandeau discret signale qu'elle
// tourne. Un rechargement de l'onglet la reprend (sessionStorage, propre à l'onglet). Fermer l'onglet l'arrête après le
// passage en cours, sans rien perdre côté serveur (e-mails déjà lus enregistrés, point de reprise par boîte).
// Les passages passent par une route (fetch) et non par une Server Action : voir aoSyncResponse (src/lib/ao/http.ts).

/** Cumul des passages d'une synchronisation continue. */
export interface SyncProgress {
  processed: number
  offersCreated: number
  duplicates: number
  failed: number
  remaining: number
  errors: string[]
}

export type SyncNotice = { tone: 'ok' | 'error'; text: string } | null

interface AoSyncValue {
  running: boolean
  progress: SyncProgress | null
  /** Message de fin de la dernière synchronisation (gardé jusqu'à sa fermeture, même vu plus tard). */
  notice: SyncNotice
  /** Offres et e-mails renvoyés par le dernier passage ; `version` augmente à chaque passage. */
  live: { version: number; rows: AoOfferRow[]; recentEmails: AoEmail[] } | null
  start(): void
  stop(): void
  clearNotice(): void
}

const AoSyncContext = createContext<AoSyncValue | null>(null)

export function useAoSync(): AoSyncValue {
  const value = useContext(AoSyncContext)
  if (!value) throw new Error('useAoSync : AoSyncProvider absent du layout de cet espace.')
  return value
}

/** Passage automatique en cours : on réessaie 6 fois, toutes les 20 s (2 min), avant d'abandonner. */
const BUSY_RETRIES = 6
const BUSY_WAIT_MS = 20_000
const EMPTY_PROGRESS: SyncProgress = { processed: 0, offersCreated: 0, duplicates: 0, failed: 0, remaining: 0, errors: [] }

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
export function summaryOf(p: SyncProgress): string {
  return [
    `${plural(p.processed, 'e-mail')} traité${p.processed > 1 ? 's' : ''}`,
    `${p.offersCreated} nouvelle${p.offersCreated > 1 ? 's' : ''} offre${p.offersCreated > 1 ? 's' : ''}`,
    p.duplicates ? `${plural(p.duplicates, 'doublon')} fusionné${p.duplicates > 1 ? 's' : ''}` : '',
    p.failed ? `${p.failed} en erreur` : '',
  ].filter(Boolean).join(' · ')
}

/** Message de fin d'une synchronisation continue, selon la raison de l'arrêt (afterBatch). */
function endNotice(reason: Extract<ReturnType<typeof afterBatch>, { action: 'stop' }>['reason'], total: SyncProgress, last: AoSyncReport, scope: string): NonNullable<SyncNotice> {
  const errors = total.errors.length ? ` — ${total.errors.slice(0, 2).join(' ; ')}` : ''
  switch (reason) {
    case 'done': return { tone: total.failed ? 'error' : 'ok', text: `Synchronisation terminée : ${summaryOf(total)}${errors}.` }
    case 'not-configured': return { tone: 'error', text: `Aucune boîte ${scope} n'est active : rien n'a été lu.` }
    case 'ai': return { tone: 'error', text: `Arrêtée, IA indisponible (crédits épuisés ou clé refusée) : ${summaryOf(total)} · ${last.remaining} en attente, voir « E-mails non traités ».` }
    case 'mailbox': return { tone: 'error', text: `Arrêtée, boîte illisible : ${last.errors.slice(0, 2).join(' ; ')}` }
    case 'stalled': return { tone: 'error', text: `Arrêtée : aucun e-mail n'a pu être traité au dernier passage (${last.remaining} restant(s))${errors}. Réessayez.` }
  }
}

/** Un passage (route POST de l'espace). Une réponse d'erreur du serveur devient un message, jamais une exception. */
async function syncPass(endpoint: string): Promise<AoSyncPassResult> {
  const res = await fetch(endpoint, { method: 'POST', cache: 'no-store' })
  const body = (await res.json().catch(() => null)) as AoSyncPassResult | null
  if (!res.ok) return { error: body?.error ?? `Synchronisation impossible (erreur ${res.status}) : relancez dans un instant.` }
  return body ?? { error: 'Réponse du serveur illisible : relancez la synchronisation.' }
}

// Synchronisation en cours dans cet onglet, pour la reprendre après un rechargement. Stockage indisponible (navigation
// privée, stockage bloqué) : la synchronisation marche quand même, seule la reprise après rechargement est perdue.
function readSaved(key: string): SyncProgress | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SyncProgress>
    const counts = [p.processed, p.offersCreated, p.duplicates, p.failed, p.remaining]
    if (!counts.every(n => typeof n === 'number' && Number.isFinite(n)) || !Array.isArray(p.errors)) return null
    return { ...(p as SyncProgress), errors: p.errors.filter((e): e is string => typeof e === 'string').slice(-3) }
  } catch {
    return null
  }
}
function writeSaved(key: string, progress: SyncProgress | null): void {
  try {
    if (progress) sessionStorage.setItem(key, JSON.stringify(progress))
    else sessionStorage.removeItem(key)
  } catch {
    // Voir readSaved : sans stockage, pas de reprise après rechargement.
  }
}

interface Props {
  /** Route POST d'un passage : /api/admin/candidats/sync ou /api/recruiter/ao/sync. */
  endpoint: string
  /** Page AO de l'espace : le bandeau « en cours » s'affiche sur les autres pages et y renvoie. */
  pagePath: string
  /** Boîtes lues, à la suite de « boîte » : « de la plateforme », « de votre organisation ». */
  scope: string
  children: ReactNode
}

export function AoSyncProvider({ endpoint, pagePath, scope, children }: Props) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [notice, setNotice] = useState<SyncNotice>(null)
  const [live, setLive] = useState<AoSyncValue['live']>(null)
  const runningRef = useRef(false)
  const stopRequested = useRef(false)
  // Layout démonté (sortie de l'espace) : la boucle s'arrête après le passage en cours en gardant sa progression, que
  // le layout remonté au retour reprend (sinon deux boucles tourneraient ensemble).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const router = useRouter()
  const pathname = usePathname()
  const storageKey = `mbc-ao-sync:${endpoint}`

  /** Enchaîne de petits passages jusqu'à ce que les boîtes soient lues (afterBatch), à partir de `initial`. */
  const run = useCallback(async (initial: SyncProgress) => {
    if (runningRef.current) return
    runningRef.current = true
    stopRequested.current = false
    setRunning(true)
    setNotice(null)
    const total: SyncProgress = { ...initial, errors: [...initial.errors] }
    setProgress({ ...total })
    writeSaved(storageKey, total)
    let waits = 0
    let detached = false
    try {
      for (;;) {
        const res = await syncPass(endpoint)
        if (!mounted.current) {
          detached = true
          return
        }
        if (res.error || !res.report) {
          setNotice({ tone: 'error', text: res.error ?? 'Synchronisation impossible.' })
          return
        }
        const r = res.report
        total.processed += r.processed
        total.offersCreated += r.offersCreated
        total.duplicates += r.duplicates
        total.failed += r.failed
        total.remaining = r.remaining
        total.errors = [...total.errors, ...r.errors].slice(-3)
        setProgress({ ...total })
        writeSaved(storageKey, total)
        // Nouvelles offres de ce passage affichées tout de suite sur la page AO (filtres, tri et panneau ouvert gardés).
        const { rows, recentEmails } = res
        if (rows && recentEmails) setLive(previous => ({ version: (previous?.version ?? 0) + 1, rows, recentEmails }))
        const step = afterBatch(r)
        if (stopRequested.current) {
          setNotice({ tone: 'ok', text: `Synchronisation arrêtée : ${summaryOf(total)}${total.remaining ? ` · ${total.remaining} restant(s) pour la prochaine fois` : ''}.` })
          return
        }
        if (step.action === 'continue') continue
        if (step.action === 'wait') {
          // Passage automatique en cours sur la même boîte : il se termine en quelques minutes au plus.
          if (waits++ < BUSY_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, BUSY_WAIT_MS))
            continue
          }
          setNotice({ tone: 'ok', text: 'Une synchronisation automatique est en cours : ses offres apparaîtront à sa fin. Réessayez dans quelques minutes si besoin.' })
          return
        }
        setNotice(endNotice(step.reason, total, r, scope))
        return
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `Synchronisation interrompue : ${err instanceof Error ? err.message : 'connexion perdue'}. Les e-mails déjà lus sont enregistrés ; relancez pour continuer.` })
    } finally {
      runningRef.current = false
      if (!detached) {
        setRunning(false)
        setProgress(null)
        writeSaved(storageKey, null)
        // Données de la page affichée rafraîchies une fois la synchronisation finie (bandeaux des boîtes, compteurs…).
        router.refresh()
      }
    }
  }, [endpoint, router, scope, storageKey])

  // Onglet rechargé pendant une synchronisation : elle reprend là où elle en était (lancée hors du rendu de l'effet,
  // annulée si le composant est démonté entre-temps).
  useEffect(() => {
    const saved = readSaved(storageKey)
    if (!saved) return
    const timer = setTimeout(() => { void run(saved) }, 0)
    return () => clearTimeout(timer)
  }, [run, storageKey])

  const value: AoSyncValue = {
    running,
    progress,
    notice,
    live,
    start: () => { void run(EMPTY_PROGRESS) },
    stop: () => { stopRequested.current = true },
    clearNotice: () => setNotice(null),
  }

  return (
    <AoSyncContext.Provider value={value}>
      {children}
      {running && pathname !== pagePath && (
        <div role="status" aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 max-w-[calc(100vw-32px)] px-4 py-2.5 rounded-full text-[13px] text-white"
          style={{ background: '#2C2C2E', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <Loader2 size={15} className="shrink-0 animate-spin motion-reduce:animate-none" style={{ color: '#F97316' }} aria-hidden />
          <span className="truncate">Synchronisation des appels d&apos;offres en cours{progress ? ` : ${summaryOf(progress)}` : ''}</span>
          <Link href={pagePath} className="shrink-0 font-semibold underline underline-offset-2" style={{ color: '#F97316' }}>Voir</Link>
        </div>
      )}
    </AoSyncContext.Provider>
  )
}
