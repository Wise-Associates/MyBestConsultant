'use server'

export async function fetchGithubComponentHtml(rawUrl: string): Promise<{ html: string } | { error: string }> {
  try {
    const res = await fetch(rawUrl, {
      headers: { 'Accept': 'text/html,text/plain,*/*' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { error: `Erreur ${res.status} lors du chargement` }
    const full = await res.text()

    // Extract only the <body> content — discard <html>/<head> wrapper
    const bodyMatch = full.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const bodyContent = bodyMatch ? bodyMatch[1].trim() : full

    // Inject Tailwind CDN so classes render correctly in the preview/frontend
    const html = `<link rel="stylesheet" href="https://cdn.tailwindcss.com">\n${bodyContent}`
    return { html }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur réseau' }
  }
}
