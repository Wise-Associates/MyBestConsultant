import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { zipSync } from 'fflate'
import { AppwriteException } from 'node-appwrite'
import { z } from 'zod'
import { llmUnavailableReason } from '@/lib/ao/ai-failures'
import { getCurrentUser } from '@/lib/appwrite/auth'
import type { UserProfile } from '@/types'
import { exportBaseName } from './cv-data'
import { CvExportError, bundleCvExport, exportCandidateCv, type CvExportFile } from './export'
import type { GenerationSlot } from './recruiter'
import { cvExportErrorName, isCvExportStorageConfigured, listCvExports, readCvExportFiles, saveCvExports } from './store'
import { CANDIDATE_ID, storedFor } from './stored'
import { SAMPLE_CV, TemplateError, checkTemplate } from './template-check'
import { loadEsnTemplate, readExampleTemplateFiles, type EsnTemplate } from './templates'

// Cœur commun des routes « Format ESN » de la plateforme (/api/admin/…) et des organisations (/api/recruiter/…) :
// export d'un candidat (cv-export) et téléchargements du modèle (cv-templates : aperçu fictif, exemple). Chaque route
// vérifie elle-même son appelant et fixe l'organisation d'après la session, jamais d'après la requête ; ce cœur valide la
// demande, génère (POST) ou relit (GET) la version de cette organisation et la livre. Le compte rendu (champs à compléter,
// contenus non repris) est renvoyé dans l'en-tête X-Cv-Export-Notes ; POST indique dans X-Cv-Export-Saved si la version a
// été enregistrée.

const ExportRequest = z.object({
  langs: z.array(z.enum(['fr', 'en'])).min(1).max(2).transform(langs => [...new Set(langs)]),
  mode: z.enum(['standard', 'renforcee']),
})

type SaveStatus = 'saved' | 'failed' | 'off'

// Les appels d'IA peuvent prendre 265 s : l'enregistrement est abandonné avant la fin des 300 s de la fonction, pour
// que le fichier généré soit livré quoi qu'il arrive (Appwrite n'a pas de délai d'attente côté client).
const SAVE_DEADLINE_MS = 285_000
const MIN_SAVE_TIME_MS = 15_000

export const deny = (status: number, error: string) => NextResponse.json({ error }, { status })

/** Admin de la plateforme ; sinon la réponse de refus. */
export async function adminDenial(): Promise<NextResponse | null> {
  const user = await getCurrentUser()
  if (!user) return deny(401, 'Non autorisé')
  if (user.role !== 'admin') return deny(403, 'Accès refusé')
  return null
}

/** Recruteur rattaché à une organisation, lue dans la session ; sinon la réponse de refus. */
export async function sessionRecruiter(): Promise<{ denied: NextResponse } | { user: UserProfile; tenantId: string }> {
  const user = await getCurrentUser()
  if (!user) return { denied: deny(401, 'Non autorisé') }
  if (user.role !== 'recruiter') return { denied: deny(403, 'Accès refusé') }
  if (!user.tenantId) return { denied: deny(403, 'Votre compte n\'est rattaché à aucune organisation.') }
  return { user, tenantId: user.tenantId }
}

/** Enregistre la génération dans le temps restant ; un échec est journalisé et signalé, jamais levé. */
async function saveWithinBudget(input: Parameters<typeof saveCvExports>[0], startedAt: number): Promise<SaveStatus> {
  const remaining = SAVE_DEADLINE_MS - (Date.now() - startedAt)
  if (remaining < MIN_SAVE_TIME_MS) {
    console.error('[cv-export] version non enregistrée : plus assez de temps après la génération', input.candidateId)
    return 'failed'
  }
  const saving = saveCvExports(input)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), remaining) })
  try {
    const outcome = await Promise.race([saving, timeout])
    if (outcome === 'saved') return 'saved'
    console.error('[cv-export] version non enregistrée', input.candidateId, outcome === 'timeout' ? 'délai dépassé' : 'candidat supprimé pendant la génération')
    if (outcome === 'timeout') {
      // L'enregistrement continue peut-être : son échec éventuel est journalisé (fichier sans document : supprimé avec le compte).
      saving.catch(err => console.error('[cv-export] enregistrement en échec après le délai', input.candidateId, cvExportErrorName(err)))
    }
    return 'failed'
  } catch (err) {
    console.error('[cv-export] version non enregistrée', input.candidateId, cvExportErrorName(err))
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/** Nom de fichier pour Content-Disposition : version ASCII, plus l'original encodé (RFC 5987). */
function disposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').slice(0, 150) || 'cv.docx'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 200))}`
}

// Téléchargement forcé, jamais affiché par le navigateur ni gardé en cache.
const DOWNLOAD_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }

function fileResponse(file: CvExportFile, notes: string[], saved?: SaveStatus): NextResponse {
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': disposition(file.fileName),
      ...DOWNLOAD_HEADERS,
      'X-Cv-Export-Notes': encodeURIComponent(JSON.stringify(notes)),
      ...(saved ? { 'X-Cv-Export-Saved': saved } : {}),
    },
  })
}

function zipResponse(files: Record<string, Uint8Array>, fileName: string): NextResponse {
  return new NextResponse(new Uint8Array(zipSync(files)), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition(fileName), ...DOWNLOAD_HEADERS },
  })
}

// Pour un recruteur : pas de détail de configuration de l'IA (crédits, clé, modèle), qu'il ne peut ni voir ni régler.
const UNAVAILABLE_FOR_RECRUITER = 'Génération indisponible pour le moment : réessayez plus tard ; si cela dure, contactez-nous.'

function errorResponse(err: unknown, candidateId: string, publicErrors = false): NextResponse {
  if (err instanceof CvExportError) {
    if (err.status >= 500) {
      // Notre message (sans donnée du CV) et la classe de la cause avec son statut, jamais le message de la cause : une
      // erreur d'API peut recopier la requête, donc le CV.
      const cause = err.cause
      const detail = cause instanceof Error ? `${cause.constructor.name}${'status' in cause ? ` ${String(cause.status)}` : ''}` : ''
      console.error('[cv-export] échec', candidateId, err.status, err.message, detail)
      if (publicErrors) return deny(err.status, UNAVAILABLE_FOR_RECRUITER)
    }
    return deny(err.status, err.message)
  }
  console.error('[cv-export] échec inattendu', candidateId, err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : String(err))
  return deny(500, 'Export impossible : erreur inattendue. Réessayez ; si cela se répète, signalez-le.')
}

/** Échec qui n'a rien coûté : IA refusée avant tout traitement (non configurée, crédits, clé, panne). */
const failedWithoutCost = (err: unknown) => err instanceof CvExportError && err.cause !== undefined && llmUnavailableReason(err.cause) !== null

export const isCandidateId = (candidateId: string) => CANDIDATE_ID.test(candidateId)

export interface GenerationScope {
  /** Organisation de l'appelant (« admin » : la plateforme), fixée par la route d'après la session. */
  tenantId: string
  template: EsnTemplate
  /** Quota du jour, pris juste avant le premier appel d'IA ; rendu si la génération échoue sans frais. */
  reserve?: () => Promise<GenerationSlot>
  /** Erreurs de l'IA sans détail de configuration (recruteurs). */
  publicErrors?: boolean
}

/** POST : génère la version (deux appels d'IA au plus), l'enregistre pour l'organisation et la livre. */
export async function generateExport(req: NextRequest, candidateId: string, scope: GenerationScope, startedAt: number): Promise<NextResponse> {
  // En plus du cookie de session SameSite=Lax : une génération coûte deux appels d'IA, elle ne part que d'une page du
  // site lui-même (un navigateur envoie toujours Sec-Fetch-Site ; son absence = client hors navigateur, avec la session).
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return deny(403, 'Accès refusé')
  if (!isCandidateId(candidateId)) return deny(404, 'Candidat introuvable.')
  const body = ExportRequest.safeParse(await req.json().catch(() => null))
  if (!body.success) return deny(400, 'Demande invalide : langues et anonymisation attendues.')

  const { reserve } = scope
  let release: (() => Promise<void>) | undefined
  const beforeAi = reserve && (async () => {
    const slot = await reserve()
    if ('refused' in slot) throw new CvExportError(slot.refused, slot.status ?? 429)
    release = slot.release
  })
  let result
  try {
    result = await exportCandidateCv(candidateId, body.data, scope.template, beforeAi)
  } catch (err) {
    if (release && failedWithoutCost(err)) {
      await release().catch(releaseErr => console.error('[cv-export] places de quota non rendues', candidateId, cvExportErrorName(releaseErr)))
    }
    return errorResponse(err, candidateId, scope.publicErrors)
  }

  // Les appels d'IA sont faits : un échec d'enregistrement n'empêche pas de livrer le fichier, la fenêtre le signale.
  const saved: SaveStatus = isCvExportStorageConfigured()
    ? await saveWithinBudget({
      tenantId: scope.tenantId, candidateId, mode: body.data.mode, sourceCvFileId: result.sourceCvFileId, notes: result.notes,
      files: result.files, now: new Date(),
    }, startedAt)
    : 'off'
  return fileResponse(bundleCvExport(result.files), result.notes, saved)
}

/** GET : version enregistrée de l'organisation pour ce choix, sans appel d'IA. */
export async function downloadSavedExport(req: NextRequest, candidateId: string, tenantId: string): Promise<NextResponse> {
  if (!isCandidateId(candidateId)) return deny(404, 'Candidat introuvable.')
  const query = ExportRequest.safeParse({ langs: req.nextUrl.searchParams.getAll('lang'), mode: req.nextUrl.searchParams.get('mode') })
  if (!query.success) return deny(400, 'Demande invalide : langues et anonymisation attendues.')
  if (!isCvExportStorageConfigured()) return deny(404, 'Enregistrement des versions non configuré.')

  try {
    const versions = storedFor(await listCvExports(tenantId, candidateId), query.data.mode, query.data.langs)
    if (!versions) return deny(404, 'Aucune version enregistrée pour ce choix : générez-la.')
    // Compte rendu de la première langue, comme à la génération (deux langues peuvent venir de générations différentes).
    return fileResponse(bundleCvExport(await readCvExportFiles(versions)), versions[0].notes)
  } catch (err) {
    return errorResponse(err, candidateId)
  }
}

/** Aperçu du modèle de l'organisation : le candidat fictif rendu en français et en anglais (.zip), aucune donnée réelle. */
export async function templateSampleResponse(tenantId: string): Promise<NextResponse> {
  try {
    const template = await loadEsnTemplate(tenantId)
    if (!template) return deny(404, 'Aucun modèle CV enregistré pour cette organisation.')
    const samples = checkTemplate(template.bytes, template.map)
    const base = exportBaseName(template.map.esn, SAMPLE_CV.identifiant, `Apercu ${SAMPLE_CV.titre}`)
    return zipResponse({ [`${base}_FR.docx`]: samples.fr, [`${base}_EN.docx`]: samples.en }, `${base}.zip`)
  } catch (err) {
    if (err instanceof TemplateError) return deny(422, err.message)
    if (err instanceof AppwriteException && err.type === 'storage_file_not_found') {
      return deny(404, 'Fichier du modèle introuvable dans le stockage : déposez-le à nouveau.')
    }
    console.error('[cv-export] aperçu du modèle impossible', tenantId, cvExportErrorName(err))
    return deny(500, 'Aperçu impossible : erreur du stockage, réessayez.')
  }
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Exemple pour préparer un modèle : le modèle Wise Associates sans son bloc contact (.docx seul, ADR 0014). */
export async function templateExampleResponse(): Promise<NextResponse> {
  try {
    const { docx } = await readExampleTemplateFiles()
    return new NextResponse(Buffer.from(docx), {
      headers: { 'Content-Type': DOCX_TYPE, 'Content-Disposition': disposition('Modele_CV_exemple.docx'), ...DOWNLOAD_HEADERS },
    })
  } catch (err) {
    // Fichiers absents de la fonction : chemin manquant dans outputFileTracingIncludes (next.config.ts).
    console.error('[cv-export] exemple de modèle illisible', err)
    return deny(500, 'Exemple indisponible : fichiers du modèle introuvables sur le serveur.')
  }
}
