import 'server-only'
import { createAdminClient } from '@/lib/appwrite/client'
import { DEFAULT_WEIGHTS, parseRecruiterWeights, type RecruiterWeights, type ScaleWeights } from '@/lib/scoring-weights'
import type { ActiveScale } from '@/lib/match-scoring'

// Poids personnels du recruteur (scoring-weights.ts) gardés dans les préférences de son compte Appwrite : propres à la
// personne, sans collection ni attribut à créer. Les préférences portent aussi le jeton d'invitation (team.ts) : on les
// relit pour les compléter, jamais pour les remplacer.

const PREF_KEY = 'scoringWeights'

/** Poids du recruteur `authUserId` ; préférences illisibles : poids par défaut et `unreadable` (journalisé). */
export async function loadRecruiterWeights(authUserId: string): Promise<{ weights: RecruiterWeights; unreadable: boolean }> {
  try {
    const prefs = await createAdminClient().users.getPrefs(authUserId) as Record<string, unknown>
    return { weights: parseRecruiterWeights(prefs[PREF_KEY]), unreadable: false }
  } catch (e) {
    console.error('[poids] préférences du recruteur non lues : poids par défaut', e instanceof Error ? e.message : e)
    return { weights: DEFAULT_WEIGHTS, unreadable: true }
  }
}

/**
 * Enregistre les poids d'un barème (déjà validés : ScaleWeightsSchemas) dans les préférences du compte : l'autre barème
 * et les autres préférences sont relus et gardés.
 */
export async function saveRecruiterWeights(authUserId: string, scale: ActiveScale, weights: ScaleWeights): Promise<void> {
  const { users } = createAdminClient()
  const prefs = await users.getPrefs(authUserId) as Record<string, unknown>
  const current = parseRecruiterWeights(prefs[PREF_KEY])
  await users.updatePrefs(authUserId, { ...prefs, [PREF_KEY]: { ...current, [scale]: weights } })
}
