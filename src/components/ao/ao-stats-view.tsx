import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { AoOfferRow } from '@/lib/ao/filters'
import { SENIORITY_LABEL, SENIORITY_ORDER, cityName, lastTwelveMonths, offersOverTime, seniorityOf, tjmSummary, topCounts } from '@/lib/ao/stats'
import { periodLabel, type StatsPeriod } from '@/lib/ao/stats-filters'
import { BarList, ChartCard, StatTile, TimeBars } from './stats-charts'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

// Statistiques des offres AO d'un espace (même périmètre que son tableau) : offres reçues dans le temps, séniorité,
// assistance technique ou forfait, compétences, technologies, TJM, clients, villes. Pages : /admin/candidats/statistiques
// (plateforme : période et sites sources choisis, `rows` déjà filtrées), /recruiter/parametres/boites-ao/statistiques
// (organisation du recruteur : 12 derniers mois).

interface Props {
  rows: AoOfferRow[]
  loadError: string
  back: { href: string; label: string }
  /** Boîtes lues, à la suite de « boîtes » : « de la plateforme », « de votre organisation ». */
  scope: string
  now: Date
  /** Espace admin : retour, titre et sous-titre dans la barre du haut du layout (AdminPageHeader). */
  titleInAdminBar?: boolean
  /** Période choisie (plateforme) ; absente : les 12 derniers mois. */
  period?: StatsPeriod
  /** Filtres de la page, sous le titre. */
  toolbar?: React.ReactNode
  /** Phrase sous le titre, à la place de celle qui compte les offres des boîtes. */
  summary?: string
  /** Sections propres à l'espace, sous les chiffres (plateforme : offres et état de chaque site source). */
  children?: React.ReactNode
}

export function AoStatsView({ rows, loadError, back, scope, now, titleInAdminBar, period, toolbar, summary, children }: Props) {
  const { grain, buckets } = offersOverTime(rows, period ?? lastTwelveMonths(now))
  const received = buckets.reduce((sum, b) => sum + b.published + b.to_review + b.ignored, 0)
  const published = rows.filter(r => r.status === 'published').length
  const tjm = tjmSummary(rows.map(r => r.salary))
  const engagement = [
    { label: 'Assistance technique', count: rows.filter(r => r.engagement === 'assistance').length },
    { label: 'Forfait', count: rows.filter(r => r.engagement === 'forfait').length },
    { label: 'Non précisé', count: rows.filter(r => !r.engagement).length },
  ]
  const seniority = SENIORITY_ORDER.map(key => ({ label: SENIORITY_LABEL[key], count: rows.filter(r => seniorityOf(r.experience) === key).length }))
  const title = "Statistiques des appels d'offres"
  const description = summary ?? `${rows.length} offre${rows.length > 1 ? 's' : ''} reçue${rows.length > 1 ? 's' : ''} dans les boîtes ${scope} (conservées 365 jours). Doublons fusionnés : une offre reçue plusieurs fois compte une fois.`
  const overTime = { day: 'par jour', week: 'par semaine', month: 'par mois' }[grain]

  return (
    <div className="admin-light min-h-full p-4 sm:p-8 space-y-6">
      {titleInAdminBar ? (
        <AdminPageHeader title={title} description={description} back={back} />
      ) : (
        <div>
          <Link href={back.href} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--admin-fg-muted)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> {back.label}
          </Link>
          <h1 className="font-bold mt-2" style={{ color: 'var(--admin-fg)', fontSize: '1.5rem' }}>{title}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--admin-fg-muted)' }}>{description}</p>
        </div>
      )}

      {toolbar}

      {loadError ? (
        <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{loadError}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label={period ? 'Offres reçues' : 'Offres reçues (12 mois)'} value={String(received)} hint={period ? periodLabel(period) : undefined} />
            <StatTile label="Publiées" value={String(published)} hint={rows.length ? `${Math.round((published / rows.length) * 100)} % des offres` : undefined} />
            <StatTile label="TJM médian" value={tjm.median ? `${tjm.median} €` : '—'} hint={tjm.count ? `sur ${tjm.count} offre${tjm.count > 1 ? 's' : ''} avec TJM` : 'aucun TJM indiqué'} />
            <StatTile label="Assistance technique / Forfait" value={`${engagement[0].count} / ${engagement[1].count}`} hint={`${engagement[2].count} non précisé${engagement[2].count > 1 ? 's' : ''}`} />
          </div>

          {children}

          <ChartCard title={`Offres reçues ${overTime}`} note={period ? `Reçues ${periodLabel(period)}, par statut actuel.` : '12 derniers mois, par statut actuel.'}>
            <TimeBars grain={grain} buckets={buckets} />
          </ChartCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Séniorité demandée" note="D'après l'expérience indiquée dans l'offre.">
              <BarList items={seniority} />
            </ChartCard>
            <ChartCard title="Assistance technique ou forfait">
              <BarList items={engagement} />
            </ChartCard>
            <ChartCard title="Compétences les plus demandées" note="10 premières.">
              <BarList items={topCounts(rows.flatMap(r => r.skills), 10)} />
            </ChartCard>
            <ChartCard title="Technologies les plus demandées" note="10 premières (offres reçues depuis leur ajout).">
              <BarList items={topCounts(rows.flatMap(r => r.technologies), 10)} />
            </ChartCard>
            <ChartCard title="TJM proposés" note={tjm.median ? `Médiane : ${tjm.median} € par jour. Salaires annuels exclus.` : 'Salaires annuels exclus.'}>
              <BarList items={tjm.ranges} />
            </ChartCard>
            <ChartCard title="Clients" note="10 premiers (entreprise de l'expéditeur d'origine).">
              <BarList items={topCounts(rows.map(r => r.companyName), 10)} empty="Aucun client identifié." />
            </ChartCard>
            <ChartCard title="Villes" note="10 premières." className="lg:col-span-2">
              <BarList items={topCounts(rows.map(r => cityName(r.location)), 10)} empty="Aucune ville indiquée." />
            </ChartCard>
          </div>
        </>
      )}
      {loadError && children}
    </div>
  )
}
