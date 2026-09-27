import { getJobsForSourcing } from './actions'
import { SourcingDashboard } from './sourcing-dashboard'

export default async function SourcingPage() {
  const jobs = await getJobsForSourcing()
  return <SourcingDashboard jobs={jobs} />
}
