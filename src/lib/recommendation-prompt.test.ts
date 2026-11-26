import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanRecommendationMessage, recommendationMessagePrompt } from './recommendation-prompt'

const candidate = { candidateFirstName: 'Awa', candidateLastName: 'Diallo' }

describe('demande du message de recommandation', () => {
  it('nom seul : ni entreprise ni expérience', () => {
    const { system, user } = recommendationMessagePrompt({ ...candidate, recipientName: '  Paul Durand ' })
    assert.ok(user.startsWith('Rédige un court message personnalisé (3-4 phrases maximum) que Awa Diallo envoie à Paul Durand, un ancien employeur ou client,'))
    assert.ok(user.includes('sur la plateforme MyBestConsultant. Le ton doit être chaleureux'))
    assert.ok(user.endsWith('Réponds uniquement avec le texte du message, sans guillemets.'))
    assert.equal(system, 'Tu es un assistant qui aide un consultant à rédiger un message court et sincère pour demander une recommandation professionnelle.')
  })

  it('entreprise, expérience et période ; expérience coupée à 200, période à 60', () => {
    const { user } = recommendationMessagePrompt({
      ...candidate, recipientName: 'Paul', recipientCompany: 'Banque X', experience: ` ${'E'.repeat(300)} `, period: ` ${'P'.repeat(100)} `,
    })
    assert.ok(user.includes('envoie à Paul (Banque X), un ancien employeur'))
    assert.ok(user.includes(`MyBestConsultant, en rapport avec cette expérience commune : ${'E'.repeat(200)} (${'P'.repeat(60)}). Le ton`))
  })

  it('période sans expérience : non citée', () => {
    const { user } = recommendationMessagePrompt({ ...candidate, recipientName: 'Paul', period: '2020 - 2022' })
    assert.ok(!user.includes('2020'))
  })

  it('nom du candidat sans nom de famille : pas d\'espace en trop', () => {
    assert.ok(recommendationMessagePrompt({ candidateFirstName: 'Jean', candidateLastName: '', recipientName: 'Paul' }).user.includes('que Jean envoie à Paul'))
  })
})

describe('nettoyage du message', () => {
  it('retire les guillemets d\'ouverture et de fermeture et les blancs autour', () => {
    assert.equal(cleanRecommendationMessage('  «Merci pour cette mission.»  '), 'Merci pour cette mission.')
    assert.equal(cleanRecommendationMessage('"Bonjour Paul"'), 'Bonjour Paul')
  })

  it('garde les guillemets intérieurs ; réponse vide : rien d\'utilisable', () => {
    assert.equal(cleanRecommendationMessage('Le projet "Atlas" était réussi.'), 'Le projet "Atlas" était réussi.')
    assert.equal(cleanRecommendationMessage('""'), '')
  })
})
