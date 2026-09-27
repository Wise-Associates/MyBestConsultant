import { getCvthequeCandidates } from './actions'
import { CvthequeClient } from './cvtheque-client'

export default async function CvthequePage() {
  const { candidates, error } = await getCvthequeCandidates()
  return <CvthequeClient initialCandidates={candidates} loadError={error} />
}
