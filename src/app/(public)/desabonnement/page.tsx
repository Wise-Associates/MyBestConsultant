import { CheckCircle2, AlertCircle } from 'lucide-react'
import { unsubscribeFromOutreach } from './actions'

export const metadata = { title: 'Désabonnement — MyBestConsultant' }

export default async function DesabonnementPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>
}) {
  const { u } = await searchParams
  const result = u ? await unsubscribeFromOutreach(u) : { error: 'Lien invalide.' }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-24" style={{ background: 'var(--color-background)' }}>
      <div className="max-w-md text-center">
        {result.ok ? (
          <>
            <CheckCircle2 className="h-10 w-10 mx-auto mb-4" style={{ color: 'var(--color-accent)' }} />
            <h1 className="text-2xl font-light" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
              Vous êtes désabonné
            </h1>
            <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Vous ne recevrez plus de propositions de missions par email de notre part. Vous pouvez toujours postuler vous-même aux offres depuis votre espace candidat.
            </p>
          </>
        ) : (
          <>
            <AlertCircle className="h-10 w-10 mx-auto mb-4" style={{ color: '#ef4444' }} />
            <h1 className="text-2xl font-light" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
              Lien invalide
            </h1>
            <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {result.error}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
