import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight, Building2, Calendar, ExternalLink, Globe, MapPin, Users, Briefcase, Wifi, Eye } from 'lucide-react'
import { getBrandBySlug } from '@/lib/appwrite/brand'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BenefitIcon } from '@/lib/brand-icons'
import { SIZE_LABEL, videoEmbedUrl } from '@/lib/brand'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote' }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const brand = await getBrandBySlug(slug)
  if (!brand || !brand.published) return { robots: { index: false } }
  const desc = (brand.profile.tagline || brand.profile.about).slice(0, 160)
  return {
    title: `${brand.name} — Offres d'emploi & culture d'entreprise | MyBestConsultant`,
    description: desc,
    alternates: { canonical: `${BASE_URL}/entreprises/${brand.slug}` },
    openGraph: {
      title: `${brand.name} recrute`, description: desc, type: 'website',
      ...(brand.profile.coverUrl ? { images: [brand.profile.coverUrl] } : {}),
    },
  }
}

export default async function EmployerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const brand = await getBrandBySlug(slug)
  if (!brand) notFound()

  // Une page en brouillon n'est visible que par l'équipe de l'entreprise (aperçu).
  let isPreview = false
  if (!brand.published) {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter' || user.tenantId !== brand.tenantId) notFound()
    isPreview = true
  }

  const p = brand.profile
  const jobs = (await getActiveJobs().catch(() => [])).filter(j => j.tenantId === brand.tenantId)
  const embed = videoEmbedUrl(p.videoUrl)
  const facts = [
    p.sector && { icon: <Briefcase className="h-4 w-4" />, text: p.sector },
    p.headquarters && { icon: <MapPin className="h-4 w-4" />, text: p.headquarters },
    p.size && { icon: <Users className="h-4 w-4" />, text: SIZE_LABEL[p.size] },
    p.foundedYear && { icon: <Calendar className="h-4 w-4" />, text: `Fondée en ${p.foundedYear}` },
  ].filter(Boolean) as { icon: React.ReactNode; text: string }[]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: brand.name,
    url: p.website || `${BASE_URL}/entreprises/${brand.slug}`,
    ...(brand.logoUrl ? { logo: brand.logoUrl } : {}),
    ...(p.about ? { description: p.about.slice(0, 300) } : {}),
    ...(p.foundedYear ? { foundingDate: p.foundedYear } : {}),
    ...(p.linkedin ? { sameAs: [p.linkedin] } : {}),
  }

  const sectionTitle = (text: string) => (
    <h2 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.35rem', letterSpacing: '-0.01em', marginBottom: '1.25rem' }}>{text}</h2>
  )

  return (
    <div style={{ background: 'var(--color-background)', minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {isPreview && (
        <div className="px-4 py-2.5 text-center text-xs font-semibold flex items-center justify-center gap-2 flex-wrap" style={{ background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fde68a' }}>
          <Eye className="h-3.5 w-3.5" /> Aperçu — cette page est un brouillon, visible uniquement par votre équipe.
          <Link href="/recruiter/marque-employeur" className="underline">Modifier / publier</Link>
        </div>
      )}

      {/* ── Bandeau ── */}
      <header className="relative" style={{ background: 'var(--hero-bg)' }}>
        {p.coverUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(17,17,20,0.35) 0%, rgba(17,17,20,0.78) 100%)' }} />
          </>
        )}
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-10 sm:pt-24 sm:pb-12">
          <div className="flex items-end gap-4 sm:gap-6 flex-wrap">
            <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'white', border: '1px solid rgba(255,255,255,0.6)' }}>
              {brand.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={brand.logoUrl} alt={`Logo ${brand.name}`} className="w-full h-full object-contain p-2" />
                : <Building2 className="h-9 w-9" style={{ color: '#9ca3af' }} />}
            </div>
            <div className="min-w-0 flex-1" style={{ minWidth: 220 }}>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{brand.name}</h1>
              {p.tagline && <p className="mt-2" style={{ color: 'rgba(255,255,255,0.82)', fontSize: 'clamp(0.95rem, 1.6vw, 1.15rem)', maxWidth: 720 }}>{p.tagline}</p>}
            </div>
          </div>

          {(facts.length > 0 || p.website || p.linkedin) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {facts.map((f, i) => <span key={i} className="inline-flex items-center gap-1.5">{f.icon}{f.text}</span>)}
              {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 no-underline hover:underline" style={{ color: 'white' }}><Globe className="h-4 w-4" />Site web<ExternalLink className="h-3 w-3" /></a>}
              {p.linkedin && <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 no-underline hover:underline" style={{ color: 'white' }}>LinkedIn<ExternalLink className="h-3 w-3" /></a>}
            </div>
          )}

          {jobs.length > 0 && (
            <a href="#offres" className="inline-flex items-center gap-2 mt-7 px-5 py-3 rounded-xl text-sm font-bold no-underline transition-opacity hover:opacity-90" style={{ background: 'var(--color-primary)', color: 'white' }}>
              Voir les {jobs.length} offre{jobs.length > 1 ? 's' : ''} ouverte{jobs.length > 1 ? 's' : ''} <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-14 sm:space-y-16">
        {p.about && (
          <section>
            {sectionTitle('À propos')}
            <div className="space-y-4" style={{ color: 'var(--color-text)', fontSize: '1.02rem', lineHeight: 1.75, maxWidth: 760 }}>
              {p.about.split(/\n{2,}/).map((para, i) => <p key={i} style={{ whiteSpace: 'pre-line' }}>{para}</p>)}
            </div>
          </section>
        )}

        {p.values.length > 0 && (
          <section>
            {sectionTitle('Nos valeurs')}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {p.values.map((v, i) => (
                <div key={i} className="rounded-2xl p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <span className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 font-bold" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>{v.title}</h3>
                  {v.text && <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)', lineHeight: 1.65 }}>{v.text}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {p.benefits.length > 0 && (
          <section>
            {sectionTitle('Ce que nous vous offrons')}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
              {p.benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-3.5">
                  <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.12)', color: 'var(--color-primary)' }}>
                    <BenefitIcon name={b.icon} className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{b.title}</p>
                    {b.text && <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{b.text}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {(embed || p.gallery.length > 0) && (
          <section>
            {sectionTitle('Vie de l’entreprise')}
            {embed && (
              <div className="rounded-2xl overflow-hidden mb-4" style={{ aspectRatio: '16 / 9', maxWidth: 860, border: '1px solid var(--color-border)' }}>
                <iframe src={embed} title={`Présentation ${brand.name}`} className="w-full h-full" allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
              </div>
            )}
            {p.gallery.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {p.gallery.map((u, i) => (
                  <div key={u} className={`rounded-2xl overflow-hidden ${i === 0 && p.gallery.length > 2 ? 'col-span-2 row-span-2' : ''}`} style={{ aspectRatio: i === 0 && p.gallery.length > 2 ? '4 / 3' : '4 / 3', border: '1px solid var(--color-border)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt={`${brand.name} — photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section id="offres" style={{ scrollMarginTop: 90 }}>
          {sectionTitle(jobs.length > 0 ? `Nos offres ouvertes (${jobs.length})` : 'Nos offres')}
          {jobs.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune offre ouverte pour le moment. Revenez bientôt !</p>
              <Link href="/jobs" className="inline-block mt-3 text-sm font-semibold no-underline" style={{ color: 'var(--color-primary)' }}>Parcourir toutes les offres →</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => {
                const days = Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 86_400_000)
                return (
                  <Link key={job.$id} href={`/jobs/${job.$id}`} className="group flex items-center justify-between gap-4 rounded-2xl p-5 no-underline transition-colors hover:border-[var(--color-primary)]"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="min-w-0">
                      <h3 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.02rem' }}>{job.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>
                        {job.contractType && <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" />{CONTRACT[job.contractType]}</span>}
                        {job.remote && <span className="inline-flex items-center gap-1"><Wifi className="h-3 w-3" />{REMOTE[job.remote]}</span>}
                        <span>{days === 0 ? "Aujourd'hui" : days === 1 ? 'Hier' : `Il y a ${days} jours`}</span>
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" style={{ color: 'var(--color-primary)' }} />
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
