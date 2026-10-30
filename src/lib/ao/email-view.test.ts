import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emailViewDocument, sanitizeEmailHtml } from './email-view'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('affichage de l\'e-mail d\'origine', () => {
  it('retire scripts, gestionnaires d\'événements, formulaires, cadres, redirections et liens javascript:', () => {
    const { html } = sanitizeEmailHtml([
      '<meta http-equiv="refresh" content="0;url=https://piege.test">',
      '<base href="https://piege.test/">',
      '<script>alert(1)</script>',
      '<p onclick="alert(1)" style="color:red">Bonjour</p>',
      '<a href="javascript:alert(1)">piège</a>',
      '<form action="https://piege.test"><input name="mdp"></form>',
      '<iframe src="https://piege.test"></iframe>',
      '<svg onload="alert(1)"></svg>',
    ].join(''))
    for (const forbidden of ['<script', 'onclick', 'javascript:', '<form', '<input', '<iframe', '<meta', '<base', '<svg', 'onload']) {
      assert.ok(!html.toLowerCase().includes(forbidden), `${forbidden} doit être retiré : ${html}`)
    }
    assert.match(html, /<p style="color:red">Bonjour<\/p>/)
  })

  it('ouvre les liens dans un nouvel onglet sans transmettre la page d\'origine', () => {
    const { html } = sanitizeEmailHtml('<a href="https://exemple.test/avis/42">Avis</a>')
    assert.match(html, /href="https:\/\/exemple\.test\/avis\/42"/)
    assert.match(html, /target="_blank"/)
    assert.match(html, /rel="noopener noreferrer nofollow"/)
  })

  it('garde les images intégrées à l\'e-mail et retire les images distantes (pixels de suivi) et les SVG', () => {
    const { html, removedImages } = sanitizeEmailHtml([
      `<img src="${PNG}" alt="logo">`,
      '<img src="https://suivi.test/pixel.gif" width="1" height="1">',
      '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+">',
      '<img src="//suivi.test/pixel.gif">',
    ].join(''))
    assert.ok(html.includes(PNG), 'l\'image intégrée reste')
    assert.ok(!html.includes('suivi.test'), 'aucune image distante')
    assert.ok(!html.includes('svg'), 'aucune image SVG')
    assert.equal(removedImages, 3)
  })

  it('échappe l\'en-tête et affiche un e-mail en texte seul tel quel, sans l\'interpréter', () => {
    const page = emailViewDocument({
      subject: 'AO <b>Data</b>', from: 'Claire Martin <claire.martin@client-fictif.fr>', to: 'ao@exemple.test', cc: '',
      date: new Date('2026-10-30T09:15:00Z'), html: false, text: 'Bonjour,\n<script>alert(1)</script>', attachments: ['cahier des charges.pdf'],
    })
    assert.ok(page.includes('AO &lt;b&gt;Data&lt;/b&gt;'))
    assert.ok(page.includes('Claire Martin &lt;claire.martin@client-fictif.fr&gt;'))
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(!page.includes('<script>'))
    assert.ok(page.includes('cahier des charges.pdf'))
    assert.ok(page.includes('vendredi 30 octobre 2026'), 'date en heure de Paris')
    assert.ok(!page.includes('<dt>Cc</dt>'), 'ligne vide omise')
  })

  it('enferme le contenu de l\'expéditeur : un élément en position fixe ne peut pas recouvrir l\'en-tête', () => {
    const page = emailViewDocument({
      subject: 'AO', from: 'a@client-fictif.fr', to: '', cc: '', date: null, attachments: [], text: '',
      html: '<div style="position:fixed;top:0;left:0;width:100%;height:100%">De : faux expéditeur</div>',
    })
    assert.match(page, /\.mbc-body\{[^}]*contain:paint/)
    assert.ok(page.indexOf('<header class="mbc-meta">') < page.indexOf('<main class="mbc-body">'))
  })

  it('borne un très long e-mail en texte seul et le signale', () => {
    const page = emailViewDocument({ subject: '', from: '', to: '', cc: '', date: null, attachments: [], html: false, text: 'a'.repeat(900_000) })
    assert.match(page, /Texte trop long/)
    assert.ok(page.length < 850_000)
  })

  it('signale les images masquées', () => {
    const page = emailViewDocument({
      subject: '', from: '', to: '', cc: '', date: null, html: '<p>Offre</p><img src="https://suivi.test/p.gif">', text: 'Offre', attachments: [],
    })
    assert.match(page, /1 image masquée/)
  })
})
