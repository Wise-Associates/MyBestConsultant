import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FAKE_FIRST_NAMES, FAKE_LAST_NAMES, fakeNamesFor, keepsRealName, personFromFullName, pseudonymize } from './pseudonymize'

const elodie = { first: 'Élodie', last: 'Dupré' }

describe('noms inventés à la place des vrais', () => {
  it('remplace prénom et nom, en gardant les capitales du texte', () => {
    const out = pseudonymize('Élodie DUPRÉ, consultante chez Dupré Conseil', [elodie])
    const fakes = fakeNamesFor([elodie])
    const first = fakes.get('elodie') ?? ''
    const last = fakes.get('dupre') ?? ''
    assert.ok((FAKE_FIRST_NAMES as readonly string[]).includes(first))
    assert.ok((FAKE_LAST_NAMES as readonly string[]).includes(last))
    assert.equal(out, `${first} ${last.toUpperCase()}, consultante chez ${last} Conseil`)
    assert.doesNotMatch(out, /lodie|upr/i)
  })

  it('remplace aussi un nom en lettres espacées ou collé au prénom', () => {
    const fakes = fakeNamesFor([elodie])
    const first = fakes.get('elodie') ?? ''
    const last = fakes.get('dupre') ?? ''
    assert.equal(pseudonymize('É L O D I E   D U P R É', [elodie]), `${first.toUpperCase()}   ${last.toUpperCase()}`)
    assert.equal(pseudonymize('ElodieDupré', [elodie]), `${first}${last}`)
  })

  it('donne toujours le même faux nom à la même personne', () => {
    assert.equal(pseudonymize('Élodie Dupré', [elodie]), pseudonymize('Élodie Dupré', [{ first: 'elodie', last: 'DUPRE' }]))
  })

  it("ne donne jamais le vrai nom d'une autre personne du texte, ni deux fois le même faux nom", () => {
    const people = FAKE_LAST_NAMES.slice(0, 5).map((last, i) => ({ first: FAKE_FIRST_NAMES[i], last }))
    const fakes = fakeNamesFor(people)
    const realParts = new Set(people.flatMap(p => [p.first.toLowerCase(), p.last.toLowerCase()]))
    for (const fake of fakes.values()) assert.ok(!realParts.has(fake.toLowerCase()), fake)
    assert.equal(new Set(fakes.values()).size, fakes.size)
  })

  it('laisse le texte tel quel sans nom connu', () => {
    assert.equal(pseudonymize('Chef de projet à la Défense', [{ first: '', last: '' }]), 'Chef de projet à la Défense')
  })

  it("découpe un nom complet : le dernier mot est le nom", () => {
    assert.deepEqual(personFromFullName('  Jean-Marc de La Tour '), { first: 'Jean-Marc de La', last: 'Tour' })
    assert.deepEqual(personFromFullName('Madonna'), { first: '', last: 'Madonna' })
  })
})

describe('contrôle après remplacement', () => {
  it("repère un vrai nom resté dans le texte, pas un mot qui le contient", () => {
    assert.equal(keepsRealName('Consultant chez Exemple, Lyon', elodie), false)
    assert.equal(keepsRealName('Références : Mme DUPRE, directrice', elodie), true)
    assert.equal(keepsRealName(pseudonymize('Élodie Dupré, Lyon', [elodie]), elodie), false)
  })
})
