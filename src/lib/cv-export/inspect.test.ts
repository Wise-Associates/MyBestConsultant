import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inspectTemplate, maskContacts } from './inspect'

const EXAMPLE = new Uint8Array(readFileSync(path.join(process.cwd(), 'src/lib/cv-export/templates/example/template.docx')))

describe('inspection d\'un modèle Word', () => {
  const lines = inspectTemplate(EXAMPLE).split('\n')
  const line = (start: string) => lines.find(l => l.trimStart().startsWith(start)) ?? ''

  it('donne les index de corps et les segments utilisés par la cartographie du modèle', () => {
    // Index et segments repris par templates/example/template_map.json (exp_header : dates ⇥ client ; edu_item : 4 segments).
    assert.match(line('18 P'), /paddedline\s+⇥ 2 \| \[Mois AAAA\] – \[Mois AAAA\] \| ⇥ \| \[Client\] \[taquets right@9666\]/)
    assert.match(line('10 P'), /• ⇥ 4 \| \[AAAA\] :  \| \[Diplôme\] \|  · \[Établissement\] \|  — \[Spécialité, mention\]/)
    assert.match(line('1 P'), /CVTitre .* RESUME EXPERIENCE PROFESSIONNELLE/)
  })

  it('donne le chemin des paragraphes d\'un tableau (champs `fixed`)', () => {
    assert.match(line('0 TBL'), /4 lignes, 8 cellules/)
    assert.ok(lines.some(l => /^\s+\[0,0,1,2\] P .* \[INITIALES\]/.test(l)))
    assert.ok(lines.some(l => /^\s+\[0,0,1,6\] P .* \[N\] ans d'expérience/.test(l)))
  })

  it('masque e-mails et téléphones, pas les années ni les codes postaux', () => {
    assert.equal(maskContacts('Tel : 06 07 31 71 54 · contact@exemple.fr'), 'Tel : ‹téléphone masqué› · ‹e-mail masqué›')
    assert.equal(maskContacts('+33 1 23 45 67 89'), '‹téléphone masqué›')
    assert.equal(maskContacts('Diplôme (2012 - 2014), 75008 Paris, page 2 / 3'), 'Diplôme (2012 - 2014), 75008 Paris, page 2 / 3')
    assert.ok(lines.some(l => l.includes('‹téléphone masqué›')), 'contact du modèle d\'exemple masqué')
  })

  it('donne la largeur utile de la page et les en-têtes et pieds de page, en morceaux', () => {
    assert.ok(lines.includes('Largeur utile de la page : 9666 twips (page 11906, marges 1134 et 1106)'))
    assert.ok(lines.some(l => l.startsWith('[pied de page footer1.xml] ') && l.includes(' ¦ ')))
  })
})
