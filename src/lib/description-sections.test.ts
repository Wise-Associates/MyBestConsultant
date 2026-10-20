import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { descriptionForPublication, parseDescription, type DescriptionSection } from './description-sections'

describe('mise en forme de la description', () => {
  const outline = (sections: DescriptionSection[]) => sections.map(s => `${s.kind}:${s.title}`)

  it('reconnaît les titres markdown, en gras ou suivis de « : », et les listes', () => {
    for (const heading of ['### Missions principales', '**Missions principales**', '**Missions principales :**', 'Missions principales :']) {
      const sections = parseDescription(`Intro du client.\n\n${heading}\n- Recueillir les besoins ;\n- Piloter la recette.\n\n### Expertise souhaitée\n- 5 ans en BA`)
      assert.deepEqual(outline(sections), ['context:Contexte', 'tasks:Missions principales', 'profile:Expertise souhaitée'], heading)
      assert.deepEqual(sections[1].blocks, [{ type: 'list', items: ['Recueillir les besoins', 'Piloter la recette.'] }])
    }
  })

  it('lit les « \n » écrits en toutes lettres par l\'IA', () => {
    const sections = parseDescription('Contexte :\nRefonte CRM.\n\nMissions :\n- Animer les ateliers\n\nProfil recherché :\n- Projets Salesforce')
    assert.deepEqual(outline(sections), ['context:Contexte', 'tasks:Missions', 'profile:Profil recherché'])
  })

  it('découpe un bloc unique aux libellés et met les énumérations en liste', () => {
    const sections = parseDescription('Renfort des équipes réseau. Missions principales : appui aux équipes (MCO, incidents), accompagnement de la transition, prise en charge du RUN. Expertise souhaitée : pare-feux Fortinet, Palo Alto; load balancing F5; compétences appréciées : Ansible. Le poste est basé à Niort.')
    assert.deepEqual(outline(sections), ['context:Contexte', 'tasks:Missions principales', 'profile:Expertise souhaitée'])
    assert.deepEqual(sections[1].blocks, [{ type: 'list', items: ['Appui aux équipes (MCO, incidents)', 'Accompagnement de la transition', 'Prise en charge du RUN'] }])
    assert.deepEqual(sections[2].blocks, [
      { type: 'list', items: ['Pare-feux Fortinet, Palo Alto', 'Load balancing F5', 'Compétences appréciées : Ansible'] },
      { type: 'paragraph', text: 'Le poste est basé à Niort.' },
    ])
  })

  it('garde en texte une phrase d\'introduction et les lignes « Durée : … »', () => {
    const sections = parseDescription('**Missions**\nLe développeur Java interviendra sur deux projets connexes :\n- Diagnostics\n\nDurée : 6 mois\nMissions : Le consultant interviendra, en lien avec la DSI, sur la refonte.')
    assert.deepEqual(outline(sections), ['tasks:Missions', 'tasks:Missions'])
    assert.deepEqual(sections[0].blocks.map(b => b.type), ['paragraph', 'list', 'paragraph'])
    assert.deepEqual(sections[1].blocks, [{ type: 'paragraph', text: 'Le consultant interviendra, en lien avec la DSI, sur la refonte.' }])
  })

  it('aère un texte sans titres et met en avant les phrases sur les missions et le profil', () => {
    const long = 'Notre client, acteur de l\'assurance IARD, renforce ses équipes sur son progiciel métier avec un rythme hybride sur site à Nantes.'
    const sections = parseDescription(`${long} ${long} ${long} Il sera chargé de faire évoluer les composants. Ses principales activités comprendront le développement. Il travaillera avec la recette. Le profil idéal possède une expérience significative.`)
    assert.deepEqual(outline(sections), ['context:Contexte', 'tasks:Missions', 'other:', 'profile:Profil recherché'])
    assert.equal(sections[0].blocks.length, 2)
    assert.deepEqual(sections[1].blocks, [{ type: 'paragraph', text: 'Il sera chargé de faire évoluer les composants. Ses principales activités comprendront le développement.' }])
  })

  it('rend une liste vide pour une description vide', () => {
    assert.deepEqual(parseDescription('  '), [])
  })
})

describe('description pré-remplie avant publication', () => {
  const sample = '**Contexte**\nRefonte du **CRM** de la mutuelle.\n\nMissions :\n- Animer les *ateliers* ;\n- Piloter la recette.'

  it('écrit des titres « ### » et des puces « - », sans marques de gras ni d\'italique', () => {
    assert.equal(descriptionForPublication(sample), '### Contexte\nRefonte du CRM de la mutuelle.\n\n### Missions\n- Animer les ateliers\n- Piloter la recette.')
  })

  it('ne reprend pas les titres déduits, qui sembleraient couvrir les paragraphes suivants', () => {
    const prose = 'Notre client renforce son équipe. Le profil recherché maîtrise ITIL. Il anime aussi des formations.'
    assert.deepEqual(parseDescription(prose).map(s => s.title), ['Contexte', 'Profil recherché', ''])
    assert.equal(descriptionForPublication(prose), 'Notre client renforce son équipe.\n\nLe profil recherché maîtrise ITIL.\n\nIl anime aussi des formations.')
  })

  it('laisse en lignes simples la durée, le démarrage et l\'expérience ajoutés en fin de description', () => {
    const extras = 'Durée de la mission : 6 mois renouvelables\n\nDémarrage : 01/09/2026\n\nExpérience requise : 5 ans minimum'
    assert.equal(descriptionForPublication(`${sample}\n\n${extras}`), `${descriptionForPublication(sample)}\n\n${extras}`)
  })

  it('redonne le même texte s\'il est mis en forme une seconde fois', () => {
    for (const text of [sample, 'Intro. Missions principales : suivi budgétaire, suivi des coûts, reporting. Expertise souhaitée : Java; Spring.']) {
      const once = descriptionForPublication(text)
      assert.equal(descriptionForPublication(once), once)
    }
  })
})
