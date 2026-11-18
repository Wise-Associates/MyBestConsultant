import { CvStatsSkeleton } from '@/components/recruiter/page-skeletons'
import { ADMIN_STATS_VARS } from '@/components/stats/cv-stats-sections'

// Même forme que la page des recruteurs, aux couleurs claires du back-office.
export default function Loading() {
  return (
    <div className="admin-light min-h-full" style={{ ...ADMIN_STATS_VARS, background: 'var(--admin-bg)' }}>
      <CvStatsSkeleton />
    </div>
  )
}
