import { jobMetaLine } from '@/components/recruiter/job-tabs'
import { recruiterCvExportAccess } from '@/lib/cv-export/recruiter'
import { loadClientRows } from './data'
import { ClientResponseView } from './client-response-view'

// Onglet « Réponse client » d'une offre (demande du 2026-11-17) : candidats envoyés au client, leur fiche et leur « CV format
// cabinet », réponse du client. Accès vérifié par loadClientRows.
export default async function ClientResponsePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const { user, job, rows, client } = await loadClientRows(jobId)
  const { access } = await recruiterCvExportAccess(user)
  return <ClientResponseView jobId={jobId} jobTitle={job.title} jobMeta={jobMetaLine(job)} rows={rows} cvExport={access} client={client} />
}
