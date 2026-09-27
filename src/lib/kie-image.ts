// Génération de l'affiche via kie.ai, appelée directement depuis la plateforme — uniquement pour le
// pilote Zernio (voir lib/zernio.ts) : le flux de production (Make + Buffer) fait générer l'image par
// Make lui-même (voir /admin/social, étapes 2 et 4 du guide). Mêmes modèle et paramètres que dans Make,
// pour comparer les deux flux de publication sur un pied d'égalité.

const KIE_BASE = 'https://api.kie.ai/api/v1/jobs'

interface PosterInput { prompt: string; logoUrl: string; aspectRatio: string }

export async function generatePosterImage(input: PosterInput): Promise<{ url: string } | { error: string }> {
  const apiKey = process.env.KIE_API_KEY
  if (!apiKey) return { error: 'KIE_API_KEY manquante' }

  try {
    const createRes = await fetch(`${KIE_BASE}/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2-image-to-image',
        input: { prompt: input.prompt, input_urls: [input.logoUrl], aspect_ratio: input.aspectRatio, resolution: '1K', output_format: 'png' },
      }),
    })
    const createData: { data?: { taskId?: string }; msg?: string } | null = await createRes.json().catch(() => null)
    const taskId = createData?.data?.taskId
    if (!createRes.ok || !taskId) return { error: `Création de la tâche kie.ai échouée : ${createData?.msg ?? createRes.status}` }

    // kie.ai met environ 60-90 s à générer l'image (comme dans le scénario Make) : on interroge toutes
    // les 5 s pendant 100 s maximum.
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pollRes = await fetch(`${KIE_BASE}/recordInfo?taskId=${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
      const pollData: { data?: { state?: string; resultJson?: string; failMsg?: string } } | null = await pollRes.json().catch(() => null)
      const state = pollData?.data?.state
      if (state === 'success') {
        let url: string | undefined
        try { url = (JSON.parse(pollData?.data?.resultJson ?? '{}') as { resultUrls?: string[] }).resultUrls?.[0] } catch { /* résultat inattendu */ }
        return url ? { url } : { error: 'kie.ai : succès mais aucune image dans la réponse' }
      }
      if (state === 'fail' || state === 'failed') return { error: `kie.ai a échoué : ${pollData?.data?.failMsg ?? 'raison inconnue'}` }
    }
    return { error: 'kie.ai : délai dépassé (image non prête après 100 s)' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur réseau kie.ai' }
  }
}
