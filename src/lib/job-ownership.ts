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
