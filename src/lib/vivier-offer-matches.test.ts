import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { REASON_MAX } from './vivier-matching'
import { matchRowId, rowChanges, wantedRows, type VivierOfferMatchRow } from './vivier-offer-matches'

const row = (jobId: string, score: number, reason = ''): VivierOfferMatchRow => ({ tenantId: 'org-fictive', jobId, vivierCvId: 'cv1', score, reason })

describe('identifiant d\'une correspondance CV / offre', () => {
  it('est le même pour le même CV et la même offre : deux écritures simultanées ne font qu\'une ligne', () => {
    assert.equal(matchRowId('cv1', 'job1'), matchRowId('cv1', 'job1'))
    assert.notEqual(matchRowId('cv1', 'job1'), matchRowId('cv1', 'job2'))
    assert.notEqual(matchRowId('cv1', 'job2'), matchRowId('cv2', 'job1'))
  })

  it('est accepté par Appwrite : 36 caractères au plus, lettres et chiffres, même pour une offre d\'appel d\'offres', () => {
    const id = matchRowId('6745a1b2c3d4e5f60718', 'ao6745a1b2c3d4e5f60719')
    assert.ok(id.length <= 36, id)
    assert.match(id, /^[a-zA-Z0-9]+$/)
  })
})

describe('lignes voulues pour un CV', () => {
  it('une par offre notée 65 ou plus, avec son score et sa raison', () => {
    const rows = wantedRows('org-fictive', 'cv1', [
      { jobId: 'a', score: 64, reason: '' }, { jobId: 'b', score: 65, reason: 'Profil proche' }, { jobId: 'c', score: 90, reason: '' },
    ])
    assert.deepEqual([...rows.values()], [row('b', 65, 'Profil proche'), row('c', 90)])
    assert.deepEqual([...rows.keys()], [matchRowId('cv1', 'b'), matchRowId('cv1', 'c')])
  })

  it('coupe la raison à la taille de l\'attribut (300 caractères)', () => {
    const [only] = wantedRows('org-fictive', 'cv1', [{ jobId: 'a', score: 80, reason: 'x'.repeat(REASON_MAX + 50) }]).values()
    assert.equal(only.reason.length, REASON_MAX)
  })

  it('ne coupe jamais un emoji en deux : Appwrite refuserait la ligne', () => {
    const halfCut = `${'x'.repeat(REASON_MAX - 1)}🚀`.slice(0, REASON_MAX)
    const [cut] = wantedRows('org-fictive', 'cv1', [{ jobId: 'a', score: 80, reason: halfCut }]).values()
    assert.equal(cut.reason, 'x'.repeat(REASON_MAX - 1))
    const [kept] = wantedRows('org-fictive', 'cv1', [{ jobId: 'a', score: 80, reason: 'Profil 🚀 proche' }]).values()
    assert.equal(kept.reason, 'Profil 🚀 proche')
  })

  it('aucune quand le CV ne correspond à aucune offre', () => {
    assert.equal(wantedRows('org-fictive', 'cv1', [{ jobId: 'a', score: 30, reason: '' }]).size, 0)
  })
})

describe('lignes à écrire et à supprimer', () => {
  const ids = (rows: VivierOfferMatchRow[]) => new Map(rows.map(r => [matchRowId(r.vivierCvId, r.jobId), r]))

  it('écrit les lignes absentes ou différentes, laisse celles qui sont à jour', () => {
    const { write, remove } = rowChanges(ids([row('a', 70), row('b', 80, 'ancienne raison')]), ids([row('a', 70), row('b', 80, 'nouvelle'), row('c', 66)]))
    assert.deepEqual(write.map(([, r]) => r.jobId), ['b', 'c'])
    assert.deepEqual(remove, [])
  })

  it('réécrit une ligne dont l\'organisation diffère', () => {
    const { write } = rowChanges(ids([{ ...row('a', 70), tenantId: 'autre-org' }]), ids([row('a', 70)]))
    assert.deepEqual(write.map(([, r]) => r.tenantId), ['org-fictive'])
  })

  it('supprime la ligne d\'une offre retirée ou passée sous le seuil', () => {
    const { write, remove } = rowChanges(ids([row('a', 70), row('b', 80)]), ids([row('a', 70)]))
    assert.deepEqual(write, [])
    assert.deepEqual(remove, [matchRowId('cv1', 'b')])
  })
})
