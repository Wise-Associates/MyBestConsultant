import type { CSSProperties } from 'react'
import { Building2, CalendarClock, ListChecks, UserCheck, type LucideIcon } from 'lucide-react'
import { parseDescription, type DescriptionBlock, type DescriptionSection, type SectionKind } from '@/lib/description-sections'
import { BRAND } from './labels'

// Description d'une offre AO lue par l'admin : les missions demandées et le profil attendu sont
// mis en avant (cartes), le contexte et les modalités restent en texte simple, aéré.

const SECTION_UI: Record<SectionKind, { icon?: LucideIcon; highlight: boolean; card?: CSSProperties }> = {
  context: { icon: Building2, highlight: false },
  tasks: { icon: ListChecks, highlight: true, card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' } },
  // Orange de la marque à 6 % (fond) et 20 % (bordure) : le profil est ce que l'admin compare aux consultants.
  profile: { icon: UserCheck, highlight: true, card: { background: `${BRAND}0F`, border: `1px solid ${BRAND}33`, borderLeft: `3px solid ${BRAND}` } },
  terms: { icon: CalendarClock, highlight: false },
  other: { highlight: false },
}

/** Libellé court en tête de ligne (« Rémunération : … ») : mis en gras pour la lecture en diagonale. */
const LEAD_LABEL = /^([^:]{2,40}?)\s*:\s+(.+)$/

export function AoDescription({ text }: { text: string }) {
  const sections = parseDescription(text)
  if (sections.length === 0) return <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>—</p>
  return <div className="space-y-4">{sections.map((s, i) => <Section key={i} section={s} />)}</div>
}

function Section({ section }: { section: DescriptionSection }) {
  const { icon: Icon, highlight, card } = SECTION_UI[section.kind]
  return (
    <div className={card ? 'rounded-xl p-4 space-y-2.5' : 'space-y-2.5'} style={card}>
      {section.title && (
        // Taille en ligne : la règle globale `h3` (globals.css, hors couche) l'emporte sur `text-sm`.
        <h3 className="flex items-center gap-2 text-white" style={{ fontSize: 15, fontWeight: 600 }}>
          {Icon && <Icon size={15} aria-hidden style={{ color: highlight ? BRAND : 'rgba(255,255,255,0.45)' }} />}
          {section.title}
        </h3>
      )}
      {section.blocks.map((block, i) => <Block key={i} block={block} highlight={highlight} />)}
    </div>
  )
}

function Block({ block, highlight }: { block: DescriptionBlock; highlight: boolean }) {
  const color = highlight ? 'rgba(255,255,255,0.87)' : 'rgba(255,255,255,0.75)'
  if (block.type === 'paragraph') {
    return <p className="text-sm leading-relaxed" style={{ color, maxWidth: '75ch' }}><Inline text={block.text} /></p>
  }
  return (
    <ul className="space-y-1.5">
      {block.items.map((item, i) => {
        const lead = LEAD_LABEL.exec(item)
        const labelled = lead && lead[1].split(/\s+/).length <= 3
        return (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed" style={{ color }}>
            <span aria-hidden className="shrink-0 rounded-full" style={{ width: 5, height: 5, marginTop: 9, background: highlight ? BRAND : 'rgba(255,255,255,0.3)' }} />
            <span>{labelled ? <><Strong>{lead[1].replace(/\*\*/g, '')}</Strong> : <Inline text={lead[2]} /></> : <Inline text={item} />}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** « **gras** » et « *italique* » écrits par l'IA. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => {
        if (i % 2 === 0) return part
        return part.startsWith('**') ? <Strong key={i}>{part.slice(2, -2)}</Strong> : <em key={i}>{part.slice(1, -1)}</em>
      })}
    </>
  )
}

function Strong({ children }: { children: string }) {
  return <strong className="font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>{children}</strong>
}
