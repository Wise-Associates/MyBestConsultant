import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findLeaks, identityTerms, leakMessage } from './leak-check'
import { renderCv } from './render'
import wiseMap from './templates/wise-associates/template_map.json'
import type { CvData, TemplateMap } from './types'

// Candidat fictif « Camille Fontaine » ; le template contient le bloc contact du commercial de l'ESN.
const TEMPLATE = new Uint8Array(readFileSync(path.join(process.cwd(), 'src/lib/cv-export/templates/wise-associates/template.docx')))
const MAP: TemplateMap = wiseMap
const IDENTITY = identityTerms(
  { firstName: 'Camille', lastName: 'Fontaine', email: 'camille.fontaine@example.com', phone: '06 11 22 33 44' }, ['12 rue des Exemples'])

const base: CvData = {
  identifiant: 'C.F.',
  titre: 'Cheffe de projet qualité',
  experience: '8 ans d\'expérience',
  resume: ['Cheffe de projet qualité avec 8 ans d\'expérience.'],
  experiences: [{
    dates: 'Mars 2019 – Aujourd\'hui', client: 'Industriel Exemple', role_lignes: ['Qualité — Cheffe de projet'],
    contexte: 'Démarche qualité d\'un site de production.', realisations: ['Certification ISO 9001 obtenue.'], environnement: '',
  }],
  formations: [], certifications: [], langues: [{ langue: 'Anglais', niveau: 'courant' }], competences: [],
}

const leaksOf = (data: CvData, terms = IDENTITY) => findLeaks(renderCv(TEMPLATE, MAP, data, 'fr'), TEMPLATE, terms, MAP.esn)
const withBullet = (text: string): CvData => ({ ...base, experiences: [{ ...base.experiences[0], realisations: [text] }] })

describe('findLeaks', () => {
  it('ne signale rien pour un CV anonymisé (bloc contact du commercial compris)', () => {
    assert.deepEqual(leaksOf(base), [])
  })

  it('signale le nom, l\'e-mail, le téléphone et le lien de profil du candidat', () => {
    assert.deepEqual(leaksOf(withBullet('Rapport signé C. Fontaine.')).map(l => l.kind), ['identity'])
    const kinds = leaksOf(withBullet('Contact : camille.f@perso-exemple.fr, +33 6 11 22 33 44, linkedin.com/in/camille-f')).map(l => l.kind)
    assert.ok(kinds.includes('email') && kinds.includes('phone') && kinds.includes('link'), kinds.join(','))
  })

  it('reconnaît le nom caché par des caractères invisibles ou collé dans une adresse', () => {
    assert.equal(leaksOf(withBullet('Rapport de C. Fon\u200Btaine.'))[0]?.kind, 'identity')
    assert.ok(leaksOf(withBullet('Portfolio : camillefontaine.fr')).some(l => l.kind === 'identity'))
  })

  it('reconnaît le téléphone connu quel que soit son découpage', () => {
    for (const phone of ['06/11/22/33/44', '06 11 223 344', '(0)6.11.22.33.44']) {
      assert.ok(leaksOf(withBullet(`Joignable au ${phone}.`)).some(l => l.kind === 'phone'), phone)
    }
  })

  it('bloque tout lien absent du template, sans prendre un nom de technologie pour un lien', () => {
    for (const link of ['https://camille-f.dev', 'www.exemple-perso.fr', 'malt.fr/profile/camillef', 'wa.me/33611223344', 'calendly.com/cf-data']) {
      assert.ok(leaksOf(withBullet(`Voir ${link}`)).some(l => l.kind === 'link'), link)
    }
    assert.deepEqual(leaksOf(withBullet('Applications ASP.NET et Node.js.')), [])
  })

  it('cherche les termes en mots entiers, sans accents ni casse', () => {
    assert.deepEqual(leaksOf(base, ['Ali']), []) // « qualité » ne contient pas le prénom « Ali »
    assert.equal(leaksOf(withBullet('Projet mené avec ÉLODIE.'), ['Elodie']).length, 1)
  })

  it('n\'alerte pas sur un prénom déjà présent dans le template (commercial), seulement s\'il apparaît en plus', () => {
    assert.deepEqual(leaksOf(base, ['David']), [])
    assert.equal(leaksOf(withBullet('Binôme avec David.'), ['David']).length, 1)
  })

  it('formule un message lisible pour l\'admin', () => {
    const message = leakMessage([{ kind: 'email', value: 'x@exemple.fr' }])
    assert.match(message, /Export bloqué/)
    assert.match(message, /adresse e-mail « x@exemple\.fr »/)
  })
})
