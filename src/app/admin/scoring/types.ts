export interface ScoringWeightsConfig {
  // 0–1 — share of the final matching score coming from the candidate's average
  // recommendation rating, when they have at least one submitted recommendation.
  recommendationWeight: number
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeightsConfig = {
  recommendationWeight: 0.15,
}
