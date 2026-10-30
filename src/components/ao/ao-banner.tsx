import { AlertCircle, CheckCircle2, X } from 'lucide-react'

/** Message de la section AO (tableau, page d'une offre) : succès en vert, erreur en rouge ; fermable si `onClose`. */
export function Banner({ tone, text, onClose }: { tone: 'ok' | 'error'; text: string; onClose?: () => void }) {
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
