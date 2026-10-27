import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhrase, parseVeilleConfig, type VeilleConfig } from './config'

// Réglages fictifs, au format lu par le scanner veille-marches-emplois.
const config = (): VeilleConfig => ({
  schemaVersion: 1,
  organisations: [
    { id: 'insee', name: 'INSEE', enabled: true, tenderRules: [{ sirens: ['120027016'], names: ['institut national de la statistique*'], excludedNames: [], requiredText: [], note: '' }] },
    { id: 'banque-postale', name: 'La Banque Postale', enabled: true, tenderRules: [] },
    { id: 'proparco', name: 'Proparco', enabled: true, tenderRules: [] },
    { id: 'autorite-concurrence', name: 'Autorité de la concurrence', enabled: true, tenderRules: [] },
    { id: 'crh', name: 'CRH', enabled: true, tenderRules: [] },
  ],
  sources: [
    { kind: 'boamp', id: 'boamp', enabled: true },
    { kind: 'ted', id: 'ted', enabled: true },
    { kind: 'builtin', id: 'autorite-concurrence-carrieres', enabled: true },
    { kind: 'builtin', id: 'banque-postale-carrieres', enabled: true },
    { kind: 'builtin', id: 'afd-carrieres', enabled: true },
    { kind: 'builtin', id: 'crh-site', enabled: false },
    { kind: 'csp', id: 'csp-insee', enabled: true, organisationId: 'insee', label: 'Choisir le service public — INSEE', codes: ['978'] },
    { kind: 'rss', id: 'insee-carrieres', enabled: true, organisationId: 'insee', label: 'INSEE — site carrières fictif', url: 'https://carrieres.exemple.test/feed', readOfferPage: true },
  ],
  itScope: {
    enabled: true,
    cpvPrefixes: ['72', '48'],
    boampDescriptors: ['Logiciel'],
    phrases: ['développeur*', 'système d’information'],
    acronyms: ['SI', 'DSI'],
    exclusionPhrases: ['travaux'],
  },
  tenderKeywords: {
    allBuyers: true,
    families: [{ id: 'donnees', label: 'Gouvernance des données', phrases: ['gouvernance des données', 'data steward*'], acronyms: ['MDM'] }],
    infrastructurePhrases: ['fourniture de serveurs'],
  },
})

const errorsOf = (input: unknown) => {
  const r = parseVeilleConfig(input)
  return r.success ? [] : r.errors
}

describe('réglages de la veille', () => {
  it('accepte des réglages complets et nettoie les listes saisies (espaces, lignes vides)', () => {
    const input = config()
    input.itScope.phrases = ['  développeur*  ', '', 'système d’information']
    input.organisations[0].tenderRules[0].sirens = [' 120027016 ']
    const r = parseVeilleConfig(input)
    assert.ok(r.success, r.success ? '' : r.errors.join('\n'))
    assert.deepEqual(r.config.itScope.phrases, ['développeur*', 'système d’information'])
    assert.deepEqual(r.config.organisations[0].tenderRules[0].sirens, ['120027016'])
  })

  it('compare les expressions comme le scanner : sans accents, majuscules ni ponctuation, « * » de fin de mot gardé', () => {
    assert.equal(normalizePhrase('Système d’Information'), 'systeme d information')
    assert.equal(normalizePhrase("Agence des participations de l'État*"), 'agence des participations de l etat*')
    assert.equal(normalizePhrase('  Développeur*  Full-Stack '), 'developpeur* full stack')
    assert.equal(normalizePhrase('***'), '')
  })

  it('refuse un identifiant en double, une source sans organisme et un site intégré dont l\'organisme manque', () => {
    const duplicate = config()
    duplicate.sources.push({ ...duplicate.sources[6] })
    assert.ok(errorsOf(duplicate).some(e => /csp-insee.*plusieurs fois/.test(e)))

    const orphan = config()
    orphan.sources[7] = { ...orphan.sources[7], organisationId: 'inconnu' } as VeilleConfig['sources'][number]
    assert.ok(errorsOf(orphan).some(e => /organisme « inconnu » introuvable/.test(e)))

    const missingOrganisation = config()
    missingOrganisation.organisations = missingOrganisation.organisations.filter(o => o.id !== 'proparco')
    assert.ok(errorsOf(missingOrganisation).some(e => /afd-carrieres.*proparco/.test(e)))
  })

  it('exige BOAMP, TED et chaque site intégré une fois (désactivables, pas supprimables)', () => {
    const withoutTed = config()
    withoutTed.sources = withoutTed.sources.filter(s => s.id !== 'ted')
    assert.ok(errorsOf(withoutTed).some(e => /TED/.test(e)))
  })

  it('refuse les saisies invalides avec un message lisible', () => {
    const bad = config()
    bad.organisations[0].tenderRules[0].sirens = ['12345']
    bad.sources[7] = { ...bad.sources[7], url: 'http://carrieres.exemple.test/feed' } as VeilleConfig['sources'][number]
    bad.itScope.acronyms = ['si']
    bad.itScope.phrases = ['***']
    const errors = errorsOf(bad)
    assert.ok(errors.some(e => /SIREN/.test(e)), errors.join('\n'))
    assert.ok(errors.some(e => /https/.test(e)), errors.join('\n'))
    assert.ok(errors.some(e => /majuscules/.test(e)), errors.join('\n'))
    assert.ok(errors.some(e => /vide/.test(e)), errors.join('\n'))
  })

  it('refuse un identifiant qui ne peut pas servir de clé d\'état, et une règle d\'acheteur sans SIREN ni nom', () => {
    const bad = config()
    bad.organisations.push({ id: 'Avec Espace', name: 'Fictif', enabled: true, tenderRules: [{ sirens: [], names: [], excludedNames: ['x'], requiredText: [], note: '' }] })
    const errors = errorsOf(bad)
    assert.ok(errors.some(e => /identifiant/i.test(e)), errors.join('\n'))
    assert.ok(errors.some(e => /SIREN ou un nom/.test(e)), errors.join('\n'))
  })

  it('refuse une autre version du format', () => {
    assert.ok(errorsOf({ ...config(), schemaVersion: 2 }).length > 0)
    assert.ok(errorsOf('pas un objet').length > 0)
  })
})

describe('mots-clés des appels d\'offres', () => {
  it('lit des réglages enregistrés avant les mots-clés : recherche limitée aux organismes suivis', () => {
    const before: Record<string, unknown> = { ...config() }
    delete before.tenderKeywords
    const parsed = parseVeilleConfig(before)
    assert.ok(parsed.success)
    assert.deepEqual(parsed.success && parsed.config.tenderKeywords, { allBuyers: false, families: [], infrastructurePhrases: [] })
  })

  it('refuse une famille sans mot-clé ou en double, en nommant la famille', () => {
    const empty = config()
    empty.tenderKeywords.families = [{ id: 'vide', label: 'Famille vide', phrases: ['  '], acronyms: [] }]
    assert.deepEqual(errorsOf(empty), ['Mots-clés des appels d\'offres, famille « Famille vide » : Au moins une expression ou un sigle.'])
    const duplicate = config()
    duplicate.tenderKeywords.families.push({ ...duplicate.tenderKeywords.families[0], label: 'Copie' })
    assert.match(errorsOf(duplicate).join(' '), /famille de mots-clés « donnees » utilisé plusieurs fois/)
  })

  it('refuse un sigle en minuscules et un descripteur BOAMP qui casserait la requête du scanner', () => {
    const lower = config()
    lower.tenderKeywords.families[0].acronyms = ['mdm']
    assert.match(errorsOf(lower).join(' '), /famille « Gouvernance des données », sigles, « mdm » : Sigle en majuscules/)
    const quoted = config()
    quoted.itScope.boampDescriptors = ['Logiciel" OR nature="X']
    assert.match(errorsOf(quoted).join(' '), /descripteurs BOAMP.*sans guillemet/)
  })
})
