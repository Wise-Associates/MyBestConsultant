'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HoverCard } from '@/components/ui/hover-card'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { summaryOf, useAoSync } from './ao-sync-provider'
import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, Download, Eye, Inbox, MessageSquare, Trash2, Loader2, RefreshCcw, RotateCcw, Search, X } from 'lucide-react'
import { AO_CHANNEL_LABEL, EMPTY_AO_FILTERS, filterAoOffers, filtersToSearchParams, type AoFilters, type AoOfferRow } from '@/lib/ao/filters'
import { MAX_ATTEMPTS } from '@/lib/ao/attempts'
import type { AoDashboardActions, AoDashboardCopy, AoDashboardPaths } from '@/lib/ao/dashboard-types'
import type { AoSyncReport } from '@/lib/ao/sync'
import type { AoEmail } from '@/lib/ao/types'
import { AoComments } from './ao-comments'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AoOfferPanel } from './ao-offer-panel'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { WorkBadge, useOfferPublications } from './offer-publications'
import { TrackingIcons, TrackingLegend } from './offer-tracking'
import { trackingSteps, type TrackingStep } from '@/lib/ao/tracking'
import {
  BRAND, CONTRACT_LABEL, ENGAGEMENT_LABEL, REMOTE_LABEL, STATUS_UI, control, formatAmount, formatDay, optionStyle, secondaryButton,
} from '@/app/admin/candidats/labels'
import { SENIORITY_SHORT, seniorityOf } from '@/lib/ao/stats'

// Tableau des appels d'offres reçus, commun à /admin/candidats (boîtes de la plateforme) et à
// /recruiter/parametres/boites-ao (boîtes de l'organisation) : chaque page fournit ses actions serveur, ses liens et
// ses textes (src/lib/ao/dashboard-types.ts).

interface Props {
  rows: AoOfferRow[]
  recentEmails: AoEmail[]
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
  actions: AoDashboardActions
  paths: AoDashboardPaths
  copy: AoDashboardCopy
  /** Espace admin : titre et sous-titre dans la barre du haut du layout (AdminPageHeader), outils restant dans la page. */
  titleInAdminBar?: boolean
}

type Notice = { tone: 'ok' | 'error'; text: string } | null

/**
 * Colonnes du tableau des offres : largeur fixe (l'offre prend le reste) et écran à partir duquel la colonne s'affiche.
 * Calibrées pour la zone de contenu à côté du menu de 240 px : les colonnes visibles laissent toujours 280 px environ
 * à l'offre, sans défilement horizontal. Toute colonne masquée reste lisible dans le panneau de détail.
 */
const TABLE_COLUMNS = [
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
/** Date courte du tableau (21/10/26) ; la date complète est en infobulle. */
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })

export interface MailboxIssue {
  label: string
  error: string
  /** Début de la dernière tentative de lecture (ISO), ou null si la boîte n'a jamais été lue. */
  at: string | null
}

export function AoOffersDashboard({ rows: pageRows, recentEmails: pageEmails, inboxConfigured, mailboxIssues, loadError, accessAlert, tracking, trackingError, actions, paths, copy, titleInAdminBar }: Props) {
  // Synchronisation en arrière-plan (AoSyncProvider, layout de l'espace) : elle continue quand on quitte la page et se
  // retrouve en revenant. Les données renvoyées par ses passages ne remplacent celles de la page que si elles sont
  // arrivées après elles : la page rechargée (retour sur la page, fin de synchronisation) l'emporte sur un passage plus
  // ancien, sans retour en arrière.
  const sync = useAoSync()
  const liveVersion = sync.live?.version ?? 0
  const [pageData, setPageData] = useState({ rows: pageRows, liveVersion })
  if (pageData.rows !== pageRows) setPageData({ rows: pageRows, liveVersion })
  const current = sync.live && sync.live.version > pageData.liveVersion ? sync.live : null
  const rows = current?.rows ?? pageRows
  const recentEmails = current?.recentEmails ?? pageEmails
  const [filters, setFilters] = useState<AoFilters>(EMPTY_AO_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const router = useRouter()
  // Fenêtres « Commentaires » et « Supprimer » : identifiant de l'offre concernée (null : fermée).
  const [commentsFor, setCommentsFor] = useState<string | null>(null)
  const [deleteFor, setDeleteFor] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [retrying, startRetry] = useTransition()
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // Préparations et publications : elles continuent si l'on ferme le panneau de l'offre (offer-publications.tsx). À leur
  // fin, un message prévient seulement si ce panneau n'est plus ouvert (sinon il affiche lui-même le résultat).
  const openIdRef = useRef<string | null>(null)
  useEffect(() => { openIdRef.current = selectedId }, [selectedId])
  const publications = useOfferPublications(actions, ({ id, title, work, error }) => {
    if (openIdRef.current === id) return
    if (error) return setNotice({ tone: 'error', text: `« ${title} » : ${error}` })
    setNotice({
      tone: 'ok',
      text: work === 'preparing' ? `Version anonymisée de « ${title} » prête : ouvrez l'offre pour la relire et la publier.` : `Offre « ${title} » publiée.`,
    })
  })

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

  // Les lignes viennent du serveur (rafraîchies après chaque action) : seul le filtrage est local.
  const filtered = useMemo(() => filterAoOffers(rows, filters), [rows, filters])
  const selected = rows.find(r => r.$id === selectedId) ?? null
  const commentsRow = rows.find(r => r.$id === commentsFor) ?? null
  const deleteRow = rows.find(r => r.$id === deleteFor) ?? null

  async function confirmDelete() {
    if (!deleteRow) return
    setDeleting(true)
    setDeleteError('')
    const res = await actions.deleteOffer(deleteRow.$id)
    setDeleting(false)
    if (res.error) return setDeleteError(res.error)
    if (selectedId === deleteRow.$id) setSelectedId(null)
    setDeleteFor(null)
    setNotice({ tone: 'ok', text: `Offre « ${deleteRow.title} » supprimée.` })
    router.refresh()
  }
  const failedEmails = recentEmails.filter(e => e.status === 'failed')
  const stats = {
    toReview: rows.filter(r => r.status === 'to_review').length,
    published: rows.filter(r => r.status === 'published').length,
    ignored: rows.filter(r => r.status === 'ignored').length,
    duplicates: rows.reduce((n, r) => n + r.sourceCount - 1, 0),
  }
  const exportHref = `${paths.exportApi}?${filtersToSearchParams(filters).toString()}`
  const set = <K extends keyof AoFilters>(key: K, value: AoFilters[K]) => setFilters(f => ({ ...f, [key]: value }))
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
    if (notice || sync.notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [notice, sync.notice])

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
            {copy.back && (
              <Link href={copy.back.href} className="inline-flex items-center gap-1.5 text-xs font-semibold mb-3 hover:underline" style={{ color: 'var(--admin-fg-muted)' }}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {copy.back.label}
              </Link>
            )}
            <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--admin-fg-muted)' }}>{copy.eyebrow}</p>
            <h1 className="text-[28px] font-bold tracking-tight text-admin-fg">{copy.title}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--admin-fg-muted)' }}>{description}</p>
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
          <a href={exportHref} download aria-label={`Télécharger Excel (${filtered.length} offres)`}
            title={`Exporte les ${filtered.length} offres affichées, filtres compris`}
            className="inline-flex items-center gap-2.5 h-10 pl-3.5 pr-1.5 rounded-[10px] bg-[#F97316] text-[13px] font-semibold text-admin-fg transition-colors hover:bg-[#FB923C] active:bg-[#EA580C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-fg focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg">
            <Download size={15} aria-hidden />
            Télécharger Excel
            <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md bg-admin-fg text-white text-xs font-semibold tabular-nums">
              {filtered.length}
            </span>
          </a>
        </div>
      </div>

      {accessAlert && <Banner tone="error" text={accessAlert} />}
      {!inboxConfigured && (
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
      </div>

      {/* Indicateurs (cliquables : filtrent la liste) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'À valider', value: stats.toReview, accent: BRAND, onClick: () => set('status', 'to_review') },
          { label: 'Publiées', value: stats.published, accent: '#047857', onClick: () => set('status', 'published') },
          { label: 'Ignorées', value: stats.ignored, accent: 'var(--admin-fg-subtle)', onClick: () => set('status', 'ignored') },
          { label: 'Doublons fusionnés', value: stats.duplicates, accent: '#1d4ed8', onClick: undefined },
          { label: 'E-mails en erreur', value: failedEmails.length, accent: '#b91c1c', onClick: undefined },
        ].map(s => (
          <button key={s.label} type="button" onClick={s.onClick} disabled={!s.onClick}
            className="rounded-2xl p-5 text-left"
            style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)', cursor: s.onClick ? 'pointer' : 'default' }}>
            <p className="text-2xl font-bold text-admin-fg" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
            <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--admin-fg-muted)' }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.accent }} />{s.label}
            </p>
          </button>
        ))}
      </div>

      {/* Filtres */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--admin-fg-muted)' }} />
            <input value={filters.q} onChange={e => set('q', e.target.value)} aria-label="Rechercher"
              placeholder="Rechercher un intitulé, un client, une compétence, un objet d'e-mail…"
              style={{ ...control, width: '100%', paddingLeft: 36 }} />
          </div>
          <select aria-label="Statut" value={filters.status} onChange={e => set('status', e.target.value as AoFilters['status'])} style={control}>
            <option value="all" style={optionStyle}>Tous les statuts</option>
            {Object.entries(STATUS_UI).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v.label}</option>)}
          </select>
          <select aria-label="Type de contrat" value={filters.contractType} onChange={e => set('contractType', e.target.value as AoFilters['contractType'])} style={control}>
            <option value="all" style={optionStyle}>Tous les contrats</option>
            {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
          </select>
          <select aria-label="Télétravail" value={filters.remote} onChange={e => set('remote', e.target.value as AoFilters['remote'])} style={control}>
            <option value="all" style={optionStyle}>Tout mode de travail</option>
            {Object.entries(REMOTE_LABEL).map(([k, v]) => <option key={k} value={k} style={optionStyle}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input aria-label="Ville" value={filters.city} onChange={e => set('city', e.target.value)} placeholder="Ville" style={{ ...control, width: 150 }} />
          <input aria-label="Compétence" value={filters.skill} onChange={e => set('skill', e.target.value)} placeholder="Compétence" style={{ ...control, width: 150 }} />
          <input aria-label="Expéditeur" value={filters.sender} onChange={e => set('sender', e.target.value)} placeholder="Expéditeur" style={{ ...control, width: 170 }} />
          <input aria-label="Montant minimum" type="number" min={0} inputMode="numeric" value={filters.salaryMin ?? ''} onChange={e => set('salaryMin', amount(e.target.value))} placeholder="TJM / salaire min" style={{ ...control, width: 150 }} />
          <input aria-label="Montant maximum" type="number" min={0} inputMode="numeric" value={filters.salaryMax ?? ''} onChange={e => set('salaryMax', amount(e.target.value))} placeholder="max" style={{ ...control, width: 100 }} />
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
            Reçues du
            <input type="date" value={filters.from} onChange={e => set('from', e.target.value)} style={{ ...control, colorScheme: 'dark' }} />
            au
            <input type="date" value={filters.to} onChange={e => set('to', e.target.value)} style={{ ...control, colorScheme: 'dark' }} />
          </label>
          {JSON.stringify(filters) !== JSON.stringify(EMPTY_AO_FILTERS) && (
            <button type="button" onClick={() => setFilters(EMPTY_AO_FILTERS)} className="text-xs underline" style={{ color: 'var(--admin-fg-muted)' }}>
              Réinitialiser les filtres
            </button>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--admin-line)' }}>
        <div className="px-6 py-4 flex items-center gap-4" style={{ background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-line)' }}>
          <h2 className="font-semibold text-sm text-admin-fg mr-auto">Offres extraites</h2>
          <TrackingLegend />
          <span className="text-xs shrink-0" style={{ color: 'var(--admin-fg-muted)' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''} sur {rows.length}</span>
        </div>
        {/* Pas de défilement horizontal : largeurs fixes (sur les en-têtes, lues par table-fixed), une ligne par cellule (texte complet au survol), colonnes
            secondaires masquées sur les écrans étroits (toutes restent dans le panneau de détail). */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--admin-line)' }}>
              {TABLE_COLUMNS.map(c => (
                <th key={c.key} title={'title' in c ? c.title : undefined} className={`${c.show} text-left px-3 py-3 text-xs font-medium truncate`} style={{ color: 'var(--admin-fg-muted)', width: c.width }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length} className="text-center py-20" style={{ color: 'var(--admin-fg-muted)' }}>
                  <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>{rows.length === 0 ? 'Aucune offre reçue pour l\'instant. Les appels d\'offres envoyés à la boîte AO apparaîtront ici.' : 'Aucune offre ne correspond à ces filtres.'}</p>
                </td>
              </tr>
            ) : filtered.map(r => {
              const work = publications.of(r.$id).running
              return (
              // Seuls le titre et l'œil ouvrent le détail : un clic ailleurs dans la ligne (sélection de texte…) ne fait rien.
              <tr key={r.$id} className="hover:bg-admin-panel" style={{ borderBottom: '1px solid var(--admin-line)' }}>
                <td className={cell('received')} title={formatDay(r.receivedAt)} style={{ color: 'var(--admin-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{shortDay(r.receivedAt)}</td>
                <td className={cell('offer')}>
                  <button type="button" onClick={() => setSelectedId(r.$id)} title={r.title} className="block w-full truncate text-left font-medium text-admin-fg hover:underline">{r.title}</button>
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
                    <button type="button" onClick={() => setSelectedId(r.$id)} className={iconButton} aria-label={`Voir le détail : ${r.title}`} title="Voir le détail">
                      <Eye size={16} />
                    </button>
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

      {selected && (
        <AoOfferPanel row={selected} actions={actions} paths={paths} publishNote={copy.publishNote}
          tracking={stepsOf(selected)} social={copy.social}
          publication={publications.of(selected.$id)}
          onPrepare={() => publications.prepare(selected.$id, selected.title)}
          onPublish={(draft, skillsText) => publications.publish(selected.$id, selected.title, draft, skillsText)}
          onEdit={patch => publications.edit(selected.$id, patch)}
          onCancel={() => publications.cancel(selected.$id)}
          onClose={() => setSelectedId(null)} />
      )}

      {/* Commentaires de l'offre : discussion interne, hors du panneau de détail. */}
      <Dialog open={commentsRow !== null} onOpenChange={open => { if (!open) setCommentsFor(null) }}>
        {commentsRow && (
          // z-10000 : au-dessus de la barre fixe de l'espace recruteur, comme le panneau de détail (ao-offer-panel.tsx).
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

function Banner({ tone, text, onClose }: { tone: 'ok' | 'error'; text: string; onClose?: () => void }) {
  const color = tone === 'ok' ? '#047857' : '#b91c1c'
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex items-start gap-3 p-4 rounded-xl"
      style={{ background: tone === 'ok' ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${tone === 'ok' ? 'rgba(52,211,153,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color }} />
      <p className="text-sm flex-1" style={{ color }}>{text}</p>
      {onClose && <button type="button" onClick={onClose} aria-label="Fermer"><X size={14} style={{ color }} /></button>}
    </div>
  )
}
