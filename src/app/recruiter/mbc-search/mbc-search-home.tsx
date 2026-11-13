// Composant client : importé seulement par mbc-search-client.tsx (« use client »), qui en fait du code navigateur.
import { useRef, useState } from 'react'
import { ArrowRight, Bookmark, History, MessageSquareText, Plus, Radar, SlidersHorizontal, X } from 'lucide-react'
import { CRITERIA_LIMITS } from '@/lib/mbc-search/rules'
import type { MbcSearchEntry } from '@/lib/mbc-search/history'
import { ErrorNote, Toggle, orangeTint, surface } from './mbc-search-ui'
import { PromptBox } from './mbc-search-thread'

// Accueil de MBC Search : salutation, grand champ pour décrire le besoin (envoi = début de la conversation),
// « Recherche directe » (sans questions), filtres, puis les recherches précédentes du recruteur.

// Briefs d'exemple, fictifs, montrés tant que le recruteur n'a aucune recherche.
const EXAMPLES = [
  'Data engineer senior à Lyon, Spark et Kafka, idéalement passé par le secteur bancaire',
  'Chef de projet SAP FI/CO confirmé, Île-de-France, expérience de déploiement international',
  'Développeur React / Node.js, 3 à 5 ans d\'expérience, Nantes ou Rennes',
]

// Ce qu'un bon brief précise : un clic ajoute la ligne à compléter dans le champ.
const HINTS = ['Intitulé', 'Lieu', 'Séniorité', 'Compétences', 'Secteur']

const BRIEF_MIN = 20

const shortDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
}
const entryMeta = (e: MbcSearchEntry) => [`${e.total.toLocaleString('fr-FR')} profil${e.total > 1 ? 's' : ''}`, shortDate(e.lastRunAt)].filter(Boolean).join(' · ')

export function MbcSearchHome({
  firstName, configured, direct, onDirect, filters, onFilters, entries, historyAvailable, historyBusy, historyNote, resumeTitle,
  onStart, onManual, onOpenEntry, onRemoveEntry, onResume,
}: {
  firstName: string
  configured: boolean
  direct: boolean
  onDirect: (v: boolean) => void
  filters: { emailOnly: boolean; recentOnly: boolean }
  onFilters: (f: { emailOnly: boolean; recentOnly: boolean }) => void
  entries: MbcSearchEntry[]
  historyAvailable: boolean
  historyBusy: boolean
  historyNote: string | null
  /** Conversation en cours (quittée par « Nouvelle recherche » ou la flèche) : on peut y revenir. */
  resumeTitle: string | null
  onStart: (brief: string) => void
  onManual: () => void
  onOpenEntry: (e: MbcSearchEntry) => void
  onRemoveEntry: (e: MbcSearchEntry) => void
  onResume: () => void
}) {
  const [brief, setBrief] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const ordered = [...entries.filter(e => e.pinned), ...entries.filter(e => !e.pinned)]
  const shown = showAll ? ordered : ordered.slice(0, 6)
  const activeFilters = Number(filters.emailOnly) + Number(filters.recentOnly)

  const addHint = (hint: string) => {
    const next = `${brief.trimEnd()}${brief.trim() ? '\n' : ''}${hint} : `.slice(0, CRITERIA_LIMITS.brief)
    setBrief(next)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.length, next.length)
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16">
      <div className="flex items-center justify-center gap-3 mb-2">
        <span aria-hidden className="inline-flex items-center justify-center w-10 h-10 rounded-full" style={{ background: orangeTint(12), color: 'var(--color-brand-orange)' }}>
          <Radar className="h-5 w-5" />
        </span>
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontWeight: 300, fontSize: 'clamp(1.6rem, 3vw, 2rem)', lineHeight: 1.2 }}>
          Bonjour{firstName ? <>, <span style={{ color: 'var(--color-brand-orange)', fontWeight: 400 }}>{firstName}</span></> : ''}
        </h1>
      </div>
      <p className="text-center text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
        {direct
          ? 'Décrivez le profil recherché : la recherche part tout de suite.'
          : 'Décrivez le profil recherché : je vous pose quelques questions, puis je cherche et classe les profils.'}
      </p>

      {!configured && <div className="mb-4"><ErrorNote>La recherche n&apos;est pas encore activée sur la plateforme (clé Apollo manquante). Contactez le support.</ErrorNote></div>}

      <PromptBox id="mbc-brief" label="Profil recherché" rows={4} maxLength={CRITERIA_LIMITS.brief} minLength={BRIEF_MIN} autoFocus
        placeholder="Décrivez le profil recherché ou collez une fiche de poste…" disabled={!configured}
        value={brief} onValueChange={setBrief} inputRef={input} onSend={onStart}
        footer={
          <div className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <span className="text-xs mr-1" style={{ color: 'var(--color-text-muted)' }}>Précisez :</span>
            {HINTS.map(h => (
              <button key={h} type="button" onClick={() => addHint(h)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold hover:bg-[var(--color-background)]" style={{ ...surface, color: 'var(--color-text)' }}>
                <Plus className="h-3 w-3" aria-hidden /> {h}
              </button>
            ))}
          </div>
        } />
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ ...surface, color: 'var(--color-text)' }}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filtres{activeFilters > 0 ? ` · ${activeFilters}` : ''}
        </button>
        {/* Sans les questions de l'IA : la recherche part dès l'envoi. */}
        <span className="w-44"><Toggle label="Recherche directe" checked={direct} onChange={onDirect} /></span>
        <span className="flex-1" />
        <span className="hidden sm:inline text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {brief.trim().length > 0 && brief.trim().length < BRIEF_MIN ? `${BRIEF_MIN} caractères au moins` : 'Entrée pour envoyer · Maj + Entrée pour aller à la ligne'}
        </span>
      </div>
      {showFilters && (
        <div className="mt-2 rounded-2xl px-4 py-2 grid gap-x-6 sm:grid-cols-2" style={surface}>
          <Toggle label="E-mail disponible seulement" checked={filters.emailOnly} onChange={v => onFilters({ ...filters, emailOnly: v })} />
          <Toggle label="Mis à jour depuis moins de 6 mois" checked={filters.recentOnly} onChange={v => onFilters({ ...filters, recentOnly: v })} />
        </div>
      )}

      <section className="mt-10" aria-labelledby="mbc-previous">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
          <h2 id="mbc-previous" style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4 }}>Recherches précédentes</h2>
          <button type="button" onClick={onManual} disabled={!configured} className="text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-40" style={{ color: 'var(--color-text)' }}>
            Renseigner les critères vous-même
          </button>
        </div>
        {resumeTitle && (
          <button type="button" onClick={onResume}
            className="w-full mb-2 text-left text-sm rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-background)]"
            style={{ border: '1px solid var(--color-brand-orange)', background: orangeTint(5), color: 'var(--color-text)' }}>
            <MessageSquareText className="h-4 w-4 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
            <span className="flex-1 min-w-0 truncate"><span className="font-semibold">Reprendre la conversation</span> · {resumeTitle}</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        )}
        {historyNote && <p role="status" className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>{historyNote}</p>}
        {!historyAvailable ? (
          <p className="text-sm rounded-xl px-4 py-3" style={{ ...surface, color: 'var(--color-text-muted)' }}>
            Historique indisponible pour le moment : la recherche fonctionne, sans garder vos recherches.
          </p>
        ) : ordered.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune pour le moment. Pour commencer, essayez par exemple :</p>
            {EXAMPLES.map(ex => (
              <button key={ex} type="button" onClick={() => setBrief(ex)}
                className="w-full text-left text-sm rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--color-background)]" style={{ ...surface, color: 'var(--color-text)' }}>
                {ex}
                <ArrowRight className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
              </button>
            ))}
          </div>
        ) : (
          <>
            <ul className="rounded-2xl overflow-hidden" style={surface}>
              {shown.map((e, i) => (
                <li key={e.id} className="flex items-center gap-1 pr-2" style={i > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}>
                  <button type="button" onClick={() => onOpenEntry(e)} disabled={!configured || historyBusy}
                    className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-background)] disabled:opacity-40">
                    {e.pinned
                      ? <Bookmark className="h-4 w-4 shrink-0" fill="currentColor" style={{ color: 'var(--color-brand-orange)' }} aria-label="Recherche enregistrée" />
                      : <History className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />}
                    {/* Nom puis nombre de profils et date : l'un sous l'autre sur mobile, sur une ligne au-delà. */}
                    <span className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{e.name}</span>
                      <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>{entryMeta(e)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => onRemoveEntry(e)} disabled={historyBusy}
                    aria-label={e.pinned ? `Retirer ${e.name} des recherches enregistrées` : `Supprimer ${e.name} de l'historique`}
                    title={e.pinned ? 'Retirer des recherches enregistrées' : 'Supprimer de l’historique'}
                    className="p-2 rounded-lg disabled:opacity-40 hover:bg-[var(--color-background)]" style={{ color: 'var(--color-text-muted)' }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {ordered.length > shown.length && (
              <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-xs font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--color-text)' }}>
                Afficher toutes vos recherches ({ordered.length})
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
