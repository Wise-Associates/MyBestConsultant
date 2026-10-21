'use client'

import { useState, useTransition } from 'react'
import {
  Cpu, Plus, Trash2, TestTube, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Route, Info, Star,
} from 'lucide-react'
import { testProvider } from './actions'
import type { ProviderConfig } from './types'
import { Row, TextInput, NumInput, ApiKeyInput } from './config-ui'
import {
  AI_MODULES, MODEL_LIMITS, OS_HOSTS, OS_PRESETS, makeModelId, type AIModule, type OpenSourceModel,
} from '@/lib/ai/models'

type SetCfg = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) => void
type TestResult = { ok: boolean; latencyMs: number; error?: string }

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const btn = { border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.05)' }
const selectStyle = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }

const BUILTIN_LABEL: Record<string, string> = { claude: 'Claude', gpt4o: 'GPT-4o', teckia: 'TeckiA' }

/** Nom lisible d'un modèle (intégré ou open source). */
function modelName(id: string, cfg: ProviderConfig): string {
  if (id === 'claude') return `Claude · ${cfg.claudeModel}`
  if (id === 'gpt4o') return `GPT-4o · ${cfg.gpt4oModel}`
  if (id === 'teckia') return `TeckiA · ${cfg.teckiaModel}`
  const m = cfg.openSourceModels.find(x => x.id === id)
  return m ? `${m.label} (open source)` : id
}

/** Paramètres de test d'un modèle d'après l'état courant du formulaire (même avant enregistrement). */
function testOverridesFor(id: string, cfg: ProviderConfig) {
  if (id === 'claude') return { model: cfg.claudeModel, apiKey: cfg.claudeApiKey }
  if (id === 'gpt4o') return { model: cfg.gpt4oModel, apiUrl: 'https://api.openai.com/v1', apiKey: cfg.openaiApiKey }
  if (id === 'teckia') return { model: cfg.teckiaModel, apiUrl: cfg.teckiaApiUrl, apiKey: cfg.teckiaApiKey }
  const m = cfg.openSourceModels.find(x => x.id === id)
  return m ? { model: m.model, apiUrl: m.apiUrl, apiKey: m.apiKey } : undefined
}

function TestBadge({ result }: { result: TestResult | null }) {
  if (!result) return null
  return result.ok
    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />OK · {result.latencyMs} ms</span>
    : <span className="inline-flex items-center gap-1 text-xs text-red-400 max-w-[260px] truncate" title={result.error}><AlertCircle className="h-3.5 w-3.5 shrink-0" />{result.error ?? 'Échec'}</span>
}

function useTester(cfg: ProviderConfig) {
  const [results, setResults] = useState<Record<string, TestResult | null>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  // `key` identifie la ligne d'affichage du résultat ; `providerId` le modèle réellement testé.
  function run(key: string, providerId: string = key) {
    setTesting(key)
    setResults(r => ({ ...r, [key]: null }))
    startTransition(async () => {
      const res = await testProvider(providerId, testOverridesFor(providerId, cfg))
      setResults(r => ({ ...r, [key]: res }))
      setTesting(null)
    })
  }
  return { results, testing, run }
}

// ── Modèle par module ────────────────────────────────────────────────
export function ModuleRouting({ cfg, set }: { cfg: ProviderConfig; set: SetCfg }) {
  const { results, testing, run } = useTester(cfg)
  const enabledCustom = cfg.openSourceModels.filter(m => m.enabled)

  function assign(module: AIModule, value: string) {
    const next = { ...cfg.moduleRouting }
    if (value === 'default') delete next[module]
    else next[module] = value
    set('moduleRouting', next)
  }

  return (
    <div className="rounded-2xl p-6 space-y-4" style={card}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(96,165,250,0.15)' }}>
          <Route className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">Modèle par module</h3>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Choisissez quel modèle alimente chaque module IA de la plateforme</p>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        {AI_MODULES.map(m => {
          const assigned = cfg.moduleRouting[m.id]
          const effective = assigned && (BUILTIN_LABEL[assigned] || enabledCustom.some(c => c.id === assigned)) ? assigned : cfg.activeProvider
          return (
            <div key={m.id} className="flex items-center justify-between gap-4 flex-wrap px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="min-w-[180px]">
                <p className="text-sm font-medium text-white/85">{m.label}</p>
                <p className="text-[11px] text-white/35 mt-0.5">{m.description}</p>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <TestBadge result={results[`${m.id}:${effective}`] ?? null} />
                <select value={assigned && effective === assigned ? assigned : 'default'} onChange={e => assign(m.id, e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-white/20 max-w-[280px]" style={selectStyle}>
                  <option value="default" style={{ color: '#000' }}>Modèle par défaut — {modelName(cfg.activeProvider, cfg)}</option>
                  <optgroup label="Modèles intégrés">
                    {(['claude', 'gpt4o', 'teckia'] as const).map(id => <option key={id} value={id} style={{ color: '#000' }}>{modelName(id, cfg)}</option>)}
                  </optgroup>
                  {enabledCustom.length > 0 && (
                    <optgroup label="Open source">
                      {enabledCustom.map(c => <option key={c.id} value={c.id} style={{ color: '#000' }}>{c.label}</option>)}
                    </optgroup>
                  )}
                </select>
                <button type="button" disabled={testing !== null} onClick={() => run(`${m.id}:${effective}`, effective)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50" style={btn}>
                  {testing === `${m.id}:${effective}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}Tester
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-start gap-2.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
        <span>
          Le changement est actif <strong>dès l&apos;enregistrement</strong>, sans redéploiement ni coupure de service. Si le modèle choisi ne répond pas,
          la plateforme bascule automatiquement sur le modèle par défaut puis sur un autre modèle disponible.
        </span>
      </div>
    </div>
  )
}

// ── Modèles open source ──────────────────────────────────────────────
export function OpenSourceModels({ cfg, set }: { cfg: ProviderConfig; set: SetCfg }) {
  const { results, testing, run } = useTester(cfg)
  const [adding, setAdding] = useState(false)
  const [presetId, setPresetId] = useState(OS_PRESETS[0].id)
  const [hostId, setHostId] = useState('together')
  const [draft, setDraft] = useState({ label: '', model: '', apiUrl: '', apiKey: '' })
  const [openId, setOpenId] = useState<string | null>(null)

  const host = OS_HOSTS.find(h => h.id === hostId) ?? OS_HOSTS[0]
  const preset = OS_PRESETS.find(p => p.id === presetId)
  const usedBy = (id: string) => AI_MODULES.filter(m => cfg.moduleRouting[m.id] === id).map(m => m.label)

  function pickPreset(id: string, h: string) {
    const p = OS_PRESETS.find(x => x.id === id)
    const hostDef = OS_HOSTS.find(x => x.id === h) ?? OS_HOSTS[0]
    setPresetId(id); setHostId(h)
    setDraft(d => ({ ...d, label: p?.label ?? d.label, model: p?.models[h] ?? '', apiUrl: hostDef.apiUrl }))
  }

  function startAdd() {
    setAdding(true)
    pickPreset(OS_PRESETS[0].id, 'together')
    setDraft(d => ({ ...d, apiKey: '' }))
  }

  function add() {
    if (!draft.label.trim() || !draft.model.trim()) return
    if (cfg.openSourceModels.length >= MODEL_LIMITS.maxModels) return
    const m: OpenSourceModel = {
      id: makeModelId(draft.label), label: draft.label.trim(), family: preset?.family ?? '', model: draft.model.trim(),
      apiUrl: draft.apiUrl.trim().replace(/\/+$/, ''), apiKey: draft.apiKey.trim(), priceInput: 0, priceOutput: 0, enabled: true,
    }
    set('openSourceModels', [...cfg.openSourceModels, m])
    setOpenId(m.id)
    setAdding(false)
  }

  function update(id: string, patch: Partial<OpenSourceModel>) {
    set('openSourceModels', cfg.openSourceModels.map(m => (m.id === id ? { ...m, ...patch } : m)))
  }

  function remove(m: OpenSourceModel) {
    if (!window.confirm(`Supprimer « ${m.label} » ? Les modules qui l'utilisent repasseront sur le modèle par défaut.`)) return
    set('openSourceModels', cfg.openSourceModels.filter(x => x.id !== m.id))
    const routing = { ...cfg.moduleRouting }
    for (const k of Object.keys(routing) as AIModule[]) if (routing[k] === m.id) delete routing[k]
    set('moduleRouting', routing)
    if (cfg.activeProvider === m.id) set('activeProvider', 'claude')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Modèles open source</h2>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Llama, Mistral, Qwen, DeepSeek, Gemma… via un serveur privé ou un hébergeur (API compatible OpenAI).
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={startAdd} disabled={cfg.openSourceModels.length >= MODEL_LIMITS.maxModels}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>
            <Plus className="h-4 w-4" />Ajouter un modèle
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...card, border: '1px solid rgba(184,134,11,0.35)' }}>
          <p className="text-sm font-semibold text-white">Nouveau modèle open source</p>
          <div>
            <p className="text-[11px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>1. Famille de modèle</p>
            <div className="flex flex-wrap gap-2">
              {OS_PRESETS.map(p => (
                <button key={p.id} type="button" onClick={() => pickPreset(p.id, p.models[hostId] ? hostId : Object.keys(p.models)[0])}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={presetId === p.id ? { background: '#B8860B', color: 'white' } : btn}>{p.label}</button>
              ))}
              <button type="button" onClick={() => { setPresetId('custom'); setDraft(d => ({ ...d, label: '', model: '' })) }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium" style={presetId === 'custom' ? { background: '#B8860B', color: 'white' } : btn}>Autre modèle…</button>
            </div>
          </div>
          <div>
            <p className="text-[11px] mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>2. Hébergeur</p>
            <div className="flex flex-wrap gap-2">
              {OS_HOSTS.map(h => (
                <button key={h.id} type="button" onClick={() => pickPreset(presetId === 'custom' ? OS_PRESETS[0].id : presetId, h.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium" style={hostId === h.id ? { background: '#B8860B', color: 'white' } : btn} title={h.hint}>{h.label}</button>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{host.hint}</p>
          </div>
          <div className="space-y-1">
            <Row label="Nom affiché"><TextInput value={draft.label} onChange={v => setDraft(d => ({ ...d, label: v }))} placeholder="Llama 3.3 70B" /></Row>
            <Row label="Nom du modèle" hint="Identifiant exact chez l'hébergeur — vérifiez-le dans sa documentation"><TextInput value={draft.model} onChange={v => setDraft(d => ({ ...d, model: v }))} mono placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo" width="w-72" /></Row>
            <Row label="URL de l'API"><TextInput value={draft.apiUrl} onChange={v => setDraft(d => ({ ...d, apiUrl: v }))} mono placeholder="https://…/v1" width="w-72" /></Row>
            <Row label="Clé API" hint={host.keyRequired ? 'Requise par cet hébergeur' : 'Laissez vide si votre serveur n’en requiert pas'}><ApiKeyInput value={draft.apiKey} onChange={v => setDraft(d => ({ ...d, apiKey: v }))} placeholder="(clé de l'hébergeur)" /></Row>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm" style={btn}>Annuler</button>
            <button type="button" onClick={add} disabled={!draft.label.trim() || !draft.model.trim() || !draft.apiUrl.trim()}
              className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-40" style={{ background: '#B8860B', color: 'white' }}>Ajouter à la liste</button>
          </div>
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Pensez à cliquer sur « Enregistrer » en haut de page pour valider.</p>
        </div>
      )}

      {cfg.openSourceModels.length === 0 && !adding ? (
        <div className="rounded-2xl p-8 text-center" style={card}>
          <Cpu className="h-7 w-7 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Aucun modèle open source pour l&apos;instant. Ajoutez-en un pour l&apos;utiliser en complément de Claude.</p>
        </div>
      ) : (
        cfg.openSourceModels.map(m => {
          const isDefault = cfg.activeProvider === m.id
          const modules = usedBy(m.id)
          const expanded = openId === m.id
          return (
            <div key={m.id} className="rounded-2xl overflow-hidden"
              style={{ border: isDefault ? '1px solid rgba(184,134,11,0.4)' : '1px solid rgba(255,255,255,0.08)', background: isDefault ? 'rgba(184,134,11,0.05)' : 'rgba(255,255,255,0.03)', opacity: m.enabled ? 1 : 0.6 }}>
              <div className="flex items-start gap-4 p-5">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: 'linear-gradient(135deg,#f97316,#b45309)' }}><Cpu className="h-5 w-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{m.label}</h3>
                    {m.family && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>{m.family}</span>}
                    {isDefault && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#B8860B', color: 'white' }}>PAR DÉFAUT</span>}
                    {!m.enabled && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>DÉSACTIVÉ</span>}
                  </div>
                  <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{m.model}</p>
                  {modules.length > 0 && <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>Utilisé par : {modules.join(', ')}</p>}
                  <div className="mt-1.5"><TestBadge result={results[m.id] ?? null} /></div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <button type="button" onClick={() => run(m.id)} disabled={testing !== null} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50" style={btn}>
                    {testing === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}Tester
                  </button>
                  {!isDefault && m.enabled && (
                    <button type="button" onClick={() => set('activeProvider', m.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>
                      <Star className="h-3 w-3" />Par défaut
                    </button>
                  )}
                  <button type="button" onClick={() => setOpenId(expanded ? null : m.id)} className="p-1.5 rounded-lg" style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)' }}>
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="px-5 pb-5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <Row label="Nom affiché"><TextInput value={m.label} onChange={v => update(m.id, { label: v })} /></Row>
                  <Row label="Nom du modèle"><TextInput value={m.model} onChange={v => update(m.id, { model: v })} mono width="w-72" /></Row>
                  <Row label="URL de l'API"><TextInput value={m.apiUrl} onChange={v => update(m.id, { apiUrl: v })} mono width="w-72" /></Row>
                  <Row label="Clé API"><ApiKeyInput value={m.apiKey} onChange={v => update(m.id, { apiKey: v })} placeholder="(optionnel)" /></Row>
                  <Row label="Coût base facturation (input)" hint="$ / 1M tokens — 0 si hébergé en interne"><NumInput value={m.priceInput} onChange={v => update(m.id, { priceInput: v })} step={0.1} prefix="$" /></Row>
                  <Row label="Coût base facturation (output)"><NumInput value={m.priceOutput} onChange={v => update(m.id, { priceOutput: v })} step={0.1} prefix="$" /></Row>
                  <Row label="Actif" hint="Un modèle désactivé n'est plus utilisé (les modules reviennent au modèle par défaut)">
                    <input type="checkbox" checked={m.enabled} onChange={e => update(m.id, { enabled: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                  </Row>
                  <div className="pt-3 flex justify-end">
                    <button type="button" onClick={() => remove(m)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <Trash2 className="h-3.5 w-3.5" />Supprimer ce modèle
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
