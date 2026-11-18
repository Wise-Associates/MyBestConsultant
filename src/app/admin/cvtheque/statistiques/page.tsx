import { redirect } from 'next/navigation'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { listAllDocuments } from '@/lib/appwrite/list-all'
import { loadCvStats } from '@/lib/search/cv-stats-store'
import type { StatsScope } from '@/lib/search/cv-stats'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ADMIN_STATS_VARS, CvStatsBody, ScopeTabs } from '@/components/stats/cv-stats-sections'

// Statistiques des CV de la plateforme pour l'admin (ADR 0044, phase 3) : toute la plateforme, la base candidats, les
// profils des chasseurs, les viviers de toutes les organisations, ou ceux d'une organisation (?perimetre=organisation
// &organisation=<id>, choisie dans la liste des organisations). Mêmes comptes et même affichage que la page des
// recruteurs (src/components/stats/cv-stats-sections.tsx) ; aucun nom. Ces périmètres ne sont construits qu'ici,
// après la vérification du rôle d'admin (le layout la fait aussi).

const PAGE = '/admin/cvtheque/statistiques'
const SCOPES = [
  { key: 'plateforme', label: 'Toute la plateforme', name: 'toute la plateforme', scope: { kind: 'platform' } },
  { key: 'base', label: 'Base candidats', name: 'la base candidats', scope: { kind: 'pool' } },
  { key: 'chasseurs', label: 'Profils de chasseurs', name: 'les profils des chasseurs', scope: { kind: 'hunters' } },
  { key: 'viviers', label: 'Viviers', name: 'les viviers de toutes les organisations', scope: { kind: 'viviers' } },
  { key: 'organisation', label: 'Une organisation', name: '', scope: null },
] as const satisfies readonly { key: string; label: string; name: string; scope: StatsScope | null }[]

/** Organisations, par nom ; illisibles : liste vide et message (le reste de la page marche). */
async function organisations(): Promise<{ id: string; name: string }[] | null> {
  try {
    const { databases } = createAdminClient()
    const docs = await listAllDocuments(databases, DB_ID, COLLECTIONS.TENANTS, [Query.select(['$id', 'name'])])
    return docs.map(d => ({ id: d.$id, name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : d.$id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  } catch (err) {
    console.error('[statistiques] organisations illisibles', err instanceof Error ? err.message : err)
    return null
  }
}

export default async function AdminCvStatisticsPage({ searchParams }: { searchParams: Promise<{ perimetre?: string | string[]; organisation?: string | string[] }> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') redirect('/login')
  const { perimetre, organisation } = await searchParams
  const current = SCOPES.find(s => s.key === perimetre) ?? SCOPES[0]
  const perOrganisation = current.key === 'organisation'
  const orgs = perOrganisation ? await organisations() : []
  // Seule une organisation de la liste est acceptée : l'identifiant de l'adresse ne choisit rien d'autre.
  const chosen = perOrganisation && typeof organisation === 'string' ? orgs?.find(o => o.id === organisation) ?? null : null
  const scope: StatsScope | null = chosen ? { kind: 'tenant', tenantId: chosen.id } : current.scope
  const result = scope ? await loadCvStats(scope) : null

  return (
    <div className="admin-light min-h-full" style={{ ...ADMIN_STATS_VARS, background: 'var(--admin-bg)' }}>
      <AdminPageHeader title="CV Thèque · Statistiques" description="Ce que contiennent les CV classés, sans nom ni coordonnées"
        back={{ href: '/admin/cvtheque', label: 'CV Thèque' }} />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ScopeTabs items={SCOPES.map(s => ({
            key: s.key, label: s.label, current: s === current,
            href: s === SCOPES[0] ? PAGE : `${PAGE}?perimetre=${s.key}`,
          }))} />
          {perOrganisation && orgs && orgs.length > 0 && (
            // Formulaire GET : la page se recharge avec l'organisation choisie, sans code dans le navigateur.
            <form method="get" action={PAGE} className="flex items-center gap-2">
              <input type="hidden" name="perimetre" value="organisation" />
              <label htmlFor="stats-org" className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Organisation</label>
              <select id="stats-org" name="organisation" defaultValue={chosen?.id ?? ''} required
                className="h-10 px-3 rounded-[10px] text-[13px] max-w-[min(20rem,60vw)] focus-visible:outline-2 focus-visible:outline-(--color-text)"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="" disabled>Choisir…</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button type="submit" className="h-10 px-3.5 rounded-[10px] text-[13px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }}>
                Afficher
              </button>
            </form>
          )}
        </div>
        {perOrganisation && orgs === null && (
          <p role="alert" className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Liste des organisations illisible pour le moment : rechargez la page.</p>
        )}
        {perOrganisation && orgs !== null && !chosen && (
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            {orgs.length === 0 ? 'Aucune organisation pour le moment.' : 'Choisissez une organisation : statistiques des CV de ses viviers, tous ses recruteurs réunis.'}
          </p>
        )}
        {result && (
          <CvStatsBody result={result} scopeName={chosen ? `les viviers de ${chosen.name}` : current.name}
            offMessage="Index de recherche non configuré : MEILI_URL et MEILI_API_KEY, npm run cv:classify, puis la synchronisation de l'index sur le serveur (mbc-cron.sh search-sync ; docs/deploiement-vps.md, « Index de recherche des CV »)." />
        )}
      </main>
    </div>
  )
}
