import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PUBLISHER_INTRO, DEFAULT_SOCIAL_CONFIG, buildContent, jobLiteOf, normalizeCopy, type CopyDraft, type SocialEdits,
} from '@/lib/social-content'
import { namesToHide, rawPublicSocial, toPublicSocial } from './anonymize'
import { parsePublishInput } from './publication-input'
import { linkedInPostOf, publicJobFields, publicJobIdOf, publicVersion, splitSkills, type LinkedInPreviewSettings } from './publication-social'
import type { PublicationDraft } from './dashboard-types'

// Post LinkedIn d'un AO relu avant sa publication (ADR 0058). Données fictives.

const names = namesToHide(['Banque Exemple'])

const edits: SocialEdits = {
  context: 'Banque Exemple structure la gouvernance\nde ses données de référence.',
  pole: 'Data et intelligence artificielle',
  hashtags: ['GouvernanceDesDonnees', 'BanqueExemple'],
}

const draft: PublicationDraft = {
  title: '  Consultant gouvernance des données (H/F) ',
  companyName: 'Grand groupe bancaire',
  location: ' Paris (75) ',
  contractType: 'mission',
  remote: 'hybrid',
  salary: 650,
  skills: [],
  description: [
    'Rejoignez une équipe dédiée à la gouvernance des données.',
    '',
    '### Au programme',
    '- Cartographier les données de référence de Banque Exemple.',
    '- Animer les comités de gouvernance.',
    '',
    '### Profil recherché',
    '- Expérience en gouvernance des données dans la banque.',
  ].join('\n'),
  reviewed: false,
  maskTerms: [],
  anonymized: true,
  social: edits,
}
const skillsText = 'Gouvernance des données, Data management , , Stratégie SI'

const platform: LinkedInPreviewSettings = {
  config: DEFAULT_SOCIAL_CONFIG, baseUrl: 'https://exemple.test', calendlyUrl: 'https://calendly.com/exemple',
  jobId: publicJobIdOf('offre1'), tenantName: '', publisherAbout: '', fromPlatform: true,
}
const organisation: LinkedInPreviewSettings = {
  ...platform, tenantName: 'Cabinet Exemple', fromPlatform: false,
  publisherAbout: 'Cabinet Exemple accompagne les directions financières dans leurs projets de données.',
}

/** Textes que l'IA rédigera à la diffusion : autres que ceux du repli de l'aperçu, pour prouver qu'ils n'entrent pas dans le post. */
const generated: CopyDraft = {
  hook: 'Accroche de l’IA', tagline: 'Phrase de l’affiche', pitch: 'Présentation par l’IA.',
  missionBullets: ['Puce de mission de l’IA'], profileBullets: ['Puce de profil de l’IA'],
  context: 'Projet rédigé par l’IA à la diffusion', pole: 'Stratégie', hashtags: ['HashtagDeLIA'],
}

/** Version acceptée par le serveur ; le test échoue avec son message sinon. */
function accepted(input: unknown) {
  const parsed = parsePublishInput(input)
  if (parsed.error !== undefined) throw new Error(parsed.error)
  return parsed
}

/**
 * Ce que la publication puis la diffusion feront, sans passer par l'aperçu : validation et version publiée
 * (publishAoOfferOf), offre créée (createJob), lecture par jobToLite, textes de l'IA remplacés par ceux relus
 * (prepareSocialPost), post construit.
 */
function diffusedPost(d: PublicationDraft, settings: LinkedInPreviewSettings, hiddenNames: string[][]): string {
  const parsed = accepted({ ...d, skills: splitSkills(skillsText), reviewed: true })
  const version = publicVersion(parsed.fields, { anonymized: parsed.anonymized, names: hiddenNames, maskTerms: parsed.maskTerms }, parsed.social)
  const created = publicJobFields(version.job)
  const lite = jobLiteOf({ ...created, id: publicJobIdOf('offre1') }, settings.tenantName || created.companyName || '', settings.fromPlatform, settings.publisherAbout)
  const copy = normalizeCopy({ ...generated, ...version.social }, lite)
  return buildContent(lite, copy, settings.config, { baseUrl: settings.baseUrl, calendlyUrl: settings.calendlyUrl }).captions.linkedin
}

const postOf = (d: PublicationDraft, settings: LinkedInPreviewSettings, hiddenNames = names) => {
  const post = linkedInPostOf(d, skillsText, settings, hiddenNames)
  if (post === null) throw new Error('aucun post pour une version valide')
  return post
}

describe('post LinkedIn relu avant la publication d’un AO : celui qui partira', () => {
  it('offre de la plateforme, anonymisée : identique au post de la diffusion, client masqué partout', () => {
    const post = postOf(draft, platform)
    assert.equal(post, diffusedPost(draft, platform, names))
    assert.ok(!post.includes('Banque Exemple') && !/#BanqueExemple/i.test(post), post)
    // « Le projet » saisi sur deux lignes part sur une seule, comme le montre l'aperçu.
    assert.ok(post.includes('🧭 Le projet : Grand groupe bancaire structure la gouvernance de ses données de référence.'), post)
    // Textes de l'IA hors du post LinkedIn : aucun ne l'atteint.
    assert.ok(!post.includes('Projet rédigé par l’IA') && !post.includes('HashtagDeLIA'), post)
  })

  it('offre de la plateforme : ni présentation de Wise Associates ni phrase de recrutement, le pôle est ignoré (ADR 0060)', () => {
    const post = postOf(draft, platform)
    assert.ok(!post.includes(DEFAULT_PUBLISHER_INTRO) && !/wise/i.test(post.replace('https://exemple.test', '')), post)
    assert.ok(post.includes('https://exemple.test/jobs/aooffre1?utm_source=linkedin'), post)
    const withoutProject = postOf({ ...draft, social: { ...edits, pole: '', context: '' } }, platform)
    // Sans projet, l'accroche de la description en tient lieu.
    assert.ok(withoutProject.includes('🧭 Rejoignez une équipe dédiée à la gouvernance des données.'), withoutProject)
  })

  it('AO d’une organisation : même logique que la plateforme, au nom de l’entreprise affichée, sans ligne de diffusion (ADR 0060)', () => {
    const opening = 'Un grand groupe bancaire recrute un profil pour structurer la gouvernance de ses données.'
    const withContext = { ...draft, description: draft.description.replace('\n\n### Au programme', `\n\n### Le contexte\n${opening} Le projet couvre ses filiales.\n\n### Au programme`) }
    const post = postOf(withContext, organisation)
    assert.equal(post, diffusedPost(withContext, organisation, names))
    assert.ok(post.startsWith('🚀 '), post)
    assert.ok(post.split('\n')[0].endsWith('— Grand groupe bancaire'), post)
    assert.ok(post.includes([
      opening, '',
      '🧭 Le projet :',
    ].join('\n')), post)
    // Ni l'organisation qui publie, ni sa présentation, ni sa phrase de recrutement, ni la ligne de diffusion.
    assert.ok(!post.includes('Cabinet Exemple') && !post.includes('Dans le cadre de son développement'), post)
    assert.ok(!/wise|Offre diffusée/i.test(post.replace('https://exemple.test', '')), post)
  })

  it('version non anonymisée : client gardé, coordonnées personnelles retirées, identique à la diffusion', () => {
    const raw = { ...draft, anonymized: false, social: { ...edits, context: 'Banque Exemple recrute. Contact : marie.dupont@exemple.test' } }
    const post = postOf(raw, platform, [])
    assert.equal(post, diffusedPost(raw, platform, []))
    assert.ok(post.includes('Banque Exemple recrute.'), post)
    assert.ok(!post.includes('marie.dupont@exemple.test'), post)
  })

  it('version que le serveur refuserait (description trop courte) : pas de post', () => {
    assert.equal(linkedInPostOf({ ...draft, description: 'Trop court' }, skillsText, platform, names), null)
  })
})

describe('textes du post envoyés avec la version à publier', () => {
  const base = { ...draft, skills: ['Data'], reviewed: true }

  it('seuls « Le projet », le pôle et les hashtags sont gardés, à part de l’offre publique', () => {
    const parsed = accepted({ ...base, social: { ...edits, tagline: 'ignorée', missionBullets: ['ignorée'] } })
    assert.deepEqual(parsed.social, edits)
    assert.equal('social' in parsed.fields, false)
  })

  it('absents : la diffusion les rédigera, comme avant', () => {
    assert.equal(accepted({ ...base, social: undefined }).social, undefined)
  })

  it('« Le projet » trop long : refusé avec un message clair', () => {
    const parsed = parsePublishInput({ ...base, social: { ...edits, context: 'x'.repeat(321) } })
    assert.match(parsed.error ?? '', /Post LinkedIn invalide/)
  })

  it('nettoyage : client masqué (version anonymisée), coordonnées retirées (non anonymisée), pôle inchangé', () => {
    const masked = toPublicSocial(edits, names, 'Grand groupe bancaire')
    assert.ok(!masked.context.includes('Banque Exemple') && masked.context.includes('Grand groupe bancaire'), masked.context)
    assert.equal(masked.pole, edits.pole)
    assert.equal(rawPublicSocial({ ...edits, context: 'Écrire à jean.martin@exemple.test' }).context.includes('jean.martin@exemple.test'), false)
  })
})
