'use client'

import { Plus } from 'lucide-react'
import { control, fieldLabel, optionStyle, secondaryButton } from '@/app/admin/candidats/labels'
import { BUILTIN_SOURCES, type VeilleConfig, type VeilleSource } from '@/lib/veille/config'
import { ConfirmDelete, Switch, TextField, TokensField, freeKey } from './fields'

type CspSource = Extract<VeilleSource, { kind: 'csp' }>
type RssSource = Extract<VeilleSource, { kind: 'rss' }>

const DELETE_WARNING = 'Ses offres déjà vues restent retenues ; recréée sous un autre identifiant, la source renverrait toutes ses offres en ligne.'

interface Props {
  config: VeilleConfig
  onChange: (config: VeilleConfig) => void
  /** Sources déjà enregistrées : leur identifiant (clé d'état du scanner) ne change plus. */
  savedIds: Set<string>
}

export function SourcesTab({ config, onChange, savedIds }: Props) {
  const sources = config.sources
  const organisationName = new Map(config.organisations.map(o => [o.id, o.name]))
  const disabledOrganisations = new Set(config.organisations.filter(o => !o.enabled).map(o => o.id))
  const taken = new Set(sources.map(s => s.id))

  const setSources = (next: VeilleSource[]) => onChange({ ...config, sources: next })
  const update = (index: number, patch: Partial<VeilleSource>) =>
    setSources(sources.map((s, i) => (i === index ? ({ ...s, ...patch } as VeilleSource) : s)))
  const remove = (index: number) => setSources(sources.filter((_, i) => i !== index))
  const firstOrganisation = config.organisations[0]

  const indexed = sources.map((source, index) => ({ source, index }))
  const fixed = indexed.filter(({ source }) => source.kind === 'boamp' || source.kind === 'ted' || source.kind === 'builtin')
  const csp = indexed.filter((x): x is { source: CspSource; index: number } => x.source.kind === 'csp')
  const rss = indexed.filter((x): x is { source: RssSource; index: number } => x.source.kind === 'rss')

  const organisationSelect = (id: string, value: string, onSelect: (organisationId: string) => void) => (
    <div>
      <label htmlFor={id} style={{ ...fieldLabel, display: 'block' }}>Organisme (client des offres)</label>
      <select id={id} value={value} onChange={e => onSelect(e.target.value)} style={{ ...control, width: '100%' }}>
        {config.organisations.map(o => <option key={o.id} value={o.id} style={optionStyle}>{o.name}</option>)}
      </select>
    </div>
  )
  const idLine = (source: VeilleSource, index: number) => savedIds.has(source.id)
    ? <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>Identifiant <code className="font-mono">{source.id}</code> (fixé)</p>
    : <TextField id={`src-${index}-id`} label="Identifiant" value={source.id} mono onChange={id => update(index, { id })}
        hint="Minuscules, chiffres et tirets ; fixé à l'enregistrement (clé du scanner)." />
  const inactiveOrganisation = (organisationId: string) => disabledOrganisations.has(organisationId) && (
    <p className="text-xs" style={{ color: '#b45309' }}>Organisme désactivé : cette source n&apos;est pas lue.</p>
  )

  return (
    <div className="space-y-8">
      <Section title="Marchés publics et sites intégrés" note="Lus par un code propre à chaque site : ils se désactivent, mais ne se suppriment pas.">
        <ul className="divide-y" style={{ borderColor: 'var(--admin-line)' }}>
          {fixed.map(({ source, index }) => {
            const builtin = source.kind === 'builtin' ? BUILTIN_SOURCES[source.id] : null
            const label = source.kind === 'boamp' ? 'BOAMP (appels d\'offres)' : source.kind === 'ted' ? 'TED, Journal officiel de l\'UE (appels d\'offres)' : builtin?.label ?? source.id
            const description = builtin
              ? `Offres d'emploi de ${organisationName.get(builtin.organisationId) ?? builtin.organisationId}.`
              : 'Avis des organismes suivis, reconnus par leurs règles (onglet Organismes).'
            return (
              <li key={source.id} className="py-3" style={{ borderColor: 'var(--admin-line)' }}>
                <Switch id={`src-${index}-enabled`} label={label} description={description} checked={source.enabled} onChange={enabled => update(index, { enabled })} />
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Choisir le service public" note="Offres d'emploi de la fonction publique, par code d'organisme : le nombre dans l'adresse …/nos-offres/filtres/organisme/<code>/ du site.">
        {csp.map(({ source, index }) => (
          <Card key={index}>
            <div className="grid gap-3 md:grid-cols-3">
              <TextField id={`src-${index}-label`} label="Libellé" value={source.label} onChange={label => update(index, { label })} />
              {organisationSelect(`src-${index}-org`, source.organisationId, organisationId => update(index, { organisationId }))}
              <TokensField id={`src-${index}-codes`} label="Codes d'organisme" value={source.codes} onChange={codes => update(index, { codes })} placeholder="974" />
            </div>
            <CardFooter source={source} index={index} idLine={idLine(source, index)} warning={inactiveOrganisation(source.organisationId)}
              onToggle={enabled => update(index, { enabled })} onRemove={() => remove(index)} />
          </Card>
        ))}
        {firstOrganisation && (
          <button type="button" style={{ ...secondaryButton, padding: '8px 12px', fontSize: 13 }} onClick={() => setSources([...sources, {
            kind: 'csp', id: freeKey(`csp-${firstOrganisation.id}`, taken), enabled: true, organisationId: firstOrganisation.id,
            label: `Choisir le service public — ${firstOrganisation.name}`, codes: [],
          }])}>
            <Plus size={14} aria-hidden /> Ajouter un organisme de Choisir le service public
          </button>
        )}
      </Section>

      <Section title="Sites carrières (flux RSS)"
        note="Flux RSS 2.0 officiel du site carrières d'un organisme, en https (les flux Atom ne sont pas lus). Les liens des offres doivent rester sur le site du flux (sinon la lecture s'arrête, contre l'hameçonnage). Respectez les conditions d'usage du site (ADR 0001 du scanner).">
        {rss.map(({ source, index }) => (
          <Card key={index}>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField id={`src-${index}-label`} label="Libellé" value={source.label} onChange={label => update(index, { label })} />
              {organisationSelect(`src-${index}-org`, source.organisationId, organisationId => update(index, { organisationId }))}
            </div>
            <TextField id={`src-${index}-url`} label="Adresse du flux" value={source.url} mono onChange={url => update(index, { url })} placeholder="https://carrieres.exemple.fr/feed/" />
            <Switch id={`src-${index}-page`} label="Lire la page de chaque offre"
              description="Quand le flux ne donne que le titre : texte, lieu et date limite lus dans les données JobPosting (schema.org) de la page."
              checked={source.readOfferPage} onChange={readOfferPage => update(index, { readOfferPage })} />
            <CardFooter source={source} index={index} idLine={idLine(source, index)} warning={inactiveOrganisation(source.organisationId)}
              onToggle={enabled => update(index, { enabled })} onRemove={() => remove(index)} />
          </Card>
        ))}
        {firstOrganisation && (
          <button type="button" style={{ ...secondaryButton, padding: '8px 12px', fontSize: 13 }} onClick={() => setSources([...sources, {
            kind: 'rss', id: freeKey(`${firstOrganisation.id}-carrieres`, taken), enabled: true, organisationId: firstOrganisation.id,
            label: `${firstOrganisation.name} — site carrières`, url: '', readOfferPage: false,
          }])}>
            <Plus size={14} aria-hidden /> Ajouter un flux
          </button>
        )}
      </Section>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-admin-fg">{title}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--admin-fg-muted)' }}>{note}</p>
      </div>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-xl p-4" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>{children}</div>
}

function CardFooter({ source, index, idLine, warning, onToggle, onRemove }: {
  source: CspSource | RssSource; index: number; idLine: React.ReactNode; warning: React.ReactNode; onToggle: (enabled: boolean) => void; onRemove: () => void
}) {
  return (
    <div className="space-y-2 pt-1">
      {warning}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <Switch id={`src-${index}-enabled`} label="Lue" checked={source.enabled} onChange={onToggle} />
          {idLine}
        </div>
        <ConfirmDelete label="Supprimer" warning={DELETE_WARNING} onConfirm={onRemove} />
      </div>
    </div>
  )
}
