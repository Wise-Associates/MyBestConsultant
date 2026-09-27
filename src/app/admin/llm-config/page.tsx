import { getLLMConfig } from './actions'
import { LLMConfigClient } from './llm-config-client'

export default async function LLMConfigPage() {
  const config = await getLLMConfig()
  return <LLMConfigClient initialConfig={config} />
}
