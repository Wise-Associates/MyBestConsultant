'use client'

import { useState, useTransition } from 'react'
import {
  Brain, Zap, Server, Check, X, Loader2, TestTube,
  ChevronDown, ChevronUp, DollarSign, ToggleLeft, ToggleRight,
  AlertCircle, CheckCircle2, Info,
} from 'lucide-react'
import { saveLLMConfig, testProvider } from './actions'
import type { ProviderConfig } from './types'
import { Row, TextInput, NumInput, ApiKeyInput } from './config-ui'
import { ModuleRouting, OpenSourceModels } from './models-section'

// ── Official pricing reference (read-only) ──────────────────────────
const CLAUDE_PRICING = [
  { model: 'claude-haiku-4-5',   input: 0.80,  output: 4.00  },
  { model: 'claude-sonnet-4-6',  input: 3.00,  output: 15.00 },
  { model: 'claude-opus-4-8',    input: 15.00, output: 75.00 },
]
const GPT4O_PRICING = [
  { model: 'gpt-4o-mini', input: 0.15, output: 0.60 },
  { model: 'gpt-4o',      input: 2.50, output: 10.00 },
]

// ── Pricing reference table ──────────────────────────────────────────
function PricingRef({ rows }: { rows: { model: string; input: number; output: number }[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="grid grid-cols-3 px-3 py-2 text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span>Modèle</span><span className="text-right">Input /1M</span><span className="text-right">Output /1M</span>
      </div>
      {rows.map(r => (
        <div key={r.model} className="grid grid-cols-3 px-3 py-2 text-xs" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)' }}>
          <span className="font-mono text-[11px]">{r.model}</span>
          <span className="text-right text-white/80">${r.input.toFixed(2)}</span>
          <span className="text-right text-white/80">${r.output.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Provider card ────────────────────────────────────────────────────
function ProviderCard({
  id, name, icon: Icon, iconBg, description, active, onSelect, testOverrides, children,
}: {
  id: string; name: string; icon: React.ElementType; iconBg: string
  description: string; active: boolean; onSelect: () => void
  testOverrides?: { model?: string; apiUrl?: string; apiKey?: string }
  children?: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(active)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null)
  const [, startTransition] = useTransition()

  function runTest() {
    setTesting(true); setTestResult(null)
    startTransition(async () => {
      const res = await testProvider(id, testOverrides)
      setTestResult(res); setTesting(false)
    })
  }

  return (
    <div className="rounded-2xl overflow-hidden transition-all"
      style={{ border: active ? '1px solid rgba(184,134,11,0.4)' : '1px solid rgba(255,255,255,0.08)', background: active ? 'rgba(184,134,11,0.05)' : 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-start gap-4 p-5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: iconBg }}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{name}</h3>
            {active && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#B8860B', color: 'white' }}>ACTIF</span>
            )}
          </div>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={runTest} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.05)' }}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
            Tester
          </button>
          {!active && (
            <button onClick={onSelect}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>
              Activer
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg transition-all" style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)' }}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`mx-5 mb-3 px-4 py-3 rounded-xl flex items-center gap-3 text-sm ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}
          style={{ background: testResult.ok ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${testResult.ok ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
          {testResult.ok
            ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> Connexion OK — {testResult.latencyMs}ms</>
            : <><AlertCircle className="h-4 w-4 shrink-0" /> {testResult.error ?? 'Erreur de connexion'}</>}
        </div>
      )}

      {expanded && children && (
        <div className="px-5 pb-5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Cost estimator ───────────────────────────────────────────────────
function CostEstimator({ cfg }: { cfg: ProviderConfig }) {
  const [screenings, setScreenings] = useState(100)
  const [imports, setImports] = useState(20)
  const [interviews, setInterviews] = useState(30)

  const tokPerOp = { screening: 3000, import: 2000, interview: 8000 }
  const totalInputM = (screenings * tokPerOp.screening + imports * tokPerOp.import + interviews * tokPerOp.interview) / 1_000_000
  const totalOutputM = totalInputM * 0.4

  const custom = cfg.openSourceModels.find(m => m.id === cfg.activeProvider)
  const [priceIn, priceOut] = custom
    ? [custom.priceInput, custom.priceOutput]
    : cfg.activeProvider === 'claude'
    ? [cfg.claudePriceInput, cfg.claudePriceOutput]
    : cfg.activeProvider === 'gpt4o'
    ? [cfg.gpt4oPriceInput, cfg.gpt4oPriceOutput]
    : [cfg.teckiaPriceInput, cfg.teckiaPriceOutput]

  const baseCost = totalInputM * priceIn + totalOutputM * priceOut
  const margin = cfg.billingEnabled ? baseCost * (cfg.markupPercent / 100) : 0

  return (
    <div className="rounded-2xl p-6 space-y-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.15)' }}>
          <DollarSign className="h-4 w-4 text-amber-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">Estimateur de coûts mensuels</h3>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Basé sur le pricing du fournisseur actif</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-5">
        {[
          { label: 'Screenings CV', value: screenings, set: setScreenings },
          { label: 'Imports offres', value: imports, set: setImports },
          { label: 'Entretiens IA', value: interviews, set: setInterviews },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <label className="text-xs mb-2 block" style={{ color: 'rgba(255,255,255,0.45)' }}>{label} / mois</label>
            <input type="range" min={0} max={500} value={value} onChange={e => set(Number(e.target.value))}
              className="w-full accent-amber-400" />
            <p className="text-base font-bold text-white mt-1 text-center">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Tokens estimés</p>
          <p className="text-xl font-bold text-white">{(totalInputM * 1000).toFixed(0)}K</p>
        </div>
        <div className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Coût API</p>
          <p className="text-xl font-bold text-white">${baseCost.toFixed(2)}</p>
        </div>
        <div className="text-center p-3 rounded-xl" style={{ background: cfg.billingEnabled ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)' }}>
          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{cfg.billingEnabled ? `Marge +${cfg.markupPercent}%` : 'Marge désactivée'}</p>
          <p className="text-xl font-bold" style={{ color: cfg.billingEnabled ? '#34d399' : 'rgba(255,255,255,0.3)' }}>
            {cfg.billingEnabled ? `+$${margin.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────
export function LLMConfigClient({ initialConfig }: { initialConfig: ProviderConfig }) {
  const [cfg, setCfg] = useState<ProviderConfig>(initialConfig)
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  function set<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) {
    setCfg(prev => ({ ...prev, [key]: value }))
  }

  function save() {
    setStatus('idle')
    startTransition(async () => {
      const res = await saveLLMConfig(cfg)
      if (res.error) { setStatus('error'); setErrMsg(res.error) }
      else { setStatus('ok'); setTimeout(() => setStatus('idle'), 3000) }
    })
  }

  const S = { color: 'rgba(255,255,255,0.87)' }

  return (
    <div className="min-h-full p-8 max-w-3xl mx-auto space-y-8" style={S}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>INTELLIGENCE</p>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Configuration IA</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Clés API, modèles et pricing — utilisés pour tous les modules du site.
          </p>
        </div>
        <button onClick={save} disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#B8860B', color: 'white' }}>
          {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Enregistrement…</>
            : status === 'ok' ? <><Check className="h-4 w-4" />Enregistré !</>
            : <>Enregistrer</>}
        </button>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-3 p-4 rounded-xl text-sm text-red-400"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" />{errMsg}
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl text-sm" style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.2)', color: 'rgba(255,255,255,0.6)' }}>
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-400" />
        <div>
          Les clés API saisies ici sont prioritaires sur les variables d&apos;environnement du serveur (<code className="text-xs font-mono text-blue-300">ANTHROPIC_API_KEY</code>, <code className="text-xs font-mono text-blue-300">OPENAI_API_KEY</code>…).
          Elles sont stockées dans Appwrite. Si tu préfères les garder dans <code className="text-xs font-mono text-blue-300">.env.local</code>, laisse ces champs vides.
        </div>
      </div>

      {/* Modèle par module */}
      <ModuleRouting cfg={cfg} set={set} />

      {/* Providers */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Fournisseurs LLM</h2>

        {/* Claude */}
        <ProviderCard id="claude" active={cfg.activeProvider === 'claude'} onSelect={() => set('activeProvider', 'claude')}
          name="Claude (Anthropic)" icon={Brain} iconBg="linear-gradient(135deg,#7c3aed,#4f46e5)"
          description="Meilleure qualité · Reasoning avancé · Recommandé pour screening et entretiens"
          testOverrides={{ model: cfg.claudeModel, apiKey: cfg.claudeApiKey }}>
          <Row label="Clé API Anthropic" hint="sk-ant-api03-...">
            <ApiKeyInput value={cfg.claudeApiKey} onChange={v => set('claudeApiKey', v)} placeholder="sk-ant-api03-..." />
          </Row>
          <Row label="Modèle">
            <TextInput value={cfg.claudeModel} onChange={v => set('claudeModel', v)} mono placeholder="claude-sonnet-4-6" />
          </Row>
          <div className="pt-3 pb-1">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <Info className="h-3 w-3" /> Pricing officiel Anthropic ($/1M tokens — référence)
            </p>
            <PricingRef rows={CLAUDE_PRICING} />
          </div>
          <Row label="Coût base facturation (input)" hint="Utilisé pour calculer la marge client">
            <NumInput value={cfg.claudePriceInput} onChange={v => set('claudePriceInput', v)} step={0.5} prefix="$" />
          </Row>
          <Row label="Coût base facturation (output)">
            <NumInput value={cfg.claudePriceOutput} onChange={v => set('claudePriceOutput', v)} step={0.5} prefix="$" />
          </Row>
        </ProviderCard>

        {/* GPT-4o */}
        <ProviderCard id="gpt4o" active={cfg.activeProvider === 'gpt4o'} onSelect={() => set('activeProvider', 'gpt4o')}
          name="GPT-4o (OpenAI)" icon={Zap} iconBg="linear-gradient(135deg,#10b981,#059669)"
          description="Performances élevées · Bon rapport qualité/coût · API OpenAI standard"
          testOverrides={{ model: cfg.gpt4oModel, apiUrl: 'https://api.openai.com/v1', apiKey: cfg.openaiApiKey }}>
          <Row label="Clé API OpenAI" hint="sk-...">
            <ApiKeyInput value={cfg.openaiApiKey} onChange={v => set('openaiApiKey', v)} placeholder="sk-..." />
          </Row>
          <Row label="Modèle">
            <TextInput value={cfg.gpt4oModel} onChange={v => set('gpt4oModel', v)} mono placeholder="gpt-4o" />
          </Row>
          <div className="pt-3 pb-1">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <Info className="h-3 w-3" /> Pricing officiel OpenAI ($/1M tokens — référence)
            </p>
            <PricingRef rows={GPT4O_PRICING} />
          </div>
          <Row label="Coût base facturation (input)" hint="Pour calcul marge client">
            <NumInput value={cfg.gpt4oPriceInput} onChange={v => set('gpt4oPriceInput', v)} step={0.5} prefix="$" />
          </Row>
          <Row label="Coût base facturation (output)">
            <NumInput value={cfg.gpt4oPriceOutput} onChange={v => set('gpt4oPriceOutput', v)} step={0.5} prefix="$" />
          </Row>
        </ProviderCard>

        {/* TeckiA */}
        <ProviderCard id="teckia" active={cfg.activeProvider === 'teckia'} onSelect={() => set('activeProvider', 'teckia')}
          name="TeckiA Brain (Self-hosted)" icon={Server} iconBg="linear-gradient(135deg,#0ea5e9,#0B1D51)"
          description="Hébergé sur votre serveur · Données 100% privées · Coût réduit"
          testOverrides={{ model: cfg.teckiaModel, apiUrl: cfg.teckiaApiUrl, apiKey: cfg.teckiaApiKey }}>
          <Row label="URL de l'API" hint="Ex: http://localhost:8000/v1 ou https://teckia.ton-serveur.com/v1">
            <TextInput value={cfg.teckiaApiUrl} onChange={v => set('teckiaApiUrl', v)} mono placeholder="http://localhost:8000/v1" />
          </Row>
          <Row label="Clé API TeckiA" hint="Laisse vide si ton serveur n'en requiert pas">
            <ApiKeyInput value={cfg.teckiaApiKey} onChange={v => set('teckiaApiKey', v)} placeholder="(optionnel)" />
          </Row>
          <Row label="Nom du modèle" hint="Correspond au model_name dans ta config TeckiA">
            <TextInput value={cfg.teckiaModel} onChange={v => set('teckiaModel', v)} mono placeholder="teckia-base" />
          </Row>
          <Row label="Coût base facturation (input)" hint="Mets 0 si gratuit en interne">
            <NumInput value={cfg.teckiaPriceInput} onChange={v => set('teckiaPriceInput', v)} step={0.1} prefix="$" />
          </Row>
          <Row label="Coût base facturation (output)">
            <NumInput value={cfg.teckiaPriceOutput} onChange={v => set('teckiaPriceOutput', v)} step={0.1} prefix="$" />
          </Row>
        </ProviderCard>
      </div>

      {/* Modèles open source */}
      <OpenSourceModels cfg={cfg} set={set} />

      {/* Billing */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.15)' }}>
              <DollarSign className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Tarification variable</h3>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Refacturer le coût IA avec marge aux recruteurs</p>
            </div>
          </div>
          <button onClick={() => set('billingEnabled', !cfg.billingEnabled)}>
            {cfg.billingEnabled
              ? <ToggleRight className="h-8 w-8 text-amber-400" />
              : <ToggleLeft className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.3)' }} />}
          </button>
        </div>
        {cfg.billingEnabled && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
            <Row label="Marge appliquée">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={100} value={cfg.markupPercent}
                  onChange={e => set('markupPercent', Number(e.target.value))}
                  className="w-32 accent-amber-400" />
                <span className="text-sm font-bold w-12 text-right text-white">{cfg.markupPercent}%</span>
              </div>
            </Row>
          </div>
        )}
      </div>

      {/* Estimator */}
      <CostEstimator cfg={cfg} />

      {/* Save bottom */}
      <div className="flex justify-end pt-2">
        <button onClick={save} disabled={isPending}
          className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#B8860B', color: 'white', opacity: isPending ? 0.6 : 1 }}>
          {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Enregistrement…</>
            : status === 'ok' ? <><Check className="h-4 w-4" />Enregistré !</>
            : <>Enregistrer la configuration</>}
        </button>
      </div>
    </div>
  )
}
