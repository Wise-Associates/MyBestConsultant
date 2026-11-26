import { createHash } from 'node:crypto'
import { nameParts, replacePersonName } from './cv-classification-dataset'

// Noms inventés à la place des vrais dans les exemples d'affinage multi-tâches (ADR 0063). Pas « [NOM] » comme pour la
// classification : l'export CV et l'analyse d'entretien doivent apprendre à anonymiser un nom qu'ils voient, ce qu'un
// modèle entraîné sur des « [NOM] » ne verrait jamais. Règles pures, testées dans pseudonymize.test.ts.

/** Prénoms et noms courants, inventés pour l'exemple : aucune personne réelle n'est visée. */
export const FAKE_FIRST_NAMES = [
  'Claire', 'Lucas', 'Camille', 'Hugo', 'Sarah', 'Julien', 'Manon', 'Antoine', 'Léa', 'Thomas', 'Inès', 'Nicolas',
  'Chloé', 'Mathieu', 'Emma', 'Romain', 'Julie', 'Maxime', 'Laura', 'Adrien', 'Nadia', 'Karim', 'Sophie', 'Olivier',
  'Amandine', 'Yanis', 'Pauline', 'Bruno', 'Aïcha', 'Damien', 'Elsa', 'Mehdi', 'Céline', 'Rémi', 'Lina', 'Vincent',
] as const
export const FAKE_LAST_NAMES = [
  'Morel', 'Garnier', 'Lambert', 'Fontaine', 'Rousseau', 'Mercier', 'Blanchard', 'Gauthier', 'Perrin', 'Chevalier',
  'Robin', 'Masson', 'Marchand', 'Dumont', 'Leclerc', 'Brunet', 'Faure', 'Roche', 'Renaud', 'Picard', 'Colin',
  'Vidal', 'Caron', 'Arnaud', 'Giraud', 'Benali', 'Haddad', 'Nguyen', 'Bertin', 'Lemoine', 'Carpentier', 'Barbier',
  'Charpentier', 'Huet', 'Tessier', 'Royer',
] as const

/** Une personne citée dans un texte : prénom(s) et nom, tels qu'enregistrés. */
export interface Person {
  first: string
  last: string
}

/** Personne d'après un nom complet (« Jean-Marc de La Tour ») : le dernier mot est le nom, comme splitFullName de l'export CV. */
export function personFromFullName(full: string): Person {
  const words = full.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return { first: '', last: words[0] ?? '' }
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const indexOf = (seed: string, size: number) => parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % size

/**
 * Faux nom de chaque partie des noms : toujours le même pour une même partie (une personne citée dans un CV puis dans un
 * entretien, ou présente en DEV et en production, garde le même faux nom), jamais une partie d'un vrai nom du texte ni
 * un faux nom déjà donné à une autre partie (sinon deux personnes se confondraient).
 */
export function fakeNamesFor(people: Person[]): Map<string, string> {
  const real = new Set(nameParts(people.flatMap(p => [p.first, p.last])))
  const used = new Set<string>()
  const fakes = new Map<string, string>()
  for (const person of people) {
    for (const [list, value] of [[FAKE_FIRST_NAMES, person.first], [FAKE_LAST_NAMES, person.last]] as const) {
      for (const part of nameParts([value])) {
        if (fakes.has(part)) continue
        const start = indexOf(part, list.length)
        for (let k = 0; k < list.length; k++) {
          const fake = list[(start + k) % list.length]
          if (real.has(fold(fake)) || used.has(fake)) continue
          fakes.set(part, fake)
          used.add(fake)
          break
        }
      }
    }
  }
  return fakes
}

/** Faux nom écrit comme le texte trouvé : en capitales (« DUPRÉ », « D U P R É »), en minuscules, ou tel quel. */
function sameCase(fake: string, found: string): string {
  const letters = found.replace(/[^\p{L}]/gu, '')
  if (letters && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return fake.toUpperCase()
  if (letters && letters === letters.toLowerCase()) return fake.toLowerCase()
  return fake
}

/**
 * Noms de ces personnes remplacés par des noms inventés partout dans le texte (mêmes règles de recherche que le masquage
 * « [NOM] » : en mot entier, en lettres espacées, collés à un autre mot). Toutes les listes de faux noms épuisées (plus de
 * 36 parties de noms dans un même texte) : « [NOM] ».
 */
export function pseudonymize(text: string, people: Person[]): string {
  const fakes = fakeNamesFor(people)
  if (!fakes.size) return text
  return replacePersonName(text, people.flatMap(p => [p.first, p.last]), (part, found) => sameCase(fakes.get(part) ?? '[NOM]', found))
}

/**
 * Un vrai nom resté dans le texte après le remplacement (partie de 4 lettres au moins, en mot entier) : le texte est alors
 * écarté plutôt que d'envoyer ce nom à l'enseignant et dans les exemples.
 */
export function keepsRealName(text: string, person: Person): boolean {
  const words = new Set(fold(text).split(/[^\p{L}]+/u))
  return nameParts([person.first, person.last]).some(p => p.length >= 4 && words.has(p))
}
