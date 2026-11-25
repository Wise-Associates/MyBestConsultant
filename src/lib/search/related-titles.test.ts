import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TitleSuggestionInputSchema, dictionaryTitles, indexTitles, titleSuggestions } from './related-titles'

// Comptes fictifs de l'index (métiers des CV classés qui exercent celui de l'offre).
const DATA_ENGINEER = {
  'Data Engineer': 120, 'Ingénieur Big Data': 25, 'Ingénieur data': 14, 'Data Analyst': 20, 'Développeur Python': 30,
  'Data Engineer Senior': 9, 'Architecte data': 6, 'Ingénieur Data Spark': 1,
}

describe('autres intitulés du métier proposés (ADR 0062)', () => {
  it('dictionnaire : les autres écritures du même métier, sans le titre lui-même ni les sigles courts', () => {
    assert.deepEqual(dictionaryTitles('Data Engineer (H/F) – Lyon'), ['Ingénieur data', 'Ingénieur données'])
    assert.deepEqual(dictionaryTitles('Développeur Full-Stack'), ['Full Stack Developer'])
    assert.deepEqual(dictionaryTitles('Product Owner'), ['Proxy PO'])
    assert.deepEqual(dictionaryTitles('Responsable des plantations'), [])
  })

  it('index : métiers portés par 2 CV au moins, ni plus généraux, ni un autre métier connu, ni liés par un mot générique', () => {
    assert.deepEqual(indexTitles('Data Engineer', DATA_ENGINEER), [
      { title: 'Ingénieur Big Data', count: 25 }, { title: 'Ingénieur data', count: 14 },
    ])
    // « Chef de projet » est plus général que « Chef de projet SAP » ; « Consultant SAP FI » est un autre métier connu.
    assert.deepEqual(indexTitles('Chef de projet SAP', { 'Chef de projet': 50, 'Consultant SAP FI': 12, 'Directeur de projet SAP': 4, 'Chef de projet ERP': 8 }), [
      { title: 'Directeur de projet SAP', count: 4 },
    ])
    // Seul « Développeur » en commun : pas le même métier.
    assert.deepEqual(indexTitles('Développeur Java', { 'Développeur Symfony': 8, 'Ingénieur études et développement Java': 7 }), [
      { title: 'Ingénieur études et développement Java', count: 7 },
    ])
  })

  it('propositions : dictionnaire puis index, sans ce qui est déjà présent ni doublon, 8 au plus', () => {
    assert.deepEqual(titleSuggestions('Data Engineer', DATA_ENGINEER, ['Ingénieur données']), [
      { title: 'Ingénieur data', count: null }, { title: 'Ingénieur Big Data', count: 25 },
    ])
    assert.deepEqual(titleSuggestions('Data Engineer', null, []).map(s => s.title), ['Ingénieur data', 'Ingénieur données'])
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Ingénieur data ${i}`, 30 - i]))
    assert.equal(titleSuggestions('Data Engineer', many, []).length, 8)
  })

  it('entrée du navigateur : métier nettoyé et borné, 20 intitulés exclus au plus', () => {
    assert.equal(TitleSuggestionInputSchema.parse({ title: ' Data : Engineer ', exclude: [] }).title, 'Data Engineer')
    assert.equal(TitleSuggestionInputSchema.safeParse({ title: 'x', exclude: [] }).success, false)
    assert.equal(TitleSuggestionInputSchema.safeParse({ title: 'Data Engineer', exclude: Array(21).fill('a') }).success, false)
  })
})
