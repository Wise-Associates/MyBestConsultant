import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { LLMChainError, LLMHttpError } from './ai/llm-router'
import { RULES_MODEL, parseClassification } from './cv-classification'
import { buildRuleVocabulary } from './cv-classification-rules'
import { classifyWithFallback, type FallbackDeps } from './cv-classify'

// CV fictif, déjà masqué ; l'IA est remplacée par une fonction du test (aucun appel réseau).
const CV = 'Chef de projet\n2020 - 2026 · Chef de projet SAP\nJira, Power BI'
const deps = (byAi: FallbackDeps['byAi']): FallbackDeps => ({
  byAi, vocabulary: async () => buildRuleVocabulary(), now: () => new Date('2026-11-18T10:00:00.000Z'),
})
const claudeError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers())

describe('classification d\'un CV quand l\'IA ne répond pas (ADR 0044)', () => {
  it('classe par les règles quand Claude puis GPT-4o mini ont échoué', async () => {
    const down = new LLMChainError([
      { provider: 'claude', error: claudeError(529, 'overloaded_error', 'Overloaded') },
      { provider: 'gpt4o', error: new LLMHttpError(503, 'Service Unavailable') },
    ])
    const result = await classifyWithFallback(CV, 'candidate', 'candidatFictif', deps(async () => { throw down }))
    assert.equal(result?.model, RULES_MODEL)
    assert.deepEqual(result?.classification.roles, ['Chef de projet'])
    assert.ok(result?.classification.skills.includes('Power BI'))
  })

  it('laisse remonter une requête refusée pour elle-même, sans la classer par les règles', async () => {
    const refused = claudeError(400, 'invalid_request_error', 'prompt is too long')
    await assert.rejects(classifyWithFallback(CV, 'candidate', 'candidatFictif', deps(async () => { throw refused })), err => err === refused)
  })

  it('ne classe pas par les règles une réponse illisible : le CV reste à classer', async () => {
    assert.equal(await classifyWithFallback(CV, 'candidate', 'candidatFictif', deps(async () => null)), null)
  })

  it('garde la classification de l\'IA quand elle répond', async () => {
    const classification = parseClassification('{"roles":["Chef de projet"],"famille":"pilotage_projet","competences":["Jira"]}')
    assert.ok(classification)
    const fromAi = { classification, model: 'claude-haiku-5-5' }
    assert.deepEqual(await classifyWithFallback(CV, 'candidate', 'candidatFictif', deps(async () => fromAi)), fromAi)
  })
})
