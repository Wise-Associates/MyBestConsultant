import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { improveImportedJobPrompt, jobImportPrompt, parseImprovedJobAnswer, parseJobImportAnswer, type ImprovableJobFields } from './job-import-prompts'

describe('demande d\'extraction des offres d\'un document', () => {
  it('source et texte dans la demande, entreprise par défaut dans les consignes', () => {
    const { system, user } = jobImportPrompt({ text: 'Offre : Développeur Java\nLieu : Nantes', filename: 'offres.pdf', defaultCompany: 'ACME Conseil' })
    assert.equal(user, 'Contenu à analyser (source: offres.pdf):\n\nOffre : Développeur Java\nLieu : Nantes')
    assert.ok(system.startsWith('Tu es un extracteur d\'offres d\'emploi expert.'))
    assert.ok(system.includes('"companyName": "string — nom de l\'entreprise, \'ACME Conseil\' si non précisé"'))
    assert.ok(system.endsWith('- Si aucune offre n\'est détectable, retourne []'))
  })

  it('texte collé : source « paste »', () => {
    assert.ok(jobImportPrompt({ text: 'abc', filename: 'paste', defaultCompany: 'Jeanne Martin' }).user.startsWith('Contenu à analyser (source: paste):'))
  })
})

describe('lecture de l\'extraction', () => {
  it('accepte le premier tableau JSON du texte ; montant en texte vidé, 10 compétences au plus, description en texte', () => {
    const answer = '```json\n[{"title":"Dev","location":"Paris","contractType":"cdi","remote":"onsite","salary":"55k","skills":["a","b","c","d","e","f","g","h","i","j","k"],"description":42,"companyName":"X","confidence":"high"}]\n```'
    const result = parseJobImportAnswer(answer)
    assert.ok('jobs' in result)
    assert.equal(result.jobs.length, 1)
    const [job] = result.jobs
    assert.equal(job.title, 'Dev')
    assert.equal(job.salary, null)
    assert.equal(job.skills.length, 10)
    assert.equal(job.description, '42')
    assert.equal('id' in job, false, 'l\'identifiant temporaire est tiré par l\'action')
  })

  it('tableau vide : aucune offre, sans erreur', () => {
    assert.deepEqual(parseJobImportAnswer('[]'), { jobs: [] })
  })

  it('refuse une réponse sans tableau, ou un tableau illisible (réponse coupée)', () => {
    assert.deepEqual(parseJobImportAnswer('Aucune offre.'), { error: 'Le modèle n\'a pas retourné de JSON valide' })
    const cut = parseJobImportAnswer('[{"title": "Dev", "description": "coupé]')
    assert.ok('error' in cut)
    assert.match(cut.error, /trop long ou trop complexe/)
  })
})

const job: ImprovableJobFields = { title: 'Dev Java', description: 'Desc', skills: ['Java'], location: 'Nantes', contractType: 'cdi', remote: 'hybrid', salary: 50000 }

describe('amélioration d\'une offre extraite', () => {
  it('offre actuelle en JSON puis demande nettoyée', () => {
    const { system, user } = improveImportedJobPrompt({ job, request: '  Passe en full remote ' })
    assert.equal(user, `Offre actuelle :\n${JSON.stringify(job)}\n\nDemande d'amélioration du recruteur : "Passe en full remote"`)
    assert.ok(system.includes('{"title":"...","description":"...","skills":["compétence1","compétence2"],"location":"...","contractType":"cdi|cdd|freelance|mission","remote":"onsite|hybrid|remote","salary":number|null}'))
  })

  it('champ absent ou hors liste : la valeur de l\'offre envoyée est gardée', () => {
    const result = parseImprovedJobAnswer('{"title":"Dev Java senior","remote":"remote","contractType":"stage","salary":null}', job)
    assert.deepEqual(result, { ...job, title: 'Dev Java senior', remote: 'remote' })
  })

  it('refuse une réponse sans objet JSON ou qui vide la description', () => {
    assert.deepEqual(parseImprovedJobAnswer('non', job), { error: 'Réponse IA invalide, réessayez' })
    assert.deepEqual(parseImprovedJobAnswer('{"description":""}', job), { error: 'Réponse IA incomplète, réessayez' })
  })

  it('JSON malformé : l\'erreur de lecture est levée', () => {
    assert.throws(() => parseImprovedJobAnswer('{"title": }', job), SyntaxError)
  })
})
