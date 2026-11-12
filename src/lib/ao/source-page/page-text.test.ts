import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { publicOnlyLookup, readBounded } from './fetch-page'
import { charsetOf, decodePage, isLoginPage, pageTextOf } from './page-text'

// Pages fictives.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Offre</title>
<style>.x{color:red}</style><script>window.secret = "ignore-moi"</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Exemple"},
{"@type":"JobPosting","title":"Développeur Java","hiringOrganization":{"name":"Exemple SA"},
"jobLocation":{"address":{"addressLocality":"Lyon","addressCountry":"FR"}},"employmentType":"CONTRACTOR",
"baseSalary":{"currency":"EUR","value":{"minValue":500,"maxValue":600,"unitText":"DAY"}},"validThrough":"2026-11-30","experienceRequirements":"5 ans d&#39;exp&eacute;rience",
"description":"<p>Contexte &amp; missions</p><ul><li>API</li></ul>"}]}</script>
<script type="application/ld+json">{ cassé </script></head>
<body><nav>Accueil · Offres</nav><h1>Développeur Java &eacute;quipe</h1><p>Lieu&nbsp;: Lyon<br>TJM &lt; 600 €</p>
<ul><li>Java</li><li>Spring</li></ul><footer>Mentions légales</footer><noscript>Activez JS</noscript></body></html>`

describe('texte d’une page d’annonce', () => {
  const text = pageTextOf(PAGE)

  it('met les données JobPosting en tête, sous des libellés lisibles', () => {
    assert.ok(text.startsWith('Données structurées de l’annonce (JobPosting) :\nIntitulé : Développeur Java\nEmployeur : Exemple SA\nLieu : Lyon, FR'))
    assert.match(text, /Rémunération : 500 à 600 EUR par DAY/)
    assert.match(text, /Date limite de candidature : 2026-11-30/)
    assert.match(text, /Expérience demandée : 5 ans d'expérience/)
    assert.match(text, /Description :\nContexte & missions\nAPI/)
  })

  it('garde le texte visible, entités décodées, sans scripts, styles, menus ni pied de page', () => {
    // Le titre de l'onglet (<title>) est gardé : il porte souvent l'intitulé du poste.
    assert.match(text, /Texte de la page :\nOffre\nDéveloppeur Java équipe\nLieu : Lyon\nTJM < 600 €\nJava\nSpring/)
    for (const absent of ['ignore-moi', 'color:red', 'Accueil', 'Mentions légales', 'Activez JS', '<p>']) assert.ok(!text.includes(absent), absent)
  })

  it('borne la longueur du texte', () => {
    assert.equal(pageTextOf(`<p>${'mot '.repeat(50_000)}</p>`, 1000).length, 1000)
  })

  it('reconnaît une page de connexion, pas une annonce publique avec « Se connecter » dans son en-tête', () => {
    const form = '<form><input type="password" name="p"></form>'
    assert.equal(isLoginPage({ html: form, path: '/offre/42', textLength: 120 }), true)
    assert.equal(isLoginPage({ html: '<p>Annonce</p>', path: '/fr/connexion', textLength: 5000 }), true)
    assert.equal(isLoginPage({ html: `${form}<p>annonce complète</p>`, path: '/offre/42', textLength: 5000 }), false)
    assert.equal(isLoginPage({ html: PAGE, path: '/offre/42', textLength: 400 }), false)
  })

  it('lit l’encodage de l’en-tête, sinon de la page, sinon UTF-8', () => {
    assert.equal(charsetOf('text/html; charset=ISO-8859-1', ''), 'iso-8859-1')
    assert.equal(charsetOf('text/html', '<meta charset="windows-1252">'), 'windows-1252')
    assert.equal(charsetOf('text/html', ''), 'utf-8')
    assert.equal(decodePage(Uint8Array.from([0x44, 0xe9, 0x76]), 'iso-8859-1'), 'Dév')
    assert.equal(decodePage(Buffer.from('Dév'), 'encodage-inconnu'), 'Dév')
  })
})

describe('page hostile : calcul linéaire (le serveur ne doit jamais rester figé)', () => {
  const MB3 = 3_000_000
  const hostile: [string, string][] = [
    ['« <script » sans « > »', '<script '.repeat(MB3 / 8)],
    ['« <input » sans « > »', '<input '.repeat(MB3 / 7)],
    ['balises imbriquées jamais refermées', `${'<b>'.repeat(MB3 / 7)}${'</i>'.repeat(MB3 / 7)}`],
    ['« < » isolés', '< '.repeat(MB3 / 2)],
    ['« <script> » jamais refermés', '<script>'.repeat(MB3 / 8)],
    ['JSON-LD vides en série', '<script type="application/ld+json"></script>'.repeat(MB3 / 45)],
    ['commentaires ouverts', '<!--'.repeat(MB3 / 4)],
    ['entités en série', '&eacute;&#233;&#x00e9;&inconnue;'.repeat(MB3 / 32)],
    ['un seul attribut géant', `<a title="${'x'.repeat(MB3)}">`],
  ]
  for (const [label, html] of hostile) {
    it(`traite 3 Mo de ${label} en moins de 2 s`, () => {
      const started = performance.now()
      const text = pageTextOf(html)
      isLoginPage({ html, path: '/offre', textLength: text.length })
      assert.ok(performance.now() - started < 2000, `${Math.round(performance.now() - started)} ms`)
    })
  }
})

describe('garde-fous réseau', () => {
  const lookupWith = (addresses: { address: string; family: number }[]) => (all: boolean) => new Promise<{ err: Error | null; result: unknown }>(resolve => {
    publicOnlyLookup(async () => addresses)('emplois.exemple.fr', { all }, (err, address) => resolve({ err, result: address }))
  })

  it('se connecte seulement si toutes les adresses du nom sont publiques', async () => {
    const ok = await lookupWith([{ address: '93.184.216.34', family: 4 }])(false)
    assert.equal(ok.err, null)
    assert.equal(ok.result, '93.184.216.34')
    for (const internal of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      const refused = await lookupWith([{ address: '93.184.216.34', family: 4 }, { address: internal, family: internal.includes(':') ? 6 : 4 }])(true)
      assert.ok(refused.err, internal)
      assert.equal((refused.err as NodeJS.ErrnoException).code, 'ENOTPUBLIC')
    }
  })

  it('arrête la lecture au-delà de la taille permise', async () => {
    assert.equal((await readBounded(Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), 20)).length, 20)
    await assert.rejects(readBounded(Readable.from([Buffer.alloc(15), Buffer.alloc(15)]), 20), /trop volumineuse/)
  })
})
