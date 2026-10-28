import type { Element } from '@xmldom/xmldom'
import { childW, childrenW, descendantsW, elements, isTabRun, isW, parseXml, readTemplate, runKey, runTabs, runText, textOf } from './render'

// Inspection d'un modèle Word : portage de inspect_template.py (skill cv-esn-anonymise), lu par l'IA qui écrit la
// cartographie (template-mapping.ts). Une ligne par élément du corps : index, type, style, puce, tabulation, segments.
// Les segments sont découpés comme au rendu (fillParagraph, render.ts) : liens aplatis, images ignorées, runs de même
// mise en forme réunis, « ⇥ » pour une tabulation. En plus du script : chemins des paragraphes de tableau (pour
// `fixed` et les `fields` d'un tableau), largeur utile de la page et taquets existants (pour `tab_stop`). Pur, testé.

const SEGMENT_MAX = 80
const LINE_MAX = 240
const MAX_BODY_ELEMENTS = 400
const MAX_TABLE_LINES = 80
// Le modèle est un fichier non fiable et chaque dépôt envoie l'inspection à l'IA : taille bornée (un modèle réel en fait
// 3 000 à 5 000 caractères).
const MAX_INSPECTION_CHARS = 40_000

const W_VAL = (el: Element | null, attr = 'val') => el?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', attr) ?? ''

/** Segments d'un paragraphe, dans l'ordre : texte de même mise en forme réuni, « ⇥ » pour une tabulation. */
export function paragraphSegments(p: Element): string[] {
  const runs: Element[] = []
  for (const el of elements(p)) {
    if (isW(el, 'r')) runs.push(el)
    else if (isW(el, 'hyperlink')) runs.push(...childrenW(el, 'r'))
  }
  const segments: string[] = []
  let currentKey: string | null = null
  for (const r of runs) {
    if (childW(r, 'drawing')) continue
    if (isTabRun(r)) {
      segments.push('⇥')
      currentKey = null
      continue
    }
    const text = runText(r)
    if (!text) continue
    // Tabulation dans le run du texte : sépare les segments comme au rendu (runTabs).
    const tabs = runTabs(r)
    if (tabs.before) {
      segments.push('⇥')
      currentKey = null
    }
    const key = runKey(r)
    if (currentKey !== null && key === currentKey) segments[segments.length - 1] += text
    else segments.push(text)
    currentKey = key
    if (tabs.after) {
      segments.push('⇥')
      currentKey = null
    }
  }
  return segments
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// L'inspection part chez l'IA : la cartographie n'a pas besoin des coordonnées (celles du commercial de l'ESN, ou d'un
// candidat si le modèle est un vrai dossier). Un téléphone compte au moins 9 chiffres : « 2012 - 2014 » n'en est pas un.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONE = /(?:\+|\b00)?\d[\d .()-]{7,}\d/g

/** Texte sans e-mail ni numéro de téléphone (marqueurs expliqués à l'IA). */
export function maskContacts(text: string): string {
  return text
    .replace(EMAIL, '‹e-mail masqué›')
    .replace(PHONE, m => (m.replace(/\D/g, '').length >= 9 ? '‹téléphone masqué›' : m))
}

function describeParagraph(p: Element): string {
  const style = W_VAL(childW(childW(p, 'pPr') ?? p, 'pStyle')) || '-'
  const bullet = descendantsW(p, 'numPr').length > 0 ? '•' : ' '
  const tab = descendantsW(p, 'tab').length > 0 ? '⇥' : ' '
  const segs = paragraphSegments(p)
  const tabs = childW(childW(p, 'pPr') ?? p, 'tabs')
  const stops = tabs ? childrenW(tabs, 'tab').map(t => `${W_VAL(t)}@${W_VAL(t, 'pos')}`).join(',') : ''
  const image = descendantsW(p, 'drawing').length > 0 ? ' [IMAGE]' : ''
  const text = clip(segs.map(s => clip(maskContacts(s), SEGMENT_MAX)).join(' | '), LINE_MAX)
  return `P   ${clip(style, 14).padEnd(14)} ${bullet} ${tab} ${segs.filter(s => s !== '⇥').length} | ${text}${image}${stops ? ` [taquets ${stops}]` : ''}`
}

function describeTable(tbl: Element, index: number): string[] {
  const rows = childrenW(tbl, 'tr')
  const cells = rows.flatMap(r => childrenW(r, 'tc'))
  const lines = [`TBL ${rows.length} lignes, ${cells.length} cellules${descendantsW(tbl, 'drawing').length > 0 ? ' [IMAGE]' : ''}`]
  rows.forEach((tr, ri) => childrenW(tr, 'tc').forEach((tc, ci) => descendantsW(tc, 'p').forEach((p, pi) => {
    if (!descendantsW(p, 't').map(textOf).join('').trim() && descendantsW(p, 'drawing').length === 0) return
    lines.push(`      [${index},${ri},${ci},${pi}] ${describeParagraph(p)}`)
  })))
  return lines.length > MAX_TABLE_LINES + 1 ? [...lines.slice(0, MAX_TABLE_LINES + 1), '      … paragraphes suivants du tableau non listés'] : lines
}

/**
 * Texte des en-têtes et pieds de page (identité à réécrire, texte à traduire) : paragraphes séparés par « / », et dans
 * chacun les morceaux de texte (w:t) séparés par « ¦ » — header_footer_replacements remplace à l'intérieur d'un morceau.
 */
function headerFooterLines(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter(name => /^word\/(header|footer)\d*\.xml$/.test(name))
    .sort()
    .flatMap(name => {
      const root = parseXml(files[name]).documentElement as Element | null
      const texts = root
        ? descendantsW(root, 'p').map(p => descendantsW(p, 't').map(t => maskContacts(textOf(t))).filter(Boolean).join(' ¦ ')).filter(t => t.trim())
        : []
      return texts.length > 0 ? [`[${name.includes('header') ? 'en-tête' : 'pied de page'} ${name.slice(5)}] ${clip(texts.join(' / '), LINE_MAX * 2)}`] : []
    })
}

/** Inspection lisible du modèle (bornes de rendu vérifiées par readTemplate). */
export function inspectTemplate(bytes: Uint8Array): string {
  const { files, doc } = readTemplate(bytes)
  const body = doc.documentElement ? childW(doc.documentElement as unknown as Element, 'body') : null
  if (!body) throw new Error('Template Word sans corps de document (w:body)')
  const children = elements(body)
  const lines = ['Corps : index | type | style | puce | tabulation | nombre de segments | segments (séparés par « | », ⇥ = tabulation)']
  children.slice(0, MAX_BODY_ELEMENTS).forEach((el, i) => {
    const prefix = String(i).padStart(4)
    const name = el.localName
    if (isW(el, 'p')) lines.push(`${prefix} ${describeParagraph(el)}`)
    else if (isW(el, 'tbl')) {
      const [head, ...cellLines] = describeTable(el, i)
      lines.push(`${prefix} ${head}`, ...cellLines)
    } else lines.push(`${prefix} ${name}`)
  })
  if (children.length > MAX_BODY_ELEMENTS) lines.push(`… ${children.length - MAX_BODY_ELEMENTS} éléments de plus`)

  const sect = children.at(-1)
  if (sect && isW(sect, 'sectPr')) {
    const width = Number(W_VAL(childW(sect, 'pgSz'), 'w'))
    const margins = childW(sect, 'pgMar')
    const left = Number(W_VAL(margins, 'left'))
    const right = Number(W_VAL(margins, 'right'))
    if (width && Number.isFinite(left) && Number.isFinite(right)) {
      lines.push(`Largeur utile de la page : ${width - left - right} twips (page ${width}, marges ${left} et ${right})`)
    }
  }
  const text = [...lines, ...headerFooterLines(files)].join('\n')
  return text.length > MAX_INSPECTION_CHARS ? `${text.slice(0, MAX_INSPECTION_CHARS)}\n… inspection tronquée (modèle trop long)` : text
}
