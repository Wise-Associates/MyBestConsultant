import { Skeleton, SkeletonRegion } from '@/components/shared/skeleton'

// Formes de chargement des pages de l'espace recruteur (loading.tsx des routes) : la page en gris, à la place du voile
// plein écran d'avant. Même structure que les pages (bandeau, cartes, listes, tableaux) pour que rien ne saute à
// l'arrivée du contenu. Le menu de l'espace, dans le layout, reste affiché. `SectionPageSkeleton` sert aussi aux
// pages d'aide de l'espace candidat (src/app/candidate/loading.tsx), qui sont les mêmes que celles du recruteur.

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
// Formes posées sur un bandeau de page : teinte de son texte (--hero-fg, globals.css), donc grises sur le bandeau clair de
// l'espace recruteur (2026-11-13) et blanches translucides sur le bandeau sombre des pages d'aide candidat.
const onHero = { background: 'color-mix(in srgb, var(--hero-fg) 11%, transparent)' }

/** Bandeau des rubriques (Reporting, Vivier, Annonces, Équipe, Entretiens…), clair dans l'espace recruteur. */
function HeroSkeleton() {
  return (
    <div style={{ background: 'var(--hero-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <Skeleton style={onHero} className="h-3 w-40 mb-5" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Skeleton style={onHero} className="w-12 h-12 rounded-2xl shrink-0" />
            <div className="space-y-2">
              <Skeleton style={onHero} className="h-7 w-48 sm:w-64" />
              <Skeleton style={onHero} className="h-3.5 w-56 sm:w-80" />
            </div>
          </div>
          <Skeleton style={onHero} className="h-10 w-40 rounded-xl" />
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
 * Page d'une rubrique : bandeau, puis le contenu le plus proche de la page — liste (vivier, annonces, équipe,
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
/** Tableau de bord : indicateurs séparés par un filet, tuiles « À traiter », puis « Mes offres ». */
export function DashboardSkeleton() {
  // Même mise en page que la page : rail de filtres à partir de 1440 px, panneau d'aperçu à partir de 1800 px
  // (src/app/recruiter/dashboard/dashboard-layout.ts).
  return (
    <SkeletonRegion label="Chargement du tableau de bord…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="max-w-6xl min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 sm:py-8 min-[90rem]:py-6 flex flex-col gap-6 sm:gap-7 min-[90rem]:grid min-[90rem]:grid-cols-[248px_minmax(0,1fr)] min-[112.5rem]:grid-cols-[248px_minmax(0,1fr)_340px] min-[90rem]:gap-6 min-[90rem]:items-start">
        <div className="hidden min-[90rem]:flex flex-col gap-3.5">
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="rounded-[20px] p-3.5 space-y-2" style={card}>
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
          <div className="rounded-[20px] p-3.5 space-y-2" style={card}>
            <Skeleton className="h-3 w-16" />
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
        <div className="min-w-0 flex flex-col gap-6 sm:gap-7 min-[90rem]:gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-[20px] overflow-hidden" style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="px-4 py-4 sm:px-6 sm:py-5 min-[90rem]:px-5 min-[90rem]:py-3.5 space-y-2.5" style={{ background: 'var(--color-surface)' }}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
            ))}
          </div>
          <div className="space-y-3 min-[90rem]:hidden">
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-2.5 overflow-hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex-none w-57.5 sm:w-auto flex items-center gap-3.5 px-4 py-3.5 rounded-2xl" style={card}>
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[20px] overflow-hidden" style={card}>
            <div className="px-4 sm:px-6 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
              <Skeleton className="h-5 w-36" />
              <div className="flex gap-2.5 w-full sm:w-auto">
                <Skeleton className="h-10 w-36 rounded-[10px]" />
                <Skeleton className="h-10 flex-1 sm:flex-none sm:w-40 rounded-xl" />
              </div>
            </div>
            <div className="px-4 sm:px-6 pb-4 flex flex-col sm:flex-row gap-2.5 min-[90rem]:hidden">
              <Skeleton className="h-11 sm:h-10 flex-1 rounded-xl" />
              <Skeleton className="h-11 sm:h-10 sm:w-64 rounded-xl" />
              <Skeleton className="h-11 sm:h-10 sm:w-80 rounded-xl" />
            </div>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="px-4 sm:px-6 py-4 min-[90rem]:px-5 min-[90rem]:py-2.5 grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_124px_200px_180px_88px] min-[90rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_88px] min-[112.5rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_132px] gap-x-5 gap-y-4 items-center" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="col-span-2 lg:col-span-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-1.5 w-full rounded-full" />
                <Skeleton className="hidden lg:block h-8 w-36" />
                <Skeleton className="hidden lg:block h-8 w-20 justify-self-end" />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden min-[112.5rem]:flex flex-col gap-3.5">
          <div className="rounded-[20px] p-5 space-y-3" style={card}>
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-16 w-full rounded-xl" />
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-3 w-full" />)}
          </div>
          <div className="rounded-[20px] p-5 space-y-3" style={card}>
            <Skeleton className="h-3 w-28" />
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        </div>
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

/**
 * Bandeau du Pipeline et du Matching IA d'une offre : retour, surtitre, titre, ligne de l'offre, puis à partir de
 * 1440 px les onglets « Matching IA / Pipeline ». Le Pipeline a un bandeau réduit (sans surtitre au-delà de 1440 px).
 */
function JobHeroSkeleton({ narrow, compact }: { narrow: string; compact?: boolean }) {
  return (
    <div style={{ background: 'var(--hero-bg)' }}>
      <div className={`${narrow} min-[90rem]:max-w-[1920px] mx-auto px-6 min-[90rem]:px-8 ${compact ? 'py-4 min-[90rem]:py-3' : 'py-6 min-[90rem]:py-4'}`}>
        <Skeleton style={onHero} className="h-3 w-36 mb-3 min-[90rem]:mb-2" />
        <div className="flex items-center justify-between gap-4 flex-wrap min-[90rem]:flex-nowrap">
          <div className="space-y-2 min-w-0">
            <Skeleton style={onHero} className={`h-3 w-28 ${compact ? 'min-[90rem]:hidden' : ''}`} />
            <Skeleton style={onHero} className="h-7 w-64 sm:w-md min-[90rem]:w-xl max-w-full" />
            <Skeleton style={onHero} className="h-3 w-56 min-[90rem]:w-72" />
          </div>
          <Skeleton style={onHero} className="hidden min-[90rem]:block h-10 w-54 rounded-xl shrink-0 mr-auto" />
          <div className="flex gap-2">
            <Skeleton style={onHero} className="h-8 w-28 rounded-lg" />
            <Skeleton style={onHero} className="h-8 w-36 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Carte du rail de gauche : titre, puis des lignes de filtre. */
function RailCardSkeleton({ lines, chart }: { lines: number; chart?: boolean }) {
  return (
    <div className="rounded-[20px] p-3.5 space-y-3" style={card}>
      <Skeleton className="h-3 w-20" />
      {chart && (
        <div className="flex items-end gap-1 h-12">
          {[10, 18, 30, 55, 80, 100, 70, 40].map((h, i) => <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />)}
        </div>
      )}
      {Array.from({ length: lines }, (_, j) => (
        <div key={j} className="flex items-center justify-between gap-3 py-1">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-5" />
        </div>
      ))}
    </div>
  )
}

/** Grille du tableau du Matching IA : mêmes largeurs que ses colonnes (matching-client.tsx). */
const MATCHING_ROW = 'grid items-center grid-cols-[52px_minmax(0,1fr)_140px_124px_118px_64px] min-[112.5rem]:grid-cols-[52px_minmax(0,1fr)_150px_124px_118px_minmax(0,1fr)_64px]'

/** Matching IA d'une offre : cartes de candidats (moins de 1440 px) ; rail, tableau dense et panneau au-delà. */
export function MatchingSkeleton() {
  return (
    <SkeletonRegion label="Chargement du matching…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <JobHeroSkeleton narrow="max-w-[1000px]" />
      <div className="max-w-[1000px] min-[90rem]:max-w-[1920px] mx-auto px-6 min-[90rem]:px-8 py-8 min-[90rem]:py-5 min-[90rem]:grid min-[90rem]:grid-cols-[240px_minmax(0,1fr)_320px] min-[112.5rem]:grid-cols-[264px_minmax(0,1fr)_360px] min-[90rem]:gap-5 min-[90rem]:items-start">
        <div className="hidden min-[90rem]:flex flex-col gap-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <RailCardSkeleton lines={4} />
          <RailCardSkeleton lines={3} chart />
          <RailCardSkeleton lines={2} />
        </div>
        <div className="min-w-0">
          {/* Moins de 1440 px : texte, guide du score, filtres, cartes. */}
          <div className="min-[90rem]:hidden space-y-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Skeleton className="h-10 flex-1 rounded-xl" />
              <Skeleton className="h-10 sm:w-72 rounded-xl" />
              <Skeleton className="h-10 sm:w-44 rounded-xl" />
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="p-4 rounded-2xl space-y-3" style={card}>
                <div className="flex items-center gap-3">
                  <Skeleton className="w-5 h-5 rounded shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-10 w-14 rounded-xl shrink-0" />
                </div>
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
          {/* À partir de 1440 px : tableau (sélection, candidat, type, score, critères, raison dès 1800 px, CV). */}
          <div className="hidden min-[90rem]:block rounded-2xl overflow-hidden" style={card}>
            <div className={`${MATCHING_ROW} h-9`} style={{ background: 'color-mix(in srgb, var(--color-text) 2%, transparent)', borderBottom: '1px solid var(--color-border)' }}>
              <span />
              <Skeleton className="h-3 w-16 mx-3" />
              <Skeleton className="h-3 w-10 mx-3" />
              <Skeleton className="h-3 w-12 mx-3" />
              <Skeleton className="h-3 w-14 mx-3" />
              <Skeleton className="hidden min-[112.5rem]:block h-3 w-16 mx-3" />
              <span />
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className={`${MATCHING_ROW} h-[62px]`} style={{ borderTop: i ? '1px solid var(--color-border)' : undefined }}>
                <Skeleton className="w-4.5 h-4.5 rounded ml-4" />
                <div className="space-y-2 px-3">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
                <Skeleton className="h-5 w-24 rounded-full mx-3" />
                <div className="flex items-center gap-2 px-3">
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-1.5 flex-1 rounded-full" />
                </div>
                <div className="flex gap-1 px-3">
                  {Array.from({ length: 5 }, (_, j) => <Skeleton key={j} className="h-2 flex-1 rounded-sm" />)}
                </div>
                <Skeleton className="hidden min-[112.5rem]:block h-3 mx-3" />
                <Skeleton className="h-3.5 w-8 justify-self-end mr-4" />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden min-[90rem]:flex flex-col gap-3">
          <div className="rounded-[20px] p-4 space-y-3.5" style={card}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-9 w-32" />
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3.5 w-9" />
              </div>
            ))}
            <div className="space-y-2 pt-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Skeleton className="h-11 rounded-xl" />
              <Skeleton className="h-11 rounded-xl" />
            </div>
          </div>
          <div className="rounded-[20px] p-4 space-y-2" style={{ background: 'var(--hero-bg)' }}>
            <Skeleton style={onHero} className="h-3 w-full" />
            <Skeleton style={onHero} className="h-3 w-3/5" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** Pipeline d'une offre : colonnes de cartes repliées ; rail à partir de 1440 px, panneau de la carte à partir de 1800 px. */
export function PipelineSkeleton() {
  const columns = [3, 2, 0, 1, 2]
  return (
    <SkeletonRegion label="Chargement du pipeline…" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <JobHeroSkeleton narrow="max-w-[1400px]" compact />
      <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-6 min-[90rem]:px-8 py-8 min-[90rem]:py-5 min-[90rem]:grid min-[90rem]:grid-cols-[256px_minmax(0,1fr)] min-[112.5rem]:grid-cols-[256px_minmax(0,1fr)_340px] min-[90rem]:gap-5 min-[90rem]:items-start">
        <div className="hidden min-[90rem]:flex flex-col gap-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <RailCardSkeleton lines={3} />
          <RailCardSkeleton lines={2} />
          <RailCardSkeleton lines={3} />
        </div>
        <div className="min-w-0 flex gap-4 min-[90rem]:gap-3 overflow-hidden">
          {columns.map((cards, i) => cards === 0 ? (
            // Phase vide : bande étroite à partir de 1440 px, colonne vide en dessous.
            <div key={i} className="flex-none w-[300px] min-[90rem]:w-9 h-80 rounded-2xl"
              style={{ border: '1px dashed var(--color-border)', background: 'color-mix(in srgb, var(--color-text) 2%, transparent)' }} />
          ) : (
            <div key={i} className="flex-none w-[300px] min-[90rem]:w-[232px] rounded-2xl p-3 space-y-2.5"
              style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2 pb-1">
                <Skeleton className="w-2.5 h-2.5 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-4 w-5 rounded-full" />
                <Skeleton className="h-3 w-12 ml-auto" />
              </div>
              {Array.from({ length: cards }, (_, j) => (
                <div key={j} className="rounded-2xl p-3.5 space-y-2.5" style={card}>
                  <div className="flex items-start gap-2">
                    <Skeleton className="w-7 h-7 rounded-full shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="w-3.5 h-3.5 rounded shrink-0" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="hidden min-[112.5rem]:block rounded-[20px] p-4 space-y-2.5" style={card}>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * CV Thèque (refonte du 2026-11-13) : ligne de titre, barre de recherche, filtres à gauche dès 1024 px, profils à droite.
 */
export function CvthequeSkeleton() {
  return (
    <SkeletonRegion label="Chargement de la CV Thèque">
      <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-3 h-16 px-4 sm:px-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-32" />
          <span className="flex-1" />
          <Skeleton className="h-9 w-44 rounded-xl" />
        </div>
        <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="hidden lg:block px-5 py-5 space-y-6" style={{ borderRight: '1px solid var(--color-border)' }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
          <div>
            <div className="px-4 sm:px-6 py-4"><Skeleton className="h-11 w-full rounded-xl" /></div>
            <div className="px-4 sm:px-6 py-5 space-y-4">
              <Skeleton className="h-4 w-56" />
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="rounded-3xl p-6 flex gap-4" style={card}>
                  <Skeleton className="w-14 h-14 shrink-0" style={{ borderRadius: '9999px' }} />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-64" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

// ── Pages du bas du menu : Utilisateurs, Abonnement, Organisation (ADR 0033) ─────────────────────────────────────
// Même structure que les pages : ligne de titre, puis le contenu centré (deux cartes côte à côte dès 1024 px pour
// l'abonnement et l'organisation). À changer avec elles.

const line = '1px solid var(--color-border)'

/** Ligne de titre des pages de compte : icône, titre, bouton à droite (« Inviter un utilisateur »). */
function AccountHeaderSkeleton({ action }: { action?: boolean }) {
  return (
    <div className="flex items-center gap-3 min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: line }}>
      <Skeleton className="h-5 w-5 rounded shrink-0" />
      <Skeleton className="h-5 w-32" />
      <span className="flex-1" />
      {action && <Skeleton className="h-10 w-44 rounded-xl" />}
    </div>
  )
}

const accountPage = { minHeight: 'calc(100vh - 68px)', background: 'var(--color-surface)' }

export function UsersSkeleton() {
  return (
    <SkeletonRegion label="Chargement des utilisateurs" style={accountPage}>
      <AccountHeaderSkeleton action />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-2xl p-4 flex items-center gap-3" style={card}>
              <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-5 w-8" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="flex items-center gap-2 flex-wrap px-4 py-3" style={{ borderBottom: line }}>
            <Skeleton className="h-10 flex-1 min-w-[14rem] rounded-lg" />
            <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
            <Skeleton className="h-10 w-36 rounded-lg" />
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 flex-wrap px-4 py-3.5" style={i > 0 ? { borderTop: line } : undefined}>
              {/* Cercle forcé en style : la classe rounded-md de Skeleton l'emporte sur rounded-full. */}
              <Skeleton className="w-9 h-9 shrink-0" style={{ borderRadius: '9999px' }} />
              <div className="flex-1 min-w-[10rem] space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
              <Skeleton className="h-7 w-28 rounded-lg" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="hidden md:block h-8 w-56 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  )
}

export function SubscriptionSkeleton() {
  return (
    <SkeletonRegion label="Chargement de l’abonnement" style={accountPage}>
      <AccountHeaderSkeleton />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid gap-5 lg:grid-cols-2 items-start">
        <div className="rounded-2xl p-5 sm:p-6 space-y-5" style={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-40 max-w-full" /></div>
            ))}
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl p-5 sm:p-6 space-y-4" style={card}>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-60 max-w-full rounded-lg" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

export function OrganisationSkeleton() {
  return (
    <SkeletonRegion label="Chargement de l’organisation" style={accountPage}>
      <AccountHeaderSkeleton />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid gap-5 lg:grid-cols-2 items-start">
        <div className="rounded-2xl p-5 sm:p-6" style={card}>
          <div className="flex items-center gap-4 mb-5">
            <Skeleton className="w-14 h-14 rounded-xl shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-32 max-w-full" /></div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-5 sm:p-6 space-y-4" style={card}>
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="space-y-1.5"><Skeleton className="h-3 w-40" /><Skeleton className="h-10 w-full rounded-lg" /></div>
          <div className="flex items-center gap-3">
            <Skeleton className="w-14 h-14 rounded-xl shrink-0" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
