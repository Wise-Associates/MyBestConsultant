import { z } from 'zod'
import { scoreBreakdown } from './score-breakdown'
import { LINK } from './cv-export/leak-check'
import type { RecruiterWeights } from './scoring-weights'

// Fiche candidat proposée au client (demande du 2026-11-17) : une page imprimable (PDF) par candidat envoyé depuis
// « Réponse client » : profil, parcours, adéquation au poste et comptes rendus du cabinet. Le candidat n'y est désigné que
// par ses initiales, sans coordonnées (choix du 2026-11-17, même règle que le « CV format cabinet ») : le client passe par
// le cabinet. Les textes libres (résumé du CV, avis de l'IA, comptes rendus) sont donc nettoyés de son nom et de toute
// adresse, numéro ou lien. Règles pures, testées dans client-sheet.test.ts.

export const SHEET_LIMITS = { skills: 15, experiences: 6, education: 4, languages: 6, summary: 900 } as const

/** Étape envoyée au client avec son compte rendu. */
export interface SheetStep { id: string; label: string; report: string; validatedAt?: string }

export interface ClientSheet {
  appId: string
  initials: string
  /** Intitulé du poste le plus récent du CV. */
  headline: string
  years: number | null
  city: string
  languages: string[]
  skills: string[]
  summary: string
  experiences: { title: string; company: string; period: string }[]
  education: { degree: string; school: string; year: string }[]
  /** Adéquation à l'offre ; null sans score. */
  fit: { score: number; parts: { label: string; percent: number }[]; opinion: string } | null
  steps: SheetStep[]
  /** Rubriques où un mot du nom du candidat reste peut-être (écrit sans majuscule) : à vérifier avant de transmettre. */
  warnings: string[]
}

/** « Marie-Hélène Durand » → « M. D. » ; sans nom : « Candidat ». */
export function initialsOf(firstName: string, lastName: string): string {
  const letters = [firstName, lastName].map(p => p.trim().charAt(0).toUpperCase()).filter(Boolean)
  return letters.length ? letters.map(l => `${l}.`).join(' ') : 'Candidat'
}

/** Nom du candidat : celui de son compte, ou celui lu sur son CV (prénom = premier mot). */
export interface PersonName { first: string; last: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const SEP = "[\\s'’.-]+"
const PARTICLES = new Set(['d', 'l', 'de', 'du', 'des', 'la', 'le', 'les', 'van', 'von', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'das'])
// Particules qu'un nom perd quand il est écrit seul (« de La Tour » → « La Tour », « d'Artagnan » → « Artagnan »).
const LEADING = new Set(['d', 'de', 'du', 'des', 'van', 'von'])
const wordsOf = (s: string) => s.split(/[\s'’.-]+/).filter(Boolean)
// Valeurs mises à la place d'un nom inconnu (profils de chasseur : « Profil sans nom », nom tiré du fichier « CV_… »).
const PLACEHOLDER_WORDS = new Set(['cv', 'profil', 'sans', 'nom'])
const realWord = (w: string) => /^[\p{L}\p{M}]+$/u.test(w) && !PLACEHOLDER_WORDS.has(fold(w))

/** Motif d'un nom, insensible à la casse et aux accents (texte en NFD), mots séparés par espace, tiret, point ou apostrophe. */
const namePattern = (words: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${words.map(w => [...fold(w)].map(c => `${escape(c)}\\p{M}*`).join('')).join(SEP)}(?![\\p{L}\\p{N}])`, 'giu')

/** Noms complets et composés (remplacés quelle que soit la casse), mots seuls (avec une majuscule), formes collées. */
function nameTerms(names: PersonName[]) {
  const multi: string[][] = []
  const single = new Set<string>()
  const glued = new Set<string>()
  for (const { first, last } of names) {
    const f = wordsOf(first).filter(w => fold(w) !== 'cv' && !/\d/.test(w))
    const l = wordsOf(last).filter(w => !/\d/.test(w))
    if (![...f, ...l].some(realWord)) continue
    const lastProper = l.slice(Math.max(0, l.findIndex(w => !LEADING.has(fold(w)))))
    for (const words of [[...f, ...l], [...l, ...f], f, l, lastProper]) if (words.length > 1) multi.push(words)
    for (const w of [...f, ...l]) if (w.length >= 3 && realWord(w) && !PARTICLES.has(fold(w))) single.add(w)
    for (const words of [[...f, ...l], [...l, ...f]]) {
      const g = fold(words.join(''))
      if (words.length > 1 && g.length >= 6) glued.add(g)
    }
  }
  // Du plus long au plus court : « Marie Durand » devient « M. D. », pas « M. D. M. D. ».
  multi.sort((a, b) => b.join(' ').length - a.join(' ').length)
  return { multi, single: [...single], glued: [...glued] }
}

/**
 * Initiales du premier nom connu qui n'est pas une valeur de remplacement (« Profil sans nom ») ; à défaut, du premier et du
 * dernier vrai mot d'un nom mêlé de valeurs de remplacement (« CV Marie Durand 2024 » → « M. D. »).
 */
export function sheetInitials(names: PersonName[]): string {
  const clean = names.find(n => {
    const words = [...wordsOf(n.first), ...wordsOf(n.last)]
    return words.length > 0 && words.every(realWord)
  })
  if (clean) return initialsOf(clean.first, clean.last)
  const words = names.map(n => [...wordsOf(n.first), ...wordsOf(n.last)].filter(realWord)).find(w => w.length > 0)
  return words ? initialsOf(words[0], words.length > 1 ? words[words.length - 1] : '') : 'Candidat'
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const EMAIL_HIDDEN = /[\w.+-]+\s*[[(]\s*(?:at|arobase)\s*[\])]\s*[\w-]+(?:\.[\w-]+)*/gi
// Suite de 9 à 15 chiffres, quel que soit le découpage (« 06  12 34 56 78 », « +1 (415) 555-0123 ») : un numéro ; une suite
// d'années (« 2015-2018-2021 ») reste.
const DIGIT_RUN = /(?:\+|\b00)?\(?\d[\d\s./()-]{7,}\d/g
const isPhone = (run: string) => {
  const n = run.replace(/\D/g, '').length
  return n >= 9 && n <= 15 && !run.split(/\D+/).filter(Boolean).every(g => /^(?:19|20)\d\d$/.test(g))
}
const STREET = /\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|allée|chemin|impasse|place|quai|route|cours|square)\b[^,\n]*/giu
const BIRTH = /\bnée?\s+le\s+\d{1,2}(?:[/. -]\d{1,2}[/. -]|\s+\p{L}+\s+)\d{2,4}/giu

/**
 * Texte libre sans l'identité du candidat : ses noms (compte et CV ; complets ou composés quelle que soit la casse, mot seul
 * écrit avec une majuscule ; accents et apostrophes indifférents) deviennent ses initiales ; un mot qui contient son nom collé
 * (« marie-durand-42 », « mariedurand.dev »), les adresses e-mail, liens, numéros de téléphone, adresses postales et dates de
 * naissance sont retirés.
 */
export function scrubIdentity(text: string, names: PersonName[]): string {
  const initials = sheetInitials(names)
  const { multi, single, glued } = nameTerms(names)
  // Coordonnées sur le texte composé (NFC : « née », « allée ») ; les noms sur le texte décomposé (NFD : accents indifférents).
  let out = text.normalize('NFC')
    .replace(EMAIL, '').replace(EMAIL_HIDDEN, '').replace(LINK, '')
    .replace(DIGIT_RUN, run => (isPhone(run) ? '' : run))
    .replace(STREET, '').replace(BIRTH, '')
    .normalize('NFD')
    .replace(/\S+/g, token => {
      const flat = fold(token).replace(/[^a-z0-9]/g, '')
      return glued.some(g => flat.includes(g)) ? '' : token
    })
  for (const words of multi) out = out.replace(namePattern(words), initials)
  // Mot seul : 3 lettres au moins et une majuscule dans le texte, pour ne pas toucher « le » (nom « Le ») ni « petit ».
  for (const word of single) out = out.replace(namePattern([word]), m => (/^\p{Lu}/u.test(m) ? initials : m))
  // Parenthèses vidées par les retraits (« (, ) ») : supprimées.
  return out.normalize('NFC').replace(/\([\s,;/-]*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}

/** Mots du nom (3 lettres au moins) encore présents dans `text`, quelle que soit la casse : à signaler, pas à corriger. */
export function namesLeft(text: string, names: PersonName[]): string[] {
  return nameTerms(names).single.filter(w => namePattern([w]).test(text.normalize('NFD')))
}

const text = (max: number) => z.string().catch('').transform(s => s.trim().slice(0, max))
// CV analysé (`users.cvProfileJson`, cv-profile-extract.ts), relu sans confiance : un champ absent ou abîmé est laissé vide.
const profileSchema = z.object({
  skills: z.array(text(60)).catch([]),
  experienceSummary: text(4000),
  experiences: z.array(z.object({ title: text(120), company: text(120), period: text(60) }).catch({ title: '', company: '', period: '' })).catch([]),
  education: z.array(z.object({ degree: text(160), school: text(160), year: text(30) }).catch({ degree: '', school: '', year: '' })).catch([]),
  languages: z.array(z.object({ name: text(40), level: text(40) }).catch({ name: '', level: '' })).catch([]),
  yearsOfExperience: z.number().int().min(0).max(70).nullable().catch(null),
  /** Nom lu sur le CV : jamais imprimé, sert à le retirer des textes (il peut différer du compte : nom d'usage, profil de chasseur). */
  candidateName: text(200),
}).partial()

function parseProfile(raw: unknown) {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed = profileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {} // CV non analysé ou valeur abîmée : la fiche montre le reste
  }
}

/** Coupe à la dernière phrase entière avant `max` caractères. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const end = cut.lastIndexOf('. ')
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

export function buildClientSheet(input: {
  appId: string
  firstName: string
  lastName: string
  city?: string
  cvProfileJson?: unknown
  /** Score aux poids du recruteur (comme dans le funnel). */
  score?: number
  /** Raison de la note de l'IA (aiSummary) : détail par critère et avis. */
  aiSummary?: string
  weights?: RecruiterWeights
  steps: SheetStep[]
}): ClientSheet {
  const p = parseProfile(input.cvProfileJson)
  const [cvFirst = '', ...cvRest] = (p.candidateName ?? '').split(/\s+/)
  const names: PersonName[] = [{ first: input.firstName, last: input.lastName }, { first: cvFirst, last: cvRest.join(' ') }]
  // Tout ce qui est imprimé passe par là : un chasseur saisit lui-même compétences et langues de ses profils.
  const clean = (s: string) => scrubIdentity(s, names)
  const experiences = (p.experiences ?? []).filter(e => e.title || e.company)
  const breakdown = input.aiSummary ? scoreBreakdown(input.aiSummary, input.weights) : null

  const sheet: Omit<ClientSheet, 'warnings'> = {
    appId: input.appId,
    initials: sheetInitials(names),
    headline: clean(experiences[0]?.title ?? ''),
    years: p.yearsOfExperience ?? null,
    city: clean(input.city ?? ''),
    languages: (p.languages ?? []).slice(0, SHEET_LIMITS.languages).map(l => [clean(l.name), clean(l.level)]).filter(([name]) => name)
      .map(([name, level]) => (level ? `${name} (${level})` : name)),
    skills: [...new Set((p.skills ?? []).map(clean).filter(Boolean))].slice(0, SHEET_LIMITS.skills),
    summary: clip(clean(p.experienceSummary ?? ''), SHEET_LIMITS.summary),
    experiences: experiences.slice(0, SHEET_LIMITS.experiences).map(e => ({ title: clean(e.title), company: clean(e.company), period: clean(e.period) })),
    education: (p.education ?? []).filter(e => e.degree || e.school).slice(0, SHEET_LIMITS.education).map(e => ({ degree: clean(e.degree), school: clean(e.school), year: clean(e.year) })),
    fit: input.score === undefined ? null : {
      score: input.score,
      parts: breakdown?.parts.map(part => ({ label: part.label, percent: part.percent })) ?? [],
      // Sans détail lisible (note d'avant), la raison entière tient lieu d'avis.
      opinion: clip(clean(breakdown ? breakdown.rest : input.aiSummary ?? ''), SHEET_LIMITS.summary),
    },
    steps: input.steps.map(s => ({ ...s, label: clean(s.label), report: clean(s.report) })),
  }
  const sections: [string, string][] = [
    ['Profil', [sheet.headline, sheet.city, sheet.summary, ...sheet.skills, ...sheet.languages].join(' ')],
    ['Parcours et formation', [...sheet.experiences.flatMap(e => [e.title, e.company]), ...sheet.education.flatMap(e => [e.degree, e.school])].join(' ')],
    ['Adéquation au poste', sheet.fit?.opinion ?? ''],
    ['Avis du cabinet', sheet.steps.map(s => `${s.label} ${s.report}`).join(' ')],
  ]
  return { ...sheet, warnings: sections.filter(([, t]) => namesLeft(t, names).length > 0).map(([title]) => title) }
}
