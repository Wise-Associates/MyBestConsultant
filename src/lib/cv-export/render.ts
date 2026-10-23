// Rendu d'un CV anonymisé dans le template Word (.docx) d'une ESN : portage TypeScript de render_cv.py
// (skill cv-esn-anonymise), qui ne peut pas tourner sur Vercel (Python). Même algorithme, même template_map.json :
// - les éléments du corps avant `body_start` (logo, bandeau, coordonnées du commercial) et à partir de `body_end`
//   sont conservés ; les éléments `protos` sont copiés comme modèles, puis la zone est reconstruite depuis les données ;
// - le texte d'un prototype est découpé en « segments » (runs de même mise en forme) ; chaque segment reçoit un
//   gabarit de `fields` ;
// - chaque bloc (une expérience, une formation…) est insécable : keepNext sur ses paragraphes sauf le dernier,
//   lignes de tableau non sécables ; un titre de section reste collé à son premier bloc ;
// - métadonnées neutralisées, commentaires et révisions suivies du template supprimés (auteurs compris).
// Fonction pure (octets en entrée et en sortie), testée dans render.test.ts. Toute évolution doit rester alignée
// sur scripts/render_cv.py de la skill, qui sert de référence.
import { DOMParser, XMLSerializer, onErrorStopParsing, type Document, type Element, type Node } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate'
import type { CvData, CvLang, TabStop, TemplateMap } from './types'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const CP_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

type Ctx = Record<string, unknown>

// ---------- accès au XML ----------

function isW(node: Node | null | undefined, local: string): node is Element {
  return !!node && node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === local
}

function elements(parent: Node): Element[] {
  const out: Element[] = []
  for (let n = parent.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element)
  return out
}

const childW = (el: Element, local: string) => elements(el).find(c => isW(c, local)) ?? null
const childrenW = (el: Element, local: string) => elements(el).filter(c => isW(c, local))

/** Descendants w:<local> dans l'ordre du document (l'élément lui-même exclu), comme `iter` de lxml. */
function descendantsW(el: Element, local: string): Element[] {
  const out: Element[] = []
  const walk = (node: Element) => {
    for (const c of elements(node)) {
      if (isW(c, local)) out.push(c)
      walk(c)
    }
  }
  walk(el)
  return out
}

const selfAndDescendantsW = (el: Element, local: string) => [...(isW(el, local) ? [el] : []), ...descendantsW(el, local)]

const textOf = (el: Element) => (el.textContent ?? '')
const runText = (r: Element) => childrenW(r, 't').map(textOf).join('')

function newW(doc: Document, local: string): Element {
  return doc.createElementNS(W_NS, `w:${local}`)
}

function textElement(doc: Document, value: string): Element {
  const t = newW(doc, 't')
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve')
  t.appendChild(doc.createTextNode(value))
  return t
}

function ownerDoc(node: Node): Document {
  const doc = node.ownerDocument
  if (!doc) throw new Error('Élément du template sans document')
  return doc
}

function setText(el: Element, value: string) {
  while (el.firstChild) el.removeChild(el.firstChild)
  el.appendChild(ownerDoc(el).createTextNode(value))
}

function parentOf(node: Node): Node {
  const parent = node.parentNode
  if (!parent) throw new Error('Élément du template détaché du document')
  return parent
}

const insertAfter = (ref: Node, node: Node) => parentOf(ref).insertBefore(node, ref.nextSibling)
const prependChild = (parent: Element, node: Node) => parent.insertBefore(node, elements(parent)[0] ?? null)
const detach = (node: Node) => node.parentNode?.removeChild(node)

/** Modèle refusé pour sa taille ou sa structure, avant tout rendu : message pour qui le dépose. */
export class TemplateStructureError extends Error {}

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser({ onError: onErrorStopParsing }).parseFromString(strFromU8(bytes), 'text/xml')
}

// xmldom réindexe tous les frères à chaque retrait (removeChild) : le coût des retraits du rendu croît avec le carré du
// nombre d'enfants d'un élément, et quelques centaines d'octets compressés de paragraphes vides bloquaient le serveur
// des dizaines de secondes (revue de sécurité du 2026-10-24). Bornes pour tout le modèle (corps, en-têtes, pieds de
// page, notes, propriétés), larges : le modèle Wise compte 1 300 éléments et au plus 25 enfants sous un même élément.
const MAX_TEMPLATE_ELEMENTS = 20_000
const MAX_CHILDREN_PER_ELEMENT = 500

/** Refuse un modèle dont les parties lues par le rendu dépassent ces bornes, avant tout traitement. */
function assertBoundedStructure(files: Unzipped) {
  let count = 0
  for (const [name, bytes] of Object.entries(files)) {
    if (!STORY_PART.test(name) && name !== 'docProps/core.xml') continue
    const root = parseXml(bytes).documentElement
    const pending: Element[] = root ? [root] : []
    for (let el = pending.pop(); el; el = pending.pop()) {
      if (++count > MAX_TEMPLATE_ELEMENTS || el.childNodes.length > MAX_CHILDREN_PER_ELEMENT) {
        throw new TemplateStructureError(`Modèle Word trop complexe : ${MAX_TEMPLATE_ELEMENTS.toLocaleString('fr-FR')} éléments au plus et ${MAX_CHILDREN_PER_ELEMENT} sous un même élément (paragraphes vides en grand nombre ?).`)
      }
      pending.push(...elements(el))
    }
  }
}

const serializer = new XMLSerializer()

function serializeXml(doc: Document) {
  const xml = serializer.serializeToString(doc)
  return strToU8(xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`)
}

// ---------- remplissage de texte ----------

function isTabRun(r: Element): boolean {
  return !!childW(r, 'tab') && !runText(r)
}

function runKey(r: Element): string {
  const rPr = childW(r, 'rPr')
  return rPr ? serializer.serializeToString(rPr) : ''
}

type RunGroup = { kind: 'tab'; run: Element } | { kind: 'txt'; runs: Element[] }

/** Remplace le texte de p : `values` = une chaîne par segment de texte ; « \t » dans une valeur = vraie tabulation. */
function fillParagraph(p: Element, values: string[], tabStop: TabStop | undefined) {
  const doc = ownerDoc(p)
  for (const el of elements(p)) {
    if (isW(el, 'proofErr') || isW(el, 'bookmarkStart') || isW(el, 'bookmarkEnd') || isW(el, 'hyperlink')) {
      if (isW(el, 'hyperlink')) for (const r of childrenW(el, 'r')) p.insertBefore(r, el) // aplatit les liens
      p.removeChild(el)
    }
  }
  const runs = childrenW(p, 'r').filter(r => !childW(r, 'drawing'))
  let groups: RunGroup[] = []
  for (const r of runs) {
    if (isTabRun(r)) {
      if (groups.at(-1)?.kind === 'tab' && tabStop) {
        p.removeChild(r) // tabulations consécutives fusionnées
        continue
      }
      groups.push({ kind: 'tab', run: r })
      continue
    }
    if (!runText(r)) {
      p.removeChild(r)
      continue
    }
    const last = groups.at(-1)
    if (last?.kind === 'txt' && runKey(last.runs[0]) === runKey(r)) last.runs.push(r)
    else groups.push({ kind: 'txt', runs: [r] })
  }
  let txtGroups = groups.filter(g => g.kind === 'txt')
  if (txtGroups.length === 0) { // paragraphe vide : crée un run
    const r = newW(doc, 'r')
    r.appendChild(textElement(doc, ''))
    p.appendChild(r)
    const created = { kind: 'txt' as const, runs: [r] }
    groups = [created]
    txtGroups = [created]
  }
  if (values.length > txtGroups.length) { // surplus concaténé dans le dernier segment
    values = [...values.slice(0, txtGroups.length - 1), values.slice(txtGroups.length - 1).join('')]
  }
  let lastUsed: number | null = null
  groups.forEach((g, gi) => {
    if (g.kind !== 'txt') return
    const k = txtGroups.indexOf(g)
    if (k >= values.length) {
      g.runs.forEach(r => p.removeChild(r))
      return
    }
    const [first, ...rest] = g.runs
    rest.forEach(r => p.removeChild(r))
    childrenW(first, 't').forEach(t => first.removeChild(t))
    childrenW(first, 'tab').forEach(t => first.removeChild(t))
    const parts = values[k].split('\t')
    first.appendChild(textElement(doc, parts[0]))
    let prev = first
    for (const part of parts.slice(1)) {
      const tabRun = first.cloneNode(true) as Element
      childrenW(tabRun, 't').forEach(t => tabRun.removeChild(t))
      tabRun.appendChild(newW(doc, 'tab'))
      const txtRun = first.cloneNode(true) as Element
      childrenW(txtRun, 't').forEach(t => setText(t, part))
      insertAfter(prev, tabRun)
      insertAfter(tabRun, txtRun)
      prev = txtRun
    }
    lastUsed = gi
  })
  // supprime les tabulations orphelines après le dernier segment utilisé
  groups.forEach((g, gi) => {
    if (g.kind === 'tab' && (lastUsed === null || gi > lastUsed) && g.run.parentNode) p.removeChild(g.run)
  })
  if (tabStop && descendantsW(p, 'tab').length > 0) {
    let pPr = childW(p, 'pPr')
    if (!pPr) {
      pPr = newW(doc, 'pPr')
      prependChild(p, pPr)
    }
    const old = childW(pPr, 'tabs')
    if (old) pPr.removeChild(old)
    const pos = typeof tabStop === 'number' ? tabStop : tabStop.pos
    const align = typeof tabStop === 'number' ? 'left' : tabStop.align ?? 'left'
    const tabs = newW(doc, 'tabs')
    const tab = newW(doc, 'tab')
    tab.setAttributeNS(W_NS, 'w:val', align)
    tab.setAttributeNS(W_NS, 'w:pos', String(Math.trunc(pos)))
    tabs.appendChild(tab)
    // ordre du schéma : après pStyle/keepNext/keepLines/pageBreakBefore/numPr…, avant spacing/ind/jc
    const anchor = ['spacing', 'ind', 'jc', 'rPr'].map(name => childW(pPr, name)).find(Boolean)
    if (anchor) pPr.insertBefore(tabs, anchor)
    else pPr.appendChild(tabs)
  }
}

/** Paragraphes porteurs de texte d'un élément (paragraphe ou tableau). */
function textParagraphs(el: Element): Element[] {
  if (isW(el, 'p')) return [el]
  const ps = descendantsW(el, 'p')
  const withText = ps.filter(p => descendantsW(p, 't').map(textOf).join('').trim())
  return withText.length > 0 ? withText : ps.slice(0, 1)
}

/** {champ} remplacé par sa valeur ; [[ … ]] n'est rendu que si tous ses {champs} sont non vides. */
export function fmt(template: string, ctx: Ctx): string {
  const value = (key: string) => String(ctx[key] ?? '')
  const withConditions = template.replace(/\[\[(.*?)\]\]/g, (_, inner: string) => {
    const keys = [...inner.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    return keys.every(k => value(k).trim()) ? inner : ''
  })
  return withConditions.replace(/\{(\w+)\}/g, (_, key: string) => value(key))
}

/** Copie un prototype et remplit ses segments ; pour un tableau, `fields` a une liste de gabarits par paragraphe. */
function instantiate(proto: Element, fields: string[] | string[][], ctx: Ctx, tabStop: TabStop | undefined): Element {
  const el = proto.cloneNode(true) as Element
  const paras = textParagraphs(el)
  const perParagraph = isW(el, 'p') || fields.length === 0 || typeof fields[0] === 'string'
    ? [fields as string[]]
    : (fields as string[][])
  paras.forEach((p, i) => {
    if (i < perParagraph.length) fillParagraph(p, perParagraph[i].map(f => fmt(f, ctx)), tabStop)
    else fillParagraph(p, [''], undefined) // paragraphes de tableau non mappés : vidés
  })
  return el
}

// ---------- insécabilité ----------

function setKeepNext(el: Element, on: boolean) {
  const doc = ownerDoc(el)
  if (isW(el, 'tbl')) {
    for (const tr of descendantsW(el, 'tr')) {
      let trPr = childW(tr, 'trPr')
      if (!trPr) {
        trPr = newW(doc, 'trPr')
        prependChild(tr, trPr)
      }
      if (!childW(trPr, 'cantSplit')) prependChild(trPr, newW(doc, 'cantSplit'))
    }
  }
  for (const p of isW(el, 'p') ? [el] : descendantsW(el, 'p')) {
    let pPr = childW(p, 'pPr')
    if (!pPr) {
      pPr = newW(doc, 'pPr')
      prependChild(p, pPr)
    }
    const keepNext = childW(pPr, 'keepNext')
    if (on && !keepNext) {
      const style = childW(pPr, 'pStyle')
      const node = newW(doc, 'keepNext')
      if (style) insertAfter(style, node)
      else prependChild(pPr, node)
    } else if (!on && keepNext) {
      pPr.removeChild(keepNext)
    }
  }
}

/** keepNext sur tous les éléments du bloc sauf le dernier élément de contenu (les espaceurs ne comptent pas). */
function keepBlockTogether(els: Element[], spacers: WeakSet<Element>) {
  const last = els.filter(e => !spacers.has(e)).at(-1)
  if (!last) return
  for (const e of els) {
    if (e === last) {
      if (isW(e, 'tbl')) { // tableau : lignes insécables, keepNext dans les cellules sauf la dernière ligne
        setKeepNext(e, true)
        const lastRow = childrenW(e, 'tr').at(-1)
        if (lastRow) for (const p of descendantsW(lastRow, 'p')) setKeepNext(p, false)
      }
      break
    }
    setKeepNext(e, true)
  }
}

// ---------- construction ----------

class Builder {
  readonly spacers = new WeakSet<Element>()
  readonly labels: Record<string, string>
  private readonly fields: Record<string, string[] | string[][]>

  constructor(private readonly doc: Document, private readonly protos: Map<string, Element>, private readonly map: TemplateMap, lang: CvLang) {
    this.fields = { ...map.fields }
    this.labels = map.labels?.[lang] ?? {}
  }

  make(name: string, ctx: Ctx): Element {
    const proto = this.protos.get(name)
    if (!proto) {
      // repli : environnement rendu avec le prototype du contexte
      const contextProto = this.protos.get('exp_context')
      if (name === 'exp_env' && contextProto) return instantiate(contextProto, ['{env_label}{environnement}'], ctx, undefined)
      throw new Error(`Prototype manquant dans template_map.json : ${name}`)
    }
    const tabStop = this.map.tab_stop_on?.includes(name) ? this.map.tab_stop : undefined
    return instantiate(proto, this.fields[name] ?? ['{text}'], ctx, tabStop)
  }

  spacer(protoName: string): Element {
    const proto = this.protos.get(protoName)
    const e = proto ? (proto.cloneNode(true) as Element) : newW(this.doc, 'p')
    this.spacers.add(e)
    return e
  }

  /**
   * tokens : 'proto', 'proto*' (une instance par élément de liste), 'spacer' ou 'spacer:proto' (espaceur cloné depuis
   * ce prototype). Un token sans donnée est sauté, ainsi que le 'spacer' qui le suit s'il ferait doublon.
   */
  layout(tokens: string[], ctx: Ctx, lists: Record<string, unknown[]>): Element[] {
    const els: Element[] = []
    let skipSpacer = false
    for (const tok of tokens) {
      if (tok === 'spacer' || tok.startsWith('spacer:')) {
        if (!skipSpacer) els.push(this.spacer(tok.includes(':') ? tok.slice(tok.indexOf(':') + 1) : 'spacer'))
        skipSpacer = false
        continue
      }
      const name = tok.replace(/\*+$/, '')
      const redundant = els.length === 0 || this.spacers.has(els[els.length - 1])
      if (tok.endsWith('*')) {
        const items = lists[name] ?? []
        if (items.length === 0) {
          skipSpacer = redundant
          continue
        }
        for (const item of items) els.push(this.make(name, { ...ctx, text: item }))
      } else {
        const required = this.map.requires?.[name]
        if (required && !ctx[required]) {
          skipSpacer = redundant
          continue
        }
        els.push(this.make(name, ctx))
      }
      skipSpacer = false
    }
    return els
  }

  sectionTitle(key: string): Element[] {
    const label = this.labels[key]
    const name = this.protos.has(`section_${key}`) ? `section_${key}` : 'section'
    if (label === undefined || !this.protos.has(name)) return [] // section sans libellé : pas de titre
    return [this.make(name, { text: label, label })]
  }
}

const DEFAULT_SECTIONS = ['identity', 'summary', 'experiences', 'education', 'certifications', 'languages', 'skills']
const SECTION_DATA_KEY: Record<string, keyof CvData> = {
  experiences: 'experiences', education: 'formations', certifications: 'certifications', languages: 'langues', skills: 'competences',
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function resolveFixedPath(children: Element[], path: number[]): Element {
  let el: Element | undefined = children[path[0]]
  if (el && path.length === 4) {
    const [, row, cell, para] = path
    const tr = childrenW(el, 'tr')[row]
    const tc = tr ? childrenW(tr, 'tc')[cell] : undefined
    el = tc ? descendantsW(tc, 'p')[para] : undefined
  } else if (el && path.length === 2) {
    el = selfAndDescendantsW(el, 'p')[path[1]]
  }
  if (!el) throw new Error(`Chemin « fixed » introuvable dans le template : [${path.join(', ')}]`)
  return el
}

function buildBody(doc: Document, map: TemplateMap, data: CvData, lang: CvLang) {
  const body = childW(doc.documentElement as Element, 'body')
  if (!body) throw new Error('Template Word sans corps de document (w:body)')
  const children = elements(body)
  const lastChild = children.at(-1)
  const sect = isW(lastChild, 'sectPr') ? lastChild : null
  const start = map.body_start
  const end = map.body_end || children.length - (sect ? 1 : 0)
  const protos = new Map<string, Element>()
  for (const [name, index] of Object.entries(map.protos)) {
    if (index === null) continue
    const el = children[index]
    if (!el) throw new Error(`Prototype « ${name} » : index ${index} hors du template`)
    protos.set(name, el.cloneNode(true) as Element)
  }
  const anchor = end < children.length ? children[end] : null
  // champs fixes dans la zone conservée (ex. identité dans un tableau d'en-tête), repérés avant la reconstruction
  const fixed = (map.fixed ?? []).map(fx => ({ el: resolveFixedPath(children, fx.path), fields: fx.fields }))
  for (const c of children.slice(start, end)) body.removeChild(c)

  const B = new Builder(doc, protos, map, lang)
  const L = map.layouts ?? {}
  const record = data as unknown as Record<string, unknown>
  const ctx0: Ctx = Object.fromEntries(Object.entries(record).filter(([, v]) => typeof v === 'string'))
  ctx0.identity = fmt(map.identity_format ?? '{identifiant}', ctx0)
  ctx0.env_label = B.labels.environment ?? (lang === 'fr' ? 'Environnement : ' : 'Environment: ')
  for (const [k, v] of Object.entries(B.labels)) ctx0[`lbl_${k}`] = v
  // listes jointes en une ligne (ex. toutes les langues dans un seul paragraphe)
  for (const [name, join] of Object.entries(map.joins ?? {})) {
    ctx0[name] = asList(record[join.list])
      .map(item => (isRecord(item) ? fmt(join.item, { ...ctx0, ...item }) : String(item)))
      .join(join.sep ?? ', ')
  }

  const blocks: { els: Element[]; together: boolean }[] = []
  for (const sec of map.sections ?? DEFAULT_SECTIONS) {
    if (typeof sec !== 'string') { // bloc libre rendu une fois : {"layout": [...], "keep_with_previous": true}
      const els = B.layout(sec.layout, ctx0, {})
      const previous = blocks.at(-1)
      if (sec.keep_with_previous && previous) previous.els.forEach(e => setKeepNext(e, true))
      blocks.push({ els, together: !!sec.together })
      continue
    }
    if (sec === 'identity') {
      blocks.push({ els: B.layout(L.identity ?? ['identity', 'spacer'], ctx0, {}), together: false })
    } else if (sec === 'summary' && data.resume.length > 0) {
      const title = B.sectionTitle('summary')
      const els = data.resume.flatMap(text => B.layout(L.summary_item ?? ['summary', 'spacer'], { ...ctx0, text }, {}))
      if (title.length > 0) {
        setKeepNext(title[0], true)
        blocks.push({ els: title, together: false })
      }
      blocks.push({ els, together: false })
    } else if (sec in SECTION_DATA_KEY) {
      const items = asList(record[SECTION_DATA_KEY[sec]]).filter(isRecord)
      if (items.length === 0) continue
      const itemLayout = L[`${sec}_item`]
      if (!itemLayout) throw new Error(`template_map.json : layout « ${sec}_item » manquant`)
      let title = B.sectionTitle(sec)
      title = [...title, ...B.layout(L[`${sec}_head`] ?? (title.length > 0 ? ['spacer'] : []), ctx0, {})]
      let first = true
      for (const item of items) {
        const ctx: Ctx = { ...ctx0 }
        const lists: Record<string, unknown[]> = {}
        for (const [k, v] of Object.entries(item)) {
          if (typeof v === 'string') ctx[k] = v
          else if (Array.isArray(v)) lists[k] = v
        }
        for (const [k, v] of Object.entries(lists)) ctx[`${k}_joined`] = v.map(String).join(', ')
        // alias de listes courants
        lists.exp_role ??= asList(item.role_lignes)
        lists.exp_bullet ??= asList(item.realisations)
        lists.edu_detail ??= [...(item.etablissement ? [item.etablissement] : []), ...asList(item.details)]
        lists.cert_detail ??= item.organisme ? [item.organisme] : []
        let els = B.layout(itemLayout, ctx, lists)
        if (first && title.length > 0) {
          els = [...title, ...els]
          first = false
        }
        blocks.push({ els, together: true })
      }
      const tail = L[`${sec}_tail`] ?? []
      if (tail.length > 0) blocks.push({ els: B.layout(tail, ctx0, {}), together: false })
    }
  }

  // pas d'espaceur en toute fin de document : il peut à lui seul créer une page blanche
  if (!map.body_end) {
    while (blocks.length > 0) {
      const els = blocks[blocks.length - 1].els
      while (els.length > 0 && B.spacers.has(els[els.length - 1])) els.pop()
      if (els.length > 0) break
      blocks.pop()
    }
  }

  for (const { els, together } of blocks) {
    if (together) keepBlockTogether(els, B.spacers)
    for (const e of els) {
      if (anchor) body.insertBefore(e, anchor)
      else if (sect) body.insertBefore(e, sect)
      else body.appendChild(e)
    }
  }
  for (const fx of fixed) fillParagraph(fx.el, fx.fields.map(f => fmt(f, ctx0)), undefined)
  return ctx0
}

// ---------- nettoyage du paquet ----------

// Parties qui ne portent que des commentaires / auteurs : supprimées du paquet.
const DROP_PARTS = ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml', 'word/people.xml']
const STORY_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/
const HEADER_FOOTER_PART = /^word\/(header|footer)\d*\.xml$/

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Accepte les révisions et retire les commentaires d'une partie Word (corps, en-tête, pied) : texte supprimé
 * (souvent l'ancien candidat) retiré, texte inséré conservé, historique de mise en forme et ancres de commentaires
 * supprimés, auteurs restants remplacés par le nom de l'ESN.
 */
function cleanStory(doc: Document, esn: string) {
  const root = doc.documentElement as Element
  for (const tag of ['del', 'moveFrom', 'commentRangeStart', 'commentRangeEnd', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) {
    descendantsW(root, tag).forEach(detach)
  }
  for (const ref of descendantsW(root, 'commentReference')) {
    const run = parentOf(ref) as Element
    run.removeChild(ref)
    if (isW(run, 'r') && elements(run).every(c => isW(c, 'rPr'))) detach(run)
  }
  for (const tag of ['ins', 'moveTo']) {
    for (const el of descendantsW(root, tag)) {
      const parent = el.parentNode
      if (!parent) continue
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
  }
  for (const tag of ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'tblPrExChange', 'numberingChange']) {
    descendantsW(root, tag).forEach(detach)
  }
  for (const el of [root, ...descendantsAll(root)]) {
    if (el.hasAttributeNS(W_NS, 'author')) el.setAttributeNS(W_NS, 'w:author', esn)
    if (el.hasAttributeNS(W_NS, 'initials')) el.setAttributeNS(W_NS, 'w:initials', '')
  }
}

function descendantsAll(el: Element): Element[] {
  return elements(el).flatMap(c => [c, ...descendantsAll(c)])
}

function setCoreProperties(doc: Document, esn: string) {
  const root = doc.documentElement as Element
  const set = (ns: string, qualifiedName: string, value: string, create: boolean) => {
    const local = qualifiedName.split(':')[1]
    let el = elements(root).find(c => c.namespaceURI === ns && c.localName === local)
    if (!el && create) el = root.appendChild(doc.createElementNS(ns, qualifiedName)) as Element
    if (el) setText(el, value)
  }
  set(DC_NS, 'dc:creator', esn, true)
  set(CP_NS, 'cp:lastModifiedBy', esn, true)
  for (const [ns, name] of [[DC_NS, 'dc:title'], [DC_NS, 'dc:subject'], [CP_NS, 'cp:keywords'], [DC_NS, 'dc:description'], [CP_NS, 'cp:category']]) {
    set(ns, name, '', false)
  }
}

const EMPTY_CUSTOM_PROPERTIES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
  + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"/>'

/**
 * Nettoie le paquet de ce que le template peut avoir laissé : propriétés personnalisées, titre / société, commentaires,
 * modèle Word d'origine (chemin local, qui porte souvent le nom de session Windows de son auteur).
 */
function scrubPackage(files: Unzipped, esn: string) {
  for (const part of DROP_PARTS) delete files[part]
  if (files['docProps/custom.xml']) files['docProps/custom.xml'] = strToU8(EMPTY_CUSTOM_PROPERTIES)
  if (files['docProps/app.xml']) {
    files['docProps/app.xml'] = strToU8(strFromU8(files['docProps/app.xml'])
      .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/g, '')
      .replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/g, '')
      .replace(/<Company>[\s\S]*?<\/Company>/g, '<Company></Company>')
      .replace(/<Template>[\s\S]*?<\/Template>/g, '<Template></Template>')
      .replace(/<Manager>[\s\S]*?<\/Manager>/g, ''))
  }
  if (files['word/settings.xml']) {
    files['word/settings.xml'] = strToU8(strFromU8(files['word/settings.xml']).replace(/<w:attachedTemplate\b[^>]*\/>/g, ''))
  }
  if (files['word/_rels/settings.xml.rels']) {
    files['word/_rels/settings.xml.rels'] = strToU8(strFromU8(files['word/_rels/settings.xml.rels'])
      .replace(/<Relationship\b[^>]*Type="[^"]*\/attachedTemplate"[^>]*\/>/g, ''))
  }
  if (files['[Content_Types].xml']) {
    let txt = strFromU8(files['[Content_Types].xml'])
    for (const part of DROP_PARTS) txt = txt.replace(new RegExp(`<Override[^>]*PartName="/${escapeRegExp(part)}"[^>]*/>`, 'g'), '')
    files['[Content_Types].xml'] = strToU8(txt)
  }
  if (files['word/_rels/document.xml.rels']) {
    let txt = strFromU8(files['word/_rels/document.xml.rels'])
    for (const part of DROP_PARTS) txt = txt.replace(new RegExp(`<Relationship[^>]*Target="${escapeRegExp(part.split('/')[1])}"[^>]*/>`, 'g'), '')
    files['word/_rels/document.xml.rels'] = strToU8(txt)
  }
  for (const name of Object.keys(files)) {
    if (!STORY_PART.test(name) || name === 'word/document.xml') continue // le corps est nettoyé avant sa sérialisation
    const doc = parseXml(files[name])
    cleanStory(doc, esn)
    files[name] = serializeXml(doc)
  }
}

function replaceInHeadersFooters(files: Unzipped, replacements: [string, string][]) {
  if (replacements.length === 0) return
  for (const name of Object.keys(files)) {
    if (!HEADER_FOOTER_PART.test(name)) continue
    const doc = parseXml(files[name])
    for (const t of descendantsW(doc.documentElement as Element, 't')) {
      let text = textOf(t)
      for (const [from, to] of replacements) if (text.includes(from)) text = text.split(from).join(to)
      if (text !== textOf(t)) setText(t, text)
    }
    files[name] = serializeXml(doc)
  }
}

// Tailles décompressées maximales d'un modèle, et de chacune de ses parties XML (le modèle Wise : 28 Ko pour le corps,
// 77 Ko pour les styles). fflate réserve la mémoire de chaque fichier d'après sa taille annoncée : borner ces tailles
// avant toute décompression arrête une archive piégée (y compris ZIP64). Au dépôt, zipFitsWithin a vérifié que les
// tailles annoncées sont les tailles réelles.
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024
const MAX_XML_PART_BYTES = 5 * 1024 * 1024

function unzipTemplate(template: Uint8Array): Unzipped {
  let total = 0
  return unzipSync(template, {
    filter: file => {
      total += file.originalSize
      if (total > MAX_UNZIPPED_BYTES) throw new TemplateStructureError('Modèle Word trop volumineux une fois décompressé (50 Mo au plus).')
      if (/\.(xml|rels)$/.test(file.name) && file.originalSize > MAX_XML_PART_BYTES) {
        throw new TemplateStructureError(`Partie ${file.name} du modèle Word trop volumineuse (5 Mo au plus).`)
      }
      return true
    },
  })
}

/** Construit le .docx du CV : template de l'ESN + cartographie + données (déjà anonymisées) d'une langue. */
export function renderCv(template: Uint8Array, map: TemplateMap, data: CvData, lang: CvLang): Uint8Array {
  const files = unzipTemplate(template)
  assertBoundedStructure(files)
  const documentXml = files['word/document.xml']
  if (!documentXml) throw new Error('Template Word invalide : word/document.xml absent')
  const doc = parseXml(documentXml)
  const ctx0 = buildBody(doc, map, data, lang)
  cleanStory(doc, map.esn)
  files['word/document.xml'] = serializeXml(doc)

  // en-têtes / pieds de page : remplacements (ex. « Page 1 sur 5 » → « Page 1 of 5 »)
  const replacements = { ...map.header_footer_replacements, ...map[`header_footer_replacements_${lang}`] }
  replaceInHeadersFooters(files, Object.entries(replacements).map(([from, to]) => [from, fmt(to, ctx0)]))

  if (files['docProps/core.xml']) {
    const core = parseXml(files['docProps/core.xml'])
    setCoreProperties(core, map.esn)
    files['docProps/core.xml'] = serializeXml(core)
  }
  scrubPackage(files, map.esn)
  return zipSync(files, { level: 6 })
}
