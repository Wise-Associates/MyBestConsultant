import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { outreachMessagePrompt, parseOutreachAnswer } from './outreach-prompt'

describe('demande du message de prise de contact', () => {
  it('candidat, offre, compétences et lieu, une ligne chacun', () => {
    const { system, user } = outreachMessagePrompt({
      candidateFirstName: 'Awa', candidateLastName: 'Diallo', jobTitle: 'Développeur Fullstack .NET', jobSkills: ['C#', '.NET', 'Angular'], jobLocation: 'Paris',
    })
    assert.equal(user, 'Candidat : Awa Diallo\nOffre : Développeur Fullstack .NET\nCompétences recherchées : C#, .NET, Angular\nLieu : Paris')
    assert.ok(system.startsWith('Tu rédiges un premier message de prise de contact d\'un recruteur vers un candidat'))
    assert.ok(system.includes('Réponds UNIQUEMENT avec un JSON valide : {"subject":"...", "message":"..."}'))
    assert.ok(system.endsWith('- "message" en texte brut, sauts de ligne avec \\n'), 'antislash littéral, pas un retour à la ligne')
  })

  it('offre sans compétences : liste vide', () => {
    const { user } = outreachMessagePrompt({ candidateFirstName: 'Awa', candidateLastName: 'Diallo', jobTitle: 'PO', jobSkills: null, jobLocation: 'Lyon' })
    assert.ok(user.includes('\nCompétences recherchées : \nLieu : Lyon'))
  })
})

describe('lecture de la réponse', () => {
  it('accepte le premier objet JSON du texte', () => {
    assert.deepEqual(
      parseOutreachAnswer('Voici : {"subject":"Mission Java à Lyon","message":"Bonjour Awa,\\nUne mission…"} Fin.', 'Dev Java'),
      { subject: 'Mission Java à Lyon', message: 'Bonjour Awa,\nUne mission…' },
    )
  })

  it('objet absent ou blanc : objet tiré de l\'intitulé de l\'offre', () => {
    assert.deepEqual(parseOutreachAnswer('{"subject":"  ","message":"m"}', 'Dev Java'), { subject: 'Opportunité — Dev Java', message: 'm' })
    assert.deepEqual(parseOutreachAnswer('{}', 'Dev Java'), { subject: 'Opportunité — Dev Java', message: '' })
  })

  it('refuse une réponse sans objet JSON ; JSON malformé : l\'erreur de lecture est levée', () => {
    assert.deepEqual(parseOutreachAnswer('Je ne peux pas.', 'Dev Java'), { subject: '', message: '', error: 'Réponse IA invalide' })
    assert.throws(() => parseOutreachAnswer('{"subject": x}', 'Dev Java'), SyntaxError)
  })
})
