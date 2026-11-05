import { Skeleton, SkeletonRegion } from '@/components/shared/skeleton'

// Chargement du tableau de bord candidat : la page en gris, même structure que page.tsx (en-tête sombre, chiffres,
// mini-CV, candidatures et colonne du profil) pour que rien ne saute à l'arrivée du contenu.

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }

/** Carte de la colonne de droite : un titre, puis quelques lignes. */
function SideCard({ lines }: { lines: number }) {
  return (
    <div className="p-5 rounded-2xl space-y-3" style={card}>
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-3" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  )
}

export default function Loading() {
  return (
    <SkeletonRegion label="Chargement de votre espace…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Skeleton tone="dark" className="h-3 w-28 mb-2" />
          <Skeleton tone="dark" className="h-8 w-56" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="p-4 rounded-2xl" style={card}>
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-3 w-3/5 max-w-20" />
                <Skeleton className="h-4 w-4 rounded" />
              </div>
              <Skeleton className="h-8 w-10" />
            </div>
          ))}
        </div>

        <div className="rounded-3xl overflow-hidden" style={card}>
          <div className="px-7 pt-7 pb-6" style={{ background: 'var(--hero-bg)' }}>
            <div className="flex items-center gap-4">
              <Skeleton tone="dark" className="w-16 h-16 rounded-full shrink-0" />
              <div className="space-y-2">
                <Skeleton tone="dark" className="h-6 w-44" />
                <Skeleton tone="dark" className="h-4 w-32" />
              </div>
            </div>
          </div>
          <div className="px-7 py-6 space-y-4">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {[20, 16, 24, 18].map((w, i) => <Skeleton key={i} className="h-7 rounded-full" style={{ width: `${w * 4}px` }} />)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-3xl overflow-hidden" style={card}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between gap-4" style={{ borderTop: i ? '1px solid var(--color-border)' : undefined }}>
                <div className="space-y-2 flex-1 min-w-0">
                  <Skeleton className="h-4 w-3/5 sm:w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-3 w-1/3 sm:w-1/5" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="p-5 rounded-2xl space-y-4" style={card}>
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="p-5 rounded-2xl space-y-3" style={card}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
            <SideCard lines={2} />
            <SideCard lines={4} />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}
