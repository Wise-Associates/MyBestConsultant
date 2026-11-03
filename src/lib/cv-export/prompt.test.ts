import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractionPrompt, translationPrompt } from './prompt'
import type { AnonymizationMode } from './types'

const MODES: AnonymizationMode[] = ['standard', 'renforcee']

describe('extractionPrompt', () => {
  it('ne montre aucune valeur réaliste en exemple : l\'IA recopiait « 2012 » et « 2020 » dans un CV sans années', () => {
    for (const mode of MODES) assert.doesNotMatch(extractionPrompt(mode), /"(annees|annee|experience|dates)": "[^…"]/, mode)
  })

  it('demande la copie mot pour mot du CV, sans résumé, avec l\'identité du candidat anonymisée', () => {
    for (const mode of MODES) {
      const prompt = extractionPrompt(mode)
      assert.match(prompt, /mot pour mot/, mode)
      assert.match(prompt, /ni résumé/, mode)
      assert.match(prompt, /Seule exception : l'anonymisation/, mode)
      assert.match(prompt, /Retirer : prénom, nom/, mode)
    }
  })

  it('garde les clients en anonymisation standard, les remplace en renforcée', () => {
    assert.match(extractionPrompt('standard'), /Conserver les noms des clients/)
    assert.match(extractionPrompt('renforcee'), /Anonymisation renforcée/)
  })
})

describe('translationPrompt', () => {
  it('traduit sans résumer et garde la forme des dates', () => {
    assert.match(translationPrompt('en'), /ni résumé/)
    assert.match(translationPrompt('en'), /même forme/)
    assert.match(translationPrompt('fr'), /même forme/)
  })
})
