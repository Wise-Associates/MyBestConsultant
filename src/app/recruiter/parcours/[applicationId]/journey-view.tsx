import Link from 'next/link'
import { ChevronLeft, FileText, History, Route } from 'lucide-react'
import {
  FIRST_TRACKED_STAGE, advanceBlockedReason, describeEvent, journeySteps, pieceStatusDef, reachedPieces, stageDef,
  type JourneyStageKey, type JourneyState, type PieceTone,
} from '@/lib/consultant-journey'
import { JourneyStepper } from '../journey-stepper'
import { JourneyActions, type PieceActionView } from './journey-actions'

// Écran du parcours d'un consultant sur une offre (ADR 0021) : bandeau des étapes, pièces avec leur statut, historique
// et panneau « Actions », sur le modèle d'un suivi de contrat. Données chargées et vérifiées par page.tsx.

const TONE: Record<PieceTone, { background: string; color: string }> = {
  pending: { background: 'rgba(180,83,9,0.10)', color: '#b45309' },
  success: { background: 'rgba(4,120,87,0.10)', color: '#047857' },
  danger: { background: 'rgba(185,28,28,0.08)', color: '#b91c1c' },
}

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })
const dateTimeFr = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' })

/** Outils existants à ouvrir depuis l'étape en cours. */
function stageLinks(stage: JourneyStageKey, ids: { applicationId: string; jobId: string }) {
  switch (stage) {
    case 'funnel': return [{ href: `/recruiter/pipeline/${ids.jobId}`, label: 'Ouvrir le pipeline de l’offre' }]
    case 'entretiens': return [{ href: `/recruiter/interviews/new?appId=${ids.applicationId}&jobId=${ids.jobId}`, label: 'Préparer un entretien IA' }]
    case 'cv_valide': return [{ href: `/recruiter/candidates/${ids.applicationId}`, label: 'Relire la fiche du candidat' }]
    case 'cv_format': return [{ href: '/recruiter/cvtheque', label: 'Exporter le CV format cabinet' }]
    default: return []
  }
}

export interface JourneyViewProps {
  applicationId: string
  jobId: string
  candidateName: string
  /** null : offre supprimée. */
  jobTitle: string | null
  /** Appel d'offres d'origine (null : offre créée directement). */
  aoOfferId: string | null
  score: number | null
  /** false : collection absente sur cet environnement. */
  configured: boolean
  /** null : pas encore démarré (ou illisible, voir `unreadable`). */
  journey: JourneyState | null
  version: number | null
  unreadable: boolean
  /** Collection inutilisable sur ce projet (message pour l'utilisateur). */
  storeProblem?: string | null
}

export function JourneyView({
  applicationId, jobId, candidateName, jobTitle, aoOfferId, score, configured, journey, version, unreadable, storeProblem = null,
}: JourneyViewProps) {
  const steps = journeySteps(journey, { fromAo: aoOfferId !== null, score })

  const stage = journey?.stage ?? FIRST_TRACKED_STAGE
  const def = stageDef(stage)
  const currentPiece = journey && def.piece ? def.piece : null
  const pieceActions: PieceActionView[] = currentPiece
    ? currentPiece.statuses
      .filter(s => s.actionLabel && s.key !== journey?.pieces[currentPiece.key]?.status)
      .map(s => ({ piece: currentPiece.key, status: s.key, label: s.actionLabel as string, tone: s.tone }))
    : []
  const links = [
    ...(aoOfferId ? [{ href: `/recruiter/parametres/boites-ao/${aoOfferId}`, label: 'Voir l’appel d’offres' }] : []),
    ...stageLinks(stage, { applicationId, jobId }),
  ]
  const pieces = journey ? reachedPieces(journey) : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/recruiter/parcours" className="inline-flex items-center gap-1 text-xs no-underline mb-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Tous les parcours
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.15)' }}>
              <Route className="h-6 w-6" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate" style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>{candidateName}</h1>
              <p className="text-sm mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Parcours consultant · {jobTitle ?? 'Offre supprimée'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="rounded-2xl p-3" style={card}>
          <JourneyStepper steps={steps} />
        </div>

        {!configured ? (
          <p role="status" className="rounded-2xl p-5 text-sm" style={{ ...card, color: 'var(--color-text-muted)' }}>
            Le suivi des parcours n’est pas encore activé sur cet environnement (collection « consultant_journeys » à créer).
          </p>
        ) : storeProblem ? (
          <p role="alert" className="rounded-2xl p-5 text-sm" style={{ ...card, color: '#b91c1c' }}>{storeProblem}</p>
        ) : unreadable ? (
          <p role="alert" className="rounded-2xl p-5 text-sm" style={{ ...card, color: '#b91c1c' }}>
            Ce parcours est illisible et ne peut pas être modifié. Contactez le support en indiquant cette candidature.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="space-y-6 order-2 lg:order-1">
              <section aria-labelledby="journey-pieces-title" className="rounded-2xl p-5" style={card}>
                <h2 id="journey-pieces-title" className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.95rem' }}>
                  <FileText className="h-4 w-4" aria-hidden /> Pièces
                </h2>
                {pieces.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Les pièces (CV format cabinet, proposition au client, contrat, timesheet, facture) apparaissent ici à partir de la validation du CV.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {pieces.map(piece => {
                      const state = journey?.pieces[piece.key]
                      const status = state ? pieceStatusDef(piece.key, state.status) : undefined
                      return (
                        <li key={piece.key} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{piece.label}</p>
                            {state && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Mis à jour le {dateFr(state.at)}</p>}
                          </div>
                          {status && (
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0" style={TONE[status.tone]}>{status.label}</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section aria-labelledby="journey-history-title" className="rounded-2xl p-5" style={card}>
                <h2 id="journey-history-title" className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.95rem' }}>
                  <History className="h-4 w-4" aria-hidden /> Historique
                </h2>
                {!journey ? (
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Le candidat est dans le funnel de l’offre. Démarrez le parcours pour suivre les étapes jusqu’à la facture.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {[...journey.history].reverse().map((event, i) => (
                      <li key={`${event.at}-${i}`} className="text-sm">
                        <p style={{ color: 'var(--color-text)' }}>{describeEvent(event)}</p>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{dateTimeFr(event.at)} · {event.by}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <div className="order-1 lg:order-2">
              <JourneyActions
                applicationId={applicationId}
                version={version}
                abandoned={journey?.status === 'abandoned'}
                advance={def.advanceLabel && journey ? { label: def.advanceLabel, blockedReason: advanceBlockedReason(journey) } : null}
                canGoBack={stage !== FIRST_TRACKED_STAGE}
                pieceActions={pieceActions}
                links={links}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
