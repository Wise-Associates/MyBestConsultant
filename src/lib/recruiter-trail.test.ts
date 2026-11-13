import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { backTarget, parseTrail, recordVisit, recruiterPageLabel, TRAIL_MAX } from './recruiter-trail'

describe('pages visitées dans l\'onglet (lien « Retour »)', () => {
  it('ajoute chaque nouvelle page à la suite', () => {
    let trail: string[] = []
    trail = recordVisit(trail, '/recruiter/dashboard')
    trail = recordVisit(trail, '/recruiter/pipeline/job42')
    trail = recordVisit(trail, '/recruiter/candidates/app7')
    assert.deepEqual(trail, ['/recruiter/dashboard', '/recruiter/pipeline/job42', '/recruiter/candidates/app7'])
  })

  it('garde l\'état le plus récent d\'une page dont seuls les filtres changent', () => {
    const trail = recordVisit(['/recruiter/dashboard'], '/recruiter/dashboard?statut=archivees&q=java')
    assert.deepEqual(trail, ['/recruiter/dashboard?statut=archivees&q=java'])
  })

  it('revient d\'un cran quand on retourne à la page d\'où l\'on venait (Précédent du navigateur ou « Retour »)', () => {
    const trail = recordVisit(['/recruiter/dashboard?q=java', '/recruiter/pipeline/job42', '/recruiter/candidates/app7'], '/recruiter/pipeline/job42')
    assert.deepEqual(trail, ['/recruiter/dashboard?q=java', '/recruiter/pipeline/job42'])
    // Le pipeline renvoie de nouveau au tableau de bord, filtres compris.
    assert.equal(backTarget(trail, '/recruiter/pipeline/job42'), '/recruiter/dashboard?q=java')
  })

  it('reprend la page d\'origine dans l\'état où on la retrouve', () => {
    const trail = recordVisit(['/recruiter/dashboard?q=java', '/recruiter/pipeline/job42'], '/recruiter/dashboard')
    assert.deepEqual(trail, ['/recruiter/dashboard'])
  })

  it('est sans effet quand la même adresse est notée deux fois', () => {
    const once = recordVisit(['/recruiter/dashboard'], '/recruiter/pipeline/job42')
    assert.equal(recordVisit(once, '/recruiter/pipeline/job42'), once)
  })

  it(`garde les ${TRAIL_MAX} dernières pages`, () => {
    let trail: string[] = []
    for (let i = 0; i < TRAIL_MAX + 5; i++) trail = recordVisit(trail, `/recruiter/pipeline/job${i}`)
    assert.equal(trail.length, TRAIL_MAX)
    assert.equal(trail[0], '/recruiter/pipeline/job5')
    assert.equal(trail.at(-1), `/recruiter/pipeline/job${TRAIL_MAX + 4}`)
  })

  it('ne note que les pages de l\'espace recruteur', () => {
    const trail = ['/recruiter/dashboard']
    assert.equal(recordVisit(trail, '/jobs/job42'), trail)
    assert.equal(recordVisit(trail, '//exemple.fr/recruiter/dashboard'), trail)
  })
})

describe('destination du lien « Retour »', () => {
  it('renvoie la page précédente de l\'onglet', () => {
    assert.equal(backTarget(['/recruiter/vivier/job42', '/recruiter/pipeline/job42/matching'], '/recruiter/pipeline/job42/matching'), '/recruiter/vivier/job42')
  })

  it('ne renvoie rien sans page précédente (page ouverte directement, nouvel onglet) : la page donne sa page parente', () => {
    assert.equal(backTarget([], '/recruiter/candidates/app7'), null)
    assert.equal(backTarget(['/recruiter/candidates/app7'], '/recruiter/candidates/app7'), null)
  })

  it('donne la même page, que la page affichée soit déjà notée ou non', () => {
    // Arrivée sur le pipeline par un lien depuis la fiche candidat.
    assert.equal(backTarget(['/recruiter/dashboard', '/recruiter/candidates/app7'], '/recruiter/pipeline/job42'), '/recruiter/candidates/app7')
    // Précédent du navigateur depuis la fiche candidat : le pipeline renvoie au tableau de bord, pas à la fiche.
    const trail = ['/recruiter/dashboard?q=java', '/recruiter/pipeline/job42', '/recruiter/candidates/app7']
    assert.equal(backTarget(trail, '/recruiter/pipeline/job42'), '/recruiter/dashboard?q=java')
    assert.equal(backTarget(recordVisit(trail, '/recruiter/pipeline/job42'), '/recruiter/pipeline/job42'), '/recruiter/dashboard?q=java')
  })

  it('ne renvoie rien hors de l\'espace recruteur', () => {
    assert.equal(backTarget(['/recruiter/dashboard'], '/jobs/job42'), null)
  })
})

describe('relecture des pages notées dans l\'onglet', () => {
  it('reprend une liste valide', () => {
    assert.deepEqual(parseTrail('["/recruiter/dashboard","/recruiter/pipeline/job42"]'), ['/recruiter/dashboard', '/recruiter/pipeline/job42'])
  })

  it('écarte tout ce qui n\'est pas une adresse de l\'espace recruteur', () => {
    assert.deepEqual(parseTrail('["/recruiter/dashboard","https://exemple.fr/recruiter",42,"/candidate/dashboard"]'), ['/recruiter/dashboard'])
    assert.deepEqual(parseTrail('{"a":1}'), [])
    assert.deepEqual(parseTrail('pas du JSON'), [])
    assert.deepEqual(parseTrail(null), [])
  })

  it(`ne garde que les ${TRAIL_MAX} dernières`, () => {
    const many = JSON.stringify(Array.from({ length: TRAIL_MAX + 3 }, (_, i) => `/recruiter/pipeline/job${i}`))
    assert.equal(parseTrail(many).length, TRAIL_MAX)
  })
})

describe('nom de la page d\'origine', () => {
  it('nomme les pages de l\'espace recruteur', () => {
    assert.equal(recruiterPageLabel('/recruiter/dashboard?q=java'), 'Job board')
    assert.equal(recruiterPageLabel('/recruiter/pipeline/job42'), 'Pipeline de l’offre')
    assert.equal(recruiterPageLabel('/recruiter/pipeline/job42/matching'), 'Matching IA')
    assert.equal(recruiterPageLabel('/recruiter/candidates/app7'), 'Fiche candidat')
    assert.equal(recruiterPageLabel('/recruiter/candidate-preview/vivier/cv9'), 'Profil du candidat')
    assert.equal(recruiterPageLabel('/recruiter/annonces'), 'Suivi des annonces')
    assert.equal(recruiterPageLabel('/recruiter/annonces/job42'), 'Rapport de l’annonce')
    assert.equal(recruiterPageLabel('/recruiter/vivier/job42'), 'Vivier de l’offre')
    assert.equal(recruiterPageLabel('/recruiter/parametres/boites-ao/abc123'), 'Appel d’offres')
    assert.equal(recruiterPageLabel('/recruiter/interviews/sess1'), 'Entretien IA')
    assert.equal(recruiterPageLabel('/recruiter/screening/job42'), 'Screening de l’offre')
    assert.equal(recruiterPageLabel('/recruiter/support/t1'), 'Demande au support')
  })

  it('distingue les sous-pages fixes des pages d\'un élément', () => {
    assert.equal(recruiterPageLabel('/recruiter/parametres/boites-ao/boites'), 'Boîtes AO')
    assert.equal(recruiterPageLabel('/recruiter/parametres/boites-ao/statistiques'), 'Statistiques AO')
    assert.equal(recruiterPageLabel('/recruiter/interviews/new'), 'Nouvel entretien')
    assert.equal(recruiterPageLabel('/recruiter/interviews/questions'), 'Questions génériques')
    assert.equal(recruiterPageLabel('/recruiter/screening/best'), 'Meilleurs candidats')
  })

  it('reprend les rubriques du sous-menu', () => {
    assert.equal(recruiterPageLabel('/recruiter/funnel'), 'Pipelines')
    assert.equal(recruiterPageLabel('/recruiter/cvtheque'), 'CV Thèque')
    assert.equal(recruiterPageLabel('/recruiter/interviews'), 'Entretiens IA')
  })

  it('nomme l\'onglet du vivier gardé dans l\'adresse', () => {
    assert.equal(recruiterPageLabel('/recruiter/vivier'), 'Mon vivier')
    assert.equal(recruiterPageLabel('/recruiter/vivier?vue=general'), 'Vivier général')
  })

  it('donne un nom neutre à une page inconnue', () => {
    assert.equal(recruiterPageLabel('/recruiter/nouvelle-page'), 'Page précédente')
  })
})
