import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { FunnelStep } from './candidate-funnel'
import { cleanStepReport, stepReportPrompt, type StepReportInput } from './step-report-prompt'

const steps: FunnelStep[] = [
  { id: 's1', type: 'screening', label: 'Screening', status: 'validated', report: 'Bon profil.' },
  { id: 's2', type: 'phone', label: 'Entretien téléphonique', status: 'validated', report: 'Clair et motivé.' },
  { id: 's3', type: 'ai_interview', label: 'Entretien IA', status: 'done', report: 'Pas encore validé.' },
  { id: 's4', type: 'video', label: 'Entretien visio', status: 'todo' },
]

const base: StepReportInput = {
  jobTitle: 'Développeur Java',
  step: steps[3],
  funnelSteps: steps,
  interviewAnalyses: [],
}

describe('demande de compte rendu d\'étape', () => {
  it('sans autre élément : poste, étape (description du type) et résultat « non précisé »', () => {
    const { system, user } = stepReportPrompt({ ...base, funnelSteps: [] })
    assert.equal(user, 'Poste : Développeur Java\nÉtape : Entretien visio (Teams, Meet ou Zoom)\nRésultat indiqué par le recruteur : non précisé')
    assert.ok(system.startsWith('Tu es un assistant de recrutement. Rédige un COMPTE RENDU D\'ÉTAPE'))
    assert.ok(system.endsWith('Pas de markdown, pas d\'emoji.'))
  })

  it('offre introuvable : poste vide', () => {
    assert.ok(stepReportPrompt({ ...base, jobTitle: undefined }).user.startsWith('Poste : \n'))
  })

  it('tous les éléments, dans l\'ordre ; seuls les comptes rendus des étapes validées sont repris', () => {
    const { user } = stepReportPrompt({
      ...base,
      result: 'neutral',
      notes: '  Bon échange  ',
      applicationNote: 'Disponible en mars',
      aiScore: 81,
      aiSummary: 'Profil aligné.',
      interviewAnalyses: [{ overallScore: 72, summary: 'Solide en backend.', recommendation: 'oui' }, null, { summary: 'Sans score.' }],
    })
    assert.equal(user, [
      'Poste : Développeur Java',
      'Étape : Entretien visio (Teams, Meet ou Zoom)',
      'Résultat indiqué par le recruteur : réservé',
      'Notes du recruteur : Bon échange',
      'Note sur la candidature : Disponible en mars',
      'Éléments connus :',
      'Screening IA : score 81/100. Profil aligné.',
      'Entretien IA : score 72/100, recommandation oui. Solide en backend.',
      'Entretien IA : score ?/100, recommandation ?. Sans score.',
      'Comptes rendus des étapes précédentes :',
      'Screening : Bon profil.',
      'Entretien téléphonique : Clair et motivé.',
    ].join('\n'))
  })

  it('score de screening sans résumé ; notes blanches et note vide ignorées', () => {
    const { user } = stepReportPrompt({ ...base, funnelSteps: [], aiScore: 0, aiSummary: null, notes: '   ', applicationNote: '' })
    assert.ok(user.endsWith('Éléments connus :\nScreening IA : score 0/100.'))
    assert.ok(!user.includes('Notes du recruteur'))
    assert.ok(!user.includes('Note sur la candidature'))
  })

  it('coupe les blocs : notes 800, note de candidature 400, éléments 1 800, comptes rendus 900 (3 derniers)', () => {
    const many: FunnelStep[] = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, type: 'other', label: `Étape ${i}`, status: 'validated', report: 'R'.repeat(500) }))
    const { user } = stepReportPrompt({
      ...base,
      funnelSteps: many,
      notes: 'n'.repeat(900),
      applicationNote: 'a'.repeat(600),
      interviewAnalyses: [{ summary: 's'.repeat(2500) }],
    })
    const lines = user.split('\n')
    assert.equal(lines.find(l => l.startsWith('Notes du recruteur : '))?.length, 'Notes du recruteur : '.length + 800)
    assert.equal(lines.find(l => l.startsWith('Note sur la candidature : '))?.length, 'Note sur la candidature : '.length + 400)
    const factsLine = lines[lines.indexOf('Éléments connus :') + 1]
    assert.equal(factsLine.length, 1800)
    const prior = user.slice(user.indexOf('Comptes rendus des étapes précédentes :\n') + 'Comptes rendus des étapes précédentes :\n'.length)
    assert.equal(prior.length, 900)
    assert.ok(prior.startsWith('Étape 2 : '), 'les 3 dernières étapes validées')
  })
})

describe('nettoyage du compte rendu', () => {
  it('retire le gras markdown, les blancs autour et coupe à 1 200 caractères', () => {
    assert.equal(cleanStepReport('  **Synthèse** : bon profil.  '), 'Synthèse : bon profil.')
    assert.equal(cleanStepReport('x'.repeat(2000)).length, 1200)
  })

  it('réponse vide ou seulement du gras : rien d\'utilisable', () => {
    assert.equal(cleanStepReport('  '), '')
    assert.equal(cleanStepReport('****'), '')
  })
})
