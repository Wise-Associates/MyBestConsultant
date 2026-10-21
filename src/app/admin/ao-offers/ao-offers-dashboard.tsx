'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, Copy, Download, Inbox, Loader2, RefreshCcw, RotateCcw, Search, X } from 'lucide-react'
import { EMPTY_AO_FILTERS, filterAoOffers, filtersToSearchParams, type AoFilters, type AoOfferRow } from '@/lib/ao/filters'
import { MAX_ATTEMPTS } from '@/lib/ao/attempts'
import type { AoSyncReport } from '@/lib/ao/sync'
import type { AoEmail } from '@/lib/ao/types'
import { retryAoEmail, syncAoInboxNow } from './actions'
import { AoOfferPanel } from './ao-offer-panel'
import {
  BRAND, CONTRACT_LABEL, REMOTE_LABEL, STATUS_UI, control, formatAmount, formatDay, optionStyle, primaryButton, secondaryButton,
} from './labels'

interface Props {
  rows: AoOfferRow[]
  recentEmails: AoEmail[]
  inboxConfigured: boolean
  loadError: string
}

type Notice = { tone: 'ok' | 'error'; text: string } | null

export function AoOffersDashboard({ rows, recentEmails, inboxConfigured, loadError }: Props) {
  const [filters, setFilters] = useState<AoFilters>(EMPTY_AO_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [syncing, startSync] = useTransition()
  const [retrying, startRetry] = useTransition()
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

  // Les lignes viennent du serveur (rafraîchies après chaque action) : seul le filtrage est local.
  const filtered = useMemo(() => filterAoOffers(rows, filters), [rows, filters])
  const selected = rows.find(r => r.$id === selectedId) ?? null
  const failedEmails = recentEmails.filter(e => e.status === 'failed')
  const stats = {
    toReview: rows.filter(r => r.status === 'to_review').length,
    published: rows.filter(r => r.status === 'published').length,
    ignored: rows.filter(r => r.status === 'ignored').length,
    duplicates: rows.reduce((n, r) => n + r.sourceCount - 1, 0),
  }
  const exportHref = `/api/admin/ao-offers/export?${filtersToSearchParams(filters).toString()}`
  const set = <K extends keyof AoFilters>(key: K, value: AoFilters[K]) => setFilters(f => ({ ...f, [key]: value }))
  const amount = (value: string) => (value.trim() === '' || Number.isNaN(Number(value)) ? null : Math.max(0, Number(value)))

  function sync() {
    setNotice(null)
    startSync(async () => {
      const res = await syncAoInboxNow()
      if (res.error || !res.report) return setNotice({ tone: 'error', text: res.error ?? 'Synchronisation impossible.' })
      if (res.report.skipped) return setNotice({ tone: 'ok', text: 'Une synchronisation est déjà en cours (passage automatique) : les nouvelles offres apparaîtront à la fin. Réessayez dans quelques minutes si besoin.' })
      setNotice(noticeOf(res.report))
    })
  }

  function retry(id: string) {
    setNotice(null)
    setRetryingId(id)
    startRetry(async () => {
      const res = await retryAoEmail(id)
      setRetryingId(null)
      if (res.error || !res.report) return setNotice({ tone: 'error', text: res.error ?? 'Relance impossible.' })
      if (res.report.skipped) return setNotice({ tone: 'ok', text: 'Une synchronisation est en cours : l\'e-mail est remis en file et sera traité juste après.' })
      setNotice(noticeOf(res.report, 'E-mail retraité : '))
    })
  }

  // Le message s'affiche en haut de la page : on l'amène à l'écran, « Réessayer » étant plus bas.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [notice])

  return (
    <div className="admin-light min-h-full p-8 space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--admin-fg-muted)' }}>RECRUTEMENT</p>
          <h1 className="text-[28px] font-bold tracking-tight text-admin-fg">AO Offers</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--admin-fg-muted)' }}>
            Appels d&apos;offres reçus sur la boîte AO, lus automatiquement.
            {recentEmails[0] ? ` Dernier e-mail : ${formatDay(recentEmails[0].receivedAt)}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={sync} disabled={syncing || !inboxConfigured} style={{ ...secondaryButton, opacity: syncing || !inboxConfigured ? 0.6 : 1 }}>
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
            {syncing ? 'Lecture de la boîte…' : 'Synchroniser maintenant'}
          </button>
          <a href={exportHref} download style={primaryButton}>
            <Download size={15} />
            Télécharger Excel ({filtered.length})
          </a>
        </div>
      </div>

      {!inboxConfigured && (
        <Banner tone="error" text="La lecture automatique est désactivée : renseignez AO_IMAP_USER et AO_IMAP_PASSWORD dans les variables d'environnement (Vercel et fichier .env local)." />
      )}
      {loadError && <Banner tone="error" text={loadError} />}
      <div ref={noticeRef}>{notice && <Banner tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}</div>

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
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-line)' }}>
          <h2 className="font-semibold text-sm text-admin-fg">Offres extraites</h2>
          <span className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''} sur {rows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--admin-line)' }}>
                {['Reçue le', 'Offre', 'Ville', 'Contrat', 'TJM / salaire', 'Compétences', 'Sources', 'Statut'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium whitespace-nowrap" style={{ color: 'var(--admin-fg-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-20" style={{ color: 'var(--admin-fg-muted)' }}>
                    <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>{rows.length === 0 ? 'Aucune offre reçue pour l\'instant. Les appels d\'offres envoyés à la boîte AO apparaîtront ici.' : 'Aucune offre ne correspond à ces filtres.'}</p>
                  </td>
                </tr>
              ) : filtered.map(r => (
                <tr key={r.$id} onClick={() => setSelectedId(r.$id)} className="cursor-pointer hover:bg-admin-panel"
                  style={{ borderBottom: '1px solid var(--admin-line)' }}>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--admin-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDay(r.receivedAt)}</td>
                  <td className="px-4 py-3 min-w-[240px]">
                    <button type="button" onClick={() => setSelectedId(r.$id)} className="text-left font-medium text-admin-fg hover:underline">{r.title}</button>
                    <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>{r.companyName || 'Client non précisé'} · {r.senderName || r.senderAddress}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.location || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{CONTRACT_LABEL[r.contractType]} · {REMOTE_LABEL[r.remote]}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(r.salary, r.contractType)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {r.skills.slice(0, 4).map(s => (
                        <span key={s} className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg)' }}>{s}</span>
                      ))}
                      {r.skills.length > 4 && <span className="text-[11px]" style={{ color: 'var(--admin-fg-muted)' }}>+{r.skills.length - 4}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.sourceCount > 1
                      ? <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#1d4ed8' }} title="Reçue dans plusieurs e-mails"><Copy size={12} />{r.sourceCount}</span>
                      : <span style={{ color: 'var(--admin-fg-muted)' }}>1</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs font-medium px-2 py-1 rounded-md" style={{ color: STATUS_UI[r.status].color, background: 'var(--admin-panel-raised)' }}>{STATUS_UI[r.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      {selected && <AoOfferPanel row={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

/** Message de fin d'une synchronisation (bouton « Synchroniser maintenant » ou « Réessayer »). */
function noticeOf(r: AoSyncReport, lead = ''): NonNullable<Notice> {
  if (!r.configured) return { tone: 'error', text: 'La boîte AO n\'est pas configurée (AO_IMAP_USER / AO_IMAP_PASSWORD).' }
  const parts = [
    `${r.processed} e-mail${r.processed > 1 ? 's' : ''} traité${r.processed > 1 ? 's' : ''}`,
    `${r.offersCreated} nouvelle${r.offersCreated > 1 ? 's' : ''} offre${r.offersCreated > 1 ? 's' : ''}`,
    r.duplicates ? `${r.duplicates} doublon${r.duplicates > 1 ? 's' : ''} fusionné${r.duplicates > 1 ? 's' : ''}` : '',
    r.remaining ? `${r.remaining} restant${r.remaining > 1 ? 's' : ''} pour le prochain passage` : '',
    r.aiUnavailable ? 'IA indisponible (crédits épuisés ou clé refusée) : les e-mails concernés attendent, voir « E-mails non traités »' : '',
  ].filter(Boolean)
  return {
    tone: r.failed ? 'error' : 'ok',
    text: `${lead}${parts.join(' · ')}${r.failed ? ` — ${r.failed} en erreur : ${r.errors.slice(0, 2).join(' ; ')}` : ''}`,
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
