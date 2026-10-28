import 'server-only'
import { strFromU8 } from 'fflate'
import { callLLM } from '@/lib/ai/llm-router'
import { inspectTemplate } from './inspect'
import { cvExportErrorName, isCvExportStorageMissing } from './store'
import { TemplateError, templateUploadFiles, type TemplateUploadFiles } from './template-check'
import { mapTemplate, type AskModel, type MappingExample } from './template-mapping'
import { deleteEsnTemplate, isCvTemplateStorageConfigured, readExampleTemplateFiles, saveEsnTemplate } from './templates'

// Dépôt du modèle Word « Format ESN » depuis la CV Thèque (ADR 0010), partagé par les actions de l'admin (modèle de la
// plateforme) et des recruteurs (modèle de leur organisation). Chaque action vérifie son appelant et fixe l'organisation
// d'après la session, jamais d'après le formulaire. Le .docx seul : sa cartographie est écrite par l'IA (ADR 0014).
// Messages sans détail de configuration : les recruteurs les lisent.

const NOT_CONFIGURED = 'Dépôt des modèles CV indisponible : stockage non configuré.'
const AI_UNAVAILABLE = 'Analyse du modèle par l\'IA impossible pour le moment (service indisponible) : réessayez dans quelques minutes.'

function storageError(err: unknown, action: string): string {
  if (isCvExportStorageMissing(err)) {
    console.error('[cv-export] collection ou bucket cv_templates introuvable : lancez npm run cv-export:setup -- <env> --apply')
    return `Modèle non ${action} : stockage des modèles indisponible, contactez-nous.`
  }
  return `Modèle non ${action} : erreur du stockage, réessayez.`
}

/**
 * Modèle de l'export (« Export CV » de Config IA), Claude s'il n'en a pas : la cartographie demande un modèle capable.
 * Sans repli, comme l'export : le modèle déposé peut être le dossier d'un vrai candidat. Deux tentatives de 120 s au
 * plus tiennent dans les 300 s des pages de CV Thèque (maxDuration).
 */
const askExportModel: AskModel = async (system, user) => {
  const { content } = await callLLM([{ role: 'user', content: user }], system, {
    module: 'cvExport', moduleDefault: 'claude', strict: true, maxTokens: 8000, timeoutMs: 120_000,
  })
  return content
}

/** Exemple montré à l'IA : le modèle d'exemple du dépôt (sans contact réel) et sa cartographie. */
async function mappingExample(): Promise<MappingExample> {
  const { docx, mapJson } = await readExampleTemplateFiles()
  return { inspection: inspectTemplate(docx), mapJson: strFromU8(mapJson) }
}

/** Contrôles sans coût (stockage configuré, fichier joint, taille) : à faire avant de compter un dépôt dans un quota. */
export function readTemplateUpload(formData: FormData): TemplateUploadFiles | { error: string } {
  if (!isCvTemplateStorageConfigured()) return { error: NOT_CONFIGURED }
  return templateUploadFiles(formData.get('template'))
}

/**
 * Fait cartographier le modèle par l'IA (vérifiée par le rendu d'un candidat fictif en FR et EN), puis l'enregistre à la
 * place du précédent ; message sinon. `esn` : nom de l'organisation, écrit dans les métadonnées des exports.
 */
export async function saveUploadedTemplate(input: { tenantId: string; esn: string; files: TemplateUploadFiles; uploadedBy: string; now: Date }): Promise<{ error?: string }> {
  let mapped: Awaited<ReturnType<typeof mapTemplate>>
  const bytes = new Uint8Array(await input.files.docx.arrayBuffer())
  try {
    mapped = await mapTemplate({ bytes, esn: input.esn, example: await mappingExample(), ask: askExportModel })
  } catch (err) {
    if (err instanceof TemplateError) return { error: err.message }
    // Ni contenu du modèle ni réponse de l'IA dans le journal : le modèle peut être le dossier d'un vrai candidat.
    console.error('[cv-export] cartographie du modèle par l\'IA impossible', input.tenantId, err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : err)
    return { error: AI_UNAVAILABLE }
  }
  try {
    await saveEsnTemplate({ tenantId: input.tenantId, bytes, map: mapped.map, mapJson: mapped.mapJson, uploadedBy: input.uploadedBy, now: input.now })
    return {}
  } catch (err) {
    console.error('[cv-export] modèle non enregistré', input.tenantId, cvExportErrorName(err))
    return { error: storageError(err, 'enregistré') }
  }
}

export async function removeTemplate(tenantId: string): Promise<{ error?: string }> {
  if (!isCvTemplateStorageConfigured()) return { error: NOT_CONFIGURED }
  try {
    await deleteEsnTemplate(tenantId)
    return {}
  } catch (err) {
    console.error('[cv-export] modèle non retiré', tenantId, cvExportErrorName(err))
    return { error: storageError(err, 'retiré') }
  }
}
