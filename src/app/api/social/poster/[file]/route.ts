import { NextResponse } from 'next/server'
import { AppwriteException } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { getJobById } from '@/lib/appwrite/jobs'
import { DEFAULT_SOCIAL_CONFIG, SAMPLE_JOB, buildContent, fallbackCopy } from '@/lib/social-content'
import { renderPoster } from '@/lib/social-poster/poster'
import { parsePosterImage, posterCacheControl, posterTarget } from '@/lib/social-poster/rules'
import { isSceneStorageConfigured, readScene } from '@/lib/social-poster/store'

// Affiche PNG d'une publication sur les réseaux (ADR 0015) : « <id de la publication>.png », ou « exemple.png ».
// Publique, sans connexion : Buffer, Instagram, Facebook et X la téléchargent. Elle ne montre que ce que l'offre publiée
// montre déjà (intitulé, entreprise, lieu, conditions, compétences, accroche), relu dans la publication enregistrée :
// l'image est exactement celle annoncée à Make. Offre désactivée, expirée ou supprimée : plus d'affiche.
// Redessinée à chaque téléchargement (≈ 0,2 à 0,4 s), mise en cache par le CDN de Vercel (posterCacheControl).

const CACHE_SAMPLE = 'public, max-age=300, s-maxage=300'

const notFound = () => NextResponse.json({ error: 'Affiche introuvable' }, { status: 404 })

function png(bytes: Uint8Array, cacheControl: string) {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  // Make, Buffer et les réseaux n'ajoutent jamais de paramètres : un paramètre ne servirait qu'à contourner le cache.
  if (new URL(req.url).search) return notFound()
  const target = posterTarget((await params).file)
  if (!target) return notFound()
  try {
    if (target.kind === 'sample') {
      const image = buildContent(SAMPLE_JOB, fallbackCopy(SAMPLE_JOB), DEFAULT_SOCIAL_CONFIG, { baseUrl: '', calendlyUrl: '' }).image
      return png(await renderPoster(image, null), CACHE_SAMPLE)
    }

    const { databases } = createAdminClient()
    let doc
    try {
      doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, target.id)
    } catch (err) {
      if (err instanceof AppwriteException && err.code === 404) return notFound()
      throw err
    }
    if (doc.status === 'config') return notFound()
    let payload: { content?: { image?: unknown } } | null = null
    try { payload = JSON.parse(typeof doc.payloadJson === 'string' ? doc.payloadJson : '') } catch { /* publication d'avant ce format */ }
    const image = parsePosterImage(payload?.content?.image)
    if (!image) return notFound()
    const job = typeof doc.jobId === 'string' && doc.jobId ? await getJobById(doc.jobId) : null
    if (!job?.isActive || (job.expiresAt && new Date(job.expiresAt) < new Date())) return notFound()
    // La photo est facultative : stockage injoignable → affiche sans elle, jamais mise en cache (elle reviendra).
    let scene = null
    let sceneUnavailable = false
    if (isSceneStorageConfigured()) {
      try {
        scene = await readScene(target.id)
      } catch (err) {
        sceneUnavailable = true
        console.error('[social] photo de l’affiche illisible, affiche sans photo', target.id, err instanceof AppwriteException ? `${err.type} ${err.code}` : err instanceof Error ? err.name : err)
      }
    }
    const cache = sceneUnavailable ? 'no-store' : posterCacheControl(String(doc.status), scene !== null)
    return png(await renderPoster(image, scene), cache)
  } catch (err) {
    console.error('[social] affiche non dessinée', target.kind === 'post' ? target.id : 'exemple', err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err))
    return NextResponse.json({ error: 'Affiche indisponible' }, { status: 500 })
  }
}
