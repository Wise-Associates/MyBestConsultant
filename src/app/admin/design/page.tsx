import { getSiteConfig } from '@/lib/site-config'
import { TEMPLATES } from '@/lib/templates'
import { DesignManager } from './design-manager'

export default async function AdminDesignPage() {
  const config = await getSiteConfig()
  return (
    <DesignManager
      templates={TEMPLATES}
      currentTemplateId={config.templateId}
      customColors={config.customColors}
    />
  )
}
