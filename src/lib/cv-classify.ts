import { AppwriteException } from 'node-appwrite'
import { LLMChainError, callLLM } from '@/lib/ai/llm-router'
import { CLASSIFICATION_AI, CLASSIFIER_MODELS } from '@/lib/ai/models'
import { llmFailureDetail } from '@/lib/ao/ai-failures'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import {
  classificationId, isCvClassificationsConfigured, saveClassification, storedClassificationVersion, type ClassifiedKind,
} from '@/lib/appwrite/cv-classifications'
import { indexClassifiedCv } from '@/lib/search/cv-index'
import { MeiliError, facetCounts, isSearchConfigured } from '@/lib/search/meili'
import { CLASSIFICATION_SYSTEM, RULES_MODEL, classificationSourceKey, isUpToDate, parseClassification, type CvClassification } from '@/lib/cv-classification'
import { buildRuleVocabulary, classifyCvByRules, type RuleVocabulary } from '@/lib/cv-classification-rules'
import { readCvForScoring } from '@/lib/sourcing-core'
import { profileForAi, type ProfileToScore } from '@/lib/vivier-matching'

// Classification d'un CV (ADR 0044) : ligne « Classification des CV » de Config IA (Claude si « Modèle par défaut »),
// puis la chaîne de repli de toute la plateforme (modèle par défaut, TeckiA, GPT, modèles open source : callLLM) —
// demande du 2026-11-18 ; Claude en Haiku et GPT en GPT-4o mini (CLASSIFIER_MODELS, choix du 2026-11-18). Aucun modèle
// disponible : classement par règles (classifyWithFallback). Une fois par version de CV : au dépôt (hooks des actions,
// en arrière-plan) et par `npm run cv:classify` (rattrapage). Le texte envoyé est celui de la notation (coordonnées
// masquées), aux mêmes fournisseurs que la notation des CV.

// Modèles précis de la classification, dans ai/models.ts (aussi lus par le classement des offres, job-classify.ts).
export { CLASSIFIER_MODELS }

/**
 * Classe le texte d'un CV par le modèle de la ligne « Classification des CV », puis la chaîne de repli ; null si la
 * réponse est illisible. Lève LLMChainError (cause de chaque modèle, à journaliser par llmFailureDetail) quand toute la
 * chaîne a échoué. `model` enregistré : celui de CLASSIFIER_MODELS, sinon l'identifiant du fournisseur (« teckia »,
 * « os-… »).
 */
export async function classifyCvText(cvText: string): Promise<{ classification: CvClassification; model: string } | null> {
  const { content, provider } = await callLLM([{ role: 'user', content: cvText }], CLASSIFICATION_SYSTEM, {
    ...CLASSIFICATION_AI, providerModels: CLASSIFIER_MODELS, maxTokens: 4000, timeoutMs: 90_000,
    // Classement de champs : réflexion courte (Haiku 5.5 réfléchit par défaut, effort moyen) ; ignoré hors Claude.
    effort: 'low',
  })
  const classification = parseClassification(content)
  return classification ? { classification, model: (CLASSIFIER_MODELS[provider] ?? provider).slice(0, 40) } : null
}

export type ClassifyOutcome = 'classified' | 'classified_by_rules' | 'invalid_answer' | 'up_to_date' | 'no_text' | 'missing' | 'off'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Texte d'un profil sans fichier (profil MBC Search, profil de chasseur saisi à la main) ; '' s'il est vide ou illisible.
 * Aussi lu par l'export des exemples d'entraînement (scripts/finetune-cv-dataset.mts) : le même texte que le classement.
 */
export function profileText(raw: unknown): string {
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

// Vocabulaire du classement sans IA, relu au plus une fois par heure (l'index et les offres changent lentement) ; une
// minute quand une source était illisible : relu bientôt, mais pas à chaque CV pendant une panne.
const VOCABULARY_TTL_MS = 60 * 60 * 1000
const DEGRADED_VOCABULARY_TTL_MS = 60 * 1000
let vocabularyCache: { until: number; value: RuleVocabulary } | null = null

/**
 * Vocabulaire du classement sans IA : listes de départ, plus les compétences et métiers que l'IA a déjà relevés (index de
 * recherche : les 100 plus fréquents de chacun). Pas les compétences des offres, saisies librement par les recruteurs
 * (buildRuleVocabulary). Index illisible : journalisé, listes de départ seules.
 */
async function ruleVocabulary(): Promise<RuleVocabulary> {
  if (vocabularyCache && Date.now() < vocabularyCache.until) return vocabularyCache.value
  let complete = true
  const unreadable = (source: string) => (err: unknown) => {
    // Index pas encore créé (aucune synchronisation) : rien à y lire, ce n'est pas une panne.
    if (err instanceof MeiliError && err.status === 404) return null
    complete = false
    console.error(`[classification] vocabulaire des règles : ${source} illisible`, err instanceof Error ? err.message : err)
    return null
  }
  const indexed = isSearchConfigured()
    ? await facetCounts('kind IN ["candidate", "vivier"]', ['skills', 'roles']).catch(unreadable('index de recherche'))
    : null
  const value = buildRuleVocabulary({
    skills: Object.keys(indexed?.facetDistribution?.skills ?? {}),
    roles: Object.keys(indexed?.facetDistribution?.roles ?? {}),
  })
  vocabularyCache = { until: Date.now() + (complete ? VOCABULARY_TTL_MS : DEGRADED_VOCABULARY_TTL_MS), value }
  return value
}

type Classified = { classification: CvClassification; model: string }
const byRules = async (text: string, vocabulary: () => Promise<RuleVocabulary>, now: Date): Promise<Classified> =>
  ({ classification: classifyCvByRules(text, await vocabulary(), now), model: RULES_MODEL })

/** Dépendances de classifyWithFallback, remplacées par les tests (cv-classify.test.ts). */
export interface FallbackDeps {
  byAi: (text: string) => Promise<Classified | null>
  vocabulary: () => Promise<RuleVocabulary>
  now: () => Date
}
const DEFAULT_DEPS: FallbackDeps = { byAi: classifyCvText, vocabulary: ruleVocabulary, now: () => new Date() }

/**
 * Classification par l'IA, ou par les règles (cv-classification-rules.ts) quand aucune IA n'a pu répondre : toute la
 * chaîne de modèles en échec (LLMChainError : pannes, crédits, aucune clé ni URL configurée). Enregistrée alors avec
 * RULES_MODEL et refaite par l'IA dès qu'elle répond (isUpToDate). null : réponse illisible — une IA a répondu, le CV
 * reste à classer (journalisé en erreur). Toute autre erreur remonte.
 */
export async function classifyWithFallback(text: string, kind: ClassifiedKind, sourceId: string, deps: FallbackDeps = DEFAULT_DEPS): Promise<Classified | null> {
  let result: Classified | null
  try {
    result = await deps.byAi(text)
  } catch (err) {
    if (!(err instanceof LLMChainError)) throw err
    console.warn('[classification] aucune IA disponible : classement par règles, à refaire par l\'IA', kind, sourceId, classifyFailureText(err).slice(0, 400))
    return byRules(text, deps.vocabulary, deps.now())
  }
  if (!result) console.error('[classification] réponse illisible : CV à classer de nouveau', kind, sourceId)
  return result
}

/**
 * Classe un CV source s'il ne l'est pas encore pour sa version actuelle (fichier, ou texte du profil sans fichier), ces
 * consignes et par l'IA. Candidats et profils de chasseurs (`users`), CV des viviers (`vivier_cvs`). Sans IA disponible,
 * classé par les règles (classifyWithFallback) ; `rulesOnly` : par les règles sans appeler l'IA, un CV déjà classé (par
 * l'IA ou les règles) n'étant pas refait (npm run cv:classify -- --rules). Lève sur un échec de lecture, d'enregistrement
 * ou une requête refusée par l'IA (l'appelant journalise ; le script compte et passe au suivant).
 */
export async function classifySource(kind: ClassifiedKind, sourceId: string, { rulesOnly = false }: { rulesOnly?: boolean } = {}): Promise<ClassifyOutcome> {
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
  if (isUpToDate(await storedClassificationVersion(kind, sourceId), sourceKey, { acceptRules: rulesOnly })) return 'up_to_date'

  const text = fileId ? await readCvForScoring(fileId, kind === 'vivier' ? BUCKETS.VIVIER_CVS : BUCKETS.CVS) : profileText(doc.cvProfileJson)
  if (!text) return 'no_text'

  const result = rulesOnly ? await byRules(text, ruleVocabulary, new Date()) : await classifyWithFallback(text, kind, sourceId)
  if (!result) return 'invalid_answer'
  const tenantId = kind === 'vivier' ? str(doc.tenantId) : ''
  const ownerId = kind === 'vivier' ? str(doc.recruiterId) : str(doc.hunterUserId)
  await saveClassification({ kind, sourceId, sourceKey, model: result.model, classification: result.classification, tenantId, ownerId })
  // Index de recherche (phase 2) : jamais bloquant, rattrapé par la synchronisation de l'index (src/lib/search/sync.ts).
  await indexClassifiedCv({
    id: classificationId(kind, sourceId), kind, sourceId, tenantId, ownerId, classification: result.classification,
    role: kind === 'vivier' ? 'vivier' : str(doc.role), optedOut: doc.optedOutOfOutreach === true,
    cvDate: await cvDateOf(kind, doc, fileId),
  })
  return result.model === RULES_MODEL ? 'classified_by_rules' : 'classified'
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

/** Raison journalisée quand un CV déposé n'est pas classé sans erreur. */
const NOT_CLASSIFIED: Partial<Record<ClassifyOutcome, string>> = {
  off: 'classification désactivée : APPWRITE_COLLECTION_CV_CLASSIFICATIONS absente de l\'environnement de l\'application',
  missing: 'source introuvable, ou compte qui n\'est ni candidat ni profil de chasseur',
  no_text: 'aucun texte lisible dans le CV (PDF scanné, fichier vide ou illisible)',
}

/** Classement en arrière-plan après un dépôt (`after`) : jamais bloquant, un échec est journalisé (le script le rattrape). */
export async function classifySourceInBackground(kind: ClassifiedKind, sourceId: string): Promise<void> {
  try {
    const outcome = await classifySource(kind, sourceId)
    // Un CV déposé qui n'est pas classé dit pourquoi (sinon rien dans les journaux : « je ne vois pas le CV dans
    // cv_classifications », 2026-11-18). « invalid_answer » est déjà journalisé par classifyWithFallback.
    const reason = NOT_CLASSIFIED[outcome]
    if (reason) console.warn('[classification] CV non classé', kind, sourceId, reason)
  } catch (err) {
    console.error('[classification] classement impossible', kind, sourceId, classifyFailureText(err))
  }
}
