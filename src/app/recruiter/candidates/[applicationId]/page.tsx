import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { CvProfile } from '@/lib/cv-profile-extract'
import type { InterviewAnalysis } from '@/app/recruiter/interviews/actions'
import {
  ArrowLeft, Mail, Phone, MapPin, Navigation, Briefcase, Building2,
  GraduationCap, FileText, ExternalLink, Link2, ClipboardList, Video, ChevronRight, Star,
  GitBranch, ThumbsUp, ThumbsDown, Scale, CheckCircle2,
} from 'lucide-react'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { CvDetailExpander } from '@/components/shared/cv-detail-expander'
import { ExportPdfButton } from './export-pdf-button'
import { AutoPrint } from './auto-print'
import { getFunnelStages } from '@/lib/appwrite/funnel'
import { funnelForCandidate, STEP_TYPES, type StepStatus, type StepResult } from '@/lib/candidate-funnel'
import { resolveCandidateIdentities } from '@/lib/candidate-identity'
import { WhatsAppContact } from '@/components/recruiter/whatsapp-contact'
import { getSubmittedRecommendations } from '@/lib/appwrite/recommendations'
import { RELATIONSHIP_LABEL } from '@/lib/recommendation-boost'

const STATUS: Record<string, { label: string; bg: string; text: string }> = {
  pending:   { label: 'En attente',   bg: 'rgba(107,114,128,0.14)', text: '#9ca3af' },
  screening: { label: 'Screening IA', bg: 'rgba(139,92,246,0.14)',  text: '#c4b5fd' },
  interview: { label: 'Entretien',    bg: 'rgba(59,130,246,0.14)',  text: '#93c5fd' },
  accepted:  { label: 'Accepté ✓',   bg: 'rgba(16,185,129,0.14)',  text: '#6ee7b7' },
  rejected:  { label: 'Refusé',       bg: 'rgba(239,68,68,0.14)',   text: '#fca5a5' },
  on_hold:   { label: 'Vivier',       bg: 'rgba(245,158,11,0.14)',  text: '#fcd34d' },
}

const SCREEN_RECO: Record<string, { label: string; color: string }> = {
  top:     { label: 'Top profil',    color: '#10b981' },
  good:    { label: 'Bon profil',    color: '#3b82f6' },
  average: { label: 'Profil moyen',  color: '#f59e0b' },
  weak:    { label: 'Profil faible', color: '#e8a33d' },
  reject:  { label: 'À rejeter',     color: '#ef4444' },
}

const INTERVIEW_RECO: Record<string, { label: string; color: string }> = {
  hire:     { label: 'Recommandé',     color: '#10b981' },
  consider: { label: 'À considérer',   color: '#f59e0b' },
  reject:   { label: 'Non recommandé', color: '#ef4444' },
}

// Même libellés que la modale du funnel (recruiter/pipeline/[jobId]/funnel-modal.tsx), pour rester cohérent.
const STEP_STATUS_LABEL: Record<StepStatus, string> = { todo: 'À faire', scheduled: 'Planifié', done: 'Réalisé', validated: 'Validé', skipped: 'Passée' }
const STEP_RESULT: Record<StepResult, { label: string; color: string; Icon: React.ElementType }> = {
  positive: { label: 'Favorable', color: '#10b981', Icon: ThumbsUp },
  neutral:  { label: 'Réservé',   color: '#f59e0b', Icon: Scale },
  negative: { label: 'Défavorable', color: '#ef4444', Icon: ThumbsDown },
}

// Vue détaillée d'un candidat qui a postulé, organisée en blocs distincts (au lieu du
// résumé brut affiché avant) : identité/contact, expertises, expérience, CV. Consolide
// aussi le rapport de screening ET l'analyse d'entretien (s'il y en a un) sur la même
// page, avec un export PDF — jusqu'ici il fallait recouper plusieurs pages pour avoir
// une vue d'ensemble à transmettre à sa hiérarchie.
export default async function CandidateProfilePage({ params, searchParams }: {
  params: Promise<{ applicationId: string }>
  searchParams: Promise<{ print?: string }>
}) {
  const { applicationId } = await params
  const { print } = await searchParams
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { databases } = createAdminClient()
  let application
  try {
    application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
  } catch {
    notFound()
  }
  if (application.tenantId !== user.tenantId) redirect('/recruiter/dashboard')

  const [candidate, job, interviewResults, recommendations, funnelStages] = await Promise.all([
    databases.getDocument(DB_ID, COLLECTIONS.USERS, application.candidateId as string).catch(() => null),
    databases.getDocument(DB_ID, COLLECTIONS.JOBS, application.jobId as string).catch(() => null),
    databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
      Query.equal('applicationId', applicationId),
      Query.orderDesc('$createdAt'),
      Query.limit(1),
    ]).catch(() => ({ documents: [] })),
    getSubmittedRecommendations(application.candidateId as string),
    getFunnelStages(user.tenantId),
  ])
  if (!candidate) notFound()

  // Profil proposé par un chasseur de têtes : c'est lui l'interlocuteur (coordonnées du candidat non exposées).
  const identity = (await resolveCandidateIdentities([candidate.$id])).get(candidate.$id)
  const hunter = identity?.hunter
  const isHunterProfile = candidate.role === 'hunter_profile'

  const interview = interviewResults.documents[0]
  const interviewAnalysis: InterviewAnalysis | null = interview?.analysis ? JSON.parse(interview.analysis as string) : null

  const profile: Partial<CvProfile> = candidate.cvProfileJson ? JSON.parse(candidate.cvProfileJson as string) : {}
  const skills = profile.skills ?? []
  const name = `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim() || (candidate.email as string)
  const desiredSector = candidate.desiredSector ? (candidate.desiredSector as string).split(',').map(s => s.trim()).filter(Boolean) : []
  const desiredRoles = candidate.desiredRoles ? (candidate.desiredRoles as string).split(',').map(s => s.trim()).filter(Boolean) : []
  // Libellé/couleur de l'étape depuis le funnel du recruteur (étapes personnalisables) ;
  // les étapes standard gardent leur style pastel lisible sur le bandeau sombre.
  const funnelStage = funnelStages.find(s => s.slug === application.status)
  const known = STATUS[application.status as string]
  const stage = known
    ? { ...known, label: funnelStage?.label ?? known.label }
    : { label: funnelStage?.label ?? (application.status as string), bg: `${funnelStage?.color ?? '#6b7280'}33`, text: '#ffffff' }
  const screeningReco = application.aiRecommendation ? SCREEN_RECO[application.aiRecommendation as string] : null
  const hasReports = application.aiScore !== undefined || interviewAnalysis !== null
  // Parcours de recrutement (funnel) : n'apparaît que si le recruteur y a déjà touché (sinon c'est le
  // funnel par défaut, non pertinent à afficher ici) — voir recruiter/pipeline/[jobId]/funnel-modal.tsx.
  const funnel = funnelForCandidate(application.funnelJson, application.status as string)
  const funnelSteps = funnel.saved ? funnel.steps.filter(s => s.status !== 'todo' || s.report) : []

  return (
    <div id="candidate-report" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="sticky top-0 z-20 no-print" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-3xl mx-auto px-6 py-6">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-3 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <CandidateAvatar photoUrl={candidate.photoUrl as string} initials={name[0]?.toUpperCase() ?? '?'} size={56}
                openToWork={!!candidate.openToWork} bgColor="var(--hero-bg)" />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.5rem' }}>{name}</h1>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: stage.bg, color: stage.text }}>
                    {stage.label}
                  </span>
                </div>
                {job && <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>A postulé pour : {job.title as string}</p>}
              </div>
            </div>
            <ExportPdfButton />
          </div>
        </div>
      </div>

      {print === '1' && <AutoPrint />}

      {/* En-tête imprimé uniquement — le header sticky ci-dessus est masqué à l'impression */}
      <div className="hidden print-only px-6 pt-8 pb-2">
        <h1 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.5rem' }}>{name}</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          {stage.label}{job ? ` · Candidature pour ${job.title as string}` : ''}
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        {/* Bloc profil : identité, coordonnées, missions recherchées, localisation */}
        <Block icon={Briefcase} title="Profil">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {!isHunterProfile && candidate.email && <Row icon={Mail} value={candidate.email as string} href={`mailto:${candidate.email}`} />}
            {!isHunterProfile && candidate.phone && <Row icon={Phone} value={candidate.phone as string} href={`tel:${candidate.phone}`} />}
            {candidate.city && <Row icon={MapPin} value={candidate.city as string} />}
            {candidate.mobilityRadiusKm != null && <Row icon={Navigation} value={`Mobilité ${candidate.mobilityRadiusKm} km`} />}
            {candidate.linkedinUrl && <Row icon={Link2} value="Profil LinkedIn" href={candidate.linkedinUrl as string} />}
          </div>
          {isHunterProfile && (
            <div className="mt-3 rounded-2xl p-4" style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.3)' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#0d9488' }}>🎯 Profil proposé par un chasseur de têtes</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{hunter?.name ?? 'Chasseur'}</p>
              {hunter?.email && <p className="text-sm mt-0.5"><a href={`mailto:${hunter.email}`} style={{ color: 'var(--color-primary)' }}>{hunter.email}</a></p>}
              {hunter?.whatsapp && <div className="mt-3 no-print"><WhatsAppContact name={hunter.name} number={hunter.whatsapp} jobTitle={job?.title as string | undefined} applicationId={applicationId} hunter /></div>}
              {application.coverLetter && (
                <blockquote className="mt-3 pt-3 text-sm whitespace-pre-line leading-relaxed" style={{ borderTop: '1px solid rgba(20,184,166,0.25)', color: 'var(--color-text)' }}>{application.coverLetter as string}</blockquote>
              )}
            </div>
          )}
          {!isHunterProfile && identity?.whatsapp && (
            <div className="mt-3 no-print"><WhatsAppContact name={name} number={identity.whatsapp} jobTitle={job?.title as string | undefined} applicationId={applicationId} /></div>
          )}
          {(desiredRoles.length > 0 || desiredSector.length > 0) && (
            <div className="mt-3 pt-3 flex flex-wrap gap-4 text-sm" style={{ borderTop: '1px solid var(--color-border)' }}>
              {desiredRoles.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Missions recherchées</p>
                  <p style={{ color: 'var(--color-text)' }}>{desiredRoles.join(' · ')}</p>
                </div>
              )}
              {desiredSector.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Secteurs</p>
                  <p style={{ color: 'var(--color-text)' }}>{desiredSector.join(' · ')}</p>
                </div>
              )}
            </div>
          )}
        </Block>

        {/* Bloc rapports IA — screening et entretien consolidés */}
        {hasReports && (
          <Block icon={ClipboardList} title="Rapports IA">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {application.aiScore !== undefined && (
                <div className="p-4 rounded-2xl" style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Screening CV</p>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{application.aiScore as number}/100</span>
                  </div>
                  {screeningReco && (
                    <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full mb-2"
                      style={{ background: `${screeningReco.color}18`, color: screeningReco.color }}>
                      {screeningReco.label}
                    </span>
                  )}
                  {application.aiSummary && (
                    <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--color-text)' }}>{application.aiSummary as string}</p>
                  )}
                </div>
              )}

              {interviewAnalysis && interview && (
                <div className="p-4 rounded-2xl" style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Entretien IA</p>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{interviewAnalysis.overallScore}/100</span>
                  </div>
                  <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full mb-2"
                    style={{ background: `${INTERVIEW_RECO[interviewAnalysis.recommendation].color}18`, color: INTERVIEW_RECO[interviewAnalysis.recommendation].color }}>
                    {INTERVIEW_RECO[interviewAnalysis.recommendation].label}
                  </span>
                  <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--color-text)' }}>{interviewAnalysis.summary}</p>
                  <Link href={`/recruiter/interviews/${interview.$id}`}
                    className="no-print inline-flex items-center gap-1 text-[11px] font-bold mt-2 no-underline transition-opacity hover:opacity-75"
                    style={{ color: 'var(--color-primary)' }}>
                    <Video className="h-3 w-3" /> Voir l&apos;entretien complet <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          </Block>
        )}

        {/* Bloc parcours de recrutement — statut, résultat et compte rendu de chaque étape déjà renseignée
            dans le pipeline (modale funnel), pour ne plus avoir à y retourner pour les consulter. */}
        {funnelSteps.length > 0 && (
          <Block icon={GitBranch} title="Parcours de recrutement">
            <div className="space-y-3">
              {funnelSteps.map(s => {
                const meta = STEP_TYPES[s.type]
                const result = s.result ? STEP_RESULT[s.result] : null
                return (
                  <div key={s.id} className="p-4 rounded-2xl" style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
                      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                        {s.label}
                      </p>
                      <div className="flex items-center gap-1.5">
                        {result && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${result.color}18`, color: result.color }}>
                            <result.Icon className="h-3 w-3" /> {result.label}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--color-text-muted)' }}>
                          {s.status === 'validated' && <CheckCircle2 className="h-3 w-3" />}{STEP_STATUS_LABEL[s.status]}
                        </span>
                      </div>
                    </div>
                    {s.validatedAt && (
                      <p className="text-[11px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
                        Validée le {new Date(s.validatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}{s.validatedBy ? ` par ${s.validatedBy}` : ''}
                      </p>
                    )}
                    {s.report && (
                      <p className="text-xs leading-relaxed mt-1 whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{s.report}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </Block>
        )}

        {/* Bloc recommandations — anciens employeurs/clients ayant répondu à une demande du candidat */}
        {recommendations.length > 0 && (
          <Block icon={Star} title="Recommandations">
            <div className="space-y-3">
              {recommendations.map(r => (
                <div key={r.$id} className="p-4 rounded-2xl" style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      {r.recipientName}{r.recipientCompany ? ` — ${r.recipientCompany}` : ''}
                    </p>
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(n => (
                        <Star key={n} className="h-3 w-3" color="#E8A33D" fill={(r.rating ?? 0) >= n ? '#E8A33D' : 'none'} />
                      ))}
                    </span>
                  </div>
                  {(r.recipientRole || r.relationship || r.period || r.experience) && (
                    <p className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                      {[r.recipientRole, r.relationship ? RELATIONSHIP_LABEL[r.relationship] : '', r.period, r.experience].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {(r.endorsedExpertises ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {(r.endorsedExpertises ?? []).map(e => <span key={e} className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(232,163,61,0.18)', color: '#8a6a1f' }}>{e}</span>)}
                    </div>
                  )}
                  {r.comment && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>&laquo; {r.comment} &raquo;</p>
                  )}
                </div>
              ))}
            </div>
          </Block>
        )}

        {/* Bloc expertises et formations */}
        {skills.length > 0 && (
          <Block icon={GraduationCap} title="Expertises">
            <div className="flex flex-wrap gap-1.5">
              {skills.map(s => (
                <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'rgba(184,134,11,0.1)', color: 'var(--color-primary)' }}>
                  {s}
                </span>
              ))}
            </div>
          </Block>
        )}

        {/* Bloc expériences professionnelles — synthèse par défaut, détail dépliable */}
        {profile.experienceSummary && (
          <Block icon={Building2} title="Expérience">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{profile.experienceSummary}</p>
            <div className="mt-3">
              <CvDetailExpander
                experiences={profile.experiences ?? []}
                education={profile.education ?? []}
                languages={profile.languages ?? []}
              />
            </div>
          </Block>
        )}

        {/* Bloc CV / candidature */}
        <Block icon={FileText} title="Candidature">
          <div className="flex flex-wrap gap-3">
            {candidate.cvFileId ? (
              <a href={`/api/cv/${candidate.cvFileId}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold no-underline transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-primary)', color: 'white' }}>
                <ExternalLink className="h-3.5 w-3.5" /> Voir le CV
              </a>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun CV joint</span>
            )}
            <span className="text-xs self-center" style={{ color: 'var(--color-text-muted)' }}>
              Candidature du {new Date(application.$createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        </Block>
      </div>

      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
      `}</style>
    </div>
  )
}

function Block({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Row({ icon: Icon, value, href }: { icon: React.ElementType; value: string; href?: string }) {
  const content = (
    <span className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
      {value}
    </span>
  )
  return href
    ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="no-underline hover:opacity-75">{content}</a>
    : content
}
