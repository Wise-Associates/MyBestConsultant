import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getApplicationsByCandidate, getJobById } from '@/lib/appwrite/jobs'
import { FileText, CalendarCheck, Upload, User, Briefcase, ArrowRight } from 'lucide-react'
import type { Application, Job } from '@/types'
import type { CvProfile } from '@/lib/cv-profile-extract'
import { CvUploadButton } from './cv-upload-button'
import { ProfileEditor } from './profile-editor'
import { MiniCvCard } from './mini-cv-card'
import { RecommendationPanel } from './recommendation-panel'
import { getMyRecommendations } from './recommendations-actions'

const STATUS: Record<string, { label: string; bg: string; text: string }> = {
  pending:   { label: 'En attente',   bg: 'rgba(107,114,128,0.1)', text: '#6b7280' },
  screening: { label: 'Screening IA', bg: 'rgba(139,92,246,0.1)',  text: '#8b5cf6' },
  interview: { label: 'Entretien',    bg: 'rgba(59,130,246,0.1)',  text: '#3b82f6' },
  accepted:  { label: 'Accepté ✓',   bg: 'rgba(16,185,129,0.1)',  text: '#10b981' },
  rejected:  { label: 'Refusé',       bg: 'rgba(239,68,68,0.1)',   text: '#ef4444' },
  on_hold:   { label: 'Vivier',       bg: 'rgba(245,158,11,0.1)',  text: '#f59e0b' },
}

export default async function CandidateDashboard({
  searchParams,
}: {
  searchParams: Promise<{ applied?: string }>
}) {
  const sp = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [applications, recommendations] = await Promise.all([
    getApplicationsByCandidate(user.$id),
    getMyRecommendations(),
  ])

  // Fetch jobs for each application in parallel
  const jobs = await Promise.all(
    applications.map(a => getJobById(a.jobId))
  )
  const jobMap = new Map<string, Job | null>(
    applications.map((a, i) => [a.jobId, jobs[i]])
  )

  const total = applications.length
  const interviews = applications.filter(a => a.status === 'interview').length
  const pending = applications.filter(a => a.status === 'pending' || a.status === 'screening').length

  const cvProfile: Partial<CvProfile> = user.cvProfileJson ? JSON.parse(user.cvProfileJson) : {}

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      {/* Header */}
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Espace candidat
          </p>
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>
            Bonjour, {user.firstName} 👋
          </h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Applied confirmation */}
        {sp.applied && (
          <div className="p-4 rounded-xl flex items-center gap-3"
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <span style={{ color: '#10b981', fontSize: '1.25rem' }}>✓</span>
            <p className="text-sm font-medium" style={{ color: '#10b981' }}>
              Candidature envoyée avec succès !
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Candidatures', value: total, icon: <FileText className="h-4 w-4" /> },
            { label: 'Entretiens', value: interviews, icon: <CalendarCheck className="h-4 w-4" /> },
            { label: 'En cours', value: pending, icon: <Briefcase className="h-4 w-4" /> },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-2xl transition-transform hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{s.label}</span>
                <span style={{ color: 'var(--color-primary)' }}>{s.icon}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Mini-CV */}
        <MiniCvCard
          firstName={user.firstName}
          lastName={user.lastName}
          email={user.email}
          phone={user.phone}
          city={user.city}
          mobilityRadiusKm={user.mobilityRadiusKm}
          photoUrl={user.photoUrl}
          linkedinUrl={user.linkedinUrl}
          openToWork={user.openToWork}
          desiredSector={user.desiredSector ?? []}
          desiredRoles={user.desiredRoles ?? []}
          skills={cvProfile.skills ?? []}
          experienceSummary={cvProfile.experienceSummary}
          experiences={cvProfile.experiences ?? []}
          education={cvProfile.education ?? []}
          languages={cvProfile.languages ?? []}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Mes candidatures */}
          <div className="lg:col-span-2 rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-semibold" style={{ color: 'var(--color-text)' }}>Mes candidatures</h2>
              <Link href="/jobs" className="text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                Voir les offres <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {applications.length === 0 ? (
              <div className="py-16 text-center space-y-3 px-6">
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                  Vous n&apos;avez encore postulé à aucune offre.
                </p>
                <Link href="/jobs"
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  Explorer les offres
                </Link>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {applications.map(app => {
                  const job = jobMap.get(app.jobId)
                  const status = STATUS[app.status] ?? STATUS.pending
                  const date = new Date(app.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                  return (
                    <div key={app.$id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" style={{ color: 'var(--color-text)' }}>
                          {job?.title ?? 'Offre supprimée'}
                        </p>
                        {job?.location && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            {job.location}
                          </p>
                        )}
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          Postulé le {date}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-3">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: status.bg, color: status.text }}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Profil panel */}
          <div className="space-y-4">
            <div className="p-5 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
                  style={{ background: 'var(--color-primary)', color: 'white', fontSize: '1rem' }}>
                  {user.firstName[0]}{user.lastName[0]}
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{user.email}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>CV</span>
                  <span className="text-xs font-semibold"
                    style={{ color: user.cvFileId ? '#10b981' : '#ef4444' }}>
                    {user.cvFileId ? '✓ Uploadé' : '✗ Manquant'}
                  </span>
                </div>
              </div>
            </div>

            {/* CV Upload */}
            <div className="p-5 rounded-2xl space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                  {user.cvFileId ? 'Mettre à jour mon CV' : 'Uploader mon CV'}
                </p>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                PDF, DOC, DOCX — max 10 Mo
              </p>
              <CvUploadButton currentFileId={user.cvFileId} />
            </div>

            <RecommendationPanel initialRecommendations={recommendations} skills={cvProfile.skills ?? []} />

            <ProfileEditor
              key={user.cvProfileJson ?? 'no-profile'}
              initialPhone={user.phone ?? ''}
              initialWhatsapp={user.whatsapp ?? ''}
              initialCity={user.city ?? ''}
              initialMobilityRadiusKm={user.mobilityRadiusKm ?? null}
              initialSkills={cvProfile.skills ?? []}
              experienceSummary={cvProfile.experienceSummary ?? ''}
              initialOpenToWork={user.openToWork ?? true}
              initialDesiredSector={user.desiredSector ?? []}
              initialDesiredRoles={user.desiredRoles ?? []}
              initialPhotoUrl={user.photoUrl ?? ''}
              initialLinkedinUrl={user.linkedinUrl ?? ''}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
