import { AppwriteException } from 'node-appwrite'
import { LLMChainError, callLLM } from '@/lib/ai/llm-router'
import { claudeUnavailableReason, llmFailureDetail } from '@/lib/ao/ai-failures'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import {
  classificationId, isCvClassificationsConfigured, saveClassification, storedClassificationVersion, type ClassifiedKind,
} from '@/lib/appwrite/cv-classifications'
import { indexClassifiedCv } from '@/lib/search/cv-index'
import { CLASSIFICATION_SYSTEM, CLASSIFICATION_VERSION, classificationSourceKey, parseClassification, type CvClassification } from '@/lib/cv-classification'
import { readCvForScoring } from '@/lib/sourcing-core'
import { profileForAi, type ProfileToScore } from '@/lib/vivier-matching'

// Classification d'un CV (ADR 0044) : Claude Haiku (choix de l'utilisateur du 2026-11-18), GPT-4o mini quand Claude ne
// répond pas (crédits, clé, panne, délai… : claudeUnavailableReason, demande du 2026-11-18). Une fois par version de CV :
// au dépôt (hooks des actions, en arrière-plan) et par `npm run cv:classify` (rattrapage). Le texte envoyé est celui de
// la notation (coordonnées masquées).

export const CLASSIFIER_MODELS = { claude: 'claude-haiku-5-5', fallback: 'gpt-4o-mini' } as const

/**
 * Classe le texte d'un CV ; null si la réponse est illisible. Claude indisponible : même demande à GPT-4o mini. Lève
 * l'erreur de Claude quand la requête est refusée pour elle-même, et LLMChainError (cause de chaque modèle, à journaliser
 * par llmFailureDetail) quand les deux ont échoué.
 */
export async function classifyCvText(cvText: string): Promise<{ classification: CvClassification; model: string } | null> {
  const ask = (provider: 'claude' | 'gpt4o', model: string) => callLLM([{ role: 'user', content: cvText }], CLASSIFICATION_SYSTEM, {
    provider, model, strict: true, maxTokens: 4000, timeoutMs: 90_000,
    // Classement de champs : réflexion courte (Haiku 5.5 réfléchit par défaut, effort moyen).
    ...(provider === 'claude' ? { effort: 'low' as const } : {}),
  })
  let model: string = CLASSIFIER_MODELS.claude
  let content: string
  try {
    content = (await ask('claude', CLASSIFIER_MODELS.claude)).content
  } catch (claudeErr) {
    const reason = claudeUnavailableReason(claudeErr)
    if (!reason) throw claudeErr
    console.warn(`[classification] Claude indisponible (${reason}) : classement par GPT-4o mini`)
    model = CLASSIFIER_MODELS.fallback
    try {
      content = (await ask('gpt4o', CLASSIFIER_MODELS.fallback)).content
    } catch (fallbackErr) {
      throw new LLMChainError([{ provider: 'claude', error: claudeErr }, { provider: 'gpt4o', error: fallbackErr }])
    }
  }
  const classification = parseClassification(content)
  return classification ? { classification, model } : null
}

export type ClassifyOutcome = 'classified' | 'up_to_date' | 'no_text' | 'invalid_answer' | 'missing' | 'off'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Texte d'un profil sans fichier (profil MBC Search, profil de chasseur saisi à la main) ; '' s'il est vide ou illisible. */
function profileText(raw: unknown): string {
  try {
    const p = JSON.parse(str(raw) || '{}') as Partial<ProfileToScore>
    // Profil sans contenu (ni compétence, ni résumé, ni expérience) : rien à classer, pas d'appel d'IA.
    const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '')
    if (!has(p.skills) && !has(p.experienceSummary) && !has(p.experiences)) return ''
    return profileForAi({
      skills: Array.isArray(p.skills) ? p.skills : [], experienceSummary: str(p.experienceSummary),
      experiences: Array.isArray(p.experiences) ? p.experiences : [], yearsOfExperience: p.yearsOfExperience ?? null,
      languages: Array.isArray(p.languages) ? p.languages : [],
    }).trim()
  } catch {
    return '' // profil abîmé : rien à classer
  }
}

/** Version d'un CV source (document `users` ou `vivier_cvs`) sans rien télécharger ; null s'il n'a rien à classer. */
export function sourceKeyOf(doc: Record<string, unknown>): string | null {
  const fileId = str(doc.cvFileId)
  if (fileId) return classificationSourceKey(fileId)
  const text = profileText(doc.cvProfileJson)
  return text ? classificationSourceKey(null, text) : null
}

/** La classification enregistrée correspond à cette version de CV et à ces consignes. */
export const isUpToDate = (stored: { sourceKey: string; version: number } | null, sourceKey: string) =>
  stored?.version === CLASSIFICATION_VERSION && stored.sourceKey === sourceKey

/**
 * Classe un CV source s'il ne l'est pas encore pour sa version actuelle (fichier, ou texte du profil sans fichier) et ces
 * consignes. Candidats et profils de chasseurs (`users`), CV des viviers (`vivier_cvs`). Lève sur un échec de lecture ou
 * de l'IA (l'appelant journalise ; le script compte et passe au suivant).
 */
export async function classifySource(kind: ClassifiedKind, sourceId: string): Promise<ClassifyOutcome> {
  if (!isCvClassificationsConfigured()) return 'off'
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, kind === 'vivier' ? COLLECTIONS.VIVIER_CVS : COLLECTIONS.USERS, sourceId).catch(err => {
    if (err instanceof AppwriteException && err.code === 404) return null
    throw err
  })
  if (!doc || (kind === 'candidate' && doc.role !== 'candidate' && doc.role !== 'hunter_profile')) return 'missing'

  const fileId = str(doc.cvFileId) || null
  // La version se connaît sans télécharger le fichier : rien n'est relu pour un CV déjà classé.
  const sourceKey = sourceKeyOf(doc)
  if (!sourceKey) return 'no_text'
  if (isUpToDate(await storedClassificationVersion(kind, sourceId), sourceKey)) return 'up_to_date'

  const text = fileId ? await readCvForScoring(fileId, kind === 'vivier' ? BUCKETS.VIVIER_CVS : BUCKETS.CVS) : profileText(doc.cvProfileJson)
  if (!text) return 'no_text'

  const result = await classifyCvText(text)
  if (!result) return 'invalid_answer'
  const tenantId = kind === 'vivier' ? str(doc.tenantId) : ''
  const ownerId = kind === 'vivier' ? str(doc.recruiterId) : str(doc.hunterUserId)
  await saveClassification({ kind, sourceId, sourceKey, model: result.model, classification: result.classification, tenantId, ownerId })
  // Index de recherche (phase 2) : jamais bloquant, rattrapé par npm run search:sync.
  await indexClassifiedCv({
    id: classificationId(kind, sourceId), kind, sourceId, tenantId, ownerId, classification: result.classification,
    role: kind === 'vivier' ? 'vivier' : str(doc.role), optedOut: doc.optedOutOfOutreach === true,
    cvDate: await cvDateOf(kind, doc, fileId),
  })
  return 'classified'
}

/**
 * Date de dépôt du CV, pour la fraîcheur et les tendances des statistiques : le fichier du CV d'un candidat (son CV
 * actuel), l'import d'un CV du vivier, la dernière modification d'un profil sans fichier. null si le fichier est illisible.
 */
export async function cvDateOf(kind: ClassifiedKind, doc: Record<string, unknown>, fileId: string | null): Promise<string | null> {
  if (kind === 'vivier') return str(doc.$createdAt) || null
  if (!fileId) return str(doc.$updatedAt) || null
  try {
    return (await createAdminClient().storage.getFile(BUCKETS.CVS, fileId)).$createdAt
  } catch (err) {
    console.error('[classification] date du CV illisible', fileId, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Cause d'un échec de classement pour les journaux : celle de chaque modèle quand Claude puis GPT-4o mini ont échoué
 * (llmFailureDetail), sinon le message (lecture du CV, Appwrite, requête refusée par Claude) ; jamais le texte du CV.
 */
export const classifyFailureText = (err: unknown): string =>
  err instanceof LLMChainError ? llmFailureDetail(err) : err instanceof Error ? err.message : String(err)

/** Classement en arrière-plan après un dépôt (`after`) : jamais bloquant, un échec est journalisé (le script le rattrape). */
export async function classifySourceInBackground(kind: ClassifiedKind, sourceId: string): Promise<void> {
  try {
    const outcome = await classifySource(kind, sourceId)
    if (outcome === 'invalid_answer') console.error('[classification] réponse illisible', kind, sourceId)
  } catch (err) {
    console.error('[classification] classement impossible', kind, sourceId, classifyFailureText(err))
  }
}
