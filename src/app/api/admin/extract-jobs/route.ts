import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/ai/llm-router'
import { getLLMConfig } from '@/lib/ai/llm-config-store'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { extractTextFromFile } from '@/lib/import-file-extract'
import { AO_EXTRACTION_PROMPT } from '@/lib/ao/prompt'

const SYSTEM = AO_EXTRACTION_PROMPT

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const provider = (form.get('provider') as string | null) ?? undefined

    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop grand (max 20 Mo)' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await extractTextFromFile(buffer, file.name)

    if (!text || text.trim().length < 50) {
      return NextResponse.json({ error: 'Impossible d\'extraire du texte de ce fichier' }, { status: 422 })
    }

    // Read saved LLM config so we use the admin-configured API keys, not env vars
    const llmCfg = await getLLMConfig()
    const chosenProvider = (provider as 'claude' | 'teckia' | undefined) ?? llmCfg.activeProvider as 'claude' | 'teckia'

    let result: { content: string; provider: string }
    if (chosenProvider === 'claude') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const apiKey = llmCfg.claudeApiKey || process.env.ANTHROPIC_API_KEY || ''
      if (!apiKey) throw new Error('Clé API Claude non configurée — allez dans Admin → Config IA')
      const client = new Anthropic({ apiKey })
      const resp = await client.messages.create({
        model: llmCfg.claudeModel || 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Voici le texte du document d'appels d'offres :\n\n${text.slice(0, 40000)}` }],
      })
      const text2 = resp.content[0]?.type === 'text' ? resp.content[0].text : ''
      result = { content: text2, provider: 'claude' }
    } else {
      // Teckia / self-hosted Gemma4 (OpenAI-compatible)
      const apiUrl = (llmCfg.teckiaApiUrl || '').trim()
      const apiKey = (llmCfg.teckiaApiKey || '').trim()
      if (!apiUrl) throw new Error('URL Teckia non configurée — allez dans Admin → Config IA')
      result = await callLLM(
        [{ role: 'user', content: `Voici le texte du document d'appels d'offres :\n\n${text.slice(0, 40000)}` }],
        SYSTEM,
        'teckia',
      )
      void apiKey // used via callLLM internal config
    }

    // Parse JSON — be tolerant of LLM wrapping it in markdown
    let raw = result.content.trim()
    raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    const jobs = JSON.parse(raw) as Record<string, unknown>[]

    if (!Array.isArray(jobs)) throw new Error('Réponse LLM invalide : attendu un tableau')

    return NextResponse.json({ jobs, provider: result.provider, count: jobs.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
