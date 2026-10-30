import { Skeleton, SkeletonRegion } from '@/components/shared/skeleton'

// Formes de chargement des pages de l'espace recruteur (loading.tsx des routes) : la page en gris, à la place du voile
// plein écran d'avant. Même structure que les pages (en-tête sombre, cartes, listes, tableaux) pour que rien ne saute à
// l'arrivée du contenu. Le sous-menu de l'espace, dans le layout, reste affiché.

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }

/** En-tête sombre des rubriques (Reporting, Vivier, CV Thèque, Annonces, Équipe, Entretiens…). */
function HeroSkeleton() {
  return (
    <div style={{ background: 'var(--hero-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <Skeleton tone="dark" className="h-3 w-40 mb-5" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Skeleton tone="dark" className="w-12 h-12 rounded-2xl shrink-0" />
            <div className="space-y-2">
              <Skeleton tone="dark" className="h-7 w-48 sm:w-64" />
              <Skeleton tone="dark" className="h-3.5 w-56 sm:w-80" />
            </div>
          </div>
          <Skeleton tone="dark" className="h-10 w-40 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

/** Cartes de chiffres (indicateurs). */
function StatCards({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="p-4 rounded-2xl" style={card}>
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  )
}

/** Liste dans une carte : un titre, puis des lignes (intitulé, détails, pastilles). */
function ListCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-3xl overflow-hidden" style={card}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-28 rounded-lg" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-5 py-4 space-y-2.5" style={{ borderTop: i ? '1px solid var(--color-border)' : undefined }}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1 min-w-0">
              <Skeleton className="h-4 w-3/5 sm:w-2/5" />
              <Skeleton className="h-3 w-1/3 sm:w-1/5" />
            </div>
            <Skeleton className="h-8 w-16 rounded-lg shrink-0" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Barre de recherche et filtres, avec un bouton au bout. */
function FilterBar({ selects, action }: { selects: number; action?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
      <Skeleton className="h-11 sm:h-10 flex-1 min-w-0 sm:min-w-60 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:flex">
        {Array.from({ length: selects }, (_, i) => <Skeleton key={i} className="h-11 sm:h-10 sm:w-40 rounded-xl" />)}
      </div>
      {action && <Skeleton className="h-11 sm:h-10 w-full sm:w-40 sm:ml-auto rounded-xl" />}
    </div>
  )
}

/**
 * Page d'une rubrique : en-tête sombre, puis le contenu le plus proche de la page — liste (vivier, annonces, équipe,
 * entretiens…), chiffres et graphiques (reporting), ou grille de profils (CV Thèque).
 */
export function SectionPageSkeleton({ content = 'list' }: { content?: 'list' | 'stats' | 'grid' }) {
  return (
    <SkeletonRegion label="Chargement de la page…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <HeroSkeleton />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {content === 'list' && <ListCard rows={5} />}
        {content === 'stats' && (
          <>
            <StatCards count={4} />
            <div className="grid lg:grid-cols-2 gap-4">
              {[0, 1].map(i => (
                <div key={i} className="p-5 rounded-3xl space-y-4" style={card}>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-48 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </>
        )}
        {content === 'grid' && (
          <>
            <FilterBar selects={2} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="p-5 rounded-3xl space-y-3" style={card}>
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-11 h-11 rounded-full shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SkeletonRegion>
  )
}

/** Tableau de bord : chiffres, filtres et « Créer une offre », puis « Mes offres ». */
export function DashboardSkeleton() {
  return (
    <SkeletonRegion label="Chargement du tableau de bord…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <StatCards count={4} />
        <FilterBar selects={2} action />
        <ListCard rows={5} />
      </div>
    </SkeletonRegion>
  )
}

const adminCard = { background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }

/** Liste des appels d'offres (page claire .admin-light) : en-tête, compteurs, filtres, tableau. */
export function AoListSkeleton() {
  return (
    <SkeletonRegion label="Chargement des appels d’offres…" className="admin-light min-h-full p-4 sm:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton tone="admin" className="h-3 w-44" />
          <Skeleton tone="admin" className="h-8 w-56" />
          <Skeleton tone="admin" className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="flex gap-3 flex-wrap">
          <Skeleton tone="admin" className="h-10 w-44 rounded-[10px]" />
          <Skeleton tone="admin" className="h-10 w-52 rounded-[10px]" />
          <Skeleton tone="admin" className="h-10 w-44 rounded-[10px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-2xl p-5 space-y-2" style={adminCard}>
            <Skeleton tone="admin" className="h-7 w-12" />
            <Skeleton tone="admin" className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <Skeleton tone="admin" className="h-9.5 flex-1 min-w-60 rounded-[10px]" />
          {[0, 1, 2].map(i => <Skeleton key={i} tone="admin" className="h-9.5 w-40 rounded-[10px]" />)}
        </div>
        <div className="flex gap-3 flex-wrap">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} tone="admin" className="h-9.5 w-36 rounded-[10px]" />)}
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--admin-line)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-line)' }}>
          <Skeleton tone="admin" className="h-4 w-32" />
          <Skeleton tone="admin" className="h-3 w-20" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="px-3 py-3 flex items-center gap-4" style={{ borderBottom: '1px solid var(--admin-line)' }}>
            <Skeleton tone="admin" className="hidden sm:block h-3 w-14" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <Skeleton tone="admin" className="h-3.5 w-3/4 sm:w-1/2" />
              <Skeleton tone="admin" className="h-3 w-1/2 sm:w-1/3" />
            </div>
            <Skeleton tone="admin" className="hidden md:block h-3 w-16" />
            <Skeleton tone="admin" className="hidden sm:block h-5 w-20 rounded-md" />
            <Skeleton tone="admin" className="h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/** Page d'un appel d'offres : barre du haut, titre, suivi de la publication, données extraites. */
export function AoOfferSkeleton() {
  return (
    <SkeletonRegion label="Chargement de l’appel d’offres…" className="admin-light min-h-full px-4 sm:px-8 pb-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="-mx-4 sm:-mx-8 px-4 sm:px-8 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--admin-line)' }}>
          <Skeleton tone="admin" className="h-6 w-20" />
          <div className="flex items-center gap-2">
            <Skeleton tone="admin" className="h-9 w-20 rounded-[10px]" />
            <Skeleton tone="admin" className="hidden sm:block h-3 w-16" />
            <Skeleton tone="admin" className="h-9 w-10 sm:w-28 rounded-[10px]" />
            <Skeleton tone="admin" className="h-9 w-10 sm:w-28 rounded-[10px]" />
          </div>
        </div>
        <div className="space-y-2.5">
          <Skeleton tone="admin" className="h-7 w-4/5 sm:w-1/2" />
          <Skeleton tone="admin" className="h-6 w-32" />
          <Skeleton tone="admin" className="h-3 w-full sm:w-2/3" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl p-4 space-y-3" style={adminCard}>
              <Skeleton tone="admin" className="h-4 w-24" />
              <Skeleton tone="admin" className="h-5 w-3/4" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton tone="admin" className="h-2.5 w-16" />
              <Skeleton tone="admin" className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton tone="admin" className="h-2.5 w-24" />
          <div className="flex flex-wrap gap-1.5">
            {[20, 28, 16, 24, 20].map((w, i) => <Skeleton key={i} tone="admin" className="h-6 rounded-md" style={{ width: `${w * 4}px` }} />)}
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton tone="admin" className="h-2.5 w-24" />
          {[100, 92, 96, 70].map((w, i) => <Skeleton key={i} tone="admin" className="h-3.5" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    </SkeletonRegion>
  )
}
