'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Save } from 'lucide-react'
import { formatDay, primaryButton, secondaryButton } from '@/app/admin/candidats/labels'
import type { VeilleConfig } from '@/lib/veille/config'
import type { VeilleConfigVersion } from '@/lib/veille/store'
import { saveVeilleConfigAction } from './actions'
import { ItScopeTab } from './it-scope-tab'
import { OrganisationsTab } from './organisations-tab'
import { SourcesTab } from './sources-tab'
import { TenderKeywordsTab } from './tender-keywords-tab'

// Réglages de la veille marchés et emplois : une copie locale est modifiée dans les onglets, puis enregistrée en
// une fois comme nouvelle version (une version cohérente, jamais à moitié modifiée).

type Tab = 'organisations' | 'sources' | 'filtres' | 'mots-cles'

interface Props {
  initial: VeilleConfigVersion | null
  loadError: string
  tokenConfigured: boolean
}

export function VeilleSettings({ initial, loadError, tokenConfigured }: Props) {
  return (
    <div className="admin-light min-h-full p-4 sm:p-8 space-y-6">
      <header>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--admin-fg-muted)' }}>VEILLE</p>
        <h1 className="text-[28px] font-bold tracking-tight text-admin-fg">Marchés &amp; emplois</h1>
        <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--admin-fg-muted)' }}>
          Organismes suivis, sources lues, filtre informatique et mots-clés des appels d&apos;offres du scanner, qui envoie chaque
          nouvelle offre à la boîte AO.
          Pris en compte au passage suivant (5 h, 9 h, 13 h et 17 h UTC).
        </p>
        <p className="inline-flex items-center gap-1.5 text-xs mt-3 px-2 py-1 rounded-md"
          style={{ background: 'var(--admin-panel-raised)', color: tokenConfigured ? '#047857' : '#b91c1c' }}>
          <KeyRound size={13} aria-hidden />
          {tokenConfigured
            ? 'Jeton du scanner configuré (VEILLE_CONFIG_TOKEN).'
            : 'Jeton du scanner absent ou trop court (VEILLE_CONFIG_TOKEN, 32 caractères au moins) : le scanner ne peut pas lire ces réglages.'}
        </p>
      </header>
      {initial ? <Editor initial={initial} /> : <Banner tone="error" text={loadError} />}
    </div>
  )
}

function Editor({ initial }: { initial: VeilleConfigVersion }) {
  const [saved, setSaved] = useState(initial)
  const [config, setConfig] = useState<VeilleConfig>(initial.config)
  const [tab, setTab] = useState<Tab>('organisations')
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved.config), [config, saved.config])
  const savedOrganisationIds = useMemo(() => new Set(saved.config.organisations.map(o => o.id)), [saved.config])
  const savedSourceIds = useMemo(() => new Set(saved.config.sources.map(s => s.id)), [saved.config])

  // Modifications non enregistrées : le navigateur demande confirmation avant de quitter ou recharger la page.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const change = (next: VeilleConfig) => {
    setConfig(next)
    setNotice('')
  }

  function save() {
    setErrors([])
    setNotice('')
    startTransition(async () => {
      const res = await saveVeilleConfigAction(config, saved.version)
      if (res.errors) return setErrors(res.errors)
      if (res.error || !res.version || !res.config) return setErrors([res.error ?? 'Enregistrement impossible : réessayez.'])
      setSaved({ version: res.version, config: res.config, savedAt: new Date().toISOString(), savedByName: 'vous' })
      setConfig(res.config)
      setNotice(`Version ${res.version} enregistrée : le scanner l'appliquera à son prochain passage.`)
    })
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'organisations', label: 'Organismes', count: config.organisations.length },
    { id: 'sources', label: 'Sources', count: config.sources.length },
    { id: 'filtres', label: 'Filtre informatique' },
    { id: 'mots-cles', label: 'Mots-clés des appels d\'offres', count: config.tenderKeywords.families.length },
  ]

  return (
    <div className="space-y-5">
      {/* Barre d'enregistrement, toujours visible pendant la saisie. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
        style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
        <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>
          <span className="font-semibold text-admin-fg">Version {saved.version}</span>
          {' · '}enregistrée le {formatDay(saved.savedAt)} par {saved.savedByName}
          {dirty && <span className="ml-2 inline-flex items-center gap-1.5 font-medium" style={{ color: '#b45309' }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#F97316' }} aria-hidden />Modifications non enregistrées
          </span>}
        </p>
        <div className="flex items-center gap-2">
          {dirty && (
            <button type="button" onClick={() => { setConfig(saved.config); setErrors([]) }} disabled={pending} style={secondaryButton}>
              Annuler les modifications
            </button>
          )}
          <button type="button" onClick={save} disabled={!dirty || pending}
            style={{ ...primaryButton, color: '#2C2C2E', opacity: !dirty || pending ? 0.55 : 1, cursor: !dirty || pending ? 'not-allowed' : 'pointer' }}>
            {pending ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Save size={15} aria-hidden />}
            Enregistrer
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#b91c1c' }}><AlertCircle size={15} aria-hidden />Rien n&apos;a été enregistré :</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm" style={{ color: '#b91c1c' }}>
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      {notice && <Banner tone="ok" text={notice} />}

      <div role="tablist" aria-label="Réglages de la veille" className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--admin-line)' }}>
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
            className="-mb-px px-4 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F97316]"
            style={{
              color: tab === t.id ? 'var(--admin-fg)' : 'var(--admin-fg-muted)',
              borderBottom: `2px solid ${tab === t.id ? '#F97316' : 'transparent'}`,
            }}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs" style={{ color: 'var(--admin-fg-muted)' }}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="max-w-5xl">
        {tab === 'organisations' && <OrganisationsTab config={config} onChange={change} savedIds={savedOrganisationIds} />}
        {tab === 'sources' && <SourcesTab config={config} onChange={change} savedIds={savedSourceIds} />}
        {tab === 'filtres' && <ItScopeTab config={config} onChange={change} />}
        {tab === 'mots-cles' && <TenderKeywordsTab config={config} onChange={change} />}
      </div>
    </div>
  )
}

function Banner({ tone, text }: { tone: 'ok' | 'error'; text: string }) {
  const color = tone === 'ok' ? '#047857' : '#b91c1c'
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex items-start gap-3 rounded-xl p-4"
      style={{ background: tone === 'ok' ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${tone === 'ok' ? 'rgba(52,211,153,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color }} aria-hidden />
      <p className="text-sm" style={{ color }}>{text}</p>
    </div>
  )
}
