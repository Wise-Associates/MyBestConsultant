import 'server-only'
import { cvExportErrorName, isCvExportStorageMissing } from './store'
import { TemplateError, checkTemplate, parseTemplateMap, templateUploadFiles, type TemplateUploadFiles } from './template-check'
import { deleteEsnTemplate, isCvTemplateStorageConfigured, saveEsnTemplate } from './templates'

// Dépôt du modèle Word « Format ESN » depuis la CV Thèque (ADR 0010), partagé par les actions de l'admin (modèle de la
// plateforme) et des recruteurs (modèle de leur organisation). Chaque action vérifie son appelant et fixe l'organisation
// d'après la session, jamais d'après le formulaire. Messages sans détail de configuration : les recruteurs les lisent.

const NOT_CONFIGURED = 'Dépôt des modèles CV indisponible : stockage non configuré.'

function storageError(err: unknown, action: string): string {
  if (isCvExportStorageMissing(err)) {
    console.error('[cv-export] collection ou bucket cv_templates introuvable : lancez npm run cv-export:setup -- <env> --apply')
    return `Modèle non ${action} : stockage des modèles indisponible, contactez-nous.`
  }
  return `Modèle non ${action} : erreur du stockage, réessayez.`
}

/** Contrôles sans coût (stockage configuré, fichiers joints, tailles) : à faire avant de compter un dépôt dans un quota. */
export function readTemplateUpload(formData: FormData): TemplateUploadFiles | { error: string } {
  if (!isCvTemplateStorageConfigured()) return { error: NOT_CONFIGURED }
  return templateUploadFiles(formData.get('template'), formData.get('map'))
}

/** Vérifie le modèle par un rendu fictif (FR et EN) puis l'enregistre à la place du précédent ; message sinon. */
export async function saveUploadedTemplate(input: { tenantId: string; files: TemplateUploadFiles; uploadedBy: string; now: Date }): Promise<{ error?: string }> {
  try {
    const mapJson = await input.files.map.text()
    const map = parseTemplateMap(mapJson)
    const bytes = new Uint8Array(await input.files.docx.arrayBuffer())
    checkTemplate(bytes, map)
    await saveEsnTemplate({ tenantId: input.tenantId, bytes, map, mapJson, uploadedBy: input.uploadedBy, now: input.now })
    return {}
  } catch (err) {
    if (err instanceof TemplateError) return { error: err.message }
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
