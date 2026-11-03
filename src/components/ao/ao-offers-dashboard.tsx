'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { HoverCard } from '@/components/ui/hover-card'
import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react'
import { summaryOf, useAoSync } from './ao-sync-provider'
import { BarChart3, Download, Eye, Inbox, MessageSquare, Trash2, Loader2, RefreshCcw, RotateCcw, Search, X } from 'lucide-react'
import {
  AO_CHANNEL_LABEL, AO_MAX_LISTED, AO_PAGE_SIZE, EMPTY_AO_FILTERS, filtersFromSearchParams, filtersToSearchParams, listSizeFromSearchParams, listToSearchParams,
  type AoFilters, type AoOfferRow,
} from '@/lib/ao/filters'
import { MAX_ATTEMPTS } from '@/lib/ao/attempts'
import { BULK_DELETE_MAX, bulkDeleteNotice } from '@/lib/ao/bulk-delete'
import type { AoDashboardActions, AoDashboardCopy, AoDashboardPaths, AoListPage, AoPageView } from '@/lib/ao/dashboard-types'
import type { AoSyncReport } from '@/lib/ao/sync'
import { AoComments } from './ao-comments'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { WorkBadge, useAoPublications } from './offer-publications'
import { Banner } from './ao-banner'
import { TrackingIcons, TrackingLegend } from './offer-tracking'
import { trackingSteps, type TrackingStep } from '@/lib/ao/tracking'
import {
  BRAND, CONTRACT_LABEL, ENGAGEMENT_LABEL, REMOTE_LABEL, STATUS_UI, control, formatAmount, formatDay, optionStyle, secondaryButton,
} from '@/app/admin/candidats/labels'
import { SENIORITY_SHORT, seniorityOf } from '@/lib/ao/stats'

// Tableau des appels d'offres reçus, commun à /admin/candidats (boîtes de la plateforme) et à
// /recruiter/parametres/boites-ao (boîtes de l'organisation) : chaque page fournit ses actions serveur, ses liens et
// ses textes (src/lib/ao/dashboard-types.ts).

/** Offres affichées après « Afficher 50 offres de plus » : toutes, à partir des offres de `base`. */
interface Appended {
  base: AoPageView
  rows: AoOfferRow[]
  total: number
  size: number
  tracking: Record<string, TrackingStep[]>
}

interface Props {
  /** Offres affichées : filtrées par le serveur (offer-index.ts). */
  view: AoPageView
  /** Filtres appliqués (lus dans l'adresse par la page). */
  filters: AoFilters
  inboxConfigured: boolean
  /** Boîtes de l'espace dont la dernière lecture a échoué (ou qui ne sont pas lues). */
  mailboxIssues: MailboxIssue[]
  loadError: string
  /** Lecture des boîtes suspendue pour tout l'espace (abonnement inactif) : bandeau en tête. */
  accessAlert?: string
  /** Étapes de suivi des offres publiées, par offre (tracking-store.ts) ; les autres sont calculées ici. */
  tracking: Record<string, TrackingStep[]>
  /** Suivi illisible : bandeau, les offres restent affichées. */
  trackingError?: string
  /** Actions de la liste ; celles d'une offre sont sur sa page (ao-offer-page.tsx). */
  actions: Pick<AoDashboardActions, 'retryEmail' | 'deleteOffer' | 'deleteOffers' | 'listComments' | 'addComment' | 'deleteComment'>
  paths: AoDashboardPaths
  copy: Pick<AoDashboardCopy, 'title' | 'scope'>
  /** Espace admin : titre et sous-titre dans la barre du haut du layout (AdminPageHeader), outils restant dans la page. */
  titleInAdminBar?: boolean
}

type Notice = { tone: 'ok' | 'error'; text: string } | null

/**
 * Colonnes du tableau des offres : largeur fixe (l'offre prend le reste) et écran à partir duquel la colonne s'affiche.
 * Calibrées pour la zone de contenu à côté du menu de 240 px : les colonnes visibles laissent toujours 240 px environ
 * à l'offre (280 avant la colonne de sélection), sans défilement horizontal. Toute colonne masquée reste lisible dans le panneau de détail.
 */
const TABLE_COLUMNS = [
  // Cases à cocher de la sélection (suppression groupée) : toujours visibles, 40 px pris sur l'offre.
  // Libellé « Sélection » : la case d'en-tête est dessinée à la place (thead).
  { key: 'select', label: 'Sélection', width: 40, show: '' },
  { key: 'received', label: 'Reçue le', width: 80, show: 'hidden sm:table-cell' },
  { key: 'offer', label: 'Offre', width: undefined, show: '' },
  { key: 'city', label: 'Ville', width: 96, show: 'hidden 2xl:table-cell' },
  { key: 'seniority', label: 'Séniorité', width: 80, show: 'hidden xl:table-cell' },
  { key: 'engagement', label: 'AT / Forfait', title: 'Assistance technique (AT) ou forfait', width: 90, show: 'hidden xl:table-cell' },
  { key: 'deadline', label: 'Date limite', width: 92, show: 'hidden md:table-cell' },
  { key: 'tjm', label: 'TJM', title: 'TJM ou salaire', width: 80, show: 'hidden sm:table-cell' },
  { key: 'skills', label: 'Compétences', width: 200, show: 'hidden min-[1400px]:table-cell' },
  { key: 'sources', label: 'Source', title: 'Canal d’arrivée : e-mails de la boîte AO, ou veille des sites publics (scraping)', width: 88, show: 'hidden 2xl:table-cell' },
  { key: 'status', label: 'Suivi', title: 'Statut de l’offre ; une fois publiée : offre en ligne, LinkedIn et sourcing (survolez les icônes)', width: 104, show: 'hidden sm:table-cell' },
  { key: 'actions', label: 'Actions', width: 116, show: '' },
] as const satisfies readonly { key: string; label: string; title?: string; width: number | undefined; show: string }[]

type ColumnKey = (typeof TABLE_COLUMNS)[number]['key']
// Colonnes secondaires en petit texte (comme les badges et sous-lignes) : l'offre garde la place et la taille normale.
const SMALL_TEXT = new Set<ColumnKey>(['received', 'city', 'seniority', 'engagement', 'deadline', 'tjm', 'sources'])
const cell = (key: ColumnKey) => `${TABLE_COLUMNS.find(c => c.key === key)!.show} px-3 py-3 truncate${SMALL_TEXT.has(key) ? ' text-xs' : ''}`
/** Bouton icône de la colonne Actions (cible de 32 px, focus visible). */
const iconButton = 'inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-admin-panel-raised focus-visible:ring-2 focus-visible:ring-offset-1'
// Barre d'actions de l'en-tête : trois natures, trois traitements. Les pages de la section (Statistiques, Boîtes) sont
// groupées et discrètes ; la synchronisation devient un contrôle double « en cours | Arrêter » ; l'export est le seul
// bouton plein, avec le nombre d'offres exportées. Hauteur commune de 40 px, pas d'ombre (page claire). Texte sombre
// sur l'orange de la marque : le blanc n'y atteint que 2,8:1.
const toolbarGroup = 'inline-flex items-stretch h-10 rounded-[10px] border border-admin-line-strong bg-admin-panel overflow-hidden'
const toolbarSegment =
  'inline-flex items-center gap-2 px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F97316] disabled:cursor-not-allowed'
/** Libellé court dans le tableau ; le libellé complet est en infobulle et dans le panneau. */
const ENGAGEMENT_SHORT = { assistance: 'AT', forfait: 'Forfait', '': '—' } as const
/** Nombre d'offres affiché : Appwrite ne compte pas au-delà de AO_MAX_LISTED (« 5 000+ »). */
const countLabel = (n: number) => (n >= AO_MAX_LISTED ? `${AO_MAX_LISTED.toLocaleString('fr-FR')}+` : n.toLocaleString('fr-FR'))
/** Date courte du tableau (21/10/26) ; la date complète est en infobulle. */
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const NO_IDS: ReadonlySet<string> = new Set()
/** Marque du pluriel (« 3 offres supprimées »). */
const s = (n: number) => (n > 1 ? 's' : '')
/** Case à cocher de la sélection : 16 px dans une cellule de 40 px. */
const selectBox = 'h-4 w-4 align-middle cursor-pointer disabled:cursor-not-allowed'

export interface MailboxIssue {
  label: string
  error: string
  /** Début de la dernière tentative de lecture (ISO), ou null si la boîte n'a jamais été lue. */
  at: string | null
}

export function AoOffersDashboard({ view, filters, inboxConfigured, mailboxIssues, loadError, accessAlert, tracking: serverTracking, trackingError, actions, paths, copy, titleInAdminBar }: Props) {
  // Synchronisation en arrière-plan (AoSyncProvider, layout de l'espace) : elle continue quand on quitte la page et se
  // retrouve en revenant. Le tableau renvoyé par ses passages ne remplace celui du serveur que s'il est arrivé après
  // lui et porte sur les mêmes filtres : la page rechargée (retour sur la page, fin de synchronisation,
  // filtre changé) l'emporte sur un passage plus ancien, sans retour en arrière.
  const sync = useAoSync()
  const liveVersion = sync.live?.version ?? 0
  // Filtres saisis : appliqués par le serveur (adresse de la page) 300 ms après la dernière frappe.
  const [draft, setDraft] = useState<AoFilters>(filters)
  // Filtres modifiés pas encore demandés au serveur (attente de la fin de la frappe).
  const [typed, setTyped] = useState<AoFilters | null>(null)
  const [loading, startLoading] = useTransition()
  const filtersKey = filtersToSearchParams(filters).toString()
  const [pageData, setPageData] = useState({ view, liveVersion })
  if (pageData.view !== view) {
    setPageData({ view, liveVersion })
    // Nouvelles données du serveur : le formulaire reprend les filtres appliqués (retour arrière du navigateur, lien,
    // réinitialisation), sauf pendant une frappe ou un chargement, où il montre ce qui est en cours de saisie ou demandé.
    if (!loading && typed === null && filtersToSearchParams(draft).toString() !== filtersKey) setDraft(filters)
  }
  // Adresse de la liste affichée (filtres et `nb`, forme canonique) : « Afficher 50 offres de plus » y augmente `nb` sans
  // relire la page (history.replaceState, suivi par useSearchParams), les passages de synchronisation l'envoient.
  const searchParams = useSearchParams()
  const listQuery = listToSearchParams(filtersFromSearchParams(searchParams), listSizeFromSearchParams(searchParams)).toString()
  const current = sync.live && sync.live.version > pageData.liveVersion && sync.live.view.query === listQuery ? sync.live.view : null
  const base = current ?? view
  // Lots lus ensuite par « Afficher 50 offres de plus », à la suite des offres de `base`. Oubliés dès que `base` change
  // (page relue par le serveur, passage de synchronisation) : `base` contient alors toutes les offres affichées (`nb`).
  const [appended, setAppended] = useState<Appended | null>(null)
  const extra = appended?.base === base ? appended : null
  const { recentEmails, counts } = base
  const rows = extra?.rows ?? base.rows
  const total = extra?.total ?? base.total
  const size = extra?.size ?? base.size
  const tracking = extra?.tracking ?? serverTracking
  const baseRef = useRef(base)
  useEffect(() => { baseRef.current = base })
  const [notice, setNotice] = useState<Notice>(null)
  const router = useRouter()
  const pathname = usePathname()
  // Fenêtres « Commentaires » et « Supprimer » : identifiant de l'offre concernée (null : fermée).
  const [commentsFor, setCommentsFor] = useState<string | null>(null)
  const [deleteFor, setDeleteFor] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [retrying, startRetry] = useTransition()
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // Préparations et publications des offres (pages des offres) : tenues par la section AO, elles continuent ici ; leur
  // fin est annoncée par un message (offer-publications.tsx).
  const publications = useAoPublications()

  // Diffusion et sourcing avancent en arrière-plan après une publication : tant qu'une étape est en cours, la page est
  // relue toutes les 15 s. Une diffusion envoyée à Make reste « en attente » jusqu'à 10 min après son envoi (lui-même
  // jusqu'à 4,5 min après la publication) : 15 min au plus, le compte repartant à chaque changement d'état.
  const stepsOf = (r: AoOfferRow) => tracking[r.$id] ?? trackingSteps(r)
  const workingKey = Object.entries(tracking)
    .flatMap(([id, steps]) => steps.filter(s => s.tone === 'working').map(s => `${id}:${s.key}:${s.text}`)).join('|')
  useEffect(() => {
    if (!workingKey) return
    let refreshes = 0
    const timer = setInterval(() => { if (++refreshes > 60) clearInterval(timer); else router.refresh() }, 15_000)
    return () => clearInterval(timer)
  }, [workingKey, router])

  // Les lignes viennent du serveur (rafraîchies après chaque action), filtrées par lui.
  const commentsRow = rows.find(r => r.$id === commentsFor) ?? null
  const deleteRow = rows.find(r => r.$id === deleteFor) ?? null

  async function confirmDelete() {
    if (!deleteRow) return
    setDeleting(true)
    setDeleteError('')
    const res = await actions.deleteOffer(deleteRow.$id)
    setDeleting(false)
    if (res.error) return setDeleteError(res.error)
    setDeleteFor(null)
    setNotice({ tone: 'ok', text: `Offre « ${deleteRow.title} » supprimée.` })
    router.refresh()
  }

  // Sélection pour la suppression groupée : offres affichées seulement, oubliée dès que les filtres appliqués changent
  // (on ne supprime que ce qu'on voit). Une offre publiée, ou en cours de publication, n'est pas sélectionnable, comme
  // pour sa corbeille : son offre publique resterait en ligne sans son appel d'offres.
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: filtersKey, ids: NO_IDS })
  // Vidée, pas seulement masquée : revenir aux mêmes filtres ne fait pas réapparaître d'anciennes cases cochées.
  if (selection.key !== filtersKey) setSelection({ key: filtersKey, ids: NO_IDS })
  const checkedIds = selection.key === filtersKey ? selection.ids : NO_IDS
  const isPublished = (r: AoOfferRow) => r.status === 'published' || !!r.jobId
  const selectable = rows.filter(r => !isPublished(r) && !publications.of(r.$id).running)
  const selected = selectable.filter(r => checkedIds.has(r.$id))
  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const selectOnly = (ids: Iterable<string>) => setSelection({ key: filtersKey, ids: new Set(ids) })
  function toggleRow(id: string, on: boolean) {
    const ids = new Set(checkedIds)
    if (on) ids.add(id)
    else ids.delete(id)
    setSelection({ key: filtersKey, ids })
  }

  // Fenêtre « Supprimer la sélection » : offres retenues à son ouverture (la liste peut être relue pendant la
  // suppression) ; `bulkDone` : offres traitées, pour la progression.
  const [bulkRows, setBulkRows] = useState<AoOfferRow[] | null>(null)
  const [bulkDone, setBulkDone] = useState(0)
  const [bulkError, setBulkError] = useState('')
  const [bulkDeleting, startBulkDelete] = useTransition()

  function confirmBulkDelete() {
    if (!bulkRows) return
    const ids = bulkRows.map(r => r.$id)
    const titleOf = new Map(bulkRows.map(r => [r.$id, r.title]))
    setBulkError('')
    setBulkDone(0)
    startBulkDelete(async () => {
      const deleted: string[] = []
      const failed: { id: string; error: string }[] = []
      let stopped = ''
      let interrupted = false
      // Par lots de BULK_DELETE_MAX, l'un après l'autre : chaque lot est une Server Action courte, la progression suit.
      // Arrêt au premier envoi refusé par le serveur (`stopped`) ou resté sans réponse (`interrupted` : état inconnu).
      for (let i = 0; i < ids.length && !stopped && !interrupted; i += BULK_DELETE_MAX) {
        try {
          const res = await actions.deleteOffers(ids.slice(i, i + BULK_DELETE_MAX))
          if ('error' in res) stopped = res.error
          else {
            deleted.push(...res.deleted)
            failed.push(...res.failed)
          }
        } catch {
          interrupted = true
        }
        setBulkDone(deleted.length + failed.length)
      }
      // Premier envoi refusé en entier : rien n'est supprimé, la fenêtre reste ouverte avec la raison.
      if (stopped && deleted.length + failed.length === 0) return setBulkError(stopped)
      setBulkRows(null)
      // Les offres non supprimées restent cochées, pour les retrouver dans la liste rechargée.
      selectOnly(ids.filter(id => !deleted.includes(id)))
      setNotice(bulkDeleteNotice({
        total: ids.length, deleted: deleted.length, stopped, interrupted,
        failed: failed.map(f => ({ title: titleOf.get(f.id) ?? f.id, error: f.error })),
      }))
      router.refresh()
    })
  }
  const failedEmails = recentEmails.filter(e => e.status === 'failed')
  // Toutes les offres de l'organisation, sans filtre : les indicateurs, eux, suivent les filtres.
  const allOffers = counts.received
  const filtering = filtersKey !== ''
  const exportHref = `${paths.exportApi}?${filtersKey}`
  const totalLabel = countLabel(total)

  /**
   * Page d'une offre : les filtres suivent, pour passer aux offres précédente et suivante de cette liste, ainsi que le
   * nombre d'offres affichées (`nb`), pour revenir à la même liste.
   */
  const offerHref = (id: string) => `${paths.list}/${encodeURIComponent(id)}${listQuery ? `?${listQuery}` : ''}`
  // « Afficher 50 offres de plus » : seules les 50 offres suivantes sont demandées au serveur (route GET de la liste,
  // `depuis` = offres déjà demandées), puis ajoutées ; `nb` de l'adresse suit, pour un rechargement ou un retour.
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const more = Math.min(AO_PAGE_SIZE, total - size)
  async function showMore() {
    const from = base
    setLoadingMore(true)
    setMoreError('')
    try {
      const params = filtersToSearchParams(filters)
      params.set('depuis', String(size))
      const res = await fetch(`${paths.listApi}?${params}`, { cache: 'no-store' })
      const page = (await res.json().catch(() => null)) as (AoListPage & { error?: string }) | null
      if (!res.ok || !page || page.error) return setMoreError(page?.error ?? `Chargement impossible (${res.status}).`)
      // Tableau relu entre-temps (synchronisation, filtres) : ce lot ne lui correspond plus, il est écarté.
      if (baseRef.current !== from) return
      const known = new Set(rows.map(r => r.$id))
      // Une offre arrivée entre deux lots décale la liste : celles déjà affichées ne sont pas répétées.
      const added = page.rows.filter(r => !known.has(r.$id))
      setAppended({ base: from, rows: [...rows, ...added], total: page.total, size: size + AO_PAGE_SIZE, tracking: { ...tracking, ...page.tracking } })
      if (page.trackingError) setMoreError(page.trackingError)
      setFocusRowId(added[0]?.$id ?? null)
      window.history.replaceState(null, '', `${pathname}?${listToSearchParams(filters, size + AO_PAGE_SIZE)}`)
    } catch {
      setMoreError('Chargement impossible : connexion interrompue, réessayez.')
    } finally {
      setLoadingMore(false)
    }
  }
  // Après un lot : le focus va à la première offre ajoutée (clavier, lecteurs d'écran), sans faire défiler la page.
  useEffect(() => {
    if (!focusRowId) return
    document.querySelector<HTMLElement>(`[data-ao-row="${CSS.escape(focusRowId)}"] a`)?.focus({ preventScroll: true })
  }, [focusRowId])
  /** Demande au serveur la liste filtrée (filtres dans l'adresse). */
  function load(f: AoFilters) {
    setTyped(null)
    const search = filtersToSearchParams(f).toString()
    startLoading(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }))
  }
  const set = <K extends keyof AoFilters>(key: K, value: AoFilters[K]) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setTyped(next)
  }
  const loadTyped = useEffectEvent((f: AoFilters) => load(f))
  useEffect(() => {
    if (!typed) return
    const timer = setTimeout(() => loadTyped(typed), 300)
    return () => clearTimeout(timer)
  }, [typed])
  const amount = (value: string) => (value.trim() === '' || Number.isNaN(Number(value)) ? null : Math.max(0, Number(value)))

  function retry(id: string) {
    setNotice(null)
    setRetryingId(id)
    startRetry(async () => {
      const res = await actions.retryEmail(id)
      setRetryingId(null)
      if (res.error || !res.report) return setNotice({ tone: 'error', text: res.error ?? 'Relance impossible.' })
      if (res.report.skipped) return setNotice({ tone: 'ok', text: 'Une synchronisation est en cours : l\'e-mail est remis en file et sera traité juste après.' })
      setNotice(noticeOf(res.report, copy.scope, 'E-mail retraité : '))
    })
  }

  // Le message s'affiche en haut de la page : on l'amène à l'écran, « Réessayer » étant plus bas.
  useEffect(() => {
    if (notice || sync.notice || publications.notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [notice, sync.notice, publications.notice])

  const description = `Appels d'offres reçus dans les boîtes ${copy.scope}, lus automatiquement.`
    + (recentEmails[0] ? ` Dernier e-mail : ${formatDay(recentEmails[0].receivedAt)}.` : '')

  return (
    <div className="admin-light min-h-full p-8 space-y-6">
      {/* En-tête */}
      <div className={`flex items-start ${titleInAdminBar ? 'justify-end' : 'justify-between'} flex-wrap gap-4`}>
        {titleInAdminBar ? (
          <AdminPageHeader title={copy.title} description={description} />
        ) : (
          <div>
            {/* Titre lu par les lecteurs d'écran seulement : le sous-menu de l'espace montre déjà la rubrique. */}
            <h1 className="sr-only">{copy.title}</h1>
            <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>{description}</p>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <nav aria-label="Pages de la section" className={toolbarGroup}>
            <Link href={paths.statistics} aria-label="Statistiques" title="Statistiques"
              className={`${toolbarSegment} text-admin-fg-muted hover:bg-admin-hover hover:text-admin-fg`}>
              <BarChart3 size={15} aria-hidden />
              <span className="hidden md:inline">Statistiques</span>
            </Link>
            <Link href={paths.mailboxes} aria-label="Boîtes de réception" title="Boîtes de réception"
              className={`${toolbarSegment} border-l border-admin-line text-admin-fg-muted hover:bg-admin-hover hover:text-admin-fg`}>
              <Inbox size={15} aria-hidden />
              <span className="hidden md:inline">Boîtes de réception</span>
            </Link>
          </nav>
          <div className={toolbarGroup}>
            <button type="button" onClick={sync.start} disabled={sync.running || !inboxConfigured}
              className={`${toolbarSegment} text-admin-fg enabled:hover:bg-admin-hover ${!sync.running && !inboxConfigured ? 'opacity-50' : ''}`}>
              {sync.running ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCcw size={15} aria-hidden />}
              {sync.running ? 'Lecture de la boîte…' : 'Synchroniser maintenant'}
            </button>
            {sync.running && (
              <button type="button" onClick={sync.stop}
                className={`${toolbarSegment} border-l border-admin-line text-[#b91c1c] hover:bg-[#b91c1c0f]`}>
                <X size={15} aria-hidden />
                Arrêter
              </button>
            )}
          </div>
          <a href={exportHref} download aria-label={`Télécharger Excel (${totalLabel} offres)`}
            title={`Exporte les ${totalLabel} offres filtrées (${AO_MAX_LISTED.toLocaleString('fr-FR')} au plus)`}
            className="inline-flex items-center gap-2.5 h-10 pl-3.5 pr-1.5 rounded-[10px] bg-[#F97316] text-[13px] font-semibold text-admin-fg transition-colors hover:bg-[#FB923C] active:bg-[#EA580C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-fg focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg">
            <Download size={15} aria-hidden />
            Télécharger Excel
            <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md bg-admin-fg text-white text-xs font-semibold tabular-nums">
              {totalLabel}
            </span>
          </a>
        </div>
      </div>

      {accessAlert && <Banner tone="error" text={accessAlert} />}
      {/* Chargement impossible : seule l'erreur s'affiche (ni « aucune boîte », ni compteurs à zéro, qui seraient faux). */}
      {!inboxConfigured && !loadError && (
        <Banner tone="error" text={`Aucune boîte ${copy.scope} n'est active : la lecture automatique est arrêtée. Ajoutez-en une dans « Boîtes de réception ».`} />
      )}
      {mailboxIssues.map(m => (
        <Banner key={m.label} tone="error" text={`Boîte ${m.label}${m.at ? ` (tentative du ${formatDay(m.at)})` : ''} : ${m.error}`} />
      ))}
      {loadError && <Banner tone="error" text={loadError} />}
      {trackingError && <Banner tone="error" text={trackingError} />}
      {sync.progress && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm p-3 rounded-xl" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)', color: 'var(--admin-fg)' }}>
          <Loader2 size={15} className="animate-spin shrink-0" />
          Synchronisation en cours : {summaryOf(sync.progress)}{sync.progress.remaining ? ` · ${sync.progress.remaining} restant${sync.progress.remaining > 1 ? 's' : ''}` : ''}. Les offres apparaissent au fur et à mesure ; vous pouvez changer de page, elle continue.
        </p>
      )}
      <div ref={noticeRef} className="space-y-3 empty:hidden">
        {sync.notice && <Banner tone={sync.notice.tone} text={sync.notice.text} onClose={sync.clearNotice} />}
        {notice && <Banner tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
        {publications.notice && <Banner tone={publications.notice.tone} text={publications.notice.text} onClose={publications.clearNotice} />}
      </div>

      {/* Indicateurs : selon les filtres (statuts : tous les filtres sauf le statut ; countQueries). Un statut cliqué filtre
          la liste, cliqué de nouveau retire ce filtre. Les e-mails en erreur sont ceux des boîtes, sans filtre. */}
      {!loadError && <div className="space-y-2">
        {filtering && (
          <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
            Selon vos filtres{filters.status !== 'all' ? ' (le statut mis à part, pour comparer les statuts)' : ''} ; « E-mails en erreur » n’est pas filtré.
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {([
          { label: 'À valider', value: counts.toReview, accent: BRAND, status: 'to_review' },
          { label: 'Publiées', value: counts.published, accent: '#047857', status: 'published' },
          { label: 'Ignorées', value: counts.ignored, accent: 'var(--admin-fg-subtle)', status: 'ignored' },
          { label: 'Doublons fusionnés', value: counts.duplicates, accent: '#1d4ed8', status: null },
          { label: 'E-mails en erreur', value: failedEmails.length, accent: '#b91c1c', status: null },
        ] as const).map(s => {
          const active = s.status !== null && draft.status === s.status
          return (
          <button key={s.label} type="button" disabled={s.status === null} aria-pressed={s.status === null ? undefined : active}
            onClick={s.status === null ? undefined : () => set('status', active ? 'all' : s.status)}
            className="rounded-2xl p-5 text-left"
            style={{
              background: 'var(--admin-panel)', border: `1px solid ${active ? 'var(--admin-fg)' : 'var(--admin-line)'}`,
              boxShadow: active ? '0 0 0 1px var(--admin-fg)' : undefined, cursor: s.status === null ? 'default' : 'pointer',
            }}>
            <p className="text-2xl font-bold text-admin-fg" style={{ fontVariantNumeric: 'tabular-nums' }}>{countLabel(s.value)}</p>
            <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--admin-fg-muted)' }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.accent }} />{s.label}
            </p>
          </button>
          )
        })}
        </div>
      </div>}

      {/* Filtres */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--admin-fg-muted)' }} />
            <input value={draft.q} onChange={e => set('q', e.target.value)} aria-label="Rechercher"
              placeholder="Rechercher un intitulé, un client, une compétence, un objet d'e-mail…"
              style={{ ...control, width: '100%', paddingLeft: 36 }} />
          </div>
          <select aria-label="Statut" value={draft.status} onChange={e => set('status', e.target.value as AoFilters['status'])} style={control}>
            <option value="all" style={optionStyle}>Tous les statuts</option>
            {Object.entries(STATUS_UI).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v.label}</option>)}
          </select>
          <select aria-label="Type de contrat" value={draft.contractType} onChange={e => set('contractType', e.target.value as AoFilters['contractType'])} style={control}>
            <option value="all" style={optionStyle}>Tous les contrats</option>
            {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
          </select>
          <select aria-label="Télétravail" value={draft.remote} onChange={e => set('remote', e.target.value as AoFilters['remote'])} style={control}>
            <option value="all" style={optionStyle}>Tout mode de travail</option>
            {Object.entries(REMOTE_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input aria-label="Ville" value={draft.city} onChange={e => set('city', e.target.value)} placeholder="Ville" style={{ ...control, width: 150 }} />
          <input aria-label="Compétence" value={draft.skill} onChange={e => set('skill', e.target.value)} placeholder="Compétence" style={{ ...control, width: 150 }} />
          <input aria-label="Expéditeur" value={draft.sender} onChange={e => set('sender', e.target.value)} placeholder="Expéditeur" style={{ ...control, width: 170 }} />
          <input aria-label="Montant minimum" type="number" min={0} inputMode="numeric" value={draft.salaryMin ?? ''} onChange={e => set('salaryMin', amount(e.target.value))} placeholder="TJM / salaire min" style={{ ...control, width: 150 }} />
          <input aria-label="Montant maximum" type="number" min={0} inputMode="numeric" value={draft.salaryMax ?? ''} onChange={e => set('salaryMax', amount(e.target.value))} placeholder="max" style={{ ...control, width: 100 }} />
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
            Reçues du
            <input type="date" value={draft.from} onChange={e => set('from', e.target.value)} style={{ ...control, colorScheme: 'dark' }} />
            au
            <input type="date" value={draft.to} onChange={e => set('to', e.target.value)} style={{ ...control, colorScheme: 'dark' }} />
          </label>
          {(filtering || filtersToSearchParams(draft).toString() !== '') && (
            <button type="button" onClick={() => { setDraft(EMPTY_AO_FILTERS); load(EMPTY_AO_FILTERS) }} className="text-xs underline" style={{ color: 'var(--admin-fg-muted)' }}>
              Réinitialiser les filtres
            </button>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--admin-line)' }}>
        <div className="px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-line)' }}>
          <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="font-semibold text-sm text-admin-fg">Offres extraites</h2>
            {/* Actions sur les offres cochées (case de la première colonne). */}
            {selected.length > 0 && (
              <div role="group" aria-label="Offres sélectionnées" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-xs font-medium text-admin-fg tabular-nums whitespace-nowrap">{selected.length} sélectionnée{s(selected.length)}</span>
                <button type="button" onClick={() => { setBulkError(''); setBulkRows(selected) }}
                  style={{ ...secondaryButton, padding: '6px 10px', fontSize: 12, color: '#b91c1c' }}>
                  <Trash2 size={13} aria-hidden />
                  Supprimer
                </button>
                <button type="button" onClick={() => selectOnly([])} className="text-xs underline" style={{ color: 'var(--admin-fg-muted)' }}>
                  Désélectionner
                </button>
              </div>
            )}
          </div>
          <TrackingLegend />
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs shrink-0" style={{ color: 'var(--admin-fg-muted)' }}>
            {loading && <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {loading ? 'Chargement…' : `${totalLabel} résultat${total > 1 ? 's' : ''}${filtering ? ` sur ${allOffers.toLocaleString('fr-FR')}` : ''}`}
          </span>
        </div>
        {/* Pas de défilement horizontal : largeurs fixes (sur les en-têtes, lues par table-fixed), une ligne par cellule (texte complet au survol), colonnes
            secondaires masquées sur les écrans étroits (toutes restent dans le panneau de détail). */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--admin-line)' }}>
              {TABLE_COLUMNS.map(c => c.key === 'select' ? (
                <th key={c.key} className="text-left px-3 py-3" style={{ width: c.width }}>
                  {/* Coche ou décoche les offres affichées qui peuvent être supprimées (pas les publiées). */}
                  <input type="checkbox" className={selectBox} style={{ accentColor: '#F97316' }}
                    checked={allSelected} disabled={selectable.length === 0}
                    ref={el => { if (el) el.indeterminate = selected.length > 0 && !allSelected }}
                    onChange={e => selectOnly(e.target.checked ? selectable.map(r => r.$id) : [])}
                    aria-label={allSelected ? 'Désélectionner les offres affichées' : `Sélectionner les ${selectable.length} offres affichées supprimables`}
                    title="Sélectionner les offres affichées (les offres publiées ne peuvent pas être supprimées)" />
                </th>
              ) : (
                <th key={c.key} title={'title' in c ? c.title : undefined} className={`${c.show} text-left px-3 py-3 text-xs font-medium truncate`} style={{ color: 'var(--admin-fg-muted)', width: c.width }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length} className="text-center py-20" style={{ color: 'var(--admin-fg-muted)' }}>
                  <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>{loadError ? 'Liste indisponible : voir le message en haut de la page.' : allOffers === 0 ? 'Aucune offre reçue pour l\'instant. Les appels d\'offres envoyés à la boîte AO apparaîtront ici.' : 'Aucune offre ne correspond à ces filtres.'}</p>
                </td>
              </tr>
            ) : rows.map(r => {
              const work = publications.of(r.$id).running
              const published = isPublished(r)
              const checked = !published && !work && checkedIds.has(r.$id)
              return (
              // Seuls le titre et l'œil ouvrent le détail : un clic ailleurs dans la ligne (sélection de texte…) ne fait rien.
              <tr key={r.$id} data-ao-row={r.$id} className={`hover:bg-admin-panel${checked ? ' bg-admin-panel' : ''}`} style={{ borderBottom: '1px solid var(--admin-line)' }}>
                <td className="px-3 py-3">
                  <input type="checkbox" className={selectBox} style={{ accentColor: '#F97316' }}
                    checked={checked} disabled={published || !!work} onChange={e => toggleRow(r.$id, e.target.checked)}
                    aria-label={`Sélectionner l'offre : ${r.title}`}
                    title={published ? 'Offre publiée : retirez d’abord l’offre publique pour la supprimer' : work ? 'Publication en cours' : undefined} />
                </td>
                <td className={cell('received')} title={formatDay(r.receivedAt)} style={{ color: 'var(--admin-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{shortDay(r.receivedAt)}</td>
                <td className={cell('offer')}>
                  <Link href={offerHref(r.$id)} title={r.title} className="block w-full truncate text-left font-medium text-admin-fg hover:underline">{r.title}</Link>
                  <p className="text-xs truncate" title={`${r.companyName || 'Client non précisé'} · ${r.senderName || r.senderAddress}`} style={{ color: 'var(--admin-fg-muted)' }}>
                    {/* Colonne Statut masquée sur petit écran : l'opération en cours est rappelée ici. */}
                    {work && <span className="sm:hidden font-medium" style={{ color: '#1d4ed8' }}>Modifications en cours · </span>}
                    {r.companyName || 'Client non précisé'} · {r.senderName || r.senderAddress}
                  </p>
                </td>
                <td className={cell('city')} title={r.location || undefined}>{r.location || '—'}</td>
                <td className={cell('seniority')} title={r.experience || undefined}>{SENIORITY_SHORT[seniorityOf(r.experience)]}</td>
                <td className={cell('engagement')} title={r.engagement ? ENGAGEMENT_LABEL[r.engagement] : undefined}>{ENGAGEMENT_SHORT[r.engagement]}</td>
                <td className={cell('deadline')} title={r.deadline || undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>{r.deadline || '—'}</td>
                <td className={cell('tjm')} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(r.salary, r.contractType)}</td>
                <td className={cell('skills')}>
                  {/* Deux compétences ; les autres dans une carte au survol (ligne de hauteur constante). */}
                  <div className="flex items-center gap-1 flex-nowrap">
                    {r.skills.slice(0, 2).map(s => (
                      <span key={s} title={s} className="text-[11px] px-1.5 py-0.5 rounded-md whitespace-nowrap truncate max-w-[76px]" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg)' }}>{s}</span>
                    ))}
                    {r.skills.length > 2 && (
                      <HoverCard label={`+${r.skills.length - 2}`} ariaLabel={`Voir les ${r.skills.length} compétences`}>
                        <span className="block font-semibold mb-1.5">Compétences</span>
                        <span className="flex flex-wrap gap-1">
                          {r.skills.map(s => <span key={s} className="px-2 py-0.5 rounded-md" style={{ background: 'var(--admin-panel-raised)' }}>{s}</span>)}
                        </span>
                      </HoverCard>
                    )}
                  </div>
                </td>
                <td className={cell('sources')} style={{ color: 'var(--admin-fg-muted)' }}>{AO_CHANNEL_LABEL[r.channel]}</td>
                <td className={cell('status')}>
                  {work ? <WorkBadge work={work} /> : (
                    // Statut (20 px) puis, une fois publiée, le suivi (16 px) : la hauteur du titre et du client, ligne constante.
                    <div className="flex flex-col items-start gap-0">
                      <span className="text-xs leading-4 font-medium px-2 py-0.5 rounded-md" style={{ color: STATUS_UI[r.status].color, background: 'var(--admin-panel-raised)' }}>{STATUS_UI[r.status].label}</span>
                      {(r.status === 'published' || r.jobId) && <TrackingIcons steps={stepsOf(r)} />}
                    </div>
                  )}
                </td>
                <td className={cell('actions')}>
                  <div className="flex items-center gap-1">
                    <Link href={offerHref(r.$id)} className={iconButton} aria-label={`Voir le détail : ${r.title}`} title="Voir le détail">
                      <Eye size={16} />
                    </Link>
                    <button type="button" onClick={() => setCommentsFor(r.$id)} className={`${iconButton} relative`} aria-label={`Commentaires (${r.commentCount}) : ${r.title}`} title="Commentaires">
                      <MessageSquare size={16} />
                      {r.commentCount > 0 && (
                        <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center text-white" style={{ background: '#1d4ed8' }}>{r.commentCount}</span>
                      )}
                    </button>
                    {r.status === 'published' || r.jobId ? (
                      <span className={`${iconButton} opacity-40 cursor-not-allowed`} title="Offre publiée : retirez d'abord l'offre publique" aria-label="Suppression impossible : offre publiée">
                        <Trash2 size={16} />
                      </span>
                    ) : (
                      <button type="button" onClick={() => { setDeleteError(''); setDeleteFor(r.$id) }} className={iconButton} aria-label={`Supprimer l'offre : ${r.title}`} title="Supprimer l'offre" style={{ color: '#b91c1c' }}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > 0 && (
          <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-3" style={{ background: 'var(--admin-panel)', borderTop: '1px solid var(--admin-line)' }}>
            <p role="status" aria-live="polite" className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
              {rows.length.toLocaleString('fr-FR')} offre{rows.length > 1 ? 's' : ''} affichée{rows.length > 1 ? 's' : ''} sur {totalLabel}
            </p>
            {more > 0 && (
              <button type="button" onClick={showMore} disabled={loadingMore || loading} style={{ ...secondaryButton, fontSize: 13 }}>
                {loadingMore && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                {loadingMore ? 'Chargement…' : `Afficher ${more} offre${more > 1 ? 's' : ''} de plus`}
              </button>
            )}
            {moreError && <p role="alert" className="w-full text-xs" style={{ color: '#b91c1c' }}>{moreError}</p>}
          </div>
        )}
        {total >= AO_MAX_LISTED && size >= AO_MAX_LISTED && (
          <p className="px-6 py-3 text-xs" style={{ background: 'var(--admin-panel)', borderTop: '1px solid var(--admin-line)', color: 'var(--admin-fg-muted)' }}>
            Seules les {AO_MAX_LISTED.toLocaleString('fr-FR')} offres les plus récentes sont listées : affinez les filtres pour voir les autres.
          </p>
        )}
      </div>

      {/* E-mails en erreur */}
      {failedEmails.length > 0 && (
        <div className="rounded-2xl p-5 space-y-2" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <h2 className="font-semibold text-sm text-admin-fg">E-mails non traités</h2>
          <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>Réessayés une fois, au passage suivant ; ceux en attente de l&apos;IA (crédits épuisés, service indisponible) sont repris à chaque synchronisation. « Réessayer » remet un e-mail en file pour la prochaine synchronisation ; s&apos;il échoue encore, traitez-le à la main depuis la boîte AO.</p>
          <ul className="space-y-1 text-sm">
            {failedEmails.slice(0, 10).map(e => (
              <li key={e.$id} style={{ color: 'var(--admin-fg)' }}>
                <span style={{ color: 'var(--admin-fg-muted)' }}>{formatDay(e.receivedAt)}</span> — {e.subject || e.messageId} <span style={{ color: '#b91c1c' }}>({e.attempts}/{MAX_ATTEMPTS}) {e.error}</span>
                <button
                  type="button"
                  onClick={() => retry(e.$id)}
                  disabled={retrying}
                  aria-label={`Réessayer l'e-mail « ${e.subject || e.messageId} »`}
                  style={{ ...secondaryButton, padding: '6px 10px', fontSize: 12, marginLeft: 8, verticalAlign: 'middle', opacity: retrying ? 0.6 : 1 }}
                >
                  {retryingId === e.$id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  Réessayer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}


      {/* Commentaires de l'offre : discussion interne, hors du panneau de détail. */}
      <Dialog open={commentsRow !== null} onOpenChange={open => { if (!open) setCommentsFor(null) }}>
        {commentsRow && (
          // z-10000 : au-dessus de la barre fixe de l'espace recruteur (z-index 9000, site-navbar-client.tsx).
          <DialogContent className="admin-light z-10000 sm:max-w-[640px] max-h-[85vh] overflow-y-auto" style={{ background: 'var(--admin-panel)' }}>
            <DialogHeader>
              <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>Commentaires</DialogTitle>
              <DialogDescription className="truncate" style={{ color: 'var(--admin-fg-muted)' }} title={commentsRow.title}>{commentsRow.title}</DialogDescription>
            </DialogHeader>
            <AoComments offerId={commentsRow.$id} actions={actions} onChanged={() => router.refresh()} />
          </DialogContent>
        )}
      </Dialog>

      {/* Suppression d'une offre : confirmation explicite, définitive. */}
      <Dialog open={deleteRow !== null} onOpenChange={open => { if (!open && !deleting) setDeleteFor(null) }}>
        {deleteRow && (
          <DialogContent className="admin-light z-10000 sm:max-w-[480px]" style={{ background: 'var(--admin-panel)' }} showCloseButton={!deleting}>
            <DialogHeader>
              <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>Supprimer cette offre ?</DialogTitle>
              <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>
                « {deleteRow.title} » sera supprimée définitivement, avec ses détails{deleteRow.commentCount ? ` et ses ${deleteRow.commentCount} commentaire${deleteRow.commentCount > 1 ? 's' : ''}` : ''}. L&apos;e-mail d&apos;origine reste enregistré : l&apos;offre ne sera pas recréée par la synchronisation. Pour seulement la masquer, utilisez « Ignorer » dans son détail.
              </DialogDescription>
            </DialogHeader>
            {deleteError && <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{deleteError}</p>}
            <DialogFooter>
              <button type="button" onClick={() => setDeleteFor(null)} disabled={deleting} style={secondaryButton}>Annuler</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} style={{ ...secondaryButton, background: '#b91c1c', borderColor: '#b91c1c', color: 'white' }}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Supprimer
              </button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Suppression des offres sélectionnées : confirmation explicite, définitive, par lots (BULK_DELETE_MAX). */}
      <Dialog open={bulkRows !== null} onOpenChange={open => { if (!open && !bulkDeleting) setBulkRows(null) }}>
        {bulkRows && (
          <DialogContent className="admin-light z-10000 sm:max-w-[520px]" style={{ background: 'var(--admin-panel)' }} showCloseButton={!bulkDeleting}>
            <DialogHeader>
              <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>
                {bulkRows.length > 1 ? `Supprimer ces ${bulkRows.length} offres ?` : 'Supprimer cette offre ?'}
              </DialogTitle>
              <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>
                {bulkRows.length > 1
                  ? 'Elles seront supprimées définitivement, avec leurs détails et leurs commentaires. Les e-mails d’origine restent enregistrés : ces offres ne seront pas recréées par la synchronisation. Pour seulement les masquer, utilisez « Ignorer » dans leur détail.'
                  : 'Elle sera supprimée définitivement, avec ses détails et ses commentaires. L’e-mail d’origine reste enregistré : l’offre ne sera pas recréée par la synchronisation. Pour seulement la masquer, utilisez « Ignorer » dans son détail.'}
              </DialogDescription>
            </DialogHeader>
            {/* min-w-0 : sans lui, un long titre (sur une ligne) élargit la grille de la fenêtre au-delà de son cadre. */}
            <ul className="min-w-0 text-sm space-y-1" style={{ color: 'var(--admin-fg)' }}>
              {bulkRows.slice(0, 5).map(r => <li key={r.$id} className="truncate" title={r.title}>« {r.title} »</li>)}
              {bulkRows.length > 5 && <li style={{ color: 'var(--admin-fg-muted)' }}>et {bulkRows.length - 5} autre{s(bulkRows.length - 5)}</li>}
            </ul>
            {bulkDeleting && bulkRows.length > BULK_DELETE_MAX && (
              <p role="status" className="text-sm tabular-nums" style={{ color: 'var(--admin-fg-muted)' }}>{bulkDone} / {bulkRows.length} offres traitées…</p>
            )}
            {bulkError && <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>Suppression impossible : {bulkError}</p>}
            <DialogFooter>
              <button type="button" onClick={() => setBulkRows(null)} disabled={bulkDeleting} style={secondaryButton}>Annuler</button>
              <button type="button" onClick={confirmBulkDelete} disabled={bulkDeleting} style={{ ...secondaryButton, background: '#b91c1c', borderColor: '#b91c1c', color: 'white' }}>
                {bulkDeleting ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 size={15} aria-hidden />}
                {bulkDeleting ? 'Suppression…' : bulkRows.length > 1 ? `Supprimer les ${bulkRows.length} offres` : 'Supprimer'}
              </button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

/** Message de fin de « Réessayer » (un e-mail retraité tout de suite). */
function noticeOf(r: AoSyncReport, scope: string, lead = ''): NonNullable<Notice> {
  if (!r.configured) return { tone: 'error', text: `Aucune boîte ${scope} n'est active : rien n'a été lu.` }
  const parts = [
    `${r.processed} e-mail${r.processed > 1 ? 's' : ''} traité${r.processed > 1 ? 's' : ''}`,
    `${r.offersCreated} nouvelle${r.offersCreated > 1 ? 's' : ''} offre${r.offersCreated > 1 ? 's' : ''}`,
    r.duplicates ? `${r.duplicates} doublon${r.duplicates > 1 ? 's' : ''} fusionné${r.duplicates > 1 ? 's' : ''}` : '',
    r.remaining ? `${r.remaining} restant${r.remaining > 1 ? 's' : ''} pour le prochain passage` : '',
    r.aiUnavailable ? 'IA indisponible (crédits épuisés ou clé refusée) : les e-mails concernés attendent, voir « E-mails non traités »' : '',
  ].filter(Boolean)
  return {
    // Une boîte illisible (mot de passe, serveur) laisse 0 e-mail traité : sans ce cas, le passage paraîtrait réussi.
    tone: r.failed || r.errors.length ? 'error' : 'ok',
    text: `${lead}${parts.join(' · ')}${r.errors.length ? ` — ${r.failed ? `${r.failed} en erreur : ` : ''}${r.errors.slice(0, 2).join(' ; ')}` : ''}`,
  }
}
