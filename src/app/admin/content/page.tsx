import { getSiteConfig } from '@/lib/site-config'
import { ContentEditor } from './content-editor'

export default async function AdminContentPage() {
  const config = await getSiteConfig()
  return <ContentEditor config={config} />
}
