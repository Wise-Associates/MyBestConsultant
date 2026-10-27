'use client'

import { useState } from 'react'
import { control, fieldLabel, secondaryButton } from '@/app/admin/candidats/labels'

// Champs des réglages de la veille : listes saisies une valeur par ligne ou séparées par des virgules. Les lignes vides
// et les espaces sont retirés à l'enregistrement (côté serveur, config.ts) : la saisie n'est jamais réécrite en cours
// de frappe.

const hintStyle = { color: 'var(--admin-fg-muted)' }

export function TextField({ id, label, value, onChange, hint, placeholder, mono }: {
  id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; mono?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} style={{ ...fieldLabel, display: 'block' }}>{label}</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined}
        className={mono ? 'font-mono' : undefined} style={{ ...control, width: '100%' }} />
      {hint && <p id={`${id}-hint`} className="text-xs mt-1" style={hintStyle}>{hint}</p>}
    </div>
  )
}

/** Une valeur par ligne (expressions, noms d'acheteur…). */
export function LinesField({ id, label, value, onChange, hint, rows = 4 }: {
  id: string; label: string; value: string[]; onChange: (value: string[]) => void; hint?: string; rows?: number
}) {
  const count = value.filter(v => v.trim()).length
  return (
    <div>
      <label htmlFor={id} style={{ ...fieldLabel, display: 'block' }}>{label} ({count})</label>
      <textarea id={id} value={value.join('\n')} onChange={e => onChange(e.target.value.split('\n'))} rows={rows}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ ...control, width: '100%', height: 'auto', padding: '8px 12px', lineHeight: 1.55, resize: 'vertical' }} />
      {hint && <p id={`${id}-hint`} className="text-xs mt-1" style={hintStyle}>{hint}</p>}
    </div>
  )
}

/** Valeurs courtes séparées par des virgules (SIREN, codes, préfixes CPV, sigles). */
export function TokensField({ id, label, value, onChange, hint, placeholder }: {
  id: string; label: string; value: string[]; onChange: (value: string[]) => void; hint?: string; placeholder?: string
}) {
  return (
    <div>
      <label htmlFor={id} style={{ ...fieldLabel, display: 'block' }}>{label}</label>
      <input id={id} value={value.join(', ')} onChange={e => onChange(e.target.value.split(/[,;\s]+/))} placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined} className="font-mono" style={{ ...control, width: '100%' }} />
      {hint && <p id={`${id}-hint`} className="text-xs mt-1" style={hintStyle}>{hint}</p>}
    </div>
  )
}

export function Switch({ id, label, checked, onChange, description }: {
  id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string
}) {
  return (
    <label htmlFor={id} className="inline-flex items-start gap-2.5 cursor-pointer select-none min-h-6">
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer" style={{ accentColor: '#F97316' }} />
      <span>
        <span className="text-sm text-admin-fg">{label}</span>
        {description && <span className="block text-xs mt-0.5" style={hintStyle}>{description}</span>}
      </span>
    </label>
  )
}

/** Suppression en deux clics : le premier demande confirmation, sans fenêtre du navigateur. */
export function ConfirmDelete({ label, warning, onConfirm, disabledReason }: {
  label: string; warning: string; onConfirm: () => void; disabledReason?: string
}) {
  const [asking, setAsking] = useState(false)
  if (disabledReason) {
    return <span className="text-xs" style={hintStyle} title={disabledReason}>Suppression impossible</span>
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} style={{ ...secondaryButton, padding: '6px 10px', fontSize: 12, color: '#b91c1c' }}>
        {label}
      </button>
    )
  }
  return (
    <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-xs" style={{ color: '#b91c1c' }}>
      {warning}
      <button type="button" onClick={onConfirm} className="font-semibold underline">Confirmer</button>
      <button type="button" onClick={() => setAsking(false)} style={hintStyle} className="underline">Annuler</button>
    </span>
  )
}

/** Identifiant tiré d'un nom (« Agence fictive » → « agence-fictive »), au format des clés d'état du scanner. */
export function toKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '')
}

/** Premier identifiant libre : « base », puis « base-2 », « base-3 »… */
export function freeKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}
