import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findIdentifiers, findNames, words } from './name-match'
import { descriptionFromCopy, maskNames, maskTermsOf, parsePublicationCopy, type PublicationCopy } from './publication-copy'
import { publicLabel, toPublicOffer } from './anonymize'
import type { AoOfferFields } from './types'

// Version publiée d'une offre AO (« Préparer la publication ») : réponse de l'IA validée, description mise en forme,
// et repérage de ce qui identifierait encore le client. Valeurs inventées.

const answer = {
  title: 'Coordinateur sourcing IT (H/F)',
  sector: 'Grande banque d\'investissement',
  location: 'Paris',
  tagline: 'Pilotez les achats IT d\'une direction des systèmes d\'information internationale.',
  missions: ['Coordonner les demandes de prestations IT', 'Suivre les budgets et les fournisseurs'],
  profile: ['5 ans d\'expérience en sourcing IT', 'Anglais courant'],
  terms: ['Durée : 12 mois', 'Démarrage : ASAP'],
  skills: ['Sourcing IT', 'Achats', 'Excel'],
  removed: ['BNPP', 'CIB', 'RFC00094023', 'Paris'],
}

describe('« Préparer la publication » : réponse de l\'IA', () => {
  it('lit la réponse, entourée de texte ou de balises markdown', () => {
    const copy = parsePublicationCopy(`Voici :\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``)
    assert.equal(copy?.title, 'Coordinateur sourcing IT (H/F)')
    assert.equal(copy?.sector, 'Grande banque d\'investissement')
    assert.deepEqual(copy?.missions, answer.missions)
  })

  it('refuse une réponse sans titre, sans missions ni profil, ou illisible : la version par les règles est proposée', () => {
    assert.equal(parsePublicationCopy('pas de JSON'), null)
    assert.equal(parsePublicationCopy('{"title": "Coordinateur", "missions": ['), null)
    assert.equal(parsePublicationCopy(JSON.stringify({ ...answer, title: '' })), null)
    assert.equal(parsePublicationCopy(JSON.stringify({ ...answer, missions: [], profile: [] })), null)
  })

  it('borne chaque champ et chaque liste, et retire les chevrons', () => {
    const copy = parsePublicationCopy(JSON.stringify({
      ...answer, title: `<b>${'Architecte '.repeat(20)}</b>`, missions: Array.from({ length: 12 }, (_, i) => `Mission ${i}`), skills: Array.from({ length: 15 }, (_, i) => `Outil ${i}`),
    }))!
    assert.ok(copy.title.length <= 100 && !/[<>]/.test(copy.title))
    assert.equal(copy.missions.length, 6)
    assert.equal(copy.skills.length, 10)
  })

  it('met en forme la description comme le site l\'affiche : accroche, Au programme, Profil recherché, Modalités', () => {
    const copy = parsePublicationCopy(JSON.stringify(answer))!
    assert.equal(descriptionFromCopy(copy), [
      'Pilotez les achats IT d\'une direction des systèmes d\'information internationale.',
      '',
      '### Au programme',
      '- Coordonner les demandes de prestations IT',
      '- Suivre les budgets et les fournisseurs',
      '',
      '### Profil recherché',
      '- 5 ans d\'expérience en sourcing IT',
      '- Anglais courant',
      '',
      '### Modalités',
      '- Durée : 12 mois',
      '- Démarrage : ASAP',
    ].join('\n'))
    assert.ok(!descriptionFromCopy({ ...copy, terms: [] }).includes('Modalités'), 'section vide omise')
  })

  it('masque à la publication les noms que l\'IA dit avoir retirés, même laissés par erreur, sauf la ville de l\'offre', () => {
    const copy = parsePublicationCopy(JSON.stringify(answer))!
    // « Paris » est la ville de l'offre : la masquer la ferait disparaître partout.
    assert.deepEqual(maskTermsOf(copy), ['BNPP', 'CIB', 'RFC00094023'])
    assert.deepEqual(maskTermsOf({ ...copy, removed: ['X', ' ', 'Novobanco'] } satisfies PublicationCopy), ['Novobanco'])
    // L'IA a retiré « BNPP »… mais l'a laissé dans une mission, à côté d'une norme : il reste masqué et signalé.
    const leaky = { ...copy, missions: ['Coordonner les demandes IT de BNPP CIB selon AS9100'] }
    assert.deepEqual(maskTermsOf(leaky), ['BNPP', 'CIB', 'RFC00094023'])
    const pub = toPublicOffer({ title: copy.title, companyName: '', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: null, skills: [],
      description: descriptionFromCopy(leaky), duration: '', startDate: '', experience: '' }, [], copy.sector, maskNames(maskTermsOf(leaky)))
    assert.ok(!/BNPP|CIB/.test(pub.description) && pub.description.includes('AS9100'), pub.description)
  })

  it('masque chaque terme retiré tel quel, sans ses variantes : « Group IT » ne masque pas « IT » partout', () => {
    const pub = toPublicOffer({ title: 'Chef de projet IT (H/F)', companyName: '', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: null,
      skills: ['Gouvernance IT'], description: 'Rattaché au Group IT, vous pilotez la gouvernance IT.', duration: '', startDate: '', experience: '' },
    [], 'Grand groupe bancaire', maskNames(['Group IT']))
    assert.equal(pub.title, 'Chef de projet IT (H/F)')
    assert.deepEqual(pub.skills, ['Gouvernance IT'])
    assert.equal(pub.description, 'Rattaché au Grand groupe bancaire, vous pilotez la gouvernance IT.')
  })
})

describe('relecture de la version publiée : ce qui identifierait encore le client', () => {
  it('repère les noms à masquer (casse et accents ignorés) et les références d\'appel d\'offres', () => {
    const names = [words('Société Générale'), words('BNPP')]
    const text = 'Mission pour la SOCIETE GENERALE (bnpp) — demande RFC00094023, lot DH038970, AO-0042.'
    assert.deepEqual(findIdentifiers(text, names), ['SOCIETE GENERALE', 'bnpp', 'RFC00094023', 'DH038970', 'AO-0042'])
  })

  it('version non anonymisée : ne signale que les noms de personnes, pas les références qu\'elle garde', () => {
    const text = 'Demande RFC00094023 : envoyez vos CV à Marie Dupont avant le 12/11.'
    assert.deepEqual(findNames(text, [words('Marie Dupont')]), ['Marie Dupont'])
    assert.deepEqual(findNames('Demande RFC00094023.', [words('Marie Dupont')]), [])
  })

  it('ne signale ni les normes, ni les années, ni les versions', () => {
    const text = 'ISO27001, ISO 20022, IEC61508, EN50128, AS9100, IATF16949, ISAE3402, MIL-STD-1553, SAE J1939, IFRS 9, Java 17, '
      + 'S/4HANA 2023, Dynamics AX2012, NAV2018, JavaScript ES2015+, Office365, livraison 2026'
    assert.deepEqual(findIdentifiers(text, []), [])
    assert.deepEqual(findIdentifiers('RFP99619, DH038917, AO-0042, RFC2026001', []), ['RFP99619', 'DH038917', 'AO-0042', 'RFC2026001'])
  })
})

describe('filet de sécurité de la publication : références retirées', () => {
  const offer = (over: Partial<AoOfferFields>): AoOfferFields => ({
    title: '', companyName: '', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: null, skills: [],
    description: 'Description suffisamment longue.', duration: '', startDate: '', experience: '', ...over,
  })

  it('retire les références du titre et de la description, sans laisser de séparateur ni de parenthèses vides', () => {
    const pub = toPublicOffer(offer({ title: 'BNPP - RFC00094023 - IT Sourcing Coordinator', description: 'Demande RFC00094023 (DH038970) à traiter.' }), [words('BNPP')])
    assert.equal(pub.title, 'Client confidentiel - IT Sourcing Coordinator')
    assert.equal(pub.description, 'Demande à traiter.')
    assert.equal(toPublicOffer(offer({ description: 'Votre réponse à la demande RFC00094023 avant vendredi.' }), []).description, 'Votre réponse à la demande avant vendredi.')
    assert.equal(toPublicOffer(offer({ title: 'RFC00094758 - Consultant SEO' }), []).title, 'Consultant SEO')
    assert.equal(toPublicOffer(offer({ title: 'Développeur Front IT (H/F) (DH038917)' }), []).title, 'Développeur Front IT (H/F)')
  })

  it('masque d\'abord les noms connus : un terme retiré par l\'IA qui en chevauche un ne le laisse pas à moitié', () => {
    const pub = toPublicOffer(offer({ description: 'Mission au sein du Groupe BNP Paribas.' }), [words('BNP Paribas')], 'Grande banque', maskNames(['Groupe BNP']))
    assert.equal(pub.description, 'Mission au sein du Groupe Grande banque.')
  })

  it('n\'affiche comme entreprise qu\'un libellé sans nom à masquer, coordonnée ni référence', () => {
    const names = [words('BNP Paribas')]
    assert.equal(publicLabel('Grand groupe bancaire', names), 'Grand groupe bancaire')
    assert.equal(publicLabel('Banque - CV à rh@example.test 0612345678', names), 'Client confidentiel')
    assert.equal(publicLabel('BNP Paribas', names), 'Client confidentiel')
    assert.equal(publicLabel('Banque RFC00094023', names), 'Client confidentiel')
    assert.equal(publicLabel(' ', names), 'Client confidentiel')
  })
})
