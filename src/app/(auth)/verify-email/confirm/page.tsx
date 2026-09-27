'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import { confirmVerificationAction } from '../actions'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending')
  const [error, setError] = useState('')

  useEffect(() => {
    const userId = searchParams.get('userId') ?? ''
    const secret = searchParams.get('secret') ?? ''
    confirmVerificationAction(userId, secret).then(result => {
      if (result.error) { setError(result.error); setStatus('error') }
      else setStatus('ok')
    })
  }, [searchParams])

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12"
      style={{ background: 'var(--color-background)' }}>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <div className="px-8 py-8 text-center space-y-4">
            {status === 'pending' && (
              <>
                <Loader2 className="h-8 w-8 animate-spin mx-auto" style={{ color: '#B8860B' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Vérification en cours…</p>
              </>
            )}
            {status === 'ok' && (
              <>
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                  style={{ background: 'rgba(16,185,129,0.1)' }}>
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Email vérifié avec succès !</p>
                <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold"
                  style={{ color: '#B8860B' }}>
                  <ArrowLeft className="h-4 w-4" /> Se connecter
                </Link>
              </>
            )}
            {status === 'error' && (
              <>
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                  style={{ background: 'rgba(239,68,68,0.1)' }}>
                  <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{error}</p>
                <Link href="/verify-email" className="inline-flex items-center gap-2 text-sm font-semibold"
                  style={{ color: '#B8860B' }}>
                  <ArrowLeft className="h-4 w-4" /> Redemander un email
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ConfirmVerificationPage() {
  return (
    <Suspense>
      <ConfirmContent />
    </Suspense>
  )
}
