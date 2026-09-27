'use client'

import { useState, useTransition } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { retryInterviewAnalysis } from '../actions'

export function RetryAnalysisButton({ sessionId }: { sessionId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function retry() {
    setError('')
    startTransition(async () => {
      const res = await retryInterviewAnalysis(sessionId)
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="flex flex-col items-center gap-2 mt-4">
      <button onClick={retry} disabled={isPending}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
        style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {isPending ? 'Analyse en cours…' : "Lancer l'analyse IA"}
      </button>
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  )
}
