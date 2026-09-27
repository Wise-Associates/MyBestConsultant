'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getLLMConfig } from '@/app/admin/llm-config/actions'
import { ID, Query } from 'node-appwrite'
import type { Job } from '@/types'

export interface SuggestedGroup {
  name: string
  url: string
  visibility: 'public' | 'private' | 'unknown'
  reason: string
}

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission / Consulting',
}

const SYSTEM = `Tu es un expert en sourcing et diffusion d'offres d'emploi sur LinkedIn. On te donne une offre d'emploi ; utilise la recherche web pour identifier des groupes LinkedIn (linkedin.com/groups/...) réels et pertinents où cette offre pourrait être partagée manuellement par un recruteur (groupes de professionnels du métier/de la techno concernée, groupes régionaux, groupes freelance/consulting selon le type de contrat).

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte autour :
[{"name":"nom du groupe","url":"https://www.linkedin.com/groups/XXXXX/","visibility":"public|private|unknown","reason":"pourquoi ce groupe correspond, en une phrase"}]

Règles :
- Maximum 8 groupes, les plus pertinents en premier
- N'invente pas d'URL de groupe si tu n'es pas raisonnablement confiant qu'elle existe — dans ce cas mets "visibility":"unknown" et une URL de recherche LinkedIn plausible (https://www.linkedin.com/search/results/groups/?keywords=...) plutôt qu'un lien de groupe inventé
- Si aucun groupe pertinent n'est trouvé, retourne []`

export async function findLinkedInGroupsForJob(jobId: string): Promise<{ groups: SuggestedGroup[]; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
    const job = doc as unknown as Job

    const llmCfg = await getLLMConfig()
    const apiKey = llmCfg.claudeApiKey || process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) return { groups: [], error: 'Clé API Claude non configurée — allez dans Admin → Config IA' }

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const skills = job.skills?.join(', ') || ''
    const contractLabel = job.contractType ? (CONTRACT_LABELS[job.contractType] ?? job.contractType) : ''

    const resp = await client.messages.create({
      model: llmCfg.claudeModel || 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{
        role: 'user',
        content: `Offre : ${job.title}
Compétences clés : ${skills}
Localisation : ${job.location}
Type de contrat : ${contractLabel}
Télétravail : ${job.remote ?? ''}

Trouve des groupes LinkedIn pertinents pour diffuser cette offre.`,
      }],
    })

    const rawText = resp.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { groups: [], error: 'Aucun groupe trouvé — réessayez ou affinez les compétences de l\'offre' }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<SuggestedGroup>[]
    const groups: SuggestedGroup[] = parsed
      .filter(g => g.name && g.url)
      .slice(0, 8)
      .map(g => ({
        name: String(g.name),
        url: String(g.url),
        visibility: g.visibility === 'public' || g.visibility === 'private' ? g.visibility : 'unknown',
        reason: String(g.reason ?? ''),
      }))

    // Alimente la file d'attente (dédup par offre + URL de groupe) pour le dashboard /admin/linkedin-groups
    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_GROUP_QUEUE, [
      Query.equal('jobId', jobId),
      Query.limit(100),
    ])
    const existingUrls = new Set(existing.documents.map(d => d.groupUrl as string))

    for (const g of groups) {
      if (existingUrls.has(g.url)) continue
      await databases.createDocument(DB_ID, COLLECTIONS.LINKEDIN_GROUP_QUEUE, ID.unique(), {
        jobId,
        jobTitle: job.title,
        groupName: g.name,
        groupUrl: g.url,
        visibility: g.visibility,
        reason: g.reason,
        status: 'pending',
      })
    }

    return { groups }
  } catch (e) {
    return { groups: [], error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}
