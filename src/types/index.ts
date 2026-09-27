export type UserRole = 'admin' | 'recruiter' | 'candidate' | 'hunter'

export type LLMProvider = 'claude' | 'gpt4o' | 'teckia'

// Widened from a fixed union to a plain string: the recruitment funnel is now
// tenant-configurable (see FunnelStage) — a status can be one of the 6 seeded
// default slugs below, or any custom stage slug a recruiter has added. Existing
// lookups across the app already fall back gracefully for unknown values
// (`STATUS[app.status] ?? STATUS.pending`), so this widening is backward-compatible.
export type ApplicationStatus = string
export const DEFAULT_APPLICATION_STATUSES = [
  'pending', 'screening', 'interview', 'accepted', 'rejected', 'on_hold',
] as const

export type AIRecommendation = 'retain' | 'evaluate' | 'reject'

export interface Tenant {
  $id: string
  name: string
  slug: string
  logoUrl?: string
  recruiterId: string
  createdAt: string
}

export interface Job {
  $id: string
  tenantId: string
  title: string
  description: string
  skills: string[]
  location: string
  isActive: boolean
  createdAt: string
  // optional — add to Appwrite collection when ready
  contractType?: 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote?: 'onsite' | 'hybrid' | 'remote'
  salary?: number // €/month for CDI, TJM for freelance/mission
  companyName?: string // denormalized from tenant for display speed
  expiresAt?: string   // ISO date — auto-deactivation
}

export interface Application {
  $id: string
  jobId: string
  tenantId: string
  candidateId: string
  cvFileId: string
  status: ApplicationStatus
  aiScore?: number
  aiSummary?: string
  aiRecommendation?: AIRecommendation
  tags?: string[]
  note?: string
  /** Statut à l'intérieur de la phase actuelle (ex. « Planifié », « À recontacter »). */
  stageStatus?: string
  /** Funnel du candidat (JSON) : étapes, résultats, comptes rendus — voir lib/candidate-funnel. */
  funnelJson?: string
  createdAt: string
}

export type FunnelStageAutoAction = 'screening' | 'interview'

export interface FunnelStage {
  $id: string
  tenantId: string
  slug: string
  label: string
  color: string
  order: number
  // Suggested (never automatic — the recruiter always confirms) action shown on a card
  // when it sits in this stage, e.g. "Screening" on the first stage, "Entretien" later on.
  autoAction?: FunnelStageAutoAction
  /** Pipeline auquel appartient la phase ; absent = pipeline par défaut. */
  pipelineId?: string
  /** Statuts possibles pour un candidat dans cette phase. */
  statuses?: string[]
}

/** Pipeline personnalisé (les offres non affectées utilisent le pipeline par défaut). */
export interface FunnelPipeline {
  id: string
  name: string
  jobIds: string[]
  stages: FunnelStage[]
}

export type FunnelEventKind = 'stage_change' | 'screening' | 'interview' | 'contact'

export interface FunnelEvent {
  $id: string
  applicationId: string
  stageSlug: string
  kind: FunnelEventKind
  note?: string
  actorName?: string
  $createdAt: string
}

export interface Interview {
  $id: string
  applicationId: string
  transcript: string
  score?: number
  completedAt?: string
  createdAt: string
}

export interface AIConfig {
  $id: string
  activeProvider: LLMProvider
  claudeModel: string
  gpt4oModel: string
  teckiaModel: string
  pricingPerToken: Record<LLMProvider, number>
}

export interface TemplateConfig {
  $id: string
  activeTemplate: string
  customColors?: Record<string, string>
}

export interface UserProfile {
  $id: string
  userId: string
  role: UserRole
  tenantId?: string
  firstName: string
  lastName: string
  email: string
  companyName?: string
  phone?: string
  city?: string
  mobilityRadiusKm?: number
  cvProfileJson?: string
  cvFileId?: string
  openToWork?: boolean
  desiredSector?: string[]
  desiredRoles?: string[]
  photoUrl?: string
  linkedinUrl?: string
  whatsapp?: string
  createdAt: string
  emailVerification: boolean
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMResponse {
  content: string
  // 'claude' | 'gpt4o' | 'teckia' ou l'id d'un modèle open source ajouté dans /admin/llm-config (os-…)
  provider: string
  tokensUsed?: number
}

export type RecommendationStatus = 'pending' | 'submitted'

export interface Recommendation {
  $id: string
  candidateId: string
  candidateName: string
  recipientName: string
  /** Jamais renseigné dans les données envoyées à l'écran : l'adresse du recommandant n'est pas publique. */
  recipientEmail: string
  recipientCompany?: string
  /** Fonction du recommandant (ex. « Directrice des systèmes d'information »). */
  recipientRole?: string
  /** Lien avec le candidat : manager, client, collègue… (voir RELATIONSHIPS). */
  relationship?: string
  /** Expérience de collaboration concernée (mission, projet, poste). */
  experience?: string
  /** Période de collaboration (texte libre : « mars 2022 – juin 2023 »). */
  period?: string
  /** Expertises proposées par le candidat dans sa demande. */
  requestedExpertises?: string[]
  /** Expertises confirmées par le recommandant : ce sont elles qui comptent dans le matching. */
  endorsedExpertises?: string[]
  message?: string
  status: RecommendationStatus
  comment?: string
  rating?: number
  submittedAt?: string
  $createdAt: string
}

export interface ScreeningResult {
  score: number
  skills: string[]
  summary: string
  recommendation: AIRecommendation
  strengths: string[]
  weaknesses: string[]
}
