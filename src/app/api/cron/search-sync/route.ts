import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isCvClassificationsConfigured } from '@/lib/appwrite/cv-classifications'
import { isSearchConfigured } from '@/lib/search/meili'
import { applyCvIndexSync, planCvIndexSync } from '@/lib/search/sync'

// Synchronisation de l'index de recherche des CV avec Appwrite (ADR 0044 phase 2, src/lib/search/sync.ts). En production,
// Meilisearch n'est joignable que depuis l'application (réseau Docker interne, aucun port publié) : c'est donc ici qu'elle
// tourne, chaque nuit (deploy/crontab) et à la demande sur le serveur (mbc-cron.sh search-sync, par exemple juste après
// la mise en place de l'index ou un changement de CV_INDEX_SETTINGS). Idempotente : un passage interrompu se refait au
// suivant. Réponse : des nombres seulement, aucune donnée de CV.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isSearchConfigured() || !isCvClassificationsConfigured()) {
    // Normal tant que l'index n'est pas installé (MEILI_URL, MEILI_API_KEY, APPWRITE_COLLECTION_CV_CLASSIFICATIONS).
    console.warn('[recherche] synchronisation de l\'index ignorée : index de recherche ou classifications non configurés')
    return NextResponse.json({ configured: false })
  }

  const started = Date.now()
  try {
    const plan = await planCvIndexSync()
    const { written, removed } = await applyCvIndexSync(plan)
    const result = { written, removed, previouslyIndexed: plan.indexed, undated: plan.undated, unreadable: plan.unreadable, seconds: Math.round((Date.now() - started) / 1000) }
    console.log('[recherche] index synchronisé', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    console.error('[recherche] synchronisation de l\'index en échec', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Synchronisation en échec' }, { status: 500 })
  }
}
