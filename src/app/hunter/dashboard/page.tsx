import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FolderOpen, Sparkles } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { listHunterProfiles, listProposals } from '@/lib/hunter'
import { matchProfileToJob } from '@/lib/hunter-match'
import { HunterShell } from '../hunter-shell'
import { ContactCard } from './contact-card'
import { DashboardBoard, type DashboardProposal } from './dashboard-board'

export default async function HunterDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')

  const { propositions } = await searchParams
  const [profiles, proposals, jobs] = await Promise.all([listHunterProfiles(user.userId), listProposals(user.userId), getActiveJobs().catch(() => [])])

  const usable = profiles.filter(p => p.cvFileId)
  const proposedPairs = new Set(proposals.map(p => `${p.jobId}:${p.profileId}`))
  // Offres où l'un de vos profils correspond le mieux — et qu'il n'a pas déjà été proposé.
  const suggestions = jobs.map(job => {
    let best: { name: string; score: number; id: string } | null = null
    for (const p of usable) {
      if (proposedPairs.has(`${job.$id}:${p.id}`)) continue
      const m = matchProfileToJob(p, job)
      if (!best || m.score > best.score) best = { name: `${p.firstName} ${p.lastName}`.trim(), score: m.score, id: p.id }
    }
    return { job, best }
  }).filter((s): s is { job: typeof s.job; best: NonNullable<typeof s.best> } => !!s.best && s.best.score >= 20)
    .sort((a, b) => b.best.score - a.best.score).slice(0, 5)

  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }
  const proposalRows: DashboardProposal[] = proposals.map(p => ({
    applicationId: p.applicationId, profileName: p.profileName, jobTitle: p.jobTitle, company: p.company, status: p.status,
    dateLabel: new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }),
  }))

  return (
    <HunterShell title={`Bonjour ${user.firstName}`}>
      {/* Remis à zéro par une navigation vers le tableau de bord (onglet, lien) : le filtre suit alors l'adresse. */}
      <DashboardBoard key={typeof propositions === 'string' ? propositions : ''}
        vivierCount={profiles.length} proposals={proposalRows}
        initialFilter={typeof propositions === 'string' ? propositions : null}
        suggestions={
          <section className="rounded-3xl overflow-hidden" style={card}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)', fontSize: '1rem' }}><Sparkles className="h-4 w-4" style={{ color: 'var(--color-primary)' }} aria-hidden />Offres qui correspondent à vos profils</h2>
              <Link href="/hunter/offres" className="text-xs font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Toutes les offres →</Link>
            </div>
            {suggestions.length === 0 ? (
              <p className="px-6 py-10 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                {profiles.length === 0 ? 'Ajoutez des CV à votre vivier : nous vous suggérerons les offres les plus adaptées.' : 'Aucune offre très proche de vos profils pour le moment.'}
              </p>
            ) : (
              <ul>
                {suggestions.map(({ job, best }) => (
                  <li key={job.$id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <Link href={`/hunter/offres/${job.$id}`} className="group flex items-center gap-4 px-5 sm:px-6 py-4 no-underline transition-colors hover:bg-[var(--color-background)]">
                      <span className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 font-bold" style={{ background: best.score >= 60 ? 'rgba(16,185,129,0.14)' : 'var(--color-background)', color: best.score >= 60 ? '#047857' : 'var(--color-text-muted)', border: best.score >= 60 ? 'none' : '1px solid var(--color-border)' }}>
                        <span className="text-sm leading-none">{best.score}%</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{job.title}</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>{job.companyName ? `${job.companyName} · ` : ''}{job.location} — meilleur profil : <strong>{best.name}</strong></p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" style={{ color: 'var(--color-primary)' }} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        }
        welcome={profiles.length > 0 ? null : (
          // Premier passage (vivier vide) : une seule invitation, avec le mode d'emploi, à la place d'offres et de
          // propositions forcément vides (revue du 2026-11-10). Le mode d'emploi n'est plus affiché ensuite.
          <section className="rounded-3xl p-6 sm:p-8" style={card} aria-labelledby="hunter-welcome-title">
            <h2 id="hunter-welcome-title" className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.125rem' }}>Commencez par ajouter vos CV</h2>
            <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-muted)' }}>Votre vivier est vide : importez les CV et profils dont vous disposez, nous vous montrerons les offres qui leur correspondent.</p>
            <ol className="mt-5 space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
              {['Importez vos CV et profils dans votre vivier.', 'Parcourez les offres : la compatibilité de chaque profil est calculée.', 'Choisissez le ou les profils à proposer sur chaque offre.', 'Suivez la réponse du recruteur ici, en temps réel.'].map((t, i) => (
                <li key={i} className="flex gap-3"><span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{i + 1}</span><span className="pt-0.5">{t}</span></li>
              ))}
            </ol>
            <Link href="/hunter/vivier" className="mt-6 inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-sm font-semibold no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
              <FolderOpen className="h-4 w-4" aria-hidden />Ajouter mes premiers CV
            </Link>
          </section>
        )}
        aside={
          <aside className="space-y-5 lg:sticky lg:top-[84px] min-w-0">
            <ContactCard initialWhatsapp={user.whatsapp ?? ''} initialPhone={user.phone ?? ''} />
          </aside>
        } />
    </HunterShell>
  )
}
