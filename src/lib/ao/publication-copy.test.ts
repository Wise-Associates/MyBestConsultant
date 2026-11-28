import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findIdentifiers, findNames, words } from './name-match'
import {
  PLATFORM_NAMES, descriptionFromCopy, isGenericUnit, maskNames, maskTermsOf, modalityLines, parsePublicationCopy, type PublicationCopy,
} from './publication-copy'
import { publicLabel, toPublicOffer } from './anonymize'
import type { AoOfferFields } from './types'
import { parseDescription } from '@/lib/description-sections'
import { offerRequirements } from '@/lib/match-scoring'

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
    const modalities = modalityLines({ duration: ' 12 mois\n renouvelables ', startDate: 'ASAP', experience: '' })
    assert.deepEqual(modalities, ['Durée : 12 mois renouvelables', 'Démarrage : ASAP'])
    assert.equal(descriptionFromCopy(copy, modalities), [
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
      '- Durée : 12 mois renouvelables',
      '- Démarrage : ASAP',
    ].join('\n'))
    assert.ok(!descriptionFromCopy(copy).includes('Modalités'), 'section vide omise')
  })

  it('n\'écrit jamais les modalités de l\'IA : seules celles lues dans l\'e-mail sont publiées (ADR 0060)', () => {
    // L'IA inventait une durée ou un démarrage dans la moitié des AO qui n'en donnaient pas.
    const copy = parsePublicationCopy(JSON.stringify({ ...answer, terms: ['Mission de 6 mois renouvelable', 'Démarrage immédiat'] }))!
    assert.ok(!descriptionFromCopy(copy).includes('6 mois') && !descriptionFromCopy(copy).includes('immédiat'))
    assert.deepEqual(modalityLines({ duration: '', startDate: '  ', experience: '' }), [])
  })

  it('ne masque jamais une direction générique, même citée par l\'IA parmi les noms retirés (ADR 0060)', () => {
    const copy = parsePublicationCopy(JSON.stringify(answer))!
    const removed = ['DSI', 'DPII', 'Direction des opérations', 'direction des risques', 'MOA',
      'Service Liquidation Aquitaine', 'Direction Générale des Finances Publiques', 'DSI de BHX', 'Pôle Actuariat Bretagne-Sud', 'Bureau Veritas']
    assert.deepEqual(maskTermsOf({ ...copy, removed }),
      ['Service Liquidation Aquitaine', 'Direction Générale des Finances Publiques', 'DSI de BHX', 'Pôle Actuariat Bretagne-Sud', 'Bureau Veritas'])
    assert.equal(isGenericUnit('Directions'), true)
    assert.equal(isGenericUnit('Directeur'), false)
  })

  it('signale Wise Associates à la relecture, quelle que soit la forme écrite (ADR 0060)', () => {
    assert.deepEqual(findNames('Mission pour une banque.\nTransmis par WISE-ASSOCIATES.', PLATFORM_NAMES), ['WISE-ASSOCIATES'])
    assert.deepEqual(findNames('Faire un choix avisé et sage.', PLATFORM_NAMES), [])
    assert.deepEqual(findIdentifiers('Offre relayée par Wise Associates.', PLATFORM_NAMES), ['Wise Associates'])
  })

  it('signale aussi MyBestConsultant, écrit en un mot, en trois ou comme adresse (demande du 2026-11-26)', () => {
    assert.deepEqual(findNames('Offre diffusée via MyBestConsultant.\nPostulez sur mybestconsultant.fr\nLe site My Best Consultant.', PLATFORM_NAMES),
      ['MyBestConsultant', 'mybestconsultant', 'My Best Consultant'])
    assert.deepEqual(findNames('Le meilleur consultant du marché.', PLATFORM_NAMES), [])
  })

  it('place « Le contexte » en paragraphe après l\'accroche, lu comme le contexte de l\'offre', () => {
    const context = 'Un grand groupe bancaire international modernise le pilotage de ses achats informatiques. '
      + 'Le projet vise à centraliser les demandes de prestations et à suivre les fournisseurs.'
    const copy = parsePublicationCopy(JSON.stringify({ ...answer, context }))!
    const description = descriptionFromCopy(copy)
    assert.match(description, new RegExp(`^Pilotez[^\\n]+\\n\\n### Le contexte\\n${context.replace(/[.]/g, '\\.')}\\n\\n### Au programme\\n`))
    const sections = parseDescription(description)
    assert.equal(sections.find(s => s.title === 'Le contexte')?.kind, 'context')
    // Le contexte n'est pas jugé comme une exigence par le matching (puces Profil et Missions seulement).
    assert.ok(!offerRequirements(description).some(r => r.includes('grand groupe bancaire')))
  })

  it('accepte une réponse sans contexte (offre qui n\'en dit rien) et borne le contexte', () => {
    const copy = parsePublicationCopy(JSON.stringify(answer))!
    assert.equal(copy.context, '')
    assert.ok(!descriptionFromCopy(copy).includes('Le contexte'))
    const long = parsePublicationCopy(JSON.stringify({ ...answer, context: `<p>${'Projet de transformation. '.repeat(60)}</p>` }))!
    assert.ok(long.context.length <= 600 && !/[<>]/.test(long.context))
  })

  it('signale à la relecture un nom du client resté dans le contexte', () => {
    const copy = parsePublicationCopy(JSON.stringify({ ...answer, context: 'La BNPP modernise ses achats informatiques.' }))!
    assert.deepEqual(findIdentifiers(descriptionFromCopy(copy), [words('BNPP')]), ['BNPP'])
  })

  it('masque à la publication les noms que l\'IA dit avoir retirés, même laissés par erreur, sauf la ville de l\'offre', () => {
    const copy = parsePublicationCopy(JSON.stringify(answer))!
    // « Paris » est la ville de l'offre : la masquer la ferait disparaître partout.
    assert.deepEqual(maskTermsOf(copy), ['BNPP', 'CIB', 'RFC00094023'])
    assert.deepEqual(maskTermsOf({ ...copy, removed: ['X', ' ', 'Novobanco'] } satisfies PublicationCopy), ['Novobanco'])
    // La ville suivie de son département reste la ville de l'offre.
    assert.deepEqual(maskTermsOf({ ...copy, location: 'Montreuil', removed: ['Montreuil (93)', 'Montreuil-Bellay'] }), ['Montreuil-Bellay'])
    // Expression ordinaire listée par l'IA : jamais masquée (elle deviendrait le libellé affiché dans tout le texte).
    assert.deepEqual(maskTermsOf({ ...copy, removed: ['ORION', 'référents ORION', 'dispositifs nationaux', 'projet b-steady 2'] }),
      ['ORION', 'référents ORION', 'projet b-steady 2'])
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
    assert.equal(pub.description, 'Rattaché au client confidentiel, vous pilotez la gouvernance IT.')
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

  it('repère les numéros d\'avis et d\'offres de la veille, mais ni les dates, ni les normes datées, ni les montants', () => {
    assert.deepEqual(
      findIdentifiers('Avis 26-105130, TED 654321-2026, JOUE 2023/S 123-456789, offres 2026-2442607 et MEF_2026-33005.', []),
      ['26-105130', '654321-2026', '2023/S 123-456789', '2026-2442607', 'MEF_2026-33005'],
    )
    const text = 'Démarrage le 2026-01-15, période 2025-2026, 01-23-45-67-89, lot 3-12, Paris 75015, budget 90 000 €, code 12-1234, '
      + 'ISO 27001-2022, ISO/IEC 27001-2013, EN 50128-2011, IEC 61508-2010, salaire 45-55000 € brut, 40-450000 €, 45-550000 euros'
    assert.deepEqual(findIdentifiers(text, []), [])
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

  it('retire les numéros d\'avis des marchés publics avec leur libellé', () => {
    const description = 'Procédure publiée au BOAMP (référence : 26-105130), aussi au JOUE (Avis n° 2023/S 123-456789).\n'
      + 'Réf. TED : 654321-2026\nRéférence BOAMP n° 26-105131\n\n### Référence BOAMP\n26-105130\n\n'
      + '**Référence :**\n26-105130\n\n### Références\nTrois références similaires exigées.'
    assert.equal(toPublicOffer(offer({ description }), []).description,
      'Procédure publiée au BOAMP, aussi au JOUE.\n\n### Références\nTrois références similaires exigées.')
    assert.equal(toPublicOffer(offer({ title: '26-105130 - Gouvernance des données' }), []).title, 'Gouvernance des données')
  })

  it('retire aussi les autres formes de libellé, espaces insécables compris', () => {
    const description = 'Avis BOAMP n° 26-105130\nN° TED : 654321-2026\nNuméro de l\'avis : 26-105131\n'
      + 'Référence BOAMP : 26-105132\n* **Référence :** 26-105133\n- Réf. AO : DH038970\nMission de pilotage.'
    assert.equal(toPublicOffer(offer({ description }), []).description, 'Mission de pilotage.')
  })

  it('garde le mot « référence » quand il ne présente pas une référence retirée', () => {
    const description = 'Java 17, la version de référence.\nRéférence client exigée.\nRéférences : trois projets similaires.\n\n'
      + '### Référence\nVous serez la référence technique.'
    assert.equal(toPublicOffer(offer({ description }), []).description, description)
    // Dans une phrase, seule la référence part : « la référence » reste lisible.
    assert.equal(toPublicOffer(offer({ description: 'Merci d\'indiquer la référence DH038970 dans l\'objet.' }), []).description,
      'Merci d\'indiquer la référence dans l\'objet.')
    assert.equal(toPublicOffer(offer({ description: 'Publié au BOAMP sous la référence 26-105130 le 12 octobre.' }), []).description,
      'Publié au BOAMP sous la référence le 12 octobre.')
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
