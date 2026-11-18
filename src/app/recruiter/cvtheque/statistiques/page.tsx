import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, FolderSearch } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { loadCvStats } from '@/lib/search/cv-stats-store'
import type { StatsScope } from '@/lib/search/cv-stats'
import { CvStatsBody, ScopeTabs } from '@/components/stats/cv-stats-sections'

// « CV Thèque · Statistiques » (ADR 0044, phase 3) : ce que contiennent les CV classés — familles de métiers, métiers,
// compétences, séniorité, secteurs, langues, villes, niveau d'études, fraîcheur et tendances (dates de dépôt des CV) —
// pour la base candidats (la même pour tous) ou le vivier personnel du recruteur (?perimetre=vivier). Comptes de l'index
// de recherche, sans appel d'IA ; aucun nom. Affichage partagé avec l'admin : src/components/stats/cv-stats-sections.tsx.

export default async function CvStatisticsPage({ searchParams }: { searchParams: Promise<{ perimetre?: string | string[] }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')
  const { perimetre } = await searchParams
  // Vivier : celui du recruteur connecté (organisation et profil de la session), jamais un autre.
  const vivier = perimetre === 'vivier' && !!user.tenantId
  const scope: StatsScope = vivier ? { kind: 'vivier', tenantId: user.tenantId!, ownerId: user.$id } : { kind: 'pool' }
  const result = await loadCvStats(scope)
  const scopeName = vivier ? 'votre vivier' : 'la base candidats'

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-background)' }}>
      <header className="flex items-center gap-3 flex-wrap min-h-16 px-4 sm:px-6 py-3" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <Link href="/recruiter/cvtheque" className="inline-flex items-center justify-center h-9 w-9 -ml-1.5 rounded-lg no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-(--color-text)"
          style={{ color: 'var(--color-text-muted)' }} aria-label="Retour à la CV Thèque" title="Retour à la CV Thèque">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <FolderSearch className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>CV Thèque · Statistiques</h1>
        <span className="flex-1" />
        <ScopeTabs items={[
          { key: 'pool', label: 'Base candidats', href: '/recruiter/cvtheque/statistiques', current: !vivier },
          ...(user.tenantId ? [{ key: 'vivier', label: 'Mon vivier', href: '/recruiter/cvtheque/statistiques?perimetre=vivier', current: vivier }] : []),
        ]} />
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <CvStatsBody result={result} scopeName={scopeName} emptyHint={vivier ? 'Importez des CV dans votre vivier pour les voir ici.' : undefined} />
      </main>
    </div>
  )
}
