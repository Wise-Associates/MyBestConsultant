import { Query } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllByValues, listAllDocuments } from '../appwrite/list-all'
import { ASSISTANT_QUESTIONS, assistantSystemPrompt } from './assistant-questions'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'

// Demandes de l'assistant IA (ADR 0063) : mêmes consignes que l'assistant (nom du site, contenu d'aide du rôle), pour
// les questions inventées (assistant-questions.ts) et les quelques questions réelles encore conservées (coordonnées
// masquées). Réponses de l'enseignant à partir du seul contenu d'aide, comme l'assistant.

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function assistantItem(project: string, role: 'candidate' | 'recruiter', question: string, followUp?: string): DatasetItem {
  return {
    id: itemId('assistant', role, question), group: `assistant:${role}:${question}`, project,
    system: assistantSystemPrompt(role),
    messages: [{ role: 'user', content: question }],
    ctx: { task: 'assistant', role, ...(followUp ? { followUp } : {}) },
  }
}

export async function collectAssistant(project: string): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const turns = await listAllDocuments(databases, DB_ID, COLLECTIONS.ASSISTANT_TURNS, [Query.select(['$id', 'userId', 'question'])])
  const users = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, 'userId', turns.map(t => str(t.userId)), [Query.select(['$id', 'userId', 'role'])])
  const roleOf = new Map(users.map(u => [str(u.userId), str(u.role)]))
  const real = turns.flatMap(t => {
    const role = roleOf.get(str(t.userId))
    const question = maskLeftoverContacts(str(t.question)).trim()
    return (role === 'candidate' || role === 'recruiter') && question ? [assistantItem(project, role, question)] : []
  })
  const invented = ASSISTANT_QUESTIONS.map(q => assistantItem('fictif', q.role, q.question, q.followUp))
  return {
    items: [...invented, ...real],
    stats: { tasks: { assistant: { kept: invented.length + real.length, skipped: {} } }, info: [`${real.length} question(s) réelle(s), ${invented.length} inventée(s)`] },
  }
}
