import { getJobsForLinkedIn, getLinkedInChannelConfig } from './actions'
import { LinkedInPostsClient } from './linkedin-posts-client'

export default async function LinkedInPostsPage() {
  const [jobs, cfg] = await Promise.all([
    getJobsForLinkedIn(),
    getLinkedInChannelConfig(),
  ])

  return <LinkedInPostsClient jobs={jobs} cfg={cfg} />
}
