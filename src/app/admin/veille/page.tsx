import { requireAdmin } from '@/lib/appwrite/auth'
import { getLatestVeilleConfig, isVeilleConfigStorageConfigured, type VeilleConfigVersion } from '@/lib/veille/store'
import { VeilleSettings } from './veille-settings'

// Réglages de la veille marchés et emplois (projet veille-marches-emplois, ADR 0012) : organismes suivis, sources,
// filtre informatique. Lus par le scanner à chaque passage (GET /api/veille/config).
export const dynamic = 'force-dynamic'

export default async function VeilleAdminPage() {
  await requireAdmin()
  let latest: VeilleConfigVersion | null = null
  let loadError = ''
  if (!isVeilleConfigStorageConfigured()) {
    loadError = 'Collection des réglages absente : créez veille_config (npm run schema:push -- dev) et définissez APPWRITE_COLLECTION_VEILLE_CONFIG.'
  } else {
    try {
      latest = await getLatestVeilleConfig()
      if (!latest) loadError = 'Aucun réglage enregistré : chargez ceux du scanner avec npm run veille:seed (voir ADR 0012).'
    } catch (err) {
      console.error('[veille] réglages illisibles', err instanceof Error ? err.message : String(err))
      loadError = 'Réglages de la veille illisibles pour le moment : rechargez la page dans quelques instants.'
    }
  }
  // Le scanner ne peut pas lire les réglages sans ce jeton : seule sa présence est indiquée, jamais sa valeur.
  const tokenConfigured = (process.env.VEILLE_CONFIG_TOKEN ?? '').length >= 32
  return <VeilleSettings initial={latest} loadError={loadError} tokenConfigured={tokenConfigured} />
}
