import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AFTER_PUBLICATION_MS, trackingSteps, type AoTrackingFacts, type TrackingContext } from './tracking'

const NOW = Date.parse('2026-10-29T10:00:00.000Z')
const AUTO: TrackingContext = { now: NOW, socialAuto: true }
const PUBLISHED = { status: 'published' as const, jobId: 'aooffre1' }
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()
type Job = NonNullable<AoTrackingFacts['job']>
type Social = NonNullable<AoTrackingFacts['social']>
const ONLINE: Job = { isActive: true, expiresAt: null, createdAt: ago(AFTER_PUBLICATION_MS + 60_000), linkedinPostedAt: null }
const JUST_PUBLISHED: Job = { ...ONLINE, createdAt: ago(60_000) }
const facts = (patch: Partial<AoTrackingFacts> = {}): AoTrackingFacts => ({ job: ONLINE, social: null, scored: true, qualified: 0, ...patch })
/** État de chaque étape, dans l'ordre : validation, offre en ligne, LinkedIn, sourcing. */
const summary = (steps: ReturnType<typeof trackingSteps>) => steps.map(s => `${s.tone}:${s.text}`)
const socialOf = (social: Social | null, patch: Partial<AoTrackingFacts> = {}, ctx = AUTO) => trackingSteps(PUBLISHED, facts({ social, ...patch }), ctx)[2]
const linkedin = (status: 'published' | 'scheduled' | 'failed' | 'skipped', url?: string) => ({ network: 'linkedin' as const, status, ...(url && { url }) })
const facebook = { network: 'facebook' as const, status: 'published' as const }

describe('suivi d’une offre AO : validation et offre en ligne', () => {
  it('offre à valider : seule la validation est attendue, le reste vient après la publication', () => {
    const steps = trackingSteps({ status: 'to_review', jobId: null })
    assert.deepEqual(steps.map(s => s.key), ['review', 'job', 'social', 'sourcing'])
    assert.deepEqual(summary(steps), ['todo:À valider', 'todo:Après la publication', 'todo:Après la publication', 'todo:Après la publication'])
  })

  it('offre ignorée', () => {
    assert.equal(trackingSteps({ status: 'ignored', jobId: null })[0].text, 'Ignorée')
  })

  it('offre publiée, en ligne, publiée sur LinkedIn, 3 candidats retenus : tout est fait, avec les liens', () => {
    const social: Social = { status: 'published', stale: false, stopped: false, results: [linkedin('published', 'https://www.linkedin.com/feed/update/exemple')] }
    const steps = trackingSteps(PUBLISHED, facts({ social, qualified: 3 }), AUTO)
    assert.deepEqual(summary(steps), ['done:Publiée', 'done:En ligne', 'done:Publiée', 'done:3 candidats de la base retenus'])
    assert.equal(steps[1].url, '/jobs/aooffre1')
    assert.equal(steps[2].url, 'https://www.linkedin.com/feed/update/exemple')
    assert.equal(steps[3].count, 3)
  })

  it('offre publique désactivée ou expirée : signalée, avec son lien', () => {
    const job = (patch: Partial<Job>) => trackingSteps(PUBLISHED, facts({ job: { ...ONLINE, ...patch } }), AUTO)[1]
    assert.deepEqual([job({ isActive: false }).tone, job({ isActive: false }).text], ['warning', 'Désactivée'])
    assert.deepEqual([job({ expiresAt: ago(1) }).tone, job({ expiresAt: ago(1) }).text], ['warning', 'Expirée'])
    assert.equal(job({ expiresAt: ago(-DAY) }).text, 'En ligne')
    assert.equal(job({ isActive: false }).url, '/jobs/aooffre1')
  })

  it('offre publique absente : « introuvable » (supprimée ou publication interrompue), sans lien', () => {
    const step = trackingSteps(PUBLISHED, facts({ job: null }), AUTO)[1]
    assert.deepEqual([step.tone, step.text, step.url], ['warning', 'Introuvable', undefined])
  })

  it('suivi non chargé pour une offre publiée : indisponible, jamais « fait »', () => {
    assert.deepEqual(summary(trackingSteps(PUBLISHED)), ['done:Publiée', 'todo:Suivi indisponible', 'todo:Suivi indisponible', 'todo:Suivi indisponible'])
  })

  it('offre marquée publiée sans offre publique : signalée', () => {
    assert.deepEqual(summary(trackingSteps({ status: 'published', jobId: null }, facts(), AUTO)).slice(1, 2), ['warning:Offre publique introuvable'])
  })
})

describe('suivi d’une offre AO : LinkedIn', () => {
  it('résultat propre à LinkedIn : publiée, programmée, échec, non visée', () => {
    const of = (status: Parameters<typeof linkedin>[0]) => socialOf({ status: 'partial', stale: false, stopped: false, results: [linkedin(status), facebook] })
    assert.deepEqual([of('published').tone, of('published').text], ['done', 'Publiée'])
    assert.deepEqual([of('scheduled').tone, of('scheduled').text], ['done', 'Programmée'])
    assert.deepEqual([of('failed').tone, of('failed').text], ['error', 'Échec'])
    assert.deepEqual([of('skipped').tone, of('skipped').text], ['todo', 'Non visée par la diffusion'])
  })

  it('lien de publication autre que https : publiée, sans lien', () => {
    const step = socialOf({ status: 'published', stale: false, stopped: false, results: [linkedin('published', 'javascript:alert(1)')] })
    assert.deepEqual([step.tone, step.text, step.url], ['done', 'Publiée', undefined])
  })

  it('diffusion en cours : création du visuel, puis envoyée en attente de confirmation', () => {
    assert.deepEqual([socialOf({ status: 'queued', stale: false, stopped: false, results: [] }).tone, socialOf({ status: 'queued', stale: false, stopped: false, results: [] }).text], ['working', 'Création du visuel'])
    const sent = socialOf({ status: 'sent', stale: false, stopped: false, results: [] })
    assert.deepEqual([sent.tone, sent.text], ['working', 'Envoyée, en attente de confirmation'])
  })

  it('autres réseaux publiés mais pas de résultat LinkedIn : jamais « publiée »', () => {
    const waiting = socialOf({ status: 'images_ready', stale: false, stopped: false, results: [facebook] })
    assert.deepEqual([waiting.tone, waiting.text], ['working', 'Envoyée, en attente de confirmation'])
    const done = socialOf({ status: 'published', stale: false, stopped: false, results: [facebook] })
    assert.deepEqual([done.tone, done.text], ['warning', 'Aucun résultat LinkedIn'])
  })

  it('diffusion sans confirmation ou en échec', () => {
    const stale = socialOf({ status: 'sent', stale: true, stopped: false, results: [] })
    assert.deepEqual([stale.tone, stale.text], ['warning', 'Sans confirmation'])
    const failed = socialOf({ status: 'failed', stale: false, stopped: false, results: [] })
    assert.deepEqual([failed.tone, failed.text], ['error', 'Échec'])
  })

  it('envoi direct de l’ancien circuit : à vérifier (aucune confirmation), et seulement sans diffusion par Make', () => {
    const job = { ...ONLINE, linkedinPostedAt: ago(DAY) }
    const direct = socialOf(null, { job })
    assert.deepEqual([direct.tone, direct.text], ['warning', 'Envoyée directement, sans confirmation'])
    assert.equal(socialOf({ status: 'sent', stale: false, stopped: false, results: [] }, { job }).tone, 'working')
    assert.equal(socialOf({ status: 'sent', stale: true, stopped: false, results: [] }, { job }).text, 'Sans confirmation')
  })

  it('aucune diffusion : en préparation juste après la publication, puis « non diffusée » à vérifier', () => {
    const early = socialOf(null, { job: JUST_PUBLISHED })
    assert.deepEqual([early.tone, early.text], ['working', 'Diffusion en préparation'])
    const late = socialOf(null)
    assert.deepEqual([late.tone, late.text], ['warning', 'Non diffusée'])
  })

  it('diffusion arrêtée depuis le panneau : « arrêtée », jamais « échec »', () => {
    const step = socialOf({ status: 'failed', stale: false, stopped: true, results: [] })
    assert.deepEqual([step.tone, step.text], ['todo', 'Arrêtée avant l’envoi'])
  })

  it('diffusion automatique inactive : non suivie, même juste après la publication', () => {
    const step = socialOf(null, { job: JUST_PUBLISHED }, { now: NOW, socialAuto: false })
    assert.deepEqual([step.tone, step.text], ['todo', 'Non suivie (diffusion automatique inactive)'])
  })
})

describe('suivi d’une offre AO : sourcing', () => {
  const sourcing = (patch: Partial<AoTrackingFacts>) => trackingSteps(PUBLISHED, facts(patch), AUTO)[3]

  it('un seul candidat retenu : au singulier', () => {
    assert.equal(sourcing({ qualified: 1 }).text, '1 candidat de la base retenu')
  })

  it('plus de 5 candidats notés 65 ou plus : les 5 meilleurs sont retenus, comme pour l’e-mail automatique', () => {
    const step = sourcing({ qualified: 12 })
    assert.deepEqual([step.tone, step.text, step.count], ['done', '5 candidats de la base retenus (12 notés 65 ou plus)', 5])
  })

  it('juste après la publication, sans score : recherche en cours', () => {
    const step = sourcing({ job: JUST_PUBLISHED, scored: false })
    assert.deepEqual([step.tone, step.text], ['working', 'Recherche en cours'])
  })

  it('aucun score enregistré après le délai : la recherche n’a pas abouti, ce n’est pas « aucun candidat »', () => {
    const step = sourcing({ scored: false })
    assert.deepEqual([step.tone, step.text], ['warning', 'Aucun résultat enregistré'])
  })

  it('des scores, aucun à 65 ou plus : aucun candidat de la base retenu', () => {
    const step = sourcing({ scored: true, qualified: 0 })
    assert.deepEqual([step.tone, step.text], ['warning', 'Aucun candidat de la base noté 65 ou plus'])
  })
})
