import 'server-only'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { parseDraftFields, parsePublishInput } from './publication-input'
import { liteOfPublished, publicJobFields, publicJobIdOf, publicVersion, type SocialPreview } from './publication-social'
import { fallbackCopy, tenderProject } from '@/lib/social-content'
import { createJob, getActiveJobs, getJobById, oneMonthFromNow } from '@/lib/appwrite/jobs'
import { descriptionForPublication } from '@/lib/description-sections'
import type { Job, UserProfile } from '@/types'
import { isDocumentId } from './access'
import { callLLM } from '@/lib/ai/llm-router'
import { PUBLICATION_AI, SCORING_AI } from '@/lib/ai/models'
import { CriteriaSetSchema, defaultCriteriaSet, type OfferCriteriaSet } from '@/lib/offer-criteria'
import { saveOfferCriteria } from '@/lib/offer-criteria-store'
import { CRITERIA_PROPOSAL_PROMPT, criteriaProposalRequest, parseCriteriaProposal } from './criteria-proposal'
import { findIdentifiers } from './name-match'
import { llmUnavailableReason } from './ai-failures'
import { distinctNames, publicLabel, rawPublicOffer, toPublicOffer } from './anonymize'
import { cleanedAo, hiddenNamesOf, publicationAiRequest, type HiddenNames } from './ai-input'
import {
  PLATFORM_NAMES, PUBLICATION_PROMPT, descriptionFromCopy, maskNames, maskTermsOf, modalityLines, parsePublicationCopy, platformMentions,
  type PublicationCopy,
} from './publication-copy'
import { manualRetryPatch } from './attempts'
import { deleteEach, parseBulkDeleteIds } from './bulk-delete'
import { canDeleteComment, parseCommentBody } from './comment-input'
import { createAoComment, deleteAoComment, deleteAoCommentsOfOffer, getAoComment, listAoComments, type AoComment } from './comments'
import { getJobMatches, runPoolMatching } from '@/lib/matching-core'
import { candidateNames, matchCandidatesForOffer } from '@/lib/sourcing-core'
import { offerDetails } from '@/lib/match-scoring'
import { bestMatches } from '@/lib/sourcing-rules'
import type { AoCommentView, AoDashboardActions, AoSyncPassResult, PublicationDraft, PublicationMode, PublicationPreview, SourcingResult } from './dashboard-types'
import { cityKey, titleKey } from './fingerprint'
import { filtersFromSearchParams, listSizeFromSearchParams, listToSearchParams } from './filters'
import { aoAccessFor, loadAoView } from './platform-view'
import { checkAssignee, getAoAssignee, notifyAssigneeWarning, setAoAssignee, setJobRecruiter } from '@/lib/recruiter-assignment'
import { shouldNotifyAssignee } from '@/lib/assignment-email'
import { jobOwnership, type JobCreator } from '@/lib/job-ownership'
import {
  deleteAoOfferAndDetails, getAoOfferCriteria, getAoOfferSourcing, listAoEmailsByIds, listAoOfferDetails, saveAoOfferCriteria,
  saveAoOfferSourcing, updateAoEmail, updateAoOffer,
} from './repo'
import { getAoSource } from './sources'
import { getBrandByTenantId } from '@/lib/appwrite/brand'
import { PLATFORM_RECRUITER, takeOpening, withRecruiterOpening } from './recruiter-opening'
import { PLATFORM_TENANT_ID } from './tenancy'
import { requestPublicationStop } from './state'
import { syncAoEmail, syncAoInbox, type AoSyncReport } from './sync'
import type { AoOffer } from './types'

// Cœur des actions du tableau AO, partagé par /admin/candidats (boîtes de la plateforme) et
// /recruiter/parametres/boites-ao (boîtes de l'organisation du recruteur). Les actions serveur de chaque page
// vérifient d'abord l'appelant (rôle, session) et passent SON organisation ; chaque fonction ici ne touche qu'aux
// e-mails et offres des boîtes de cette organisation (access.ts) et répond « introuvable » pour les autres.

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))


/**
 * Noms à masquer de l'offre (hiddenNamesOf, ai-input.ts), à partir de son e-mail d'origine, de ses détails et de sa
 * boîte, lus ici.
 */
async function hiddenNamesFor(offer: AoOffer): Promise<HiddenNames> {
  const [emails, details] = await Promise.all([listAoEmailsByIds([offer.emailId]), listAoOfferDetails([offer.$id])])
  const email = emails.get(offer.emailId)
  const source = email?.sourceId ? await getAoSource(email.sourceId) : null
  return hiddenNamesOf({ companyName: offer.companyName, email, contact: details.get(offer.$id)?.contact, ownDomains: source?.ownDomains ?? [] })
}

/**
 * Un petit passage du bouton « Synchroniser maintenant » : AoSyncProvider les enchaîne jusqu'à ce que les boîtes soient
 * lues (sync-loop.ts). Peu d'e-mails par passage : les offres apparaissent au fil de l'eau. Boîtes de l'organisation
 * seulement (verrou par organisation : un passage planifié en cours fait répondre `skipped`).
 */
export async function syncAoNow(tenantId: string, holder: string, pageQuery: string | null): Promise<AoSyncPassResult> {
  let report: AoSyncReport
  try {
    report = await syncAoInbox({ maxEmails: 2, budgetMs: 120_000, holder, tenantId })
  } catch (err) {
    console.error('AO: synchronisation impossible', tenantId, errorOf(err))
    return { error: `Synchronisation impossible : ${errorOf(err)}` }
  }
  // Données à jour renvoyées avec le compte rendu, pour la page affichée (`pageQuery` : ses filtres ; null hors de la
  // page AO) : elle les affiche tout de suite. Un rafraîchissement de la page (revalidatePath,
  // router.refresh) serait abandonné par Next.js au profit du passage suivant, lancé aussitôt.
  if (pageQuery === null) return { report }
  try {
    const params = new URLSearchParams(pageQuery)
    const filters = filtersFromSearchParams(params)
    // Autant d'offres que la page en affiche (« Afficher 50 offres de plus »), comparées par la même adresse.
    const size = listSizeFromSearchParams(params)
    const { rows, total, counts, recentEmails } = await loadAoView(tenantId, filters, size)
    return { report, view: { rows, total, size, counts, recentEmails, query: listToSearchParams(filters, size).toString() } }
  } catch (err) {
    // Le passage a eu lieu : son compte rendu compte, la synchronisation continue. La page est relue à la fin
    // (router.refresh) et affiche alors sa propre erreur si la lecture échoue encore.
    console.error('AO: page du tableau non relue après un passage', tenantId, errorOf(err))
    return { report }
  }
}

/**
 * Bouton « Réessayer » d'un e-mail non traité : remis en file quels que soient ses essais déjà comptés
 * (manualRetryPatch), autant de fois qu'on le relance, puis traité tout de suite (même traitement et même verrou
 * qu'une synchronisation). `beforeRetry` (recruteur : quota du jour) : appelé une fois l'e-mail vérifié, avant la
 * remise à zéro ; son message refuse la relance. Si ce traitement immédiat échoue ou qu'une synchronisation est en
 * cours, l'e-mail reste en file pour la suivante.
 */
export async function retryAoEmailOf(
  tenantId: string,
  id: string,
  { holder, path, beforeRetry }: { holder: string; path: string; beforeRetry?: () => Promise<string | null> },
): ReturnType<AoDashboardActions['retryEmail']> {
  let email
  try {
    email = (await aoAccessFor(tenantId).email(id))?.email
    if (!email) return { error: 'E-mail introuvable : rechargez la page.' }
    if (email.status !== 'failed') return { error: 'Cet e-mail n\'est plus en erreur : rechargez la page.' }
    const refused = await beforeRetry?.()
    if (refused) return { error: refused }
    const patch = manualRetryPatch(email)
    if (patch) await updateAoEmail(email.$id, patch)
  } catch (err) {
    return { error: `Relance impossible : ${errorOf(err)}` }
  }
  try {
    // Plus court que le passage planifié : l'utilisateur attend la réponse.
    return { report: await syncAoEmail(email, { budgetMs: 150_000, holder, tenantId }) }
  } catch (err) {
    return { error: `Traitement immédiat impossible (${errorOf(err)}) : l'e-mail est remis en file pour la prochaine synchronisation.` }
  } finally {
    revalidatePath(path)
  }
}

/**
 * Version anonymisée proposée avant publication (ADR 0013) : rédigée par l'IA à partir de l'offre déjà nettoyée
 * (publication-copy.ts), sinon par les règles automatiques seules. `beforeAi` est appelé juste avant l'IA, une fois
 * l'offre vérifiée : son message de refus (quota du jour des recruteurs…) donne la version des règles, comme une IA en
 * échec. Dans tous les cas, le résultat repasse par l'anonymisation, puis doit être relu et validé avant publication.
 * `mode: 'raw'` (« Publier sans anonymiser ») : l'offre telle que reçue, sans IA ni quota, à relire de la même façon.
 * `beforeSocialAi` : appelé juste avant que l'IA rédige les textes du post LinkedIn (version de l'IA seulement, ADR
 * 0058) ; son message de refus (quota du jour des recruteurs) donne des textes sans IA.
 */
export async function previewAoPublicationOf(
  tenantId: string,
  id: string,
  { beforeAi, beforeSocialAi, mode = 'anonymized' }: {
    beforeAi?: () => Promise<string | null>; beforeSocialAi?: () => Promise<string | null>; mode?: PublicationMode
  } = {},
): ReturnType<AoDashboardActions['previewPublication']> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    const key = `${titleKey(offer.title)}|${cityKey(offer.location)}`
    const similarJobs = (await getActiveJobs())
      .filter(job => `${titleKey(job.title)}|${cityKey(job.location)}` === key)
      .slice(0, 5)
      .map(job => ({ id: job.$id, title: job.title, location: job.location }))
    const terms = { contractType: offer.contractType, remote: offer.remote, salary: offer.salary, reviewed: false }

    const { clients, names, people } = await hiddenNamesFor(offer)
    const recruiter = await publisherNameOf(tenantId)
    // Critères de matching (ADR 0061) : ceux déjà enregistrés pour cet AO, sinon proposés par l'IA (version anonymisée,
    // même place du quota que sa rédaction), sinon ceux par défaut.
    const saved = await getAoOfferCriteria(offer.$id)
    if (mode === 'raw') {
      // Version non anonymisée : client et références restent ; les noms de personnes connus sont signalés à la relecture.
      // Sans IA ni quota, textes du post compris (ADR 0058) : ceux du repli, à relire et modifier (« Le projet » vide :
      // l'accroche de l'offre en tient lieu ; aucun pôle ; hashtags tirés des compétences).
      const draft = { ...rawPublicOffer(offer), ...terms, maskTerms: [], anonymized: false, criteria: saved ?? defaultAoCriteria(offer, names) }
      const preview = {
        draft, similarJobs, rewrite: 'raw' as const, notice: '', watchNames: people, maskedNames: [], hiddenNames: [], recruiter,
        criteriaSource: saved ? 'saved' as const : 'default' as const, criteriaNotice: '',
      }
      return { preview: await withSocialPreview(tenantId, offer.$id, preview, null) }
    }
    const refusal = (await beforeAi?.()) ?? null
    const [copy, proposal] = refusal !== null
      ? [refusal, null]
      : await Promise.all([rewriteForPublication(offer, clients, names), saved ? null : proposeCriteria(offer, names)])
    const criteria = saved ?? proposal?.set ?? defaultAoCriteria(offer, names)
    const criteriaFields = {
      criteriaSource: saved ? 'saved' as const : proposal && !proposal.notice ? 'ai' as const : 'default' as const,
      criteriaNotice: saved ? '' : proposal?.notice ?? refusal ?? '',
    }
    if (typeof copy === 'string') {
      const pub = toPublicOffer(offer, names)
      // Mise en forme (sections, puces) après l'anonymisation, qui retire les lignes de contact d'après leur début de ligne.
      const draft = { ...pub, description: descriptionForPublication(pub.description), ...terms, maskTerms: [], anonymized: true, criteria }
      // IA refusée (quota) ou indisponible : textes du post sans IA non plus.
      const preview = {
        draft, similarJobs, rewrite: 'rules' as const, notice: copy, watchNames: [...names, ...PLATFORM_NAMES], maskedNames: distinctNames(clients),
        hiddenNames: names, recruiter, ...criteriaFields,
      }
      return { preview: await withSocialPreview(tenantId, offer.$id, preview, null) }
    }
    const maskTerms = maskTermsOf(copy)
    const extra = maskNames(maskTerms)
    // Le secteur proposé par l'IA devient l'entreprise affichée, sauf s'il nomme le client ou contient des coordonnées.
    const label = publicLabel(copy.sector, [...names, ...extra])
    const pub = toPublicOffer({
      ...offer, title: copy.title, description: descriptionFromCopy(copy, modalityLines(offer)), location: copy.location || offer.location, skills: copy.skills,
      duration: '', startDate: '', experience: '', // déjà dans la section « Modalités », écrite par le code
    }, names, label, extra)
    // « Altrion recrute pour un grand groupe bancaire… » (demande de David) : après l'anonymisation, qui masquerait le nom
    // de l'organisation s'il est aussi celui d'un expéditeur (Wise Associates qui transfère l'e-mail).
    const description = withRecruiterOpening(pub.description, recruiter)
    const preview = {
      draft: { ...pub, description, ...terms, maskTerms, anonymized: true, criteria }, similarJobs, rewrite: 'ai' as const, notice: '',
      watchNames: [...names, ...extra, ...PLATFORM_NAMES], maskedNames: distinctNames([...clients, ...maskTerms]), hiddenNames: names, recruiter,
      ...criteriaFields,
    }
    return { preview: await withSocialPreview(tenantId, offer.$id, preview, beforeSocialAi ?? (async () => null)) }
  } catch (err) {
    return { error: errorOf(err) }
  }
}

/**
 * Post LinkedIn de la version à relire (ADR 0058) : « Le projet », pôle et hashtags, préparés maintenant à partir de
 * cette version pour être relus, puis repris tels quels par la diffusion. `beforeSocialAi` : null, sans IA (version des
 * règles, l'IA étant refusée ou indisponible ; version non anonymisée, sans quota) : le repli de la diffusion ; sinon
 * appelé juste avant l'IA, son message de refus (quota des recruteurs) donne aussi le repli, avec la raison. Aucun post
 * prévu (diffusion désactivée) ou réglages illisibles : rien n'est préparé, la diffusion fera comme avant. `tenantId`
 * est aussi l'organisation de l'offre publique (« admin » pour la plateforme : actions des deux pages).
 */
async function withSocialPreview(
  tenantId: string, offerId: string, preview: Omit<PublicationPreview, 'social'>, beforeSocialAi: (() => Promise<string | null>) | null,
): Promise<PublicationPreview> {
  const { generateCopy, linkedInPreviewOf } = await import('@/lib/social')
  let social: SocialPreview
  try {
    social = await linkedInPreviewOf(tenantId, publicJobIdOf(offerId))
  } catch (err) {
    console.error('AO: réglages de diffusion illisibles, post LinkedIn non montré', offerId, errorOf(err))
    social = { settings: null, notice: '', off: 'Réglages de diffusion illisibles : le post LinkedIn ne peut pas être montré. S’il part, l’IA le rédigera à la publication.' }
  }
  if (!social.settings) return { ...preview, social }
  const lite = liteOfPublished(parseDraftFields(preview.draft) ?? preview.draft, social.settings)
  const refusal = beforeSocialAi ? await beforeSocialAi() : null
  const copy = beforeSocialAi && !refusal ? await generateCopy(lite) : fallbackCopy(lite)
  // Version anonymisée : « Le projet » = la suite de « Le contexte », déjà relue avec l'offre (ADR 0060) ; rédigé à part
  // par l'IA, il répétait la phrase qui ouvre le post. Vide : le post reprend la section « Le contexte » entière.
  const context = preview.draft.anonymized ? tenderProject(lite.description) : copy.context
  const edits = { context, pole: copy.pole, hashtags: copy.hashtags }
  return { ...preview, draft: { ...preview.draft, social: edits }, social: { ...social, notice: refusal ?? '' } }
}

/**
 * Organisation qui publie une offre de `jobTenantId`, nommée en ouverture du contexte (recruiter-opening.ts) : la
 * plateforme sous le nom de Wise Associates, sinon l'organisation (nom de son document, comme le post LinkedIn :
 * tenantForSocial). Illisible : vide, l'offre garde la phrase de l'IA (« Un grand groupe bancaire recrute… »).
 */
async function publisherNameOf(jobTenantId: string): Promise<string> {
  if (jobTenantId === PLATFORM_TENANT_ID) return PLATFORM_RECRUITER
  const brand = await getBrandByTenantId(jobTenantId)
  if (!brand) console.warn('AO: nom de l’organisation illisible, contexte sans ouverture à son nom', jobTenantId)
  return brand?.name.trim() ?? ''
}

/** Critères par défaut d'un AO (sans IA, ADR 0061), sur son texte aux noms du client remplacés. */
const defaultAoCriteria = (offer: AoOffer, names: string[][]) => defaultCriteriaSet(cleanedAo(offer, names))

/**
 * Critères de matching proposés par l'IA de la notation (« Matching IA » de Config IA) à partir de l'AO aux noms du client
 * remplacés (ADR 0061) ; sinon les critères par défaut et la raison, affichée à la relecture.
 */
async function proposeCriteria(offer: AoOffer, names: string[][]): Promise<{ set: OfferCriteriaSet; notice: string }> {
  const fallback = defaultAoCriteria(offer, names)
  try {
    const { content } = await callLLM([{ role: 'user', content: criteriaProposalRequest(cleanedAo(offer, names)) }], CRITERIA_PROPOSAL_PROMPT, {
      ...SCORING_AI, maxTokens: 4000, timeoutMs: 60_000,
    })
    const set = parseCriteriaProposal(content, fallback)
    return set ? { set, notice: '' } : { set: fallback, notice: 'réponse de l\'IA illisible' }
  } catch (err) {
    console.error('AO: critères de matching non proposés par l\'IA', offer.$id, errorOf(err))
    return { set: fallback, notice: llmUnavailableReason(err) ?? 'service d\'IA indisponible pour le moment' }
  }
}

/**
 * Libellés, noms et intitulés des critères qui nomment encore le client (version anonymisée) ; vide sinon. `names` : les
 * noms connus et ceux que l'IA de la version publiée dit avoir retirés, comme pour le texte publié (publicVersion).
 */
const criteriaNaming = (set: OfferCriteriaSet, names: string[][]) => findIdentifiers(
  [...set.criteria.flatMap(c => [c.name, ...c.labels.map(l => l.label)]), ...set.alternativeTitles].join(' · '), names,
)

/** Version rédigée par l'IA, ou la raison pour laquelle elle n'a pas pu l'être (affichée à la relecture). */
async function rewriteForPublication(offer: AoOffer, clients: string[], names: string[][]): Promise<PublicationCopy | string> {
  // L'IA reçoit l'offre déjà nettoyée : coordonnées et références retirées, clients connus remplacés.
  const request = publicationAiRequest(offer, clients, names)
  try {
    // 8 000 jetons : la réflexion de Claude (adaptative) compte dans la limite, la réponse en fait environ 1 500.
    const { content } = await callLLM([{ role: 'user', content: request }], PUBLICATION_PROMPT, { ...PUBLICATION_AI, maxTokens: 8000, timeoutMs: 60_000 })
    return parsePublicationCopy(content) ?? 'réponse de l\'IA illisible'
  } catch (err) {
    console.error('AO: rédaction de la version publiée par l\'IA impossible', offer.$id, errorOf(err))
    // Le détail (réponse brute du fournisseur, parfois avec un morceau de clé) reste dans les journaux.
    return llmUnavailableReason(err) ?? 'service d\'IA indisponible pour le moment'
  }
}

/**
 * Publie une offre AO : sa copie anonymisée, ou non anonymisée si la personne qui publie l'a choisi (parsePublishInput).
 * `jobTenantId` : organisation de l'offre publique (« admin » pour les boîtes de la plateforme, comme l'import
 * d'offres ; celle du recruteur sinon). `publisher` : auteur de l'offre publique, son recruteur affecté si l'AO n'en a pas.
 */
export async function publishAoOfferOf(
  tenantId: string,
  id: string,
  input: PublicationDraft,
  jobTenantId: string,
  paths: string[],
  publisher: JobCreator,
): ReturnType<AoDashboardActions['publish']> {
  // Début de la requête : la diffusion sur les réseaux, en arrière-plan, doit finir avant maxDuration (page.tsx).
  const requestStart = Date.now()
  const parsed = parsePublishInput(input)
  if (parsed.error !== undefined) return { error: parsed.error }
  const { fields } = parsed
  // Version anonymisée : aucune mention de la plateforme (ADR 0060), signalée en rouge à la relecture ; refusée ici
  // plutôt que remplacée, un libellé à sa place changerait le sens de la phrase (« Transmis par … »).
  const platform = parsed.anonymized
    // L'ouverture « Wise Associates recrute pour » d'une offre de la plateforme est la seule mention permise.
    ? platformMentions([fields.title, fields.companyName, fields.location,
      takeOpening(fields.description, jobTenantId === PLATFORM_TENANT_ID ? PLATFORM_RECRUITER : '').description, ...fields.skills, parsed.social?.context ?? ''])
    : []
  if (platform.length > 0) return { error: `La version mentionne encore « ${platform[0]} » : retirez-le, puis publiez.` }
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published' || offer.jobId) return { error: 'Cette offre est déjà publiée.' }

    // Filet de sécurité : tout le texte édité (offre et textes du post LinkedIn relus, ADR 0058) repasse par
    // l'anonymisation, ou par le retrait des coordonnées personnelles pour une version non anonymisée. Même fonction que
    // l'aperçu du post (publication-social.ts).
    const names = parsed.anonymized ? (await hiddenNamesFor(offer)).names : []
    const recruiter = parsed.anonymized ? await publisherNameOf(jobTenantId) : ''
    const version = publicVersion(fields, { anonymized: parsed.anonymized, names, maskTerms: parsed.maskTerms, recruiter }, parsed.social)
    // Critères montrés à ceux qui ouvrent l'offre publiée : version anonymisée, jamais le client (mêmes noms que le texte).
    const naming = parsed.criteria ? criteriaNaming(parsed.criteria, [...names, ...maskNames(parsed.maskTerms)]) : []
    if (naming.length > 0) return { error: `Les critères de matching nomment encore « ${naming[0]} » : retirez-le, puis publiez.` }

    // Identifiant fixe : une double publication (deux onglets, nouvel essai après une erreur) échoue en 409
    // au lieu de créer une seconde offre, une seconde diffusion et un second sourcing.
    const jobId = publicJobIdOf(offer.$id)
    await updateAoOffer(offer.$id, { status: 'published', jobId })
    const job = version.job
    // Recruteur affecté sur la page de l'AO : repris par l'offre publiée. Illisible, ou AO non affecté : celui qui publie.
    const aoAssigneeId = await getAoAssignee(offer.$id).catch(err => {
      console.error('AO: recruteur affecté illisible, offre affectée à celui qui publie', offer.$id, errorOf(err))
      return ''
    })
    let created: Job | null = null
    try {
      created = await createJob({
        tenantId: jobTenantId,
        // Mêmes champs que ceux lus par l'aperçu du post LinkedIn (publication-social.ts).
        ...publicJobFields(job),
        expiresAt: oneMonthFromNow(),
        ...jobOwnership(publisher, aoAssigneeId),
      }, jobId)
    } catch (err) {
      if (!(await getJobById(jobId))) {
        await updateAoOffer(offer.$id, { status: 'to_review', jobId: null }).catch(rollback => {
          console.error('AO: offre restée « publiée » sans offre publique', offer.$id, errorOf(rollback))
        })
        throw err
      }
      // L'offre existe déjà (publication simultanée : la requête qui l'a créée lance la diffusion et le sourcing) :
      // elle reste publiée.
      console.error('AO: offre publique déjà créée', jobId, errorOf(err))
    }
    let notice: string | undefined
    if (created && parsed.criteria) {
      // Avant le sourcing automatique (après la réponse), qui note les CV sur ces critères.
      try {
        await saveOfferCriteria(jobId, parsed.criteria)
      } catch (err) {
        console.error('AO: critères de matching de l\'offre publiée non enregistrés', jobId, errorOf(err))
        notice = 'Offre publiée, mais ses critères de matching n\'ont pas pu être enregistrés : ses candidats sont notés sur le barème par défaut.'
      }
      // Copie sur l'AO (relecture, historique) : sans effet sur la notation, un échec est seulement journalisé.
      await saveAoOfferCriteria(offer.$id, parsed.criteria).catch(err =>
        console.error('AO: critères de matching non recopiés sur l\'appel d\'offres', offer.$id, errorOf(err)))
    }
    if (created) {
      // Diffusion sur les réseaux (Make → Buffer ; à défaut, ancien auto-post LinkedIn) et sourcing automatique (CV
      // analysés par l'IA, e-mail aux meilleurs candidats) après la réponse, en parallèle : attendus ici, ils feraient
      // patienter « Publier » environ 3 minutes. Le post reprend les textes relus avec la version (ADR 0058).
      const publicJob = created
      const { tryAutoPublishJob, deliveryDeadline } = await import('@/lib/social')
      const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
      after(() => tryAutoPublishJob(publicJob, deliveryDeadline(requestStart), version.social))
      after(() => tryAutoSourceCandidates(publicJob))
    }
    for (const path of paths) revalidatePath(path)
    return { jobId, notice }
  } catch (err) {
    return { error: `Publication impossible : ${errorOf(err)}` }
  }
}

/**
 * Critères de matching d'un AO pas encore publié (ADR 0061), réglés avant sa publication : gardés pour la relecture
 * suivante et pour sa section Sourcing. `criteria` vient du navigateur : validé ici (CriteriaSetSchema) ; null les retire.
 */
export async function saveAoCriteriaOf(tenantId: string, id: string, criteria: unknown): Promise<{ error?: string }> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }
    if (offer.status === 'published' || offer.jobId) return { error: 'Offre déjà publiée : ses critères ne se modifient plus ici.' }
    if (criteria === null) {
      await saveAoOfferCriteria(offer.$id, null)
      return {}
    }
    const parsed = CriteriaSetSchema.safeParse(criteria)
    if (!parsed.success) return { error: `Critères non enregistrés : ${parsed.error.issues[0]?.message ?? 'critères invalides.'}` }
    await saveAoOfferCriteria(offer.$id, parsed.data)
    return {}
  } catch (err) {
    return { error: `Critères non enregistrés : ${errorOf(err)}` }
  }
}

export async function setAoOfferStatusOf(tenantId: string, id: string, status: 'to_review' | 'ignored', path: string): ReturnType<AoDashboardActions['setStatus']> {
  if (status !== 'to_review' && status !== 'ignored') return { error: 'Statut invalide.' }
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published') return { error: 'Une offre publiée se gère depuis la liste des offres publiées.' }
    await updateAoOffer(offer.$id, { status })
    revalidatePath(path)
    return {}
  } catch (err) {
    return { error: errorOf(err) }
  }
}

/**
 * « Tout arrêter » du panneau d'une offre publiée (décision du 2026-10-29, publication-stop.ts) : arrête ses tâches
 * automatiques pas encore faites — la diffusion LinkedIn tant qu'elle n'est pas remise à Make, les e-mails aux candidats
 * pas encore envoyés. Ce qui est déjà parti ne peut pas être rappelé. `holder` : compte qui le demande (journal).
 */
export async function stopAoPublicationTasksOf(tenantId: string, id: string, holder: string, path: string): ReturnType<NonNullable<AoDashboardActions['stopTasks']>> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }
    if (!offer.jobId) return { error: 'Offre pas encore publiée : rien à arrêter.' }
    await requestPublicationStop(offer.jobId, holder, new Date())
    const { stopQueuedDiffusion } = await import('@/lib/social')
    const diffusion = await stopQueuedDiffusion(offer.jobId)
    revalidatePath(path)
    const lead = diffusion === 'stopped' ? 'Diffusion LinkedIn arrêtée avant l’envoi. '
      : diffusion === 'sent' ? 'La diffusion LinkedIn était déjà remise à Make : elle ne peut plus être arrêtée. '
      : diffusion === 'running' ? 'Une diffusion LinkedIn lancée ou relancée à la main est en cours : elle n’est pas arrêtée. '
      : 'Une diffusion LinkedIn automatique qui démarrerait est arrêtée. '
    return { message: `${lead}Les e-mails automatiques aux candidats pas encore envoyés ne partiront pas ; ceux déjà envoyés ne peuvent pas être rappelés.` }
  } catch (err) {
    console.error('AO: arrêt des tâches de la publication impossible', id, errorOf(err))
    return { error: 'Arrêt impossible pour le moment : réessayez dans quelques instants.' }
  }
}

// ── Sourcing (meilleurs candidats pour une offre) ─────────────────

/**
 * Sourcing d'une offre AO, toujours enregistré pour ne pas refaire d'appel d'IA à chaque ouverture :
 * - offre publiée : matching calculé à la publication (tryAutoSourceCandidates → runPoolMatching), lu avec
 *   getJobMatches (base candidats, vivier, candidatures) ;
 * - offre non publiée : dernier calcul à la demande, enregistré dans ao_offer_details (identifiants, scores, raisons).
 * `vivierOwner` : profil du recruteur dont les CV de vivier sont montrés (un vivier est personnel), null pour tous ceux
 * de l'organisation (admin de la plateforme).
 * `recompute` : recalcule d'abord (un appel d'IA, environ une minute). `beforeAi` est appelé juste avant cet appel, une
 * fois l'offre vérifiée : un message de refus l'empêche (quota du jour des recruteurs) ; sans recalcul, aucun appel.
 * Seuls les 5 meilleurs notés 65 ou plus sont renvoyés (même règle que l'e-mail automatique de la publication).
 */
export async function aoOfferSourcingOf(
  tenantId: string,
  id: string,
  { recompute, beforeAi, vivierOwner }: { recompute: boolean; beforeAi?: () => Promise<string | null>; vivierOwner: string | null },
): Promise<SourcingResult> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }

    if (offer.jobId) {
      if (recompute) {
        const refused = await beforeAi?.()
        if (refused) return { error: refused }
      }
      // Une partie des CV non notés (IA indisponible) : les notes enregistrées s'affichent, avec l'avertissement.
      const run = recompute ? await runPoolMatching(offer.jobId, undefined, 'all') : null
      if (run?.error && run.matched === 0) return { error: run.error }
      const { matches, poolComputedAt } = await getJobMatches(offer.jobId, tenantId, vivierOwner)
      const kept = bestMatches(matches).map(m => ({ id: `${m.source}:${m.id}`, name: m.name, score: m.score, reason: m.reason, origin: m.source }))
      return { candidates: kept, computedAt: poolComputedAt, error: run?.error }
    }

    let record = recompute ? null : await getAoOfferSourcing(offer.$id)
    if (!record && !recompute) return { computedAt: null }
    if (!record) {
      const refused = await beforeAi?.()
      if (refused) return { error: refused }
      const technologies = (await listAoOfferDetails([offer.$id])).get(offer.$id)?.technologies ?? []
      const result = await matchCandidatesForOffer({
        title: offer.title,
        skills: offer.skills,
        description: offer.description,
        details: [
          technologies.length ? `Technologies : ${technologies.join(', ')}` : '',
          offer.experience ? `Expérience requise : ${offer.experience}` : '',
          ...offerDetails(offer),
        ].filter(Boolean),
        // Critères enregistrés pour cet AO (ADR 0061) : les mêmes que ceux de l'offre une fois publiée.
        criteria: await getAoOfferCriteria(offer.$id),
      })
      if (result.error) return { error: result.error, scanned: result.scanned }
      record = {
        at: new Date().toISOString(),
        scanned: result.scanned,
        candidates: bestMatches(result.matches).map(m => ({ candidateId: m.candidateId, score: m.score, reason: m.reason })),
      }
      await saveAoOfferSourcing(offer.$id, record)
    }
    const names = await candidateNames(record.candidates.map(c => c.candidateId))
    const kept = record.candidates
      .filter(c => names.has(c.candidateId))
      .map(c => ({ id: `pool:${c.candidateId}`, name: names.get(c.candidateId) ?? '', score: c.score, reason: c.reason, origin: 'pool' as const }))
    return { candidates: kept, computedAt: record.at, scanned: record.scanned }
  } catch (err) {
    return { error: `Sourcing impossible : ${errorOf(err)}` }
  }
}

// ── Commentaires (notes internes de l'organisation) ───────────────

/** Message d'erreur d'une action sur les commentaires ; la collection manquante a déjà son message complet. */
function commentsError(err: unknown, action: string): string {
  const message = errorOf(err)
  return message.startsWith('Commentaires indisponibles') ? message : `${action} : ${message}`
}

const toCommentView = (c: AoComment, userId: string): AoCommentView => ({
  id: c.$id, authorName: c.authorName || 'Utilisateur', body: c.body, createdAt: c.createdAt, mine: canDeleteComment(c, userId),
})

/** Commentaires d'une offre de l'organisation, du plus ancien au plus récent. */
export async function listAoOfferCommentsOf(tenantId: string, userId: string, offerId: string): ReturnType<AoDashboardActions['listComments']> {
  try {
    if (!(await aoAccessFor(tenantId).offer(offerId))) return { error: 'Offre introuvable : rechargez la page.' }
    return { comments: (await listAoComments(offerId)).map(c => toCommentView(c, userId)) }
  } catch (err) {
    return { error: commentsError(err, 'Commentaires illisibles') }
  }
}

export async function addAoOfferCommentOf(tenantId: string, user: UserProfile, offerId: string, body: string): ReturnType<AoDashboardActions['addComment']> {
  const text = parseCommentBody(body)
  if (!text.ok) return { error: text.error }
  try {
    if (!(await aoAccessFor(tenantId).offer(offerId))) return { error: 'Offre introuvable : rechargez la page.' }
    const comment = await createAoComment({
      offerId,
      tenantId,
      authorId: user.userId,
      authorName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
      body: text.body,
    })
    return { comment: toCommentView(comment, user.userId) }
  } catch (err) {
    return { error: commentsError(err, 'Commentaire non enregistré') }
  }
}

/** Supprime un commentaire : son auteur seulement, sur une offre de l'organisation. */
export async function deleteAoOfferCommentOf(tenantId: string, userId: string, commentId: string): ReturnType<AoDashboardActions['deleteComment']> {
  if (!isDocumentId(commentId)) return { error: 'Commentaire introuvable : rechargez la page.' }
  try {
    const comment = await getAoComment(commentId)
    if (!comment || comment.tenantId !== tenantId || !(await aoAccessFor(tenantId).offer(comment.offerId))) return { error: 'Commentaire introuvable : rechargez la page.' }
    if (!canDeleteComment(comment, userId)) return { error: 'Seul l\'auteur d\'un commentaire peut le supprimer.' }
    await deleteAoComment(comment.$id)
    return {}
  } catch (err) {
    return { error: commentsError(err, 'Suppression impossible') }
  }
}

// ── Suppression d'une offre ──────────────────────────────────────

/**
 * Supprime définitivement une offre AO de l'organisation, avec ses commentaires et ses détails. Refusé pour une offre
 * publiée : son offre publique resterait en ligne sans son appel d'offres. L'e-mail reste enregistré, l'offre n'est
 * donc pas recréée par la synchronisation suivante (« Ignorer », lui, la garde en la masquant).
 */
export async function deleteAoOfferOf(tenantId: string, id: string): ReturnType<AoDashboardActions['deleteOffer']> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }
    if (offer.status === 'published' || offer.jobId) {
      return { error: 'Offre publiée : retirez d\'abord l\'offre publique, sinon elle resterait en ligne sans son appel d\'offres.' }
    }
    await deleteAoCommentsOfOffer(offer.$id)
    await deleteAoOfferAndDetails(offer.$id)
    return {}
  } catch (err) {
    console.error('AO: suppression d\'offre impossible', id, errorOf(err))
    return { error: `Suppression impossible : ${errorOf(err)}` }
  }
}

/**
 * Supprime les offres sélectionnées dans le tableau (BULK_DELETE_MAX par envoi), chacune comme deleteAoOfferOf :
 * offre de l'organisation seulement, offre publiée refusée. Une offre refusée n'arrête pas les autres ; elle est
 * rapportée avec sa raison. `ids` vient du navigateur : validé ici (bulk-delete.ts).
 */
export async function deleteAoOffersOf(tenantId: string, ids: unknown): ReturnType<AoDashboardActions['deleteOffers']> {
  const parsed = parseBulkDeleteIds(ids)
  if (!parsed.ok) return { error: parsed.error }
  return deleteEach(parsed.ids, id => deleteAoOfferOf(tenantId, id))
}

/**
 * Affecte l'offre `id` de l'organisation à un de ses recruteurs (`recruiterId` = son profil, users.$id ; vide :
 * personne). `assigner` : profil (`id`) et compte Auth (`userId`, copie de l'e-mail) de celui qui affecte. Avant
 * publication, gardé
 * sur l'offre AO et repris à la publication ; une offre déjà publiée change aussi de recruteur. Le nouveau recruteur
 * est prévenu par e-mail, `assigner` en copie (lien vers `assigner.offerPath`) ; un échec de l'e-mail n'annule pas
 * l'affectation (`warning`).
 */
export async function assignAoOfferOf(
  tenantId: string, id: string, recruiterId: string, paths: string[],
  assigner: { id: string; userId: string; name: string; offerPath: string },
): Promise<{ error?: string; warning?: string }> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    const refused = await checkAssignee(tenantId, recruiterId)
    if (refused) return { error: refused }
    const previous = await getAoAssignee(offer.$id)
    await setAoAssignee(offer.$id, recruiterId)
    if (offer.jobId && !(await setJobRecruiter(tenantId, offer.jobId, recruiterId))) {
      console.error('AO: offre publiée introuvable pour l\'affectation', offer.$id, offer.jobId)
    }
    for (const path of paths) revalidatePath(path)
    const warning = shouldNotifyAssignee(previous, recruiterId, assigner.id)
      ? await notifyAssigneeWarning({
        tenantId, assigneeId: recruiterId, assignerUserId: assigner.userId, assignerName: assigner.name,
        kind: 'ao', title: offer.title, location: offer.location, path: assigner.offerPath,
      })
      : null
    return warning ? { warning } : {}
  } catch (err) {
    return { error: `Affectation impossible : ${errorOf(err)}` }
  }
}
