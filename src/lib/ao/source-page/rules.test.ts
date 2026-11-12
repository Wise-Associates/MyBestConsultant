import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ExtractedOffer } from '../types'
import { parsePageFill, pageFillJson, pageFillOf, pageFillText } from './page-fill'
import { blockedSiteReason, checkPageUrl, fillFromPage, isIncomplete, parseRobots, pickPageOffer, robotsAllows } from './rules'

// Données fictives.
const offer = (over: Partial<ExtractedOffer> = {}): ExtractedOffer => ({
  title: 'Développeur Java H/F', companyName: 'Exemple SA', location: '', contractType: 'mission', remote: 'onsite', salary: null,
  skills: [], technologies: [], description: 'Mission Java, voir l’annonce.', duration: '', startDate: '', experience: '',
  deadline: '', endClient: '', engagement: '', contact: null, sourceUrl: 'https://emplois.exemple.fr/offre/42', ...over,
})
const complete = offer({
  location: 'Paris', skills: ['Java'], experience: '5 ans', description: 'x'.repeat(600),
})

describe('offre à compléter par son annonce', () => {
  it('lit l’annonce si la description est courte ou si le lieu, les compétences ou l’expérience manquent', () => {
    assert.equal(isIncomplete(complete), false)
    assert.equal(isIncomplete({ ...complete, description: 'Courte' }), true)
    assert.equal(isIncomplete({ ...complete, location: ' ' }), true)
    assert.equal(isIncomplete({ ...complete, skills: [] }), true)
    assert.equal(isIncomplete({ ...complete, experience: '' }), true)
  })
})

describe('adresse d’une annonce que le serveur peut ouvrir', () => {
  it('accepte une page https, lue sans son ancre', () => {
    const check = checkPageUrl('https://emplois.exemple.fr/offre/42?ref=mail#postuler')
    assert.ok(check.ok)
    assert.equal(check.url.href, 'https://emplois.exemple.fr/offre/42?ref=mail')
  })

  it('lit un lien http en https, jamais en clair', () => {
    const check = checkPageUrl('http://emplois.exemple.fr/offre/42')
    assert.ok(check.ok)
    assert.equal(check.url.protocol, 'https:')
  })

  it('refuse les adresses IP, ports, identifiants et autres protocoles', () => {
    for (const url of [
      'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://10.0.0.5/admin', 'https://0x7f000001/',
      'https://localhost/', 'https://appwrite:8080/', 'https://emplois.exemple.fr:8443/', 'https://user:pass@emplois.exemple.fr/',
      'ftp://emplois.exemple.fr/', 'file:///etc/passwd', 'javascript:alert(1)', 'pas une adresse',
    ]) {
      assert.equal(checkPageUrl(url).ok, false, url)
    }
  })

  it('exclut les sites dont les conditions interdisent la lecture, sous-domaines compris, mais pas leurs homonymes', () => {
    for (const url of [
      'https://www.marches-publics.gouv.fr/?page=x', 'https://marches.maximilien.fr/', 'https://fr.linkedin.com/jobs/view/1', 'https://fr.indeed.com/viewjob?jk=1',
      'https://lnkd.in/abc', 'https://www.malt.de/profile/x', 'https://www-linkedin-com.translate.goog/jobs/view/1', 'https://web.archive.org/web/2026/https://fr.linkedin.com/',
    ]) {
      const check = checkPageUrl(url)
      assert.equal(check.ok, false, url)
      assert.match(check.ok ? '' : check.reason, /^site exclu/, url)
    }
    assert.equal(blockedSiteReason('notlinkedin.com'), null)
    assert.equal(blockedSiteReason('linkedin.com.exemple.fr'), null)
    assert.ok(blockedSiteReason('LinkedIn.com.'))
  })

  it('ne suit jamais un lien de désinscription (un GET suffit parfois à désinscrire la boîte)', () => {
    for (const url of [
      'https://exemple.fr/unsubscribe?u=1', 'https://exemple.fr/desinscription', 'https://exemple.fr/mail?action=désabonner', 'https://exemple.fr/opt-out',
      'https://unsubscribe.envoi.exemple/u/abc123', 'https://exemple.fr/stop', 'https://exemple.fr/preferences?u=1', 'https://exemple.fr/resilier',
    ]) {
      assert.equal(checkPageUrl(url).ok, false, url)
    }
  })
})

describe('robots.txt', () => {
  const groups = parseRobots([
    '# commentaire',
    'User-agent: *',
    'Disallow: /prive/',
    'Allow: /prive/offres/',
    'Disallow: /*.pdf$',
    '',
    'User-agent: MBCAnnonceBot',
    'User-agent: autrebot',
    'Disallow: /recherche',
  ].join('\n'))

  it('applique le groupe de notre nom, sinon celui de « * »', () => {
    assert.equal(robotsAllows(groups, 'MBCAnnonceBot', '/recherche?q=java'), false)
    assert.equal(robotsAllows(groups, 'MBCAnnonceBot', '/prive/x'), true)
    assert.equal(robotsAllows(groups, 'InconnuBot', '/prive/x'), false)
    assert.equal(robotsAllows(groups, 'InconnuBot', '/recherche'), true)
  })

  it('fait gagner la règle la plus longue, Allow à égalité, et comprend * et $', () => {
    assert.equal(robotsAllows(groups, 'InconnuBot', '/prive/offres/42'), true)
    assert.equal(robotsAllows(groups, 'InconnuBot', '/docs/annonce.pdf'), false)
    assert.equal(robotsAllows(groups, 'InconnuBot', '/docs/annonce.pdf?v=2'), true)
    assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a'), 'x', '/a'), true)
  })

  it('permet tout sans règle, et « Disallow: » vide n’interdit rien', () => {
    assert.equal(robotsAllows([], 'MBCAnnonceBot', '/offre'), true)
    assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:'), 'MBCAnnonceBot', '/offre'), true)
    assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), 'MBCAnnonceBot', '/offre'), false)
  })

  it('reste rapide sur un motif à étoiles répétées', () => {
    const started = Date.now()
    const hostile = parseRobots(`User-agent: *\nDisallow: /${'*a'.repeat(200)}b`)
    assert.equal(robotsAllows(hostile, 'x', `/${'a'.repeat(1000)}`), true)
    assert.ok(Date.now() - started < 200)
  })
})

describe('offre de la page qui est celle de l’e-mail', () => {
  it('retient la page qui parle du même poste, et refuse un autre poste', () => {
    const page = [offer({ title: 'Data engineer' }), offer({ title: 'Développeur Java (F/H) – Paris' })]
    assert.equal(pickPageOffer(offer(), page)?.title, 'Développeur Java (F/H) – Paris')
    assert.equal(pickPageOffer(offer(), [offer({ title: 'Chef de projet SAP' })]), null)
    assert.equal(pickPageOffer(offer({ title: 'Ingénieur DevOps' }), [offer({ title: 'DevOps Engineer AWS' })])?.title, 'DevOps Engineer AWS')
  })

  it('ne confond pas deux postes qui ne partagent que le métier', () => {
    assert.equal(pickPageOffer(offer({ title: 'Chef de projet SAP' }), [offer({ title: 'Chef de projet Salesforce' })]), null)
    assert.equal(pickPageOffer(offer({ title: 'Consultant SAP FI' }), [offer({ title: 'Consultant' })]), null)
    assert.equal(pickPageOffer(offer({ title: 'Développeur Java Paris' }), [offer({ title: 'Développeur Java – Lyon' })]), null)
    assert.equal(pickPageOffer(offer({ title: 'Chef de projet SAP' }), [offer({ title: 'Chef de projet SAP S/4HANA – Finance' })])?.title, 'Chef de projet SAP S/4HANA – Finance')
  })

  it('accepte une page à une seule offre quand l’intitulé de l’e-mail ne dit rien du poste', () => {
    assert.equal(pickPageOffer(offer({ title: 'Nouvelle opportunité' }), [offer({ title: 'Architecte cloud' })])?.title, 'Architecte cloud')
    assert.equal(pickPageOffer(offer({ title: 'Nouvelle opportunité' }), [offer({ title: 'A' }), offer({ title: 'B' })]), null)
  })
})

describe('complément par l’annonce', () => {
  const page = offer({
    location: 'Lyon', skills: ['Java', 'Spring'], technologies: ['Kafka'], experience: '3 ans', duration: '6 mois', startDate: 'ASAP',
    deadline: '30/11/2026', deadlineFromText: true, salary: 550, engagement: 'assistance', endClient: 'Banque fictive',
    description: 'Contexte : '.padEnd(800, 'détail '), clientAliases: ['BF'], contractType: 'mission', remote: 'remote',
  })

  it('remplit seulement les champs vides et dit lesquels', () => {
    const { offer: filled, fields } = fillFromPage(offer(), page)
    assert.equal(filled.location, 'Lyon')
    assert.deepEqual(filled.skills, ['Java', 'Spring'])
    assert.equal(filled.salary, 550)
    assert.equal(filled.deadline, '30/11/2026')
    assert.equal(filled.deadlineFromText, true)
    assert.deepEqual(fields.sort(), ['deadline', 'description', 'duration', 'endClient', 'engagement', 'experience', 'location', 'salary', 'skills', 'startDate', 'technologies'])
  })

  it('ne remplace jamais ce que dit l’e-mail', () => {
    const email = offer({ location: 'Paris', skills: ['COBOL'], experience: 'Senior', salary: 400, deadline: '15/11/2026', engagement: 'forfait' })
    const { offer: filled, fields } = fillFromPage(email, page)
    assert.equal(filled.location, 'Paris')
    assert.deepEqual(filled.skills, ['COBOL'])
    assert.equal(filled.experience, 'Senior')
    assert.equal(filled.salary, 400)
    assert.equal(filled.deadline, '15/11/2026')
    assert.equal(filled.engagement, 'forfait')
    assert.ok(!fields.includes('location') && !fields.includes('salary'))
  })

  it('garde la description courte de l’e-mail en tête de celle de l’annonce, sans dépasser la taille de l’attribut', () => {
    const { offer: filled } = fillFromPage(offer(), page)
    assert.ok(filled.description.startsWith('Mission Java, voir l’annonce.\n\nContexte'))
    assert.equal(fillFromPage(offer({ description: 'x'.repeat(499) }), { ...page, description: 'y'.repeat(20_000) }).offer.description.length, 20_000)
  })

  it('ne reprend ni contrat, ni télétravail, ni intitulé, ni client ; un montant seulement pour le même contrat', () => {
    const { offer: filled, fields } = fillFromPage(offer(), { ...page, contractType: 'cdi', salary: 60000, title: 'Autre', companyName: 'Site d’emploi' })
    assert.equal(filled.contractType, 'mission')
    assert.equal(filled.remote, 'onsite')
    assert.equal(filled.title, 'Développeur Java H/F')
    assert.equal(filled.companyName, 'Exemple SA')
    assert.equal(filled.salary, null)
    assert.ok(!fields.includes('salary'))
  })

  it('ajoute les autres noms du client lus sur la page (masqués à la publication)', () => {
    assert.deepEqual(fillFromPage(offer({ clientAliases: ['EX'] }), page).offer.clientAliases, ['EX', 'BF'])
  })
})

describe('trace de la lecture', () => {
  const at = new Date('2026-11-12T10:00:00Z')

  it('se relit telle qu’enregistrée et refuse un JSON abîmé', () => {
    const fill = pageFillOf({ at, url: 'https://www.emplois.exemple.fr/offre/42', status: 'filled', fields: ['location', 'skills'] })
    assert.equal(fill.host, 'emplois.exemple.fr')
    assert.deepEqual(parsePageFill(JSON.stringify(fill)), fill)
    assert.equal(parsePageFill('{'), null)
    assert.equal(parsePageFill(JSON.stringify({ ...fill, fields: ['mot de passe'] })), null)
    assert.ok(JSON.stringify(pageFillOf({ at, url: 'https://exemple.fr', status: 'not_read', reason: 'x'.repeat(5000) })).length <= 1000)
  })

  it('tient dans l’attribut sans jamais couper le JSON, même avec un long site et une raison pleine de guillemets', () => {
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.fr`
    const fill = { ...pageFillOf({ at, url: `https://${host}/`, status: 'filled', fields: ['description', 'location', 'skills', 'technologies', 'experience', 'duration', 'startDate', 'deadline', 'salary', 'engagement', 'endClient'] }), reason: '"\t'.repeat(150) }
    const json = pageFillJson(fill)
    assert.ok(json.length <= 1000, String(json.length))
    const back = parsePageFill(json)
    assert.equal(back?.status, 'filled')
    assert.equal(back?.fields.length, 11)
    assert.equal(pageFillJson(pageFillOf({ at, url: 'https://exemple.fr/o', status: 'unchanged' })), JSON.stringify(pageFillOf({ at, url: 'https://exemple.fr/o', status: 'unchanged' })))
  })

  it('dit ce qui a été complété ou pourquoi l’annonce n’a pas été lue', () => {
    assert.equal(
      pageFillText(pageFillOf({ at, url: 'https://exemple.fr/o', status: 'filled', fields: ['location', 'skills'] })),
      'Complété depuis l’annonce d’origine (exemple.fr) : lieu, compétences. À vérifier sur l’annonce avant de publier.',
    )
    assert.equal(pageFillText(pageFillOf({ at, url: 'https://exemple.fr/o', status: 'not_read', reason: 'délai dépassé' })), 'Annonce d’origine non lue (exemple.fr) : délai dépassé.')
  })
})
