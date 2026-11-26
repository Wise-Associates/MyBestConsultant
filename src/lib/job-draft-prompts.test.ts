import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jobDraftPrompt, jobImprovePrompt, parseJobDraftAnswer, type JobDraft } from './job-draft-prompts'

const draft: JobDraft = {
  title: 'Consultant SAP FI/CO', description: 'Contexte\n- Mission', skills: ['SAP FI', 'SAP CO'],
  location: 'Lyon', contractType: 'freelance', remote: 'hybrid', salary: 650,
}

describe('demande de génération d\'une annonce', () => {
  it('besoin du recruteur nettoyé, entre guillemets', () => {
    const { system, user } = jobDraftPrompt({ need: '  Un dev React senior à Paris  ' })
    assert.equal(user, 'Besoin exprimé par le recruteur : "Un dev React senior à Paris"')
    assert.ok(system.startsWith('Tu es un expert en rédaction d\'annonces d\'emploi'))
    assert.ok(system.includes('"contractType":"cdi|cdd|freelance|mission ou \'\' si non précisé"'))
    assert.ok(system.includes('- Les sauts de ligne dans "description" doivent être de vrais \\n'), 'antislash littéral, pas un retour à la ligne')
  })

  it('« Régénérer » : la version précédente en JSON, pour une variante', () => {
    const { user } = jobDraftPrompt({ need: 'Dev React', previousDraft: draft })
    assert.equal(
      user,
      `Besoin exprimé par le recruteur : "Dev React"\n\nUne première version a déjà été générée, propose une variante différente (autre formulation, éventuellement autre angle) :\n${JSON.stringify(draft)}`,
    )
  })
})

describe('demande d\'amélioration d\'une annonce', () => {
  it('annonce actuelle en JSON puis demande nettoyée ; consignes propres à l\'amélioration', () => {
    const { system, user } = jobImprovePrompt({ request: ' Ajoute le télétravail ', currentDraft: draft })
    assert.equal(user, `Annonce actuelle :\n${JSON.stringify(draft)}\n\nDemande d'amélioration du recruteur : "Ajoute le télétravail"`)
    assert.ok(system.includes('renvoie TOUS les champs, en recopiant à l\'identique ceux qui ne sont pas concernés'))
    assert.notEqual(system, jobDraftPrompt({ need: 'x' }).system)
  })
})

describe('lecture de la réponse (génération et amélioration)', () => {
  it('accepte le premier objet JSON du texte ; valeurs hors liste vidées, 10 compétences au plus', () => {
    const answer = `Voici l'annonce :\n{"title":"Dev Java","description":"Texte","skills":["a","b","c","d","e","f","g","h","i","j","k"],"location":"Nantes","contractType":"stage","remote":"remote","salary":"55000"}`
    const result = parseJobDraftAnswer(answer)
    assert.ok('draft' in result)
    assert.equal(result.draft.title, 'Dev Java')
    assert.equal(result.draft.skills.length, 10)
    assert.equal(result.draft.contractType, '', 'stage n\'est pas un contrat proposé')
    assert.equal(result.draft.remote, 'remote')
    assert.equal(result.draft.salary, null, 'un montant en texte n\'est pas repris')
  })

  it('titre coupé à 200 caractères', () => {
    const result = parseJobDraftAnswer(JSON.stringify({ title: 'T'.repeat(300), description: 'd' }))
    assert.ok('draft' in result)
    assert.equal(result.draft.title.length, 200)
  })

  it('refuse une réponse sans objet JSON ou sans titre / description', () => {
    assert.deepEqual(parseJobDraftAnswer('Désolé, je ne peux pas.'), { error: 'Réponse IA invalide, réessayez' })
    assert.deepEqual(parseJobDraftAnswer('{"title":"","description":"x"}'), { error: 'Réponse IA incomplète, réessayez' })
    assert.deepEqual(parseJobDraftAnswer('{"title":"x"}'), { error: 'Réponse IA incomplète, réessayez' })
  })

  it('JSON malformé : l\'erreur de lecture est levée', () => {
    assert.throws(() => parseJobDraftAnswer('{"title": "x", oups}'), SyntaxError)
  })
})
