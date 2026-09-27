import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getJobById, hasApplied } from '@/lib/appwrite/jobs'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { ApplyModal } from './apply-modal'
import { MapPin, Briefcase, Wifi, Clock, ArrowLeft, CheckCircle2, Send, Building2, Calendar, ChevronRight } from 'lucide-react'
import { JobDescription } from '@/components/shared/job-description'
import { MobileApplyBar } from './mobile-apply-bar'
import { getBrandByTenantId } from '@/lib/appwrite/brand'

const EMPLOYMENT_TYPE: Record<string, string> = {
  cdi: 'FULL_TIME', cdd: 'CONTRACTOR', freelance: 'CONTRACTOR', mission: 'CONTRACTOR',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const job = await getJobById(id)
  if (!job) return {}
  const desc = job.description.replace(/<[^>]*>/g, '').slice(0, 160)
  return {
    title: `${job.title}${job.companyName ? ' — ' + job.companyName : ''} | MyBestConsultant`,
    description: desc,
    ...(job.skills.length > 0 ? { keywords: job.skills } : {}),
    openGraph: { title: job.title, description: desc, type: 'website' },
  }
}

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}
const CONTRACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  cdi:       { bg: 'rgba(16,185,129,0.08)',  text: '#059669', border: 'rgba(16,185,129,0.2)'  },
  cdd:       { bg: 'rgba(59,130,246,0.08)',  text: '#2563eb', border: 'rgba(59,130,246,0.2)'  },
  freelance: { bg: 'rgba(139,92,246,0.08)',  text: '#7c3aed', border: 'rgba(139,92,246,0.2)'  },
  mission:   { bg: 'rgba(232,163,61,0.08)',  text: '#b45309', border: 'rgba(232,163,61,0.2)'  },
}
const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote',
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [job, user] = await Promise.all([
    getJobById(id),
    getCurrentUser(),
  ])

  if (!job) notFound()

  // Lien vers la page employeur quand l'entreprise en a publié une.
  const brand = job.tenantId ? await getBrandByTenantId(job.tenantId) : null
  const brandLink = brand?.published ? `/entreprises/${brand.slug}` : null

  const alreadyApplied = user?.role === 'candidate'
    ? await hasApplied(job.$id, user.$id)
    : false

  const daysSince = Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 86_400_000)
  const postedLabel = daysSince === 0 ? "Aujourd'hui" : daysSince === 1 ? 'Hier' : `Il y a ${daysSince} jours`
  const cc = job.contractType ? (CONTRACT_COLORS[job.contractType] ?? CONTRACT_COLORS.mission) : null

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description.replace(/<[^>]*>/g, ''),
    datePosted: job.createdAt,
    validThrough: job.expiresAt || new Date(new Date(job.createdAt).getTime() + 90 * 86_400_000).toISOString(),
    employmentType: job.contractType ? EMPLOYMENT_TYPE[job.contractType] : undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName || 'MyBestConsultant',
    },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: job.location, addressCountry: 'FR' },
    },
    ...(job.remote === 'remote' ? { jobLocationType: 'TELECOMMUTE' } : {}),
    ...(job.salary ? {
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'EUR',
        value: { '@type': 'QuantitativeValue', value: job.salary, unitText: job.contractType === 'cdi' || job.contractType === 'cdd' ? 'YEAR' : 'DAY' },
      },
    } : {}),
  }

  const isRecruiterOrAdmin = user?.role === 'recruiter' || user?.role === 'admin'

  return (
    <div className="pb-24 lg:pb-0" style={{ minHeight: '100vh', background: 'var(--color-background)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ── Hero band ── */}
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-10">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-6 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Link href="/jobs" className="hover:text-white transition-colors" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Offres
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>{job.title}</span>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-4">
            {job.contractType && cc && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}>
                {CONTRACT_LABELS[job.contractType]}
              </span>
            )}
            {job.remote && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <Wifi className="h-3 w-3" />{REMOTE_LABELS[job.remote]}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Clock className="h-3 w-3" />{postedLabel}
            </span>
          </div>

          {/* Title */}
          <h1 style={{ fontWeight: 300, fontSize: 'clamp(1.6rem,4vw,2.4rem)', color: 'white', lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
            {job.title}
          </h1>

          {/* Company + location row */}
          <div className="flex flex-wrap items-center gap-5 mt-3">
            {job.companyName && (
              <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
                <Building2 className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
                {brandLink
                  ? <Link href={brandLink} className="no-underline hover:underline" style={{ color: 'inherit' }}>{job.companyName} <span style={{ opacity: 0.7 }}>· Découvrir l&apos;entreprise →</span></Link>
                  : job.companyName}
              </span>
            )}
            <span className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <MapPin className="h-4 w-4" />{job.location}
            </span>
            {job.salary && (
              <span className="flex items-center gap-2 text-sm font-bold" style={{ color: '#FB923C' }}>
                <Briefcase className="h-4 w-4" />
                {job.salary.toLocaleString('fr-FR')} {job.contractType === 'cdi' || job.contractType === 'cdd' ? '€/an' : '€/j TJM'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-col lg:flex-row gap-8 items-start">

          {/* ── Main content ── */}
          <article className="flex-1 min-w-0 w-full space-y-10 order-2 lg:order-1">

            {/* Skills */}
            {job.skills.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-[0.12em] mb-4 flex items-center gap-2"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <span className="w-4 h-px inline-block" style={{ background: 'var(--color-primary)' }} />
                  Compétences requises
                </h2>
                <div className="flex flex-wrap gap-2">
                  {job.skills.map(s => (
                    <span key={s} className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: 'rgba(44,44,46,0.06)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                      }}>
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Divider */}
            <div style={{ height: '1px', background: 'var(--color-border)' }} />

            {/* Description */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] mb-6 flex items-center gap-2"
                style={{ color: 'var(--color-text-muted)' }}>
                <span className="w-4 h-px inline-block" style={{ background: 'var(--color-primary)' }} />
                Description du poste
              </h2>
              <JobDescription description={job.description} />
            </section>

            {/* Back link bottom */}
            <div className="pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              <Link href="/jobs"
                className="inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}>
                <ArrowLeft className="h-4 w-4" /> Retour aux offres
              </Link>
            </div>
          </article>

          {/* ── Sticky sidebar ── */}
          <aside className="w-full lg:w-72 shrink-0 lg:sticky lg:top-6 space-y-4 order-1 lg:order-2">

            {/* CTA card */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(44,44,46,0.08)' }}>

              {/* Card header */}
              <div className="px-6 py-5" style={{ background: 'var(--color-primary)', color: 'white' }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {alreadyApplied ? 'Candidature' : 'Postuler'}
                </p>
                <p className="font-bold text-lg leading-tight">{job.title}</p>
                {job.companyName && (
                  <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{job.companyName}</p>
                )}
              </div>

              {/* Card body */}
              <div className="p-6" style={{ background: 'var(--color-surface)' }}>
                {alreadyApplied ? (
                  <div className="text-center space-y-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                      style={{ background: 'rgba(16,185,129,0.1)' }}>
                      <CheckCircle2 className="h-7 w-7" style={{ color: '#10b981' }} />
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Candidature envoyée !</p>
                      <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Suivez l&apos;avancement depuis votre espace.
                      </p>
                    </div>
                    <Link href="/candidate/dashboard"
                      className="block text-center py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                      style={{ background: 'var(--color-primary)', color: 'white' }}>
                      Mon espace candidat
                    </Link>
                  </div>
                ) : user?.role === 'candidate' ? (
                  <ApplyModal jobId={job.$id} tenantId={job.tenantId} jobTitle={job.title} hasCV={!!user.cvFileId} />
                ) : user?.role === 'hunter' ? (
                  <div className="space-y-2.5">
                    <p className="text-sm text-center font-medium" style={{ color: 'var(--color-text-muted)' }}>Vous avez le bon profil dans votre vivier ?</p>
                    <Link href={`/hunter/offres/${job.$id}`}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
                      style={{ background: '#14b8a6', color: 'white' }}>
                      <Send className="h-4 w-4" /> Proposer un profil de mon vivier
                    </Link>
                  </div>
                ) : user?.role === 'recruiter' || user?.role === 'admin' ? (
                  <p className="text-sm text-center py-2" style={{ color: 'var(--color-text-muted)' }}>
                    Connecté en tant que recruteur
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-center font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      Rejoignez MyBestConsultant pour postuler
                    </p>
                    <Link href={`/register?role=candidate&redirect=/jobs/${job.$id}`}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                      style={{ background: 'var(--color-primary)', color: 'white' }}>
                      <Send className="h-4 w-4" /> Postuler maintenant
                    </Link>
                    <Link href={`/login?redirect=/jobs/${job.$id}`}
                      className="block text-center py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                      style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                      J&apos;ai déjà un compte
                    </Link>
                  </div>
                )}
              </div>
            </div>
            {/* Marks where the inline CTA card ends — the fixed mobile bar appears once
                this scrolls out of view (see MobileApplyBar / useApplyBarVisible). */}
            <div id="apply-top-sentinel" />

            {/* Info card */}
            <div className="rounded-2xl p-5 space-y-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Détails du poste
              </p>
              <div className="space-y-3">
                {job.location && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(44,44,46,0.06)' }}>
                      <MapPin className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Localisation</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{job.location}</p>
                    </div>
                  </div>
                )}
                {job.contractType && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(44,44,46,0.06)' }}>
                      <Briefcase className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Contrat</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{CONTRACT_LABELS[job.contractType]}</p>
                    </div>
                  </div>
                )}
                {job.remote && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(44,44,46,0.06)' }}>
                      <Wifi className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Télétravail</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{REMOTE_LABELS[job.remote]}</p>
                    </div>
                  </div>
                )}
                {job.salary && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(232,163,61,0.1)' }}>
                      <Briefcase className="h-3.5 w-3.5" style={{ color: '#E8A33D' }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        {job.contractType === 'cdi' || job.contractType === 'cdd' ? 'Salaire' : 'TJM'}
                      </p>
                      <p className="text-sm font-bold" style={{ color: '#E8A33D' }}>
                        {job.salary.toLocaleString('fr-FR')} €{job.contractType === 'cdi' || job.contractType === 'cdd' ? '/an' : '/j'}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(44,44,46,0.06)' }}>
                    <Calendar className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Publiée</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{postedLabel}</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile-only fixed CTA bar — for states not already covered by ApplyModal's own
          (candidate mid-application flow renders its own, matching button). Appears once
          the inline CTA card scrolls out of view, hides again near the footer. */}
      {user?.role === 'hunter' && (
        <MobileApplyBar>
          <Link href={`/hunter/offres/${job.$id}`}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold no-underline transition-transform active:scale-[0.98]"
            style={{ background: '#14b8a6', color: 'white', boxShadow: '0 12px 28px -6px rgba(20,184,166,0.5)' }}>
            <Send className="h-4 w-4" /> Proposer un profil
          </Link>
        </MobileApplyBar>
      )}
      {!isRecruiterOrAdmin && user?.role !== 'hunter' && (alreadyApplied || !user) && (
        <MobileApplyBar>
          {alreadyApplied ? (
            <Link href="/candidate/dashboard"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold no-underline"
              style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
              <CheckCircle2 className="h-4 w-4" /> Candidature envoyée — voir mon espace
            </Link>
          ) : (
            <Link href={`/register?role=candidate&redirect=/jobs/${job.$id}`}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold no-underline transition-transform active:scale-[0.98]"
              style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 -4px 4px rgba(0,0,0,0.02), 0 12px 28px -6px rgba(232,163,61,0.55)' }}>
              <Send className="h-4 w-4" /> Postuler maintenant
            </Link>
          )}
        </MobileApplyBar>
      )}
    </div>
  )
}

