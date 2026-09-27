import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ArrowLeft, Mail, Phone, FileText, Briefcase, GraduationCap } from 'lucide-react'
import type { CvProfile } from '@/lib/cv-profile-extract'

// Lightweight "fiche candidat" for the two Matching populations that don't have a full
// Application yet (pool + vivier) — /recruiter/candidates/[applicationId] needs a real
// application to exist, so it can't be reused for someone who hasn't applied.
export default async function CandidatePreviewPage({ params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin')) redirect('/login')

  if (source === 'application') redirect(`/recruiter/candidates/${id}`)
  if (source !== 'pool' && source !== 'vivier') notFound()

  const { databases } = createAdminClient()

  let name = ''
  let email = ''
  let phone = ''
  let cvFileId = ''
  let cvHref = ''
  let profile: Partial<CvProfile> = {}

  if (source === 'pool') {
    let doc
    try { doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, id) } catch { notFound() }
    if (doc.role !== 'candidate') notFound()
    name = `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim() || (doc.email as string)
    email = (doc.email as string) ?? ''
    cvFileId = (doc.cvFileId as string) ?? ''
    cvHref = `/api/cv/${cvFileId}`
    profile = doc.cvProfileJson ? JSON.parse(doc.cvProfileJson as string) : {}
  } else {
    let doc
    try { doc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, id) } catch { notFound() }
    if (doc.recruiterId !== user.$id && user.role !== 'admin') redirect('/recruiter/dashboard')
    name = (doc.candidateName as string) || (doc.fileName as string) || 'CV importé'
    email = (doc.candidateEmail as string) ?? ''
    phone = (doc.candidatePhone as string) ?? ''
    cvFileId = (doc.cvFileId as string) ?? ''
    cvHref = `/api/vivier-cv/${cvFileId}`
    profile = doc.cvProfileJson ? JSON.parse(doc.cvProfileJson as string) : {}
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-2xl mx-auto px-6 py-8">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {source === 'pool' ? 'Base candidats' : 'Mon vivier'}
          </p>
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>{name}</h1>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {email && (
              <span className="flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <Mail className="h-3.5 w-3.5" /> {email}
              </span>
            )}
            {phone && (
              <span className="flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <Phone className="h-3.5 w-3.5" /> {phone}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
        {cvFileId && (
          <a href={cvHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-opacity hover:opacity-85"
            style={{ background: 'var(--color-primary)', color: 'white' }}>
            <FileText className="h-4 w-4" /> Voir le CV
          </a>
        )}

        {profile.experienceSummary && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-muted)' }}>
              <Briefcase className="h-3.5 w-3.5" /> Expérience
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{profile.experienceSummary}</p>
            {profile.yearsOfExperience != null && (
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>{profile.yearsOfExperience} an{profile.yearsOfExperience > 1 ? 's' : ''} d&apos;expérience</p>
            )}
          </div>
        )}

        {profile.skills && profile.skills.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-muted)' }}>
              <GraduationCap className="h-3.5 w-3.5" /> Compétences
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.skills.map(s => (
                <span key={s} className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        {!profile.experienceSummary && (!profile.skills || profile.skills.length === 0) && (
          <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
            Aucun profil détaillé disponible — consultez le CV directement.
          </p>
        )}
      </div>
    </div>
  )
}
