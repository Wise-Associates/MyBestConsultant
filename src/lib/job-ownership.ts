// Auteur et recruteur affecté d'une offre (jobs.postedBy, jobs.recruiterId) et recruteur affecté d'un appel d'offres
// (ao_offer_details.assigneeId) : identifiant du DOCUMENT DE PROFIL (users.$id), comme postedBy l'a toujours été
// (ADR 0023, demande du 2026-11-02) ; une offre créée a donc recruiterId === postedBy. Le compte Auth (users.userId) ne
// sert qu'aux appels Auth et Messaging (recruiter-assignment.ts). tenants.recruiterId, propriétaire de l'organisation
// (un seul par organisation), reste le compte Auth.

/** Profil de celui qui crée l'offre (UserProfile). */
export interface JobCreator {
  $id: string
}

/**
 * Champs d'auteur d'une offre créée par `creator`. Le recruteur affecté est l'auteur, sauf offre publiée depuis un appel
 * d'offres déjà affecté (`aoAssigneeId`) : elle garde le recruteur de l'AO.
 */
export function jobOwnership(creator: JobCreator, aoAssigneeId = ''): { postedBy: string; recruiterId: string } {
  return { postedBy: creator.$id, recruiterId: aoAssigneeId || creator.$id }
}

/** Profil lu par scripts/jobs-fill-recruiter.mts. */
export interface UserRef {
  $id: string
  userId: string
  tenantId: string
  role: string
}

/** Profil désigné par un identifiant de profil, ou par un compte Auth (valeur écrite avant l'ADR 0023). */
export type FindUser = (id: string) => UserRef | undefined

export type JobRecruiterPlan =
  /** recruiterId est déjà un profil. */
  | { note: 'already' }
  /** recruiterId est un compte Auth (valeur ancienne) : remplacé par le profil de la même personne. */
  | { note: 'converted'; recruiterId: string }
  /** Offre sans recruteur, affectée à son auteur. */
  | { note: 'filled'; recruiterId: string }
  /** recruiterId ne désigne aucun utilisateur (compte supprimé) : gardé tel quel. */
  | { note: 'recruiter-unknown' }
  /** Offre sans recruteur dont postedBy ne désigne aucun profil. */
  | { note: 'author-unknown' }
  /** Offre sans recruteur dont l'auteur n'est pas recruteur de son organisation (offre déplacée, rôle changé). */
  | { note: 'author-outside' }
  /** Ni auteur ni recruteur (offre de la plateforme, ancienne offre) : rien à faire. */
  | { note: 'unowned' }

/**
 * Recruteur affecté d'une offre existante, au format de l'ADR 0023 : un compte Auth est converti en profil ; une offre
 * sans recruteur est affectée à son auteur s'il est recruteur de l'organisation de l'offre (même règle que l'affectation
 * dans « Mes offres », checkAssignee).
 */
export function planJobRecruiter(job: { tenantId: string; postedBy: string; recruiterId: string }, find: FindUser): JobRecruiterPlan {
  if (job.recruiterId) {
    const recruiter = find(job.recruiterId)
    if (!recruiter) return { note: 'recruiter-unknown' }
    return recruiter.$id === job.recruiterId ? { note: 'already' } : { note: 'converted', recruiterId: recruiter.$id }
  }
  if (!job.postedBy) return { note: 'unowned' }
  const author = find(job.postedBy)
  if (!author) return { note: 'author-unknown' }
  if (author.role !== 'recruiter' || !job.tenantId || author.tenantId !== job.tenantId) return { note: 'author-outside' }
  return { note: 'filled', recruiterId: author.$id }
}

/**
 * Un recruteur de l'organisation `tenantId` ouvre le pipeline et le Matching IA d'une offre de son organisation, ou
 * d'une offre partagée par la plateforme (tenantId ''). Jamais sans organisation.
 */
export function recruiterCanOpenJob(jobTenantId: string, tenantId: string | null | undefined): boolean {
  return !!tenantId && (jobTenantId === tenantId || jobTenantId === '')
}

/**
 * Un recruteur de l'organisation `tenantId` voit et gère une candidature : sur une offre de son organisation, toutes ;
 * sur une offre partagée par la plateforme (tenantId ''), les siennes (« Ajouter dans le funnel ») et les candidatures
 * directes (tenantId ''), jamais celles qu'une autre organisation y a ajoutées (même règle que le Matching IA,
 * matching-core.ts). Revue de sécurité du 2026-11-13.
 */
export function recruiterCanSeeApplication(jobTenantId: string, applicationTenantId: string, tenantId: string | null | undefined): boolean {
  if (!recruiterCanOpenJob(jobTenantId, tenantId)) return false
  return jobTenantId !== '' || applicationTenantId === tenantId || applicationTenantId === ''
}

/**
 * Qui consulte les offres (ADR 0043, demande du 2026-11-17) : son organisation, son profil et son compte Auth (pour
 * reconnaître le recruteur affecté, écrit avec l'un ou l'autre avant l'ADR 0023), et s'il voit toutes les offres de
 * l'organisation : le propriétaire et les administrateurs (rôles de l'ADR 0033). Un membre ne voit que les siennes.
 */
export interface OfferViewer { tenantId: string; profileId: string; userId: string; seesAllOffers: boolean }

/** L'offre est affectée à ce recruteur (recruiterId = son profil, ou son compte Auth pour une valeur ancienne). */
export const isAssignedTo = (recruiterId: unknown, viewer: Pick<OfferViewer, 'profileId' | 'userId'>) =>
  typeof recruiterId === 'string' && recruiterId !== '' && (recruiterId === viewer.profileId || recruiterId === viewer.userId)

/**
 * Offre que ce recruteur ouvre (détail, Matching IA, funnel, réponse client, et leurs actions) : celles que
 * recruiterCanOpenJob permet à son organisation ; pour un membre, seulement les offres de l'organisation qui lui sont
 * affectées (ni les autres, ni celles de la plateforme, affectées à personne).
 */
export function viewerCanOpenJob(job: { tenantId: unknown; recruiterId?: unknown }, viewer: OfferViewer): boolean {
  const jobTenantId = typeof job.tenantId === 'string' ? job.tenantId : ''
  if (!recruiterCanOpenJob(jobTenantId, viewer.tenantId)) return false
  return viewer.seesAllOffers || (jobTenantId === viewer.tenantId && isAssignedTo(job.recruiterId, viewer))
}

/** Candidature que ce recruteur voit : offre qu'il ouvre (viewerCanOpenJob) et candidature visible de son organisation. */
export function viewerCanSeeApplication(job: { tenantId: unknown; recruiterId?: unknown }, applicationTenantId: unknown, viewer: OfferViewer): boolean {
  const jobTenantId = typeof job.tenantId === 'string' ? job.tenantId : ''
  return viewerCanOpenJob(job, viewer)
    && recruiterCanSeeApplication(jobTenantId, typeof applicationTenantId === 'string' ? applicationTenantId : '', viewer.tenantId)
}
