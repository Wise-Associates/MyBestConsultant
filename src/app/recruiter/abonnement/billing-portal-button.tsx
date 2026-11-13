'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { openBillingPortalAction } from './actions'

/** « Factures et moyen de paiement » : ouvre le portail Stripe de l'organisation (propriétaire seulement). */
export function BillingPortalButton() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Retour depuis Stripe par le bouton « Précédent » : la page revient du cache du navigateur, bouton encore en attente.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setPending(false) }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  async function open() {
    setPending(true)
    setError(null)
    try {
      const res = await openBillingPortalAction()
      if (res.url) {
        window.location.assign(res.url)
        return
      }
      setError(res.error ?? 'Portail de facturation indisponible.')
    } catch {
      setError('Le serveur ne répond pas : vérifiez votre connexion puis réessayez.')
    }
    setPending(false)
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={open} disabled={pending}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-50"
        style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ExternalLink className="h-4 w-4" aria-hidden />}
        Factures et moyen de paiement
      </button>
      {error && <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
    </div>
  )
}
