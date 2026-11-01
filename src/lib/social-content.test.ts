import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SOCIAL_CONFIG, buildContent, normalizeCopy, type CopyDraft, type JobLite } from './social-content'

// Offre fictive, au format de « Préparer la publication » (accroche, puis sections « ### » et puces « - »).
const job: JobLite = {
  id: 'ao123', title: 'Accompagnement du projet Gouvernance des données', company: 'Entreprise exemple', location: 'Paris (75)',
  contractType: 'mission', remote: 'onsite', skills: ['Gouvernance des données', 'Stratégie SI'],
  description: [
    'Une direction des systèmes d’information structure sa gouvernance des données.',
    '',
    '### Au programme',
    '- Définir un cadre de gouvernance des données',
    '- Élaborer la feuille de route du SI',
    '- Accompagner la transformation numérique des équipes',
    '- Animer les comités de pilotage',
    '',
    '### Profil recherché',
    '- Maîtrise de **Collibra**',
    '- Capacité à travailler en équipe pluridisciplinaire',
    '',
    '### Modalités',
    '- Durée : 12 mois',
  ].join('\n'),
}
const copy: CopyDraft = {
  hook: 'Gouvernance des données', tagline: 'Rejoignez un projet stratégique', pitch: '',
  missionBullets: ['Définir un cadre de gouvernance des données'], profileBullets: ['Capacité à travailler en équipe pluridisciplinaire'],
}
const opts = { baseUrl: 'https://exemple.test', calendlyUrl: 'https://calendly.com/exemple' }
const applyLine = '👉 Voir l’offre et postuler : https://exemple.test/jobs/ao123?utm_source=linkedin'

describe('texte LinkedIn d’une offre', () => {
  it('publie toute la description de l’offre, titres et puces mis en forme pour LinkedIn', () => {
    const { linkedin } = buildContent(job, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.includes([
      '🎯 Au programme',
      '• Définir un cadre de gouvernance des données',
      '• Élaborer la feuille de route du SI',
      '• Accompagner la transformation numérique des équipes',
      '• Animer les comités de pilotage',
      '',
      '🧩 Profil recherché',
      '• Maîtrise de Collibra',
      '• Capacité à travailler en équipe pluridisciplinaire',
      '',
      '📋 Modalités',
      '• Durée : 12 mois',
    ].join('\n')), linkedin)
    assert.ok(linkedin.startsWith('🚀 Accompagnement du projet Gouvernance des données — Entreprise exemple\n\n📍 Paris (75) · Mission · Présentiel\n\nUne direction'), linkedin)
    assert.ok(!linkedin.includes('###') && !linkedin.includes('**') && !linkedin.includes('…') && !linkedin.includes('➕'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n📅 Envie d’en discuter ? Réservez un échange : https://calendly.com/exemple\n\n#recrutement #emploi #IT #consulting`), linkedin)
  })

  it('raccourcit une offre trop longue section par section, la plus longue d’abord, et dit où lire la suite', () => {
    const list = (label: string, n: number) => Array.from({ length: n }, (_, i) => `- ${label} numéro ${i + 1} attendue du consultant`).join('\n')
    const description = `Intro de l’offre.\n\n### Au programme\n${list('Tâche', 120)}\n\n### Profil recherché\n${list('Compétence', 60)}\n\n### Modalités\n- Démarrage : janvier 2027\n- Durée : 12 mois`
    const { linkedin } = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.length <= 3000, `${linkedin.length} caractères`)
    assert.ok(linkedin.includes('\n\nIntro de l’offre.\n\n🎯 Au programme\n• Tâche numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n🧩 Profil recherché\n• Compétence numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n📋 Modalités\n• Démarrage : janvier 2027\n• Durée : 12 mois\n\n➕ Suite de l’offre sur le lien ci-dessous\n\n'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n📅 Envie d’en discuter ? Réservez un échange : https://calendly.com/exemple\n\n#recrutement #emploi #IT #consulting`))
    // Premières puces de chaque section, entières et dans l'ordre ; les deux longues sections gardent une place comparable.
    for (const label of ['Tâche', 'Compétence']) {
      const kept = linkedin.split('\n').filter(l => l.startsWith(`• ${label} `))
      assert.deepEqual(kept, kept.map((_, i) => `• ${label} numéro ${i + 1} attendue du consultant`))
      assert.ok(kept.length >= 10, `${label} : ${kept.length} puces`)
    }
    assert.ok(!linkedin.includes('…'), linkedin)
  })

  it('coupe un paragraphe unique trop long au dernier mot entier', () => {
    const description = 'Mission longue et détaillée. '.repeat(200).trim()
    const { linkedin } = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.length <= 3000)
    const [body] = linkedin.split(`…\n\n➕ Suite de l’offre sur le lien ci-dessous\n\n${applyLine}`)
    const kept = body.slice(body.lastIndexOf('\n\n') + 2)
    assert.ok(kept.length > 1000 && description.startsWith(kept), kept)
    assert.equal(description[kept.length], ' ')
  })

  it('sans description, reprend l’accroche et les puces rédigées par l’IA, entières', () => {
    const { linkedin } = buildContent({ ...job, description: '' }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.includes('Rejoignez un projet stratégique'))
    assert.ok(linkedin.includes('🎯 Au programme\n• Définir un cadre de gouvernance des données'))
    assert.ok(linkedin.includes('🧩 Profil recherché : Capacité à travailler en équipe pluridisciplinaire'))
  })
})

describe('textes rédigés par l’IA', () => {
  it('garde les puces entières ; seules les pastilles de l’affiche restent limitées à 40 caractères', () => {
    const mission = 'Piloter la mise en place du cadre de gouvernance des données avec les directions métiers et la DSI du groupe'
    const draft = normalizeCopy({ missionBullets: [mission], profileBullets: ['Capacité à travailler en équipe pluridisciplinaire'] }, job)
    assert.deepEqual(draft.missionBullets, [mission])
    assert.deepEqual(draft.profileBullets, ['Capacité à travailler en équipe pluridisciplinaire'])
    const { image, captions } = buildContent(job, draft, DEFAULT_SOCIAL_CONFIG, opts)
    assert.ok(image.skills.every(s => s.length <= 40), image.skills.join(' | '))
    assert.ok(captions.instagram.includes('Capacité à travailler en équipe pluridisciplinaire'))
    assert.ok(captions.facebook.includes(mission))
  })
})
