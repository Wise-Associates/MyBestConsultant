import { getScoringWeights } from './actions'
import { ScoringWeightsClient } from './scoring-weights-client'

export default async function ScoringPage() {
  const weights = await getScoringWeights()
  return <ScoringWeightsClient initialWeights={weights} />
}
