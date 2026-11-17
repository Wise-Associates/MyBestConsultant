import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stageLabel, withOrphanStages } from './funnel-stage-utils'
import { STAGE_TEMPLATES } from './funnel-config'

describe('libellé de la colonne de l\'entretien IA', () => {
  it('affiche « Entretien IA » à la place des anciens libellés par défaut', () => {
    assert.equal(stageLabel({ slug: 'interview', label: 'Entretien', autoAction: 'interview' }), 'Entretien IA')
    assert.equal(stageLabel({ slug: 'interview', label: ' entretien ' }), 'Entretien IA')
    assert.equal(stageLabel({ slug: 'interview', label: 'Entretien visio', autoAction: 'interview' }), 'Entretien IA')
    // Colonne de l'entretien IA recréée sous un autre identifiant : reconnue à son action suggérée.
    assert.equal(stageLabel({ slug: 'entretien_2', label: 'Entretien', autoAction: 'interview' }), 'Entretien IA')
  })

  it('garde le libellé choisi par le recruteur et celui des autres colonnes', () => {
    assert.equal(stageLabel({ slug: 'interview', label: 'Entretien agent', autoAction: 'interview' }), 'Entretien agent')
    assert.equal(stageLabel({ slug: 'video_interview', label: 'Entretien visio' }), 'Entretien visio')
    assert.equal(stageLabel({ slug: 'entretien', label: 'Entretien' }), 'Entretien')
    assert.equal(stageLabel({ slug: 'interview', label: 'Entretien', autoAction: 'screening' }), 'Entretien')
  })

  it('nomme « Entretien IA » la colonne d\'un candidat en entretien IA absente du pipeline', () => {
    const stages = withOrphanStages([{ slug: 'pending', label: 'Nouveaux candidats', color: '#6b7280', order: 0 }], ['pending', 'interview'])
    assert.equal(stages.find(s => s.slug === 'interview')?.label, 'Entretien IA')
  })

  it('donne au modèle « Plusieurs entretiens » une colonne Entretien IA et une colonne Entretien visio distinctes', () => {
    const stages = STAGE_TEMPLATES.find(t => t.id === 'interviews')?.stages ?? []
    assert.equal(stages.find(s => s.autoAction === 'interview')?.label, 'Entretien IA')
    assert.equal(stages.find(s => s.slug === 'video_interview')?.label, 'Entretien visio')
    assert.equal(new Set(stages.map(s => s.slug)).size, stages.length)
  })
})
