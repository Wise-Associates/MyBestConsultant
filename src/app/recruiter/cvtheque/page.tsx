import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { recruiterExportState } from '@/lib/cv-export/recruiter'
import { cvExportErrorName } from '@/lib/cv-export/store'
import { isCvTemplateStorageConfigured } from '@/lib/cv-export/templates'
import { getRecruiterCvthequeCandidates } from './actions'
import { CvthequeClient, type CvExportAccess } from './cvtheque-client'

/**
 * « Format ESN » pour l'organisation du recruteur : `access` null si la fonction est coupée (variables CV_TEMPLATES
 * absentes, ADR 0010) ou si le compte n'est pas un recruteur d'une organisation ; modèle null : à déposer.
 */
async function cvExportAccess(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>): Promise<{ access: CvExportAccess | null; error?: string }> {
  if (!isCvTemplateStorageConfigured()) return { access: null }
  try {
    const state = await recruiterExportState(user)
    return { access: state && { template: state.template, generationDenied: state.generationDenied, uploadDenied: state.uploadDenied } }
  } catch (err) {
    // La CV Thèque reste utilisable ; le recruteur sait que « Format ESN » manque pour une raison passagère.
    console.error('[cv-export] état de l\'export illisible pour la CV Thèque', user.tenantId, cvExportErrorName(err))
    return { access: null, error: '« Format ESN » est momentanément indisponible : rechargez la page dans quelques instants.' }
  }
}

export default async function RecruiterCvthequePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')

  const [{ candidates, error }, cvExport] = await Promise.all([getRecruiterCvthequeCandidates(), cvExportAccess(user)])

  return <CvthequeClient initialCandidates={candidates} loadError={error} cvExport={cvExport.access} cvExportError={cvExport.error} />
}
