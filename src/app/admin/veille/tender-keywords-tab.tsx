'use client'

import { ChevronRight, Plus } from 'lucide-react'
import { secondaryButton } from '@/app/admin/candidats/labels'
import type { VeilleConfig, VeilleKeywordFamily, VeilleTenderKeywords } from '@/lib/veille/config'
import { ConfirmDelete, LinesField, Switch, TextField, TokensField, freeKey } from './fields'

// Mots-clés des appels d'offres (ADR 0006 du scanner) : ils l'emportent sur la classification d'un avis et servent à
// chercher chez tous les acheteurs. Le scanner fait une recherche par famille dans l'intitulé des avis du BOAMP et de
// TED, puis vérifie les expressions exactes dans l'intitulé et la description.

const muted = { color: 'var(--admin-fg-muted)' }

export function TenderKeywordsTab({ config, onChange }: { config: VeilleConfig; onChange: (config: VeilleConfig) => void }) {
  const keywords = config.tenderKeywords
  const update = (patch: Partial<VeilleTenderKeywords>) => onChange({ ...config, tenderKeywords: { ...keywords, ...patch } })
  const setFamily = (index: number, patch: Partial<VeilleKeywordFamily>) =>
    update({ families: keywords.families.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
  const taken = new Set(keywords.families.map(f => f.id))

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm" style={muted}>
          Un appel d&apos;offres dont l&apos;intitulé ou la description contient l&apos;un de ces mots-clés est envoyé, même classé hors
          informatique (un projet de digitalisation est souvent classé « conseil »). Une exclusion du filtre informatique (« travaux »)
          dans l&apos;intitulé l&apos;emporte.
        </p>
        <Switch id="kw-all-buyers" label="Chercher aussi chez tous les acheteurs (BOAMP et TED)" checked={keywords.allBuyers}
          onChange={allBuyers => update({ allBuyers })}
          description="Avis de tout acheteur public dont l'intitulé contient un mot-clé, ou classés informatique : envoyés sous « Autres acheteurs », avec l'acheteur comme client. Quelques dizaines d'avis par jour, chacun lu par l'IA de la boîte AO. Désactivé : seuls les organismes suivis." />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-admin-fg">Familles de mots-clés</h2>
          <p className="text-sm mt-0.5" style={muted}>
            Une recherche par famille. Comparaison sans accents ni majuscules ; « * » en fin de mot accepte la suite du mot (« logiciel* » :
            logiciels, logicielle). Évitez les mots seuls larges : « refonte », « reporting » ou « assistance à maîtrise d&apos;ouvrage » ramènent
            surtout de la communication, des formations ou du bâtiment ; préférez une expression (« refonte du site », « outil de reporting »).
          </p>
        </div>
        {keywords.families.map((family, index) => (
          <details key={family.id} className="group rounded-xl" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F97316] rounded-xl">
              <ChevronRight size={15} className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" style={muted} aria-hidden />
              <span className="font-medium text-admin-fg">{family.label || 'Famille sans libellé'}</span>
              <span className="text-xs" style={muted}>
                {countOf(family.phrases)} expression{countOf(family.phrases) > 1 ? 's' : ''}, {countOf(family.acronyms)} sigle{countOf(family.acronyms) > 1 ? 's' : ''}
              </span>
            </summary>
            <div className="space-y-3 px-4 pb-4">
              <TextField id={`kw-${index}-label`} label="Libellé" value={family.label} onChange={label => setFamily(index, { label })} />
              <LinesField id={`kw-${index}-phrases`} label="Expressions" value={family.phrases} rows={8} onChange={phrases => setFamily(index, { phrases })} />
              <TokensField id={`kw-${index}-acronyms`} label="Sigles" value={family.acronyms} onChange={acronyms => setFamily(index, { acronyms })} placeholder="TMA, API"
                hint="Reconnus seulement écrits en majuscules. Ceux de deux lettres (IA, BI) ne sont cherchés qu'au BOAMP : TED les ignore." />
              <div className="flex justify-end">
                <ConfirmDelete label="Supprimer la famille" warning="Ses mots-clés ne seront plus cherchés."
                  onConfirm={() => update({ families: keywords.families.filter((_, i) => i !== index) })} />
              </div>
            </div>
          </details>
        ))}
        <button type="button" style={{ ...secondaryButton, padding: '8px 12px', fontSize: 13 }}
          onClick={() => update({ families: [...keywords.families, { id: freeKey('famille', taken), label: 'Nouvelle famille', phrases: [], acronyms: [] }] })}>
          <Plus size={14} aria-hidden /> Ajouter une famille
        </button>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-admin-fg">Infrastructure seule</h2>
          <p className="text-sm mt-0.5" style={muted}>
            Un avis classé informatique (CPV 72 comprend aussi les réseaux et l&apos;hébergement) dont l&apos;intitulé contient l&apos;une de ces
            expressions est écarté, sauf s&apos;il contient aussi un mot-clé.
          </p>
        </div>
        <LinesField id="kw-infrastructure" label="Expressions" value={keywords.infrastructurePhrases} rows={6}
          onChange={infrastructurePhrases => update({ infrastructurePhrases })} />
      </section>
    </div>
  )
}

/** Valeurs saisies non vides (les lignes vides sont retirées à l'enregistrement). */
const countOf = (values: string[]) => values.filter(v => v.trim()).length
