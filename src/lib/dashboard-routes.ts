import type { UserRole } from '@/types'

export const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  candidate: '/candidate/dashboard',
  recruiter: '/recruiter/dashboard',
  admin: '/admin/dashboard',
  hunter: '/hunter/dashboard',
}
