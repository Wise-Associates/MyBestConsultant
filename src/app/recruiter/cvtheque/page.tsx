import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getRecruiterCvthequeCandidates } from './actions'
import { CvthequeClient } from './cvtheque-client'

export default async function RecruiterCvthequePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')

  const { candidates, error } = await getRecruiterCvthequeCandidates()

  return <CvthequeClient initialCandidates={candidates} loadError={error} />
}
