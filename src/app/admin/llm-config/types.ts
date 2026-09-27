import type { LLMProvider } from '@/types'
import type { AIModule, OpenSourceModel } from '@/lib/ai/models'

export type { LLMProvider }

export interface ProviderConfig {
  // Modèle par défaut de la plateforme : fournisseur intégré ou id d'un modèle open source (os-…)
  activeProvider: string
  // API Keys (stored in DB, override env vars at runtime)
  claudeApiKey: string
  openaiApiKey: string
  teckiaApiKey: string
  // Models
  claudeModel: string
  gpt4oModel: string
  teckiaModel: string
  teckiaApiUrl: string
  // Pricing (used for client billing calculation only)
  claudePriceInput: number
  claudePriceOutput: number
  gpt4oPriceInput: number
  gpt4oPriceOutput: number
  teckiaPriceInput: number
  teckiaPriceOutput: number
  // Billing
  billingEnabled: boolean
  markupPercent: number
  // Modèles open source ajoutés par l'admin (API compatible OpenAI)
  openSourceModels: OpenSourceModel[]
  // Modèle dédié par module IA ; absent = modèle par défaut
  moduleRouting: Partial<Record<AIModule, string>>
}

export const DEFAULT_CONFIG: ProviderConfig = {
  activeProvider: 'claude',
  claudeApiKey: '',
  openaiApiKey: '',
  teckiaApiKey: '',
  claudeModel: 'claude-sonnet-4-6',
  gpt4oModel: 'gpt-4o',
  teckiaModel: 'teckia-base',
  teckiaApiUrl: '',
  claudePriceInput: 3,
  claudePriceOutput: 15,
  gpt4oPriceInput: 2.5,
  gpt4oPriceOutput: 10,
  teckiaPriceInput: 0,
  teckiaPriceOutput: 0,
  billingEnabled: false,
  markupPercent: 20,
  openSourceModels: [],
  moduleRouting: {},
}
