// Parcours consultant (ADR 0021, demande du 2026-10-30 du product owner) : d'un appel d'offres jusqu'à la facture,
// pour un candidat sur une offre (une candidature). Règles pures, testées dans consultant-journey.test.ts ; le
// stockage est dans src/lib/appwrite/consultant-journeys.ts, l'écran dans src/app/recruiter/parcours/.
//
// Les trois premières étapes (AO importé, publié, matching) ont lieu avant que la candidature n'existe : elles sont
// lues sur l'offre et la candidature, jamais enregistrées ici. Le parcours enregistré commence au funnel.

export type JourneyStageKey =
  | 'ao' | 'publication' | 'matching'
  | 'funnel' | 'entretiens' | 'cv_valide' | 'cv_format' | 'envoi_client' | 'contrat' | 'timesheet' | 'facture'

export type JourneyPieceKey = 'cv_format' | 'envoi_client' | 'contrat' | 'timesheet' | 'facture'

export type PieceTone = 'pending' | 'success' | 'danger'

export interface PieceStatusDef {
  key: string
  label: string
  /** Bouton du panneau « Actions » qui donne ce statut (absent : statut posé en entrant dans l'étape). */
  actionLabel?: string
  tone: PieceTone
}

export interface PieceDef {
  key: JourneyPieceKey
  label: string
  /** Le premier statut est posé en entrant dans l'étape. */
  statuses: PieceStatusDef[]
  /** Statut qui permet de passer à l'étape suivante. */
  doneStatus: string
  /** Message quand ce statut manque. */
  blockedReason: string
}

export interface JourneyStageDef {
  key: JourneyStageKey
  label: string
  /** Étape lue sur l'offre et la candidature (avant le parcours enregistré). */
  derived?: true
  /** Bouton qui fait passer à l'étape suivante. */
  advanceLabel?: string
  piece?: PieceDef
}

export const JOURNEY_STAGES: JourneyStageDef[] = [
  { key: 'ao', label: 'AO importé', derived: true },
  { key: 'publication', label: 'Publié', derived: true },
  { key: 'matching', label: 'Matching & score', derived: true },
  { key: 'funnel', label: 'Funnel', advanceLabel: 'Passer aux entretiens' },
  { key: 'entretiens', label: 'Entretiens', advanceLabel: 'Passer à la validation du CV' },
  { key: 'cv_valide', label: 'CV validé', advanceLabel: 'Valider le CV' },
  {
    key: 'cv_format', label: 'CV format cabinet', advanceLabel: 'Envoyer au client',
    piece: {
      key: 'cv_format', label: 'CV format cabinet', doneStatus: 'pret',
      blockedReason: 'Le CV format cabinet doit d’abord être prêt.',
      statuses: [
        { key: 'a_produire', label: 'À produire', tone: 'pending' },
        { key: 'pret', label: 'Prêt', actionLabel: 'CV format cabinet prêt', tone: 'success' },
      ],
    },
  },
  {
    key: 'envoi_client', label: 'Envoyé au client', advanceLabel: 'Proposer un contrat',
    piece: {
      key: 'envoi_client', label: 'Proposition au client', doneStatus: 'retenu',
      blockedReason: 'Le client doit d’abord retenir le consultant.',
      statuses: [
        { key: 'envoye', label: 'En attente du client', tone: 'pending' },
        { key: 'retenu', label: 'Retenu par le client', actionLabel: 'Retenu par le client', tone: 'success' },
        { key: 'refuse', label: 'Refusé par le client', actionLabel: 'Refusé par le client', tone: 'danger' },
      ],
    },
  },
  {
    key: 'contrat', label: 'Contrat', advanceLabel: 'Demander le timesheet',
    piece: {
      key: 'contrat', label: 'Contrat', doneStatus: 'signe',
      blockedReason: 'Le contrat doit d’abord être signé.',
      statuses: [
        { key: 'propose', label: 'Proposé', tone: 'pending' },
        { key: 'signe', label: 'Signé', actionLabel: 'Contrat signé', tone: 'success' },
        { key: 'refuse', label: 'Refusé', actionLabel: 'Contrat refusé', tone: 'danger' },
      ],
    },
  },
  {
    key: 'timesheet', label: 'Timesheet', advanceLabel: 'Préparer la facture',
    piece: {
      key: 'timesheet', label: 'Timesheet', doneStatus: 'valide',
      blockedReason: 'Le timesheet doit d’abord être validé.',
      statuses: [
        { key: 'demande', label: 'Demandé', tone: 'pending' },
        { key: 'recu', label: 'Reçu', actionLabel: 'Timesheet reçu', tone: 'pending' },
        { key: 'valide', label: 'Validé', actionLabel: 'Timesheet validé', tone: 'success' },
      ],
    },
  },
  {
    key: 'facture', label: 'Facture',
    piece: {
      key: 'facture', label: 'Facture', doneStatus: 'payee',
      blockedReason: 'Dernière étape du parcours.',
      statuses: [
        { key: 'a_emettre', label: 'À émettre', tone: 'pending' },
        { key: 'emise', label: 'Émise', actionLabel: 'Facture émise', tone: 'pending' },
        { key: 'payee', label: 'Payée', actionLabel: 'Facture payée', tone: 'success' },
      ],
    },
  },
]

/** Étapes du parcours enregistré (à partir du funnel). */
export const TRACKED_STAGES = JOURNEY_STAGES.filter(s => !s.derived)
export const FIRST_TRACKED_STAGE: JourneyStageKey = 'funnel'

export const stageIndex = (key: JourneyStageKey) => JOURNEY_STAGES.findIndex(s => s.key === key)
export const stageDef = (key: JourneyStageKey) => JOURNEY_STAGES[stageIndex(key)]
export const isTrackedStage = (key: string): key is JourneyStageKey =>
  TRACKED_STAGES.some(s => s.key === key)

export interface JourneyPieceState {
  status: string
  at: string
}

export type JourneyEventKind = 'start' | 'advance' | 'back' | 'piece' | 'abandon' | 'resume'

export interface JourneyEvent {
  kind: JourneyEventKind
  at: string
  by: string
  /** Étape après l'événement. */
  stage: JourneyStageKey
  piece?: JourneyPieceKey
  status?: string
  note?: string
}

export interface JourneyState {
  stage: JourneyStageKey
  /** 'abandoned' : parcours arrêté (client ou consultant qui renonce) ; « Reprendre » le rouvre où il était. */
  status: 'active' | 'abandoned'
  pieces: Partial<Record<JourneyPieceKey, JourneyPieceState>>
  history: JourneyEvent[]
}

export type JourneyAction =
  | { type: 'advance' }
  | { type: 'back' }
  | { type: 'piece'; piece: JourneyPieceKey; status: string }
  | { type: 'abandon'; note?: string }
  | { type: 'resume' }

/** L'historique est gardé dans un seul attribut texte : on n'en garde que la fin. */
export const MAX_HISTORY = 200

export function newJourney(by: string, now: Date): JourneyState {
  return {
    stage: FIRST_TRACKED_STAGE,
    status: 'active',
    pieces: {},
    history: [{ kind: 'start', at: now.toISOString(), by, stage: FIRST_TRACKED_STAGE }],
  }
}

/** Pourquoi on ne peut pas passer à l'étape suivante (null : on peut). */
export function advanceBlockedReason(journey: JourneyState): string | null {
  if (journey.status !== 'active') return 'Le parcours est abandonné : reprenez-le d’abord.'
  const def = stageDef(journey.stage)
  if (!def.advanceLabel) return 'Dernière étape du parcours.'
  if (def.piece && journey.pieces[def.piece.key]?.status !== def.piece.doneStatus) return def.piece.blockedReason
  return null
}

/** Pièces visibles : celles des étapes atteintes. */
export function reachedPieces(journey: JourneyState): PieceDef[] {
  const current = stageIndex(journey.stage)
  return JOURNEY_STAGES.filter((s, i) => s.piece && i <= current).map(s => s.piece as PieceDef)
}

/** Parcours terminé : facture payée. */
export const isJourneyComplete = (journey: JourneyState) => journey.pieces.facture?.status === 'payee'

export type JourneyResult = { ok: true; journey: JourneyState } | { ok: false; error: string }

export function applyJourneyAction(journey: JourneyState, action: JourneyAction, by: string, now: Date): JourneyResult {
  const at = now.toISOString()
  const withEvent = (next: Omit<JourneyState, 'history'>, event: Omit<JourneyEvent, 'at' | 'by' | 'stage'>): JourneyResult => ({
    ok: true,
    journey: { ...next, history: [...journey.history, { ...event, at, by, stage: next.stage }].slice(-MAX_HISTORY) },
  })

  if (action.type === 'resume') {
    if (journey.status !== 'abandoned') return { ok: false, error: 'Le parcours est déjà en cours.' }
    return withEvent({ ...journey, status: 'active' }, { kind: 'resume' })
  }
  if (journey.status !== 'active') return { ok: false, error: 'Le parcours est abandonné : reprenez-le d’abord.' }

  switch (action.type) {
    case 'advance': {
      const blocked = advanceBlockedReason(journey)
      if (blocked) return { ok: false, error: blocked }
      const next = JOURNEY_STAGES[stageIndex(journey.stage) + 1]
      const pieces = { ...journey.pieces }
      // Entrer dans une étape avec une pièce pose son premier statut (« Envoyer au client » → en attente du client).
      // Une pièce déjà présente (retour en arrière puis avance) garde son statut.
      if (next.piece && !pieces[next.piece.key]) pieces[next.piece.key] = { status: next.piece.statuses[0].key, at }
      return withEvent({ ...journey, stage: next.key, pieces }, { kind: 'advance' })
    }
    case 'back': {
      const index = stageIndex(journey.stage)
      if (journey.stage === FIRST_TRACKED_STAGE) return { ok: false, error: 'Première étape du parcours.' }
      return withEvent({ ...journey, stage: JOURNEY_STAGES[index - 1].key }, { kind: 'back' })
    }
    case 'piece': {
      const piece = reachedPieces(journey).find(p => p.key === action.piece)
      if (!piece) return { ok: false, error: 'Cette pièce n’est pas encore à l’ordre du jour.' }
      if (!piece.statuses.some(s => s.key === action.status)) return { ok: false, error: 'Statut inconnu.' }
      if (journey.pieces[piece.key]?.status === action.status) return { ok: false, error: 'La pièce a déjà ce statut.' }
      return withEvent(
        { ...journey, pieces: { ...journey.pieces, [piece.key]: { status: action.status, at } } },
        { kind: 'piece', piece: piece.key, status: action.status },
      )
    }
    case 'abandon':
      return withEvent({ ...journey, status: 'abandoned' }, { kind: 'abandon', note: action.note?.trim() || undefined })
  }
}

/** Relit un parcours enregistré ; null si le contenu est illisible (le parcours n'est alors pas modifiable). */
export function parseJourney(stage: unknown, status: unknown, piecesJson: unknown, historyJson: unknown): JourneyState | null {
  if (typeof stage !== 'string' || !isTrackedStage(stage)) return null
  if (status !== 'active' && status !== 'abandoned') return null
  try {
    const pieces = typeof piecesJson === 'string' && piecesJson ? JSON.parse(piecesJson) : {}
    const history = typeof historyJson === 'string' && historyJson ? JSON.parse(historyJson) : []
    if (typeof pieces !== 'object' || pieces === null || Array.isArray(pieces) || !Array.isArray(history)) return null
    return { stage, status, pieces, history }
  } catch {
    return null
  }
}

export function pieceStatusDef(piece: JourneyPieceKey, status: string): PieceStatusDef | undefined {
  return JOURNEY_STAGES.find(s => s.piece?.key === piece)?.piece?.statuses.find(s => s.key === status)
}

/** Libellé d'un événement de l'historique, pour l'écran. */
export function describeEvent(event: JourneyEvent): string {
  switch (event.kind) {
    case 'start': return 'Parcours démarré'
    case 'advance': return `Étape « ${stageDef(event.stage)?.label ?? event.stage} »`
    case 'back': return `Retour à l’étape « ${stageDef(event.stage)?.label ?? event.stage} »`
    case 'piece': {
      const piece = JOURNEY_STAGES.find(s => s.piece?.key === event.piece)?.piece
      const status = event.piece && event.status ? pieceStatusDef(event.piece, event.status) : undefined
      return `${piece?.label ?? 'Pièce'} : ${status?.label ?? event.status ?? ''}`
    }
    case 'abandon': return event.note ? `Parcours abandonné : ${event.note}` : 'Parcours abandonné'
    case 'resume': return 'Parcours repris'
  }
}

export type JourneyStepState = 'done' | 'current' | 'upcoming' | 'skipped'

/**
 * État de chaque étape pour le bandeau. `journey` null : parcours pas encore démarré, le candidat est au funnel (il a
 * une candidature). `fromAo` : l'offre vient d'un appel d'offres publié (sinon « AO importé » est sans objet).
 */
export function journeySteps(
  journey: JourneyState | null, derived: { fromAo: boolean; score: number | null },
): { key: JourneyStageKey; label: string; state: JourneyStepState; caption?: string }[] {
  const current = stageIndex(journey?.stage ?? FIRST_TRACKED_STAGE)
  const complete = journey ? isJourneyComplete(journey) : false
  return JOURNEY_STAGES.map((stage, i) => {
    if (stage.key === 'ao') {
      return derived.fromAo ? { key: stage.key, label: stage.label, state: 'done' } : { key: stage.key, label: stage.label, state: 'skipped', caption: 'Offre directe' }
    }
    if (stage.key === 'matching' && derived.score != null) {
      return { key: stage.key, label: stage.label, state: 'done', caption: `Score ${Math.round(derived.score)}/100` }
    }
    if (i < current || (i === current && complete)) return { key: stage.key, label: stage.label, state: 'done' }
    if (i === current) {
      return { key: stage.key, label: stage.label, state: 'current', caption: journey?.status === 'abandoned' ? 'Abandonné' : undefined }
    }
    return { key: stage.key, label: stage.label, state: 'upcoming' }
  })
}
