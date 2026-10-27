'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/appwrite/auth'
import { parseVeilleConfig, type VeilleConfig } from '@/lib/veille/config'
import { saveVeilleConfig } from '@/lib/veille/store'

// Enregistrement des réglages de la veille (/admin/veille) : l'admin est vérifié ici (une Server Action est un point
// d'entrée public), les réglages complets sont revalidés côté serveur (config.ts) puis enregistrés comme nouvelle
// version, seulement s'ils partent de la version en vigueur (`baseVersion`).

export interface SaveVeilleResult {
  version?: number
  /** Réglages tels qu'enregistrés (listes nettoyées) : la page repart de ceux-ci. */
  config?: VeilleConfig
  errors?: string[]
  error?: string
}

export async function saveVeilleConfigAction(input: unknown, baseVersion: number): Promise<SaveVeilleResult> {
  const user = await requireAdmin()
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return { error: 'Version de départ invalide : rechargez la page.' }
  const parsed = parseVeilleConfig(input)
  if (!parsed.success) return { errors: parsed.errors }
  try {
    // Nom affiché seulement (jamais l'e-mail) : il reste dans les 50 versions gardées.
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Admin'
    const res = await saveVeilleConfig(parsed.config, baseVersion, { id: user.userId, name })
    if ('conflict' in res) {
      return { error: 'Les réglages ont été modifiés entre-temps (autre onglet ou autre admin) : rechargez la page, puis refaites votre modification.' }
    }
    if ('tooLarge' in res) return { error: 'Réglages trop volumineux (100 000 caractères au plus) : retirez des expressions ou des noms.' }
    revalidatePath('/admin/veille')
    return { version: res.version, config: parsed.config }
  } catch (err) {
    console.error('[veille] réglages non enregistrés', err instanceof Error ? err.message : String(err))
    return { error: 'Enregistrement impossible pour le moment : réessayez dans un instant.' }
  }
}
