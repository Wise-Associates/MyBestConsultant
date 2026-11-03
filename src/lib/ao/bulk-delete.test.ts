import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BULK_DELETE_MAX, bulkDeleteNotice, deleteEach, expiredToReview, parseBulkDeleteIds, uncertainNote } from './bulk-delete'

describe('suppression de plusieurs offres AO', () => {
  it('accepte une sélection d\'identifiants de documents, sans les doublons', () => {
    assert.deepEqual(parseBulkDeleteIds(['a1', 'b2', 'a1']), { ok: true, ids: ['a1', 'b2'] })
    const full = Array.from({ length: BULK_DELETE_MAX }, (_, i) => `offre${i}`)
    assert.deepEqual(parseBulkDeleteIds(full), { ok: true, ids: full })
  })

  it('refuse une sélection vide, trop grande ou qui contient autre chose que des identifiants', () => {
    const tooMany = Array.from({ length: BULK_DELETE_MAX + 1 }, (_, i) => `offre${i}`)
    for (const bad of [[], tooMany, ['a1', ''], ['a1', 42], ['../x'], ['x'.repeat(37)], 'a1', null, undefined, { 0: 'a1', length: 1 }]) {
      const r = parseBulkDeleteIds(bad)
      assert.equal(r.ok, false, JSON.stringify(bad)?.slice(0, 40))
      assert.ok(!r.ok && r.error.length > 5)
    }
  })

  it('supprime chaque offre et rapporte celles refusées avec leur raison, sans arrêter les autres', async () => {
    const refused = new Map([['b', 'Offre publiée : retirez d\'abord l\'offre publique.'], ['d', 'Offre introuvable : rechargez la page.']])
    const result = await deleteEach(['a', 'b', 'c', 'd', 'e'], async id => (refused.has(id) ? { error: refused.get(id) } : {}))
    assert.deepEqual(result.deleted, ['a', 'c', 'e'])
    assert.deepEqual(result.failed, [{ id: 'b', error: refused.get('b') }, { id: 'd', error: refused.get('d') }])
  })

  it('rapporte une suppression qui lève une exception au lieu de perdre tout le lot', async () => {
    const result = await deleteEach(['a', 'b'], async id => {
      if (id === 'a') throw new Error('Appwrite injoignable')
      return {}
    })
    assert.deepEqual(result, { deleted: ['b'], failed: [{ id: 'a', error: 'Suppression impossible : Appwrite injoignable' }] })
  })

  it('ne mène jamais plus de suppressions à la fois que la limite donnée', async () => {
    let running = 0
    let peak = 0
    const ids = Array.from({ length: 12 }, (_, i) => `o${i}`)
    const result = await deleteEach(ids, async () => {
      peak = Math.max(peak, ++running)
      await new Promise(resolve => setTimeout(resolve, 2))
      running--
      return {}
    }, 3)
    assert.equal(peak, 3)
    assert.deepEqual(result.deleted, ids, 'ordre de la sélection gardé')
  })
})

describe('message de fin de la suppression groupée', () => {
  const base = { failed: [], stopped: '', interrupted: false }

  it('annonce un succès complet, au singulier comme au pluriel', () => {
    assert.deepEqual(bulkDeleteNotice({ ...base, total: 1, deleted: 1 }), { tone: 'ok', text: '1 offre supprimée.' })
    assert.deepEqual(bulkDeleteNotice({ ...base, total: 3, deleted: 3 }), { tone: 'ok', text: '3 offres supprimées.' })
  })

  it('compte les offres refusées, restées cochées, avec trois raisons au plus', () => {
    const failed = ['A', 'B', 'C', 'D'].map(title => ({ title, error: 'Offre publiée' }))
    const notice = bulkDeleteNotice({ ...base, total: 6, deleted: 2, failed })
    assert.equal(notice.tone, 'error')
    assert.equal(notice.text, '2 offres supprimées ; 4 non supprimées, restées cochées — « A » : Offre publiée ; « B » : Offre publiée ; « C » : Offre publiée ; …')
    assert.equal(bulkDeleteNotice({ ...base, total: 2, deleted: 1, failed: [{ title: 'A', error: 'Offre introuvable' }] }).text,
      '1 offre supprimée ; 1 non supprimée, restée cochée — « A » : Offre introuvable')
  })

  it('donne la raison d\'un arrêt du serveur : les lots suivants ne sont pas comptés comme supprimés', () => {
    assert.equal(bulkDeleteNotice({ ...base, total: 120, deleted: 50, stopped: 'Session expirée : reconnectez-vous.' }).text,
      '50 offres supprimées ; 70 non supprimées, restées cochées — arrêt : Session expirée : reconnectez-vous.')
  })

  it('n\'affirme rien sur les offres d\'un lot resté sans réponse : la liste rechargée fait foi', () => {
    const notice = bulkDeleteNotice({ ...base, total: 120, deleted: 50, interrupted: true })
    assert.equal(notice.tone, 'error')
    assert.match(notice.text, /^50 offres supprimées, puis suppression interrompue/)
    assert.doesNotMatch(notice.text, /non supprimée/)
  })
})

describe('offres à valider échues (bouton « Offres échues »)', () => {
  const now = new Date('2026-11-03T08:00:00Z')
  // Par défaut, chaque offre vient de son propre e-mail, qui n'en apporte qu'une.
  const row = (id: string, over: Partial<Parameters<typeof expiredToReview>[0][number]> = {}) => ({
    $id: id, title: `Offre ${id}`, status: 'to_review' as const, jobId: null, deadline: '30/10/2026', receivedAt: '2026-10-20T09:00:00.000Z',
    emailId: `e-${id}`, sourceCount: 1, ...over,
  })
  const alone = () => 1
  const ids = (rows: ReturnType<typeof row>[]) => expiredToReview(rows, now, alone).offers.map(o => o.id)

  it('propose les offres à valider dont la date limite est passée, avec leur titre et leur date, dans l\'ordre de la liste', () => {
    assert.deepEqual(expiredToReview([row('a'), row('b', { deadline: 'lundi 2 novembre 2026' })], now, alone), {
      offers: [{ id: 'a', title: 'Offre a', deadline: '30/10/2026' }, { id: 'b', title: 'Offre b', deadline: 'lundi 2 novembre 2026' }],
      uncertain: 0,
    })
  })

  it('écarte, en les comptant, les offres dont la date limite n\'est peut-être pas la leur', () => {
    const offersOfEmail = (emailId: string) => (emailId === 'tableau' ? 16 : 1)
    const search = expiredToReview([
      row('ligne1', { emailId: 'tableau' }), row('ligne2', { emailId: 'tableau' }),
      row('renvoyee', { sourceCount: 2 }),
      row('deux-dates', { deadline: 'du 01/11 au 20/11/2026' }),
      row('sure'),
    ], now, offersOfEmail)
    assert.deepEqual(search.offers.map(o => o.id), ['sure'])
    assert.equal(search.uncertain, 4, 'e-mail à plusieurs offres (date la plus proche de toutes), offre reçue plusieurs fois, deux dates citées')
  })

  it('ne compte comme écartées que des offres dont la date limite enregistrée est passée', () => {
    const search = expiredToReview([row('ouverte', { emailId: 'tableau', deadline: '20/11/2026' }), row('publiee', { emailId: 'tableau', status: 'published' })], now, () => 16)
    assert.deepEqual(search, { offers: [], uncertain: 0 })
  })

  it('écarte les offres publiées ou ignorées', () => {
    assert.deepEqual(ids([row('p', { status: 'published' }), row('j', { jobId: 'aoj1' }), row('i', { status: 'ignored' }), row('a')]), ['a'])
  })

  it('garde une offre sans date limite lisible, ou dont la date limite est aujourd\'hui ou plus tard', () => {
    assert.deepEqual(ids(['', 'ASAP', 'fin novembre', '03/11/2026', '15/12/2026 à 12h'].map((deadline, i) => row(`o${i}`, { deadline }))), [])
  })

  it('lit l\'année d\'une date sans année à la réception de l\'e-mail', () => {
    assert.deepEqual(ids([
      row('ancienne', { deadline: '20/12', receivedAt: '2025-12-01T09:00:00.000Z' }),
      row('recente', { deadline: '20/12', receivedAt: '2026-10-20T09:00:00.000Z' }),
      row('sans-date', { deadline: '30/10/2026', receivedAt: '' }),
    ]), ['ancienne', 'sans-date'])
  })

  it('explique les offres écartées, au singulier comme au pluriel', () => {
    assert.match(uncertainNote(1), /^1 offre écartée : sa date limite n'est peut-être pas la sienne .* supprimez-la par la sélection\.$/)
    assert.match(uncertainNote(16), /^16 offres écartées : leur date limite n'est peut-être pas la leur .* supprimez-les par la sélection\.$/)
  })
})
