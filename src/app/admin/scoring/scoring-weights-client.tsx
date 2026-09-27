'use client'

import { useState, useTransition } from 'react'
import { Star, Loader2, CheckCircle2 } from 'lucide-react'
import { saveScoringWeights } from './actions'
import type { ScoringWeightsConfig } from './types'

export function ScoringWeightsClient({ initialWeights }: { initialWeights: ScoringWeightsConfig }) {
  const [weights, setWeights] = useState(initialWeights)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function save() {
    setSaved(false)
    startTransition(async () => {
      const res = await saveScoringWeights(weights)
      if (!res.error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    })
  }

  const percent = Math.round(weights.recommendationWeight * 100)

  return (
    <div className="max-w-2xl p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#0B1D51' }}>
          <Star className="h-5 w-5" style={{ color: '#B8860B' }} /> Pondération du score de matching
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a90a8' }}>
          Ajustez le poids des recommandations candidat dans le score de matching IA (screening des candidatures).
        </p>
      </div>

      <div className="p-5 rounded-2xl space-y-4" style={{ background: 'white', border: '1px solid #e5e9f5' }}>
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold" style={{ color: '#3d4566' }}>
            Poids des recommandations
          </label>
          <span className="text-lg font-bold" style={{ color: '#B8860B' }}>{percent}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={percent}
          onChange={e => setWeights({ recommendationWeight: Number(e.target.value) / 100 })}
          className="w-full"
        />
        <p className="text-xs leading-relaxed" style={{ color: '#8a90a8' }}>
          Quand un candidat a au moins une recommandation soumise, son score de matching final est calculé comme :{' '}
          <strong>{100 - percent}%</strong> score IA (CV vs offre) + <strong>{percent}%</strong> note moyenne des
          recommandations (converties sur 100). Les candidats sans recommandation ne sont pas pénalisés — seul le
          score IA est utilisé pour eux.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: '#0B1D51' }}>
          {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…</> : 'Enregistrer'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: '#10b981' }}>
            <CheckCircle2 className="h-4 w-4" /> Enregistré
          </span>
        )}
      </div>
    </div>
  )
}
