import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById } from '@/lib/appwrite/jobs'
import { getVivierForJob } from './actions'
import { ArrowLeft, FolderOpen, Brain } from 'lucide-react'
import { VivierClient } from './vivier-client'
import { BUCKETS } from '@/lib/appwrite/config'

export default async function VivierPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin') || !user.tenantId) redirect('/login')

  const job = await getJobById(jobId)
  if (!job || job.tenantId !== user.tenantId) notFound()

  const { cvs, error } = await getVivierForJob(jobId)

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <Link href="/recruiter/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.55)' }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
            </Link>
            <Link href={`/recruiter/pipeline/${jobId}/matching`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
              <Brain className="h-3.5 w-3.5" /> Voir le Matching IA
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <FolderOpen className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Mon vivier de CV</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{job.title} · visible uniquement par vous{user.role === 'admin' ? ' (et les administrateurs)' : ''}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <VivierClient jobId={jobId} bucketId={BUCKETS.VIVIER_CVS} initialCvs={cvs} loadError={error} isAdmin={user.role === 'admin'} currentUserId={user.$id} />
      </div>

      <style>{`
        @keyframes mbc-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.08); } }
        @keyframes mbc-float-slow { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-24px, 24px) scale(1.05); } }
        .mbc-orb { animation: mbc-float 14s ease-in-out infinite; }
        .mbc-orb-slow { animation: mbc-float-slow 18s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
