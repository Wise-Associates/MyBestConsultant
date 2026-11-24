import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escapeControlCharsInStrings, parseModelJson } from './model-json'

describe('lecture du JSON d\'une réponse de modèle', () => {
  it('JSON valide : même résultat que JSON.parse (objet, tableau, mise en forme sur plusieurs lignes)', () => {
    const pretty = '{\n  "titre": "Expert ALM",\n  "competences": ["CFP", "ALM"]\n}'
    assert.deepEqual(parseModelJson(pretty), JSON.parse(pretty))
    assert.deepEqual(parseModelJson('[{"q": "Bonjour ?"}]'), [{ q: 'Bonjour ?' }])
  })

  it('retour à la ligne brut dans une chaîne (Ministral sur vLLM) : lu comme « \\n »', () => {
    const answer = '{\n  "description": "Rejoignez un grand groupe.\n\n### Vos missions\n- Piloter le CFP"\n}'
    assert.throws(() => JSON.parse(answer), /control character/i)
    assert.deepEqual(parseModelJson(answer), { description: 'Rejoignez un grand groupe.\n\n### Vos missions\n- Piloter le CFP' })
  })

  it('tabulation, retour chariot et autre caractère de contrôle bruts dans une chaîne', () => {
    assert.deepEqual(parseModelJson('{"a": "x\ty\r\nz\u0001"}'), { a: 'x\ty\r\nz\u0001' })
  })

  it('guillemet et barre oblique échappés dans la chaîne : la fin de la chaîne reste bien repérée', () => {
    const answer = '{"a": "il dit \\"oui\\"\net \\\\ part", "b": "fin"}'
    assert.deepEqual(parseModelJson(answer), { a: 'il dit "oui"\net \\ part', b: 'fin' })
  })

  it('autre défaut (virgule en trop, réponse coupée) : l\'erreur de JSON.parse sur le texte reçu, rien n\'est deviné', () => {
    for (const answer of ['{"a": 1,}', '{"a": "coupé\nen route', '{"a": "x\n" "b": 2}']) {
      let expected: unknown
      try { JSON.parse(answer) } catch (err) { expected = err }
      assert.ok(expected instanceof SyntaxError)
      assert.throws(() => parseModelJson(answer), (err: unknown) => err instanceof SyntaxError && err.message === (expected as Error).message)
    }
  })
})

describe('échappement des caractères de contrôle dans les chaînes JSON', () => {
  it('ne touche ni aux espaces entre les éléments ni au texte hors des chaînes', () => {
    assert.equal(escapeControlCharsInStrings('{\n\t"a": "b\nc"\n}'), '{\n\t"a": "b\\nc"\n}')
  })

  it('rien à échapper : le texte reçu, tel quel', () => {
    const text = '{"a": "b\\nc"}'
    assert.equal(escapeControlCharsInStrings(text), text)
  })
})
