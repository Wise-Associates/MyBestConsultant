import Link from 'next/link'
import { Query } from 'node-appwrite'
import { requireAdmin } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { listAllByValues } from '@/lib/appwrite/list-all'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { LLM_USAGE_RETENTION_DAYS, USAGE_READ_CAP, isLlmUsageConfigured, loadUsageRows } from '@/lib/ai/usage-store'
import { USAGE_PERIODS, periodStart, summarizeUsage, usagePeriodOf, type UsagePeriod, type UsageSummary } from '@/lib/ai/usage-stats'
import { UsageView } from './usage-view'

// Consommation de l'IA (ADR 0064) : appels aux modèles, jetons, coût estimé, échecs, par fonction, modèle et organisation,
// lus dans la collection llm_usage (90 jours gardés). Aucune donnée de personne : fonction, organisation, modèle, nombres.
export const dynamic = 'force-dynamic'

const NOT_CONFIGURED = 'Collection absente : créez llm_usage (npm run schema:push -- dev) puis définissez APPWRITE_COLLECTION_LLM_USAGE. '
  + 'En attendant, chaque appel est écrit dans les journaux du serveur (lignes « [llm-usage] »).'

/** Noms des organisations présentes dans la période ; une organisation illisible garde son identifiant. */
async function tenantNames(ids: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = { '': 'Sans organisation (candidats, visiteurs)', admin: 'Plateforme' }
  const wanted = ids.filter(id => id && id !== 'admin')
  if (wanted.length === 0) return names
  try {
    const { databases } = createAdminClient()
    const docs = await listAllByValues(databases, DB_ID, COLLECTIONS.TENANTS, '$id', wanted, [Query.select(['$id', 'name'])])
    for (const d of docs) names[d.$id] = String(d.name ?? d.$id)
  } catch (err) {
    console.error('[llm-usage] noms des organisations illisibles', err instanceof Error ? err.message : String(err))
  }
  return names
}

export default async function IaConsommationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const period: UsagePeriod = usagePeriodOf((await searchParams).jours)
  const now = new Date()
  const start = periodStart(period, now)

  let summary: UsageSummary | null = null
  let capped = false
  let error = ''
  let names: Record<string, string> = {}
  if (!(await isLlmUsageConfigured())) {
    error = NOT_CONFIGURED
  } else {
    try {
      const loaded = await loadUsageRows(start)
      capped = loaded.capped
      summary = summarizeUsage(loaded.rows, start, now)
      names = await tenantNames(summary.byTenant.map(g => g.key))
    } catch (err) {
      console.error('[llm-usage] lignes illisibles', err instanceof Error ? err.message : String(err))
      error = 'Consommation illisible pour le moment : rechargez la page dans quelques instants.'
    }
  }

  return (
    <div className="min-h-full p-4 md:p-8 space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>
      <AdminPageHeader title="Consommation IA"
        description={`Appels aux modèles d’IA, jetons et coût estimé — ${period} derniers jours (${LLM_USAGE_RETENTION_DAYS} jours gardés)`} />

      <nav aria-label="Période" className="flex flex-wrap gap-2">
        {USAGE_PERIODS.map(p => (
          <Link key={p} href={`/admin/ia-consommation?jours=${p}`} aria-current={p === period ? 'page' : undefined}
            className="px-3 py-1.5 rounded-lg text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={p === period
              ? { background: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }
              : { color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {p} jours
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="rounded-2xl p-5 text-sm" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {error}
        </p>
      ) : summary && (
        <UsageView summary={summary} names={names} capped={capped} cap={USAGE_READ_CAP} />
      )}
    </div>
  )
}
