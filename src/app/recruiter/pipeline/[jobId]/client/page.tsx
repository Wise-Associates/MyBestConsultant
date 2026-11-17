import { jobMetaLine } from '@/components/recruiter/job-tabs'
import { loadClientRows } from './data'
import { ClientResponseView } from './client-response-view'

// Onglet « Réponse client » d'une offre (demande du 2026-11-17) : candidats envoyés au client, synthèse de leurs comptes
// rendus, réponse du client. Accès vérifié par loadClientRows.
export default async function ClientResponsePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const { job, rows } = await loadClientRows(jobId)
  return <ClientResponseView jobId={jobId} jobTitle={job.title} jobMeta={jobMetaLine(job)} rows={rows} />
}
