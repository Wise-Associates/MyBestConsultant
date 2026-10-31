import Link from 'next/link'
import type { ComponentType, CSSProperties } from 'react'
import {
  ArrowRight, BarChart3, Briefcase, CheckCircle2, FolderOpen, FolderSearch, Inbox, LayoutDashboard, LayoutGrid, MessageSquare, Route, Search,
  Upload, Users,
} from 'lucide-react'
import { RECRUITER_SECTIONS, type RecruiterSectionKey } from '@/lib/recruiter-nav'
import {
  LEVEL_LABEL, ONLINE_STATUS_LABEL, type JobOnlineStatus, type RecruitmentLevel, type RecruitmentSummary, type WorkspaceKpis,
} from '@/lib/recruiter-workspace'
import { JobAssigneeSelect } from './job-assignee-select'

// Écran de « Mon espace » (données chargées et vérifiées par page.tsx) : un seul bloc qui regroupe tout (demande du
// 2026-10-31, la page n'a pas le sous-menu) — chiffres des recrutements, une tuile par rubrique de l'espace recruteur
// avec son chiffre, puis les recrutements avec leur statut et leur avancement. Vue « Toute l'équipe » : tous les
// recrutements, avec le recruteur affecté.

export interface WorkspaceViewProps {
  firstName: string
  view: 'mine' | 'team'
  kpis: WorkspaceKpis
  recruitments: RecruitmentSummary[]
  recruiters: { userId: string; name: string }[]
  hub: WorkspaceHub
  /** Lectures secondaires en échec (entretiens, parcours) : chiffres peut-être incomplets. */
  warning: string | null
}

/** Chiffres des tuiles ; null = lecture impossible ou fonction non configurée (la tuile reste, sans chiffre). */
export interface WorkspaceHub {
  aoToReview: number | null
  activeJourneys: number | null
  interviews: number | null
  onlineJobs: number
  teamSize: number
  vivierCount: number | null
}

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }

const ONLINE_STYLE: Record<JobOnlineStatus, { background: string; color: string }> = {
  online: { background: 'rgba(4,120,87,0.10)', color: '#047857' },
  expired: { background: 'rgba(180,83,9,0.10)', color: '#b45309' },
  inactive: { background: 'rgba(107,107,112,0.12)', color: 'var(--color-text-muted)' },
}

const LEVELS: RecruitmentLevel[] = ['matching', 'interview', 'validated']
/** Libellés courts sous la barre d'avancement (le libellé complet est lu par les lecteurs d'écran). */
const SHORT_LABEL: Record<RecruitmentLevel, string> = { matching: 'Matching', interview: 'Entretiens', validated: 'Validée' }

function Kpi({ label, value, icon: Icon, hint }: { label: string; value: number; icon: typeof Briefcase; hint: string }) {
  return (
    <div className="p-4" style={{ background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
      </div>
      <p className="mt-2 tabular-nums" style={{ color: 'var(--color-text)', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>
    </div>
  )
}

type Icon = ComponentType<{ className?: string; style?: CSSProperties; 'aria-hidden'?: boolean }>

const TILE_ICON: Record<Exclude<RecruiterSectionKey, 'espace'>, Icon> = {
  dashboard: LayoutDashboard, ao: Inbox, parcours: Route, reporting: BarChart3, vivier: FolderOpen, cvtheque: FolderSearch,
  equipe: Users, interviews: MessageSquare,
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Ligne de chaque tuile : le chiffre de la rubrique quand il est connu, sinon ce qu'on y fait. */
function tileLine(key: Exclude<RecruiterSectionKey, 'espace'>, hub: WorkspaceHub): string {
  switch (key) {
    case 'dashboard': return plural(hub.onlineJobs, 'offre en ligne', 'offres en ligne')
    case 'ao': return hub.aoToReview === null ? 'Appels d’offres reçus' : plural(hub.aoToReview, 'à valider', 'à valider')
    case 'parcours': return hub.activeJourneys === null ? 'De l’AO à la facture' : plural(hub.activeJourneys, 'parcours en cours', 'parcours en cours')
    case 'reporting': return 'Chiffres et rapports'
    case 'vivier': return hub.vivierCount === null ? 'Vos CV' : plural(hub.vivierCount, 'CV dans votre vivier', 'CV dans votre vivier')
    case 'cvtheque': return 'Tous les CV de l’organisation'
    case 'equipe': return plural(hub.teamSize, 'recruteur', 'recruteurs')
    case 'interviews': return hub.interviews === null ? 'Entretiens et screening' : plural(hub.interviews, 'entretien', 'entretiens')
  }
}

/** Une tuile par rubrique de l'espace recruteur (mêmes libellés et adresses que le sous-menu des autres pages). */
function SectionTiles({ hub }: { hub: WorkspaceHub }) {
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: 'var(--color-border)' }}>
      {RECRUITER_SECTIONS.flatMap(section => {
        if (section.key === 'espace') return []
        const key = section.key
        const Icon = TILE_ICON[key]
        return [(
          <li key={key} style={{ background: 'var(--color-surface)' }}>
            <Link href={section.href} className="group flex items-start gap-3 h-full p-4 no-underline hover:bg-[var(--color-background)] transition-colors">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.12)' }}>
                <Icon className="h-4 w-4" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {section.label}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                </span>
                <span className="block text-xs mt-0.5 lg:truncate" style={{ color: 'var(--color-text-muted)' }}>{tileLine(key, hub)}</span>
              </span>
            </Link>
          </li>
        )]
      })}
    </ul>
  )
}

/** Trois étapes de l'avancement, la plus avancée atteinte en orange, avec le nombre de candidats à chacune. */
function Progress({ summary }: { summary: RecruitmentSummary }) {
  const reached = LEVELS.indexOf(summary.level)
  return (
    <ol className="flex items-center gap-1" aria-label={`Avancement : ${LEVEL_LABEL[summary.level]}`}>
      {LEVELS.map((level, i) => (
        <li key={level} className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full" style={{ background: i <= reached ? (i === reached ? 'var(--color-brand-orange)' : 'var(--hero-bg)') : 'var(--color-border)' }} />
          <p className="text-[11px] mt-1 truncate" style={{ color: i === reached ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: i === reached ? 600 : 400 }}>
            {SHORT_LABEL[level]} · {summary.counts[level]}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function WorkspaceView({ firstName, view, kpis, recruitments, recruiters, hub, warning }: WorkspaceViewProps) {
  const names = new Map(recruiters.map(r => [r.userId, r.name]))
  const tab = (key: 'mine' | 'team', label: string) => (
    <Link href={key === 'mine' ? '/recruiter/espace' : '/recruiter/espace?vue=equipe'} aria-current={view === key ? 'page' : undefined}
      className="px-3 py-1.5 rounded-lg text-sm font-semibold no-underline"
      style={view === key ? { background: 'var(--color-brand-orange)', color: '#1C1C1E' } : { color: 'rgba(255,255,255,0.75)' }}>
      {label}
    </Link>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.15)' }}>
                <LayoutGrid className="h-6 w-6" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
              </div>
              <div className="min-w-0">
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Mon espace</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {view === 'mine'
                    ? `${firstName ? `Bonjour ${firstName} · ` : ''}vos recrutements en cours et leur avancement`
                    : 'Tous les recrutements de l’équipe, avec le recruteur affecté'}
                </p>
              </div>
            </div>
            <nav aria-label="Vue" className="flex gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
              {tab('mine', 'Mes recrutements')}
              {tab('team', 'Toute l’équipe')}
            </nav>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {warning && <p role="status" className="rounded-xl px-4 py-3 text-sm" style={{ ...card, color: '#b45309' }}>{warning}</p>}

        {/* Un seul bloc : chiffres, rubriques, recrutements (demande du 2026-10-31). */}
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: 'var(--color-border)' }}>
            <Kpi label="Recrutements en cours" value={kpis.inProgress} icon={Briefcase} hint="Offres en ligne" />
            <Kpi label="En matching" value={kpis.matching} icon={Search} hint="Aucun entretien encore" />
            <Kpi label="Avec entretien" value={kpis.interview} icon={MessageSquare} hint="Au moins un entretien" />
            <Kpi label="Recrue validée" value={kpis.validated} icon={CheckCircle2} hint="Acceptée ou retenue par le client" />
          </div>

          <section aria-labelledby="workspace-sections-title" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
              <h2 id="workspace-sections-title" style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.95rem' }}>Tout votre travail</h2>
              <Link href="/recruiter/vivier?vue=general"
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold no-underline"
                style={{ background: 'var(--color-brand-orange)', color: '#1C1C1E' }}>
                <Upload className="h-3.5 w-3.5" aria-hidden /> Importer mes CV
              </Link>
            </div>
            <div style={{ borderTop: '1px solid var(--color-border)' }}>
              <SectionTiles hub={hub} />
            </div>
          </section>

          <section aria-labelledby="workspace-list-title" style={{ borderTop: '1px solid var(--color-border)' }}>
            <h2 id="workspace-list-title" className="px-5 pt-5 pb-3" style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.95rem' }}>
              {view === 'mine' ? 'Mes recrutements' : 'Recrutements de l’équipe'} <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>({recruitments.length})</span>
            </h2>
            {recruitments.length === 0 ? (
              <div className="px-5 pb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {view === 'mine' ? (
                  <p>Aucun recrutement ne vous est affecté. Les offres que vous créez, et les appels d’offres qu’on vous affecte, arrivent ici à leur publication. <Link href="/recruiter/espace?vue=equipe" className="underline">Voir ceux de l’équipe</Link>.</p>
                ) : (
                  <p>Aucune offre pour l’instant.</p>
                )}
              </div>
            ) : (
              <ul className="divide-y" style={{ borderTop: '1px solid var(--color-border)', borderColor: 'var(--color-border)' }}>
                {recruitments.map(s => (
                  <li key={s.job.id} className="px-5 py-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,230px)_auto] sm:items-center" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/recruiter/pipeline/${s.job.id}`} className="text-sm font-semibold truncate no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                          {s.job.title}
                        </Link>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={ONLINE_STYLE[s.online]}>{ONLINE_STATUS_LABEL[s.online]}</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {s.counts.matching + s.counts.interview + s.counts.validated} candidat{s.counts.matching + s.counts.interview + s.counts.validated > 1 ? 's' : ''} en lice
                        {s.closed > 0 ? ` · ${s.closed} écarté${s.closed > 1 ? 's' : ''}` : ''}
                        {view === 'mine' ? '' : ` · ${s.job.recruiterId ? names.get(s.job.recruiterId) ?? 'Ancien membre' : 'Non affecté'}`}
                      </p>
                    </div>
                    <Progress summary={s} />
                    <div className="flex items-center gap-2 sm:justify-end">
                      {view === 'team' && (
                        <JobAssigneeSelect jobId={s.job.id} jobTitle={s.job.title} assigneeId={s.job.recruiterId} recruiters={recruiters} />
                      )}
                      <Link href={`/recruiter/pipeline/${s.job.id}`} aria-label={`Ouvrir le recrutement ${s.job.title}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg no-underline whitespace-nowrap"
                        style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        Ouvrir <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
