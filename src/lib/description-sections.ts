// Découpage de la description d'une offre en sections (Contexte, Missions, Profil, Modalités), pour
// le panneau admin AO Offers et la description pré-remplie avant publication.
// L'IA rend la description sous des formes variées : titres « ### Contexte » ou « **Contexte** »,
// libellés « Missions principales : » seuls sur leur ligne ou au milieu d'un unique paragraphe,
// parfois des « \n » écrits en toutes lettres. On en tire des sections typées pour mettre en avant
// les missions demandées et le profil attendu. Affichage seulement : le texte stocké n'est pas modifié.

export type SectionKind = 'context' | 'tasks' | 'profile' | 'terms' | 'other'
export type DescriptionBlock = { type: 'paragraph'; text: string } | { type: 'list'; items: string[] }
export interface DescriptionSection {
  title: string
  kind: SectionKind
  blocks: DescriptionBlock[]
  /** Titre déduit (phrase-repère, introduction) et non écrit dans le texte. */
  inferred?: true
}

// Ordre significatif : « Contexte de la mission » est un contexte, « Durée de la mission » une modalité.
const KIND_PATTERNS: [SectionKind, RegExp][] = [
  ['context', /contexte|présentation|à propos|enjeux/i],
  ['profile', /profil|expertise|compétence|qualification|pré-?requis|savoir-être|savoir-faire|expérience|connaissances|environnement technique/i],
  ['terms', /modalité|conditions|informations pratiques|durée/i],
  ['tasks', /mission|tâche|activité|responsabilit|livrable|rôle|prestation|périmètre/i],
]

/** Phrases qui annoncent les missions ou le profil dans une description rédigée d'un seul bloc. */
const CUES: [Extract<SectionKind, 'tasks' | 'profile'>, RegExp][] = [
  ['profile', /profil (?:recherché|idéal|attendu|souhaité)|candidat idéal|expertise (?:souhaitée|requise|attendue)|compétences (?:requises|attendues|souhaitées|recherchées)/i],
  ['tasks', /missions? principales?|principales missions|activités principales|principales activités|sera chargée? de|aura pour (?:mission|rôle|responsabilité)/i],
]
const CUE_TITLE = { tasks: 'Missions', profile: 'Profil recherché' }

/** Au-delà, un libellé suivi de « : » est une phrase, pas un titre de section. */
const MAX_LABEL_WORDS = 4
/** En deçà, « Libellé : valeur » reste une ligne (« Expérience requise : 5 ans minimum »). */
const MIN_SECTION_BODY_CHARS = 40
/** Longueur visée d'un paragraphe quand un bloc de texte est redécoupé en phrases. */
const PARAGRAPH_CHARS = 320

const HEADING_MD = /^#{1,6}\s+(.+)$/
const HEADING_BOLD = /^\*\*([^*]+?)\*\*\s*(.*)$/
const LIST_ITEM = /^\s*(?:[-*•–▪]|\d{1,2}[.)])\s+(.+)$/
const RULE = /^\s*[-*_]{3,}\s*$/
// Libellé en début de phrase : « … direction. Missions principales : suivi budgétaire, … »
const LABEL = /(?<=^|[.!?]\s+)([A-ZÀ-Ý][\p{L}'’ &/-]{1,40}?)\s*:(?:\s+|$)/gu
const SENTENCE_END = /(?<=[.!?…])\s+(?=[A-ZÀ-Ý«"“])/u

export function kindOf(title: string): SectionKind {
  return KIND_PATTERNS.find(([, re]) => re.test(title))?.[0] ?? 'other'
}

/** Type de section d'un libellé suivi de « : » et de `bodyChars` caractères, ou null si ce n'est pas un titre. */
function labelKind(label: string, bodyChars: number): SectionKind | null {
  if (label.trim().split(/\s+/).length > MAX_LABEL_WORDS) return null
  if (bodyChars > 0 && bodyChars < MIN_SECTION_BODY_CHARS) return null
  const kind = kindOf(label)
  // « Modalités : » seul sur sa ligne ouvre une section ; « Durée : 6 mois » reste une ligne de texte.
  if (kind === 'other' || (kind === 'terms' && bodyChars > 0)) return null
  return kind
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const cleanItem = (item: string) => capitalize(item.trim().replace(/\s*[;,]\s*$/, ''))

/** Découpe sur `sep` hors parenthèses : « appui (MCO, incidents), transition » donne 2 éléments. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0, from = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth = Math.max(0, depth - 1)
    else if (text[i] === sep && depth === 0) { parts.push(text.slice(from, i)); from = i + 1 }
  }
  parts.push(text.slice(from))
  return parts.map(p => p.trim()).filter(Boolean)
}

/**
 * Énumération écrite à la suite d'un libellé (« suivi budgétaire, suivi des coûts, reporting »).
 * Une phrase complète commence par une majuscule : elle reste un paragraphe.
 */
function enumeration(sentence: string, kind: SectionKind): string[] | null {
  if (!/^\p{Ll}/u.test(sentence)) return null
  const list = sentence.replace(/\.$/, '')
  const bySemicolon = splitTopLevel(list, ';')
  if (bySemicolon.length >= 2) return bySemicolon.map(cleanItem)
  const byComma = splitTopLevel(list, ',')
  return kind === 'tasks' && byComma.length >= 3 ? byComma.map(cleanItem) : null
}

export function parseDescription(raw: string): DescriptionSection[] {
  const text = raw.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim()
  const sections: DescriptionSection[] = []
  let current: DescriptionSection = { title: '', kind: 'context', blocks: [] }
  // Section ouverte par une phrase-repère (« Le profil recherché… ») et non par un titre du texte.
  let fromCue = false

  const open = (title: string, kind: SectionKind = kindOf(title), cue = false) => {
    if (current.blocks.length > 0 || current.title) sections.push(current)
    current = cue ? { title, kind, blocks: [], inferred: true } : { title, kind, blocks: [] }
    fromCue = cue
  }

  /** Phrases d'une ligne : regroupées en paragraphes courts, les phrases-repères isolées et mises en avant. */
  const addProse = (body: string) => {
    let paragraph: { type: 'paragraph'; text: string } | null = null
    for (const sentence of body.split(SENTENCE_END)) {
      const detectCues = fromCue || current.kind === 'context' || current.kind === 'other'
      const cue = detectCues ? CUES.find(([, re]) => re.test(sentence))?.[0] : undefined
      if (cue && !(fromCue && current.kind === cue)) { open(CUE_TITLE[cue], cue, true); paragraph = null }
      else if (!cue && fromCue) { open('', 'other'); paragraph = null }
      if (paragraph && paragraph.text.length + sentence.length < PARAGRAPH_CHARS) paragraph.text += ' ' + sentence
      else current.blocks.push(paragraph = { type: 'paragraph', text: sentence })
    }
  }

  /** Corps d'un libellé : énumération en liste, puis le reste de la phrase en paragraphes. */
  const addBody = (body: string) => {
    if (!body) return
    const [first, ...rest] = body.split(SENTENCE_END)
    const items = enumeration(first, current.kind)
    if (!items) return addProse(capitalize(body))
    current.blocks.push({ type: 'list', items })
    if (rest.length > 0) addProse(rest.join(' '))
  }

  const addLine = (line: string) => {
    let from = 0
    let label: string | null = null
    for (const m of line.matchAll(LABEL)) {
      const end = m.index + m[0].length
      if (!labelKind(m[1], line.length - end)) continue
      const before = line.slice(from, m.index).trim()
      if (label !== null) addBody(before)
      else if (before) addProse(before)
      open(m[1])
      label = m[1]
      from = end
    }
    const after = line.slice(from).trim()
    if (label !== null) addBody(after)
    else if (after) addProse(after)
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || RULE.test(line)) continue

    const md = HEADING_MD.exec(line)
    if (md) { open(md[1].replace(/\*\*/g, '').replace(/\s*:\s*$/, '')); continue }

    const bold = HEADING_BOLD.exec(line)
    if (bold) {
      const [, label, rest] = bold
      // « **Contexte** » ou « **Profil :** texte » ; « **Java** et Spring… » reste du texte.
      if (!rest || label.trim().endsWith(':') || rest.startsWith(':')) {
        open(label.replace(/\s*:\s*$/, ''))
        addBody(rest.replace(/^:\s*/, ''))
        continue
      }
    }

    const item = LIST_ITEM.exec(line)
    if (item) {
      const last = current.blocks.at(-1)
      if (last?.type === 'list') last.items.push(cleanItem(item[1]))
      else current.blocks.push({ type: 'list', items: [cleanItem(item[1])] })
      continue
    }

    addLine(line)
  }
  if (current.blocks.length > 0 || current.title) sections.push(current)

  // Introduction sans titre suivie de sections : c'est le contexte de la mission.
  const [intro] = sections
  if (intro && !intro.title && sections.length > 1 && !sections.some(s => s.kind === 'context' && s.title)) {
    intro.title = 'Contexte'
    intro.inferred = true
  }
  return sections
}

/** Marques « **gras** » et « *italique* » retirées : ni la page publique ni le post LinkedIn ne les affichent. */
const stripInline = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1')

/**
 * Description pré-remplie dans « Préparer la publication » (AO Offers) : titres « ### », puces « - »,
 * paragraphes courts séparés par une ligne vide. C'est le format que lisent la page publique de l'offre
 * (JobDescription) et le post LinkedIn (buildPostText, inchangé).
 */
export function descriptionForPublication(raw: string): string {
  const lines: string[] = []
  for (const section of parseDescription(raw)) {
    if (lines.length > 0) lines.push('')
    // Sans cadre visuel, un titre déduit semblerait couvrir aussi les paragraphes suivants : seuls
    // les titres écrits dans l'offre sont repris.
    if (section.title && !section.inferred) lines.push(`### ${section.title}`)
    section.blocks.forEach((block, i) => {
      if (block.type === 'list') lines.push(...block.items.map(item => `- ${stripInline(item)}`))
      else lines.push(...(i > 0 ? [''] : []), stripInline(block.text))
    })
  }
  return lines.join('\n')
}
