import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ExtractedOffer } from '../types'
import { completeOffers, PAGE_READ_MIN_MS, type CompletionContext, type CompletionDeps, type PageRead } from './completion'
import { withPageClientNames } from './rules'

// Données fictives.
const offer = (over: Partial<ExtractedOffer> = {}): ExtractedOffer => ({
  title: 'Développeur Java', companyName: 'Exemple SA', location: '', contractType: 'mission', remote: 'onsite', salary: null,
  skills: [], technologies: [], description: 'Voir l’annonce.', duration: '', startDate: '', experience: '',
  deadline: '', endClient: '', engagement: '', contact: null, sourceUrl: 'https://emplois.exemple.fr/offre/1', ...over,
})
const complete = { location: 'Paris', skills: ['Java'], experience: '5 ans', description: 'x'.repeat(600) }
const pageOffer = offer({ title: 'Développeur Java (F/H)', location: 'Lyon', skills: ['Java', 'Spring'], experience: '3 ans' })

/** Contexte et dépendances simulés : lectures et places de quota comptées. */
function setup(over: { read?: PageRead; quota?: string | null; timeLeft?: number; known?: boolean | Error } = {}) {
  const calls = { reads: [] as string[], quotas: 0 }
  const ctx: CompletionContext = {
    now: new Date('2026-11-12T10:00:00Z'),
    timeLeft: () => over.timeLeft ?? 200_000,
    isKnown: async () => {
      if (over.known instanceof Error) throw over.known
      return over.known ?? false
    },
  }
  const deps: CompletionDeps = {
    takeQuota: async () => { calls.quotas++; return over.quota ?? null },
    readPage: async (url): Promise<PageRead> => { calls.reads.push(url); return over.read ?? { ok: true, offers: [pageOffer], finalUrl: url } },
  }
  return { ctx, deps, calls }
}

describe('complément des offres d’un e-mail par leur annonce', () => {
  it('complète une offre incomplète et garde l’offre de l’e-mail pour l’empreinte', async () => {
    const { ctx, deps, calls } = setup()
    const [result] = await completeOffers([offer()], ctx, deps)
    assert.equal(result.offer.location, 'Lyon')
    assert.equal(result.basis.location, '')
    assert.equal(result.pageFill?.status, 'filled')
    assert.equal(result.pageFill?.host, 'emplois.exemple.fr')
    assert.deepEqual(calls, { reads: ['https://emplois.exemple.fr/offre/1'], quotas: 1 })
  })

  it('nomme le site d’où viennent vraiment les champs quand le lien redirige ailleurs', async () => {
    const { ctx, deps } = setup({ read: { ok: true, offers: [pageOffer], finalUrl: 'https://www.autre-site.exemple/offre' } })
    const [result] = await completeOffers([offer({ sourceUrl: 'https://raccourci.exemple/a1' })], ctx, deps)
    assert.equal(result.pageFill?.host, 'raccourci.exemple → autre-site.exemple')
  })

  it('ne lit rien pour une offre complète, sans lien, ou déjà enregistrée', async () => {
    const { ctx, deps, calls } = setup({ known: true })
    const results = await completeOffers([offer(complete), offer({ sourceUrl: '' }), offer()], ctx, deps)
    assert.ok(results.every(r => r.pageFill === null && r.offer === r.basis))
    assert.deepEqual(calls, { reads: [], quotas: 0 })
  })

  it('lit une seule fois un lien partagé par deux offres', async () => {
    const { ctx, deps, calls } = setup()
    const results = await completeOffers([offer(), offer({ title: 'Développeur Java senior' })], ctx, deps)
    assert.equal(calls.reads.length, 1)
    assert.equal(calls.quotas, 1)
    assert.ok(results.every(r => r.pageFill?.status === 'filled'))
  })

  it('lit 3 annonces au plus par e-mail, et dit pourquoi pas les suivantes', async () => {
    const { ctx, deps, calls } = setup()
    const offers = [1, 2, 3, 4].map(i => offer({ sourceUrl: `https://emplois.exemple.fr/offre/${i}` }))
    const results = await completeOffers(offers, ctx, deps)
    assert.equal(calls.reads.length, 3)
    assert.equal(results[3].pageFill?.status, 'not_read')
    assert.match(results[3].pageFill?.reason ?? '', /3 annonces au plus/)
  })

  it('ne commence pas une lecture sans le temps de la finir, ni sans place sur les quotas', async () => {
    const late = setup({ timeLeft: PAGE_READ_MIN_MS - 1 })
    assert.equal((await completeOffers([offer()], late.ctx, late.deps))[0].pageFill?.reason, 'temps du passage écoulé')
    assert.equal(late.calls.quotas, 0)
    const full = setup({ quota: 'quota du jour atteint (30 annonces lues par organisation)' })
    const [refused] = await completeOffers([offer()], full.ctx, full.deps)
    assert.equal(refused.pageFill?.reason, 'quota du jour atteint (30 annonces lues par organisation)')
    assert.equal(full.calls.reads.length, 0)
  })

  it('refuse un site exclu avant toute place de quota ou lecture', async () => {
    const { ctx, deps, calls } = setup()
    const [result] = await completeOffers([offer({ sourceUrl: 'https://fr.linkedin.com/jobs/view/1' })], ctx, deps)
    assert.match(result.pageFill?.reason ?? '', /^site exclu/)
    assert.deepEqual(calls, { reads: [], quotas: 0 })
  })

  it('garde l’offre de l’e-mail quand la lecture échoue, la page parle d’un autre poste, ou les doublons sont illisibles', async () => {
    const failed = setup({ read: { ok: false, reason: 'délai dépassé' } })
    const [notRead] = await completeOffers([offer()], failed.ctx, failed.deps)
    assert.equal(notRead.offer, notRead.basis)
    assert.equal(notRead.pageFill?.reason, 'délai dépassé')
    const other = setup({ read: { ok: true, offers: [offer({ title: 'Chef de projet SAP', location: 'Nantes' })], finalUrl: 'https://emplois.exemple.fr/offre/1' } })
    const [unchanged] = await completeOffers([offer()], other.ctx, other.deps)
    assert.equal(unchanged.offer.location, '')
    assert.equal(unchanged.pageFill?.status, 'unchanged')
    const broken = setup({ known: new Error('Appwrite injoignable') })
    const [skipped] = await completeOffers([offer()], broken.ctx, broken.deps)
    assert.equal(skipped.pageFill?.reason, 'vérification des doublons impossible')
    assert.equal(broken.calls.reads.length, 0)
  })
})

describe('noms du client lus sur la page', () => {
  const text = 'Rejoignez la Banque Fictive (BF) pour sa filiale Assurfictive. Annonce publiée par Wise Associates.'

  it('masque le client et le client final de la page s’ils y sont cités (en tête), jamais notre organisation', () => {
    const named = withPageClientNames(offer({ companyName: 'Banque Fictive', endClient: 'Assurfictive', clientAliases: ['BF', 'Inventé SA', 'Wise Associates'] }), text, 'Wise Associates')
    assert.deepEqual(named.clientAliases, ['Banque Fictive', 'Assurfictive', 'BF'])
  })
})
