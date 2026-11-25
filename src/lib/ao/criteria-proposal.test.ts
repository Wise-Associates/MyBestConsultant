import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CRITERIA_PROPOSAL_PROMPT, criteriaProposalRequest, parseCriteriaProposal } from './criteria-proposal'
import { criteriaSetProblem, defaultCriteriaSet } from '@/lib/offer-criteria'

// Appel d'offres fictif.
const AO = {
  title: 'Développeur Java Angular', description: 'Le client recherche un développeur Java Angular pour ses applications de paiement. Java obligatoire.',
  skills: ['Java', 'Angular'], location: 'Lyon', experience: '5 ans',
}
const fallback = () => defaultCriteriaSet(AO)

describe('critères proposés par l’IA pour un AO', () => {
  it('la consigne ne fixe pas les poids des critères et interdit les noms d’entreprise', () => {
    assert.match(CRITERIA_PROPOSAL_PROMPT, /Aucun nom d'entreprise, de client/)
    assert.match(criteriaProposalRequest(AO), /^Titre : Développeur Java Angular\nLieu : Lyon\nExpérience demandée : 5 ans\nCompétences relevées : Java, Angular\nDescription :/)
  })

  it('remplace les libellés lus, garde les autres et les poids des critères ; importance → poids de total 100', () => {
    const answer = `Voici : ${JSON.stringify({
      poste: [{ libelle: 'Développeur Java', importance: 7, requis: true }, { libelle: 'Développeur Angular', importance: 3, requis: false }],
      autres_intitules: ['Ingénieur Java', 'Ingénieur Java', ''],
      competences: [{ libelle: 'Java', importance: 10, requis: true }, { libelle: 'Angular', importance: 10 }, { libelle: 'java', importance: 2 }],
      domaine: [{ libelle: 'Paiements, monétique : cartes', importance: 5 }],
      langue: [],
    })}`
    const set = parseCriteriaProposal(answer, fallback())
    assert.ok(set)
    assert.equal(criteriaSetProblem(set), null)
    const by = (id: string) => set.criteria.find(c => c.id === id)
    assert.deepEqual(by('poste')?.labels, [
      { label: 'Développeur Java', weight: 70, required: true }, { label: 'Développeur Angular', weight: 30, required: false },
    ])
    assert.deepEqual(by('competences')?.labels.map(l => [l.label, l.weight, l.required]), [['Java', 50, true], ['Angular', 50, false]])
    assert.equal(by('domaine')?.labels[0].label, 'Paiements monétique cartes')
    // Liste vide ou absente : libellés par défaut gardés ; liste d'un critère absent des critères par défaut : ignorée.
    assert.deepEqual(by('niveau')?.labels, [])
    assert.equal(by('langue'), undefined)
    assert.deepEqual(set.criteria.map(c => c.weight), fallback().criteria.map(c => c.weight))
    assert.deepEqual(set.alternativeTitles, ['Ingénieur Java'])
  })

  it('bornes : 4 métiers au plus pour le poste ; importance hors bornes ramenée entre 1 et 10', () => {
    const answer = JSON.stringify({
      poste: Array.from({ length: 6 }, (_, i) => ({ libelle: `Métier ${i}`, importance: i === 0 ? 50 : -3 })),
    })
    const set = parseCriteriaProposal(answer, fallback())
    const poste = set?.criteria.find(c => c.id === 'poste')
    assert.equal(poste?.labels.length, 4)
    assert.equal(poste?.labels.reduce((s, l) => s + l.weight, 0), 100)
    assert.ok((poste?.labels[0].weight ?? 0) > (poste?.labels[1].weight ?? 0))
  })

  it('lieu, séniorité, secteur : libellés requis comme dans le barème ; poste : le premier au moins ; seuls les cinq critères par défaut', () => {
    const answer = JSON.stringify({
      poste: [{ libelle: 'Développeur Java', importance: 8 }, { libelle: 'Développeur Angular', importance: 2 }],
      localisation: [{ libelle: 'Lyon', requis: false }], niveau: [{ libelle: '5 ans et plus' }], domaine: [{ libelle: 'Paiements' }],
      langue: [{ libelle: 'Anglais courant' }], projet: [{ libelle: 'Refonte' }],
    })
    const set = parseCriteriaProposal(answer, fallback())
    const required = (id: string) => set?.criteria.find(c => c.id === id)?.labels.map(l => l.required)
    assert.deepEqual(required('poste'), [true, false])
    assert.deepEqual(required('localisation'), [true])
    assert.deepEqual(required('niveau'), [true])
    assert.deepEqual(required('domaine'), [true])
    assert.deepEqual(set?.criteria.map(c => c.id), ['poste', 'localisation', 'niveau', 'competences', 'domaine'])
  })

  it('réponse illisible : null (l’appelant garde les critères par défaut)', () => {
    assert.equal(parseCriteriaProposal('pas de JSON', fallback()), null)
    assert.equal(parseCriteriaProposal('[1, 2]', fallback()), null)
  })
})
