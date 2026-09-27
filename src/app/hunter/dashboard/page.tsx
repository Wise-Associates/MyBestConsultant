import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Briefcase, CheckCircle2, FolderOpen, Send, Sparkles, Timer } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { listHunterProfiles, listProposals } from '@/lib/hunter'
import { matchProfileToJob, proposalStatus } from '@/lib/hunter-match'
import { HunterShell } from '../hunter-shell'
import { ContactCard } from './contact-card'

export default async function HunterDashboardPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')

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

  const inProgress = proposals.filter(p => p.status !== 'pending' && p.status !== 'rejected' && p.status !== 'accepted' && p.status !== 'on_hold').length
  const accepted = proposals.filter(p => p.status === 'accepted').length
  const kpis = [
    { label: 'Profils dans mon vivier', value: profiles.length, icon: FolderOpen, color: '#14b8a6' },
    { label: 'Propositions envoyées', value: proposals.length, icon: Send, color: '#3b82f6' },
    { label: 'En cours de traitement', value: inProgress, icon: Timer, color: '#8b5cf6' },
    { label: 'Profils retenus', value: accepted, icon: CheckCircle2, color: '#10b981' },
  ]
  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }

  return (
    <HunterShell title={`Bonjour ${user.firstName}`} subtitle="Votre vivier de profils, vos propositions et les offres qui vous attendent"
      actions={<Link href="/hunter/vivier" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold no-underline" style={{ background: '#14b8a6', color: 'white' }}><FolderOpen className="h-4 w-4" />Ajouter des CV</Link>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {kpis.map(k => (
          <div key={k.label} className="rounded-2xl p-4 relative overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full" style={{ background: `radial-gradient(circle, ${k.color}22, transparent 70%)` }} />
            <div className="flex items-center justify-between relative"><span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{k.label}</span><k.icon className="h-4 w-4" style={{ color: k.color }} /></div>
            <p className="text-3xl font-bold mt-2 relative" style={{ color: 'var(--color-text)' }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <section className="rounded-3xl overflow-hidden" style={card}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)', fontSize: '1rem' }}><Sparkles className="h-4 w-4" style={{ color: '#e8a33d' }} />Offres qui correspondent à vos profils</h2>
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
                    <Link href={`/hunter/offres/${job.$id}`} className="group flex items-center gap-4 px-5 sm:px-6 py-4 no-underline transition-colors hover:bg-[rgba(20,184,166,0.05)]">
                      <span className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 font-bold" style={{ background: best.score >= 60 ? 'rgba(16,185,129,0.14)' : 'rgba(232,163,61,0.16)', color: best.score >= 60 ? '#059669' : '#b8862f' }}>
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

          <section className="rounded-3xl overflow-hidden" style={card}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>Dernières propositions</h2>
              <Link href="/hunter/propositions" className="text-xs font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Tout voir →</Link>
            </div>
            {proposals.length === 0 ? (
              <p className="px-6 py-10 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>Vous n’avez encore proposé aucun profil. <Link href="/hunter/offres" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Parcourir les offres</Link></p>
            ) : (
              <ul>
                {proposals.slice(0, 5).map(p => {
                  const st = proposalStatus(p.status)
                  return (
                    <li key={p.applicationId} className="px-5 sm:px-6 py-3.5 flex items-center gap-3 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.profileName} <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>→ {p.jobTitle}</span></p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{p.company || 'Entreprise'} · {new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${st.color}1f`, color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-[84px] min-w-0">
          <ContactCard initialWhatsapp={user.whatsapp ?? ''} initialPhone={user.phone ?? ''} />
          <div className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Briefcase className="h-4 w-4" style={{ color: '#14b8a6' }} />Comment ça marche</p>
            <ol className="space-y-2.5 text-sm" style={{ color: 'var(--color-text)' }}>
              {['Importez vos CV et profils dans votre vivier.', 'Parcourez les offres : la compatibilité de chaque profil est calculée.', 'Choisissez le ou les profils à proposer sur chaque offre.', 'Suivez la réponse du recruteur ici, en temps réel.'].map((t, i) => (
                <li key={i} className="flex gap-2.5"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: 'rgba(20,184,166,0.16)', color: '#0d9488' }}>{i + 1}</span>{t}</li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </HunterShell>
  )
}
