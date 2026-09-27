// Pilote Zernio : publication directe sur Instagram, en parallèle de Make + Buffer qui reste le flux de
// production pour LinkedIn (voir lib/social.ts). But : comparer les deux avant de généraliser à d'autres
// réseaux. Compte Instagram et clé API à créer et connecter sur zernio.com (voir /admin/social) — rien de
// tout cela ne passe par les variables __llm (config des IA), c'est un service de publication séparé.
//
// Doc utilisée : https://docs.zernio.com (quickstart, media-uploads, error-handling).

const ZERNIO_BASE = 'https://zernio.com/api/v1'

async function zernioFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) throw new Error('ZERNIO_API_KEY manquante')
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Zernio ${res.status}`)
  return data as T
}

type PublishResult =
  | { ok: true; status: string; postId?: string; permalink?: string }
  | { ok: false; error: string }

/** Envoie une image déjà générée (URL publique) chez Zernio, puis publie le post sur le compte Instagram connecté. */
export async function postImageToInstagramViaZernio(input: { caption: string; imageUrl: string }): Promise<PublishResult> {
  const accountId = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID
  if (!accountId) return { ok: false, error: 'ZERNIO_INSTAGRAM_ACCOUNT_ID manquant — connectez d’abord le compte Instagram sur zernio.com (voir le guide dans /admin/social)' }

  try {
    // 1) Récupérer l'image et la ré-héberger chez Zernio (presign + upload direct au stockage).
    const imgRes = await fetch(input.imageUrl)
    if (!imgRes.ok) return { ok: false, error: `Image introuvable à l’URL fournie (${imgRes.status})` }
    const contentType = imgRes.headers.get('content-type') || 'image/png'
    const bytes = Buffer.from(await imgRes.arrayBuffer())

    const presign = await zernioFetch<{ uploadUrl: string; publicUrl: string }>('/media/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: 'poster.png', contentType }),
    })
    const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes })
    if (!putRes.ok) return { ok: false, error: `Envoi de l’image à Zernio échoué (${putRes.status})` }

    // 2) Publier immédiatement sur Instagram.
    const post = await zernioFetch<{
      _id?: string; status?: string
      platforms?: { platform: string; permalink?: string; errorMessage?: string }[]
      post?: { _id?: string; status?: string; platforms?: { platform: string; permalink?: string; errorMessage?: string }[] }
    }>('/posts', {
      method: 'POST',
      body: JSON.stringify({
        content: input.caption,
        publishNow: true,
        mediaItems: [{ url: presign.publicUrl, type: 'image' }],
        platforms: [{ platform: 'instagram', accountId }],
      }),
    })

    // La forme exacte de la réponse (champs à plat ou sous `post`) n'est pas garantie par la doc publique :
    // on couvre les deux, à ajuster au premier vrai test si besoin.
    const p = post.post ?? post
    const platform = p.platforms?.[0]
    if (p.status === 'failed') return { ok: false, error: platform?.errorMessage ?? 'Zernio : publication échouée sur Instagram' }
    return { ok: true, status: p.status ?? 'inconnu', postId: p._id, permalink: platform?.permalink }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau Zernio' }
  }
}
