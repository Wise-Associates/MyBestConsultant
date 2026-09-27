import { getLinkedInConfig, getLinkedInJobs, getLinkedInPublishConfig } from './actions'
import { LinkedInClient } from './linkedin-client'

export default async function LinkedInPage() {
  const [config, jobs, publishConfig] = await Promise.all([
    getLinkedInConfig(),
    getLinkedInJobs(),
    getLinkedInPublishConfig(),
  ])
  return (
    <LinkedInClient
      initialConfig={config}
      initialJobs={jobs}
      initialPublishConfig={publishConfig}
    />
  )
}
