'use client'

import { useState } from 'react'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'

// ── Helpers ─────────────────────────────────────────────────────────
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.06] last:border-0">
      <div>
        <span className="text-sm text-white/70">{label}</span>
        {hint && <p className="text-[11px] text-white/30 mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, mono, type = 'text', width = 'w-64' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string; width?: string
}) {
  return (
    <input
      type={type} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`px-3 py-1.5 rounded-lg text-sm border focus:outline-none focus:ring-1 focus:ring-white/20 ${width} ${mono ? 'font-mono' : ''}`}
      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
    />
  )
}

export function NumInput({ value, onChange, step = 1, prefix }: {
  value: number; onChange: (v: number) => void; step?: number; prefix?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      {prefix && <span className="text-xs text-white/40">{prefix}</span>}
      <input
        type="number" step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 px-2 py-1.5 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-white/20"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
      />
    </div>
  )
}

export function ApiKeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  const hasKey = value.length > 0
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? 'sk-...'}
          className="pl-3 pr-8 py-1.5 rounded-lg text-sm font-mono w-64 focus:outline-none focus:ring-1 focus:ring-white/20"
          style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${hasKey ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)'}`, color: 'rgba(255,255,255,0.85)' }}
        />
        <button type="button" onClick={() => setShow(v => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2"
          style={{ color: 'rgba(255,255,255,0.35)' }}>
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {hasKey && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
    </div>
  )
}
