// Questions d'entretien lues dans un fichier du recruteur (PDF ou TXT, ADR 0054) : « découpage intelligent », choisi le
// 2026-11-21. Les éléments numérotés ou à puces et les lignes terminées par « ? » deviennent des questions (une question
// sur plusieurs lignes est rejointe) ; un titre de section (« Questions techniques ») donne leur catégorie ; le reste
// (introduction, numéros de page) est ignoré. Règles pures, testées dans interview-question-parser.test.ts. Le recruteur
// relit le résultat avant de l'envoyer.

export type QuestionCategory = 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing'

export interface ParsedQuestion {
  text: string
  category: QuestionCategory
}

/** 30 questions au plus (plafond d'un entretien, sessionInputSchema) ; une question fait de 8 à 1 000 caractères. */
export const IMPORT_LIMITS = { maxQuestions: 30, minChars: 8, maxChars: 1000 } as const

/** Catégorie par défaut, comme une question ajoutée à la main. */
const DEFAULT_CATEGORY: QuestionCategory = 'technical'

// Numéro (« 1. », « 2) », « Q3 : », « Question 4 - », « (5) »), lettre (« a) ») ou puce en début de ligne.
const MARKER = /^(?:(?:q(?:uestion)?\s*)?\d{1,2}\s*[.)\-–—:]|\(\d{1,2}\)|[a-z][.)]|[-•*–—·▪●◦►✓])\s*/i
// « Page 2 », « 3/5 », « 4 sur 12 », « - 4 - », un nombre seul.
const PAGE_MARK = /^(?:(?:page\s*)?\d{1,3}(?:\s*(?:\/|sur|of)\s*\d{1,3})?|[-–—]\s*\d{1,3}\s*[-–—])$/i
// Mot qui annonce une section plutôt qu'une question (« Questions techniques », « Partie 2 : motivation »).
const SECTION_WORD = /^(?:questions?|partie|section|th[èe]me|bloc|volet|axe|rubrique)\b/i
const TERMINAL = /[?.!;:]$/

const CATEGORY_WORDS: [QuestionCategory, RegExp][] = [
  ['closing', /\b(?:cl[ôo]ture|conclusion|pour finir|fin de l['’]entretien|closing|questions? du candidat)\b/i],
  ['intro', /\b(?:intro|introduction|pr[ée]sentation|accueil|parcours)\b/i],
  ['motivation', /\b(?:motivations?|projet professionnel)\b/i],
  ['behavioral', /\b(?:comportement\w*|situations?|soft skills?|savoir[- ][êe]tre|savoir-être|behavio\w*|manag\w*)\b/i],
  ['technical', /\b(?:techni\w*|comp[ée]tences?|hard skills?|expertise)\b/i],
]

function categoryOf(text: string): QuestionCategory | null {
  return CATEGORY_WORDS.find(([, words]) => words.test(text))?.[0] ?? null
}

/**
 * Titre de section : court, sans « ? » ni point final, avec un mot de catégorie, et d'allure de titre (3 mots au plus,
 * un mot comme « Questions » ou « Partie », ou deux-points final). Une phrase comme « Décrivez une situation
 * difficile. » n'en est pas un, malgré « situation ».
 */
function headingCategory(text: string): QuestionCategory | null {
  const content = text.replace(/^#+\s*/, '').trim()
  if (!content || content.length > 60 || content.endsWith('?') || /[.!]$/.test(content)) return null
  const category = categoryOf(content)
  if (!category) return null
  const words = content.replace(/:$/, '').trim().split(/\s+/).length
  return words <= 3 || SECTION_WORD.test(content) || content.endsWith(':') ? category : null
}

const normalize = (line: string) => line.replace(/[  \t]/g, ' ').replace(/\s+/g, ' ').trim()

/** Questions du texte, dans l'ordre ; `truncated` : il y en avait plus de 30. */
export function parseInterviewQuestions(input: string): { questions: ParsedQuestion[]; truncated: boolean } {
  const found: ParsedQuestion[] = []
  let category: QuestionCategory = DEFAULT_CATEGORY
  // Élément numéroté ou à puces en cours, qui peut continuer sur les lignes suivantes.
  let open: ParsedQuestion | null = null
  // Lignes sans numéro ni ponctuation finale qui précèdent peut-être une question écrite sur plusieurs lignes.
  let pending: string[] = []

  const close = () => {
    if (open) found.push(open)
    open = null
  }

  for (const raw of input.split(/\r?\n|\r/)) {
    const line = normalize(raw)
    if (!line) {
      close()
      pending = []
      continue
    }
    // Numéro de page : ignoré, sans couper une question qui continue sur la page suivante.
    if (PAGE_MARK.test(line)) continue

    const marker = MARKER.exec(line)
    const content = marker ? line.slice(marker[0].length).trim() : line
    const heading = headingCategory(content)
    if (heading) {
      close()
      pending = []
      category = heading
      continue
    }
    if (marker) {
      close()
      pending = []
      if (content) open = { text: content, category }
      continue
    }
    // Ligne sans numéro : suite de l'élément en cours s'il n'est pas terminé (au-delà de la longueur permise, il sera écarté :
    // inutile de l'allonger, chaque ajout recopie le texte)…
    const current: ParsedQuestion | null = open
    if (current && !TERMINAL.test(current.text)) {
      if (current.text.length <= IMPORT_LIMITS.maxChars) current.text = `${current.text} ${line}`
      continue
    }
    // … sinon une question si elle finit par « ? », rejointe aux deux lignes non terminées qui la précèdent au plus.
    if (line.endsWith('?')) {
      close()
      found.push({ text: [...pending.slice(-2), line].join(' '), category })
      pending = []
      continue
    }
    // Les deux dernières lignes seulement : recopier toute la liste à chaque ligne rendait la lecture quadratique (revue de
    // sécurité du 2026-11-21 : 7,6 s pour un fichier de 30 000 lignes courtes).
    pending = TERMINAL.test(line) ? [] : [...pending.slice(-1), line]
  }
  close()

  const seen = new Set<string>()
  const questions = found
    .map(q => ({ ...q, text: normalize(q.text) }))
    .filter(q => {
      const key = q.text.toLowerCase()
      if (q.text.length < IMPORT_LIMITS.minChars || q.text.length > IMPORT_LIMITS.maxChars || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { questions: questions.slice(0, IMPORT_LIMITS.maxQuestions), truncated: questions.length > IMPORT_LIMITS.maxQuestions }
}
