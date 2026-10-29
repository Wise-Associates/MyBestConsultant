import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { recruiterCvExportAccess } from '@/lib/cv-export/recruiter'
import { getRecruiterCvthequeCandidates } from './actions'
import { CvthequeClient } from './cvtheque-client'

// Dépôt du modèle CV (Server Action de cette page) : cartographie par l'IA, deux réponses de 120 s au plus (ADR 0014).
export const maxDuration = 300

export default async function RecruiterCvthequePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')

  const [{ candidates, error }, cvExport] = await Promise.all([getRecruiterCvthequeCandidates(), recruiterCvExportAccess(user)])

  return <CvthequeClient initialCandidates={candidates} loadError={error} cvExport={cvExport.access} cvExportError={cvExport.error} />
}
