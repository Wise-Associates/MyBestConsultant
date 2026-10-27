'use client'

import type { VeilleConfig, VeilleItScope } from '@/lib/veille/config'
import { LinesField, Switch, TokensField } from './fields'

// Périmètre informatique du scanner (src/it-scope.ts, ADR 0004 du scanner) : appels d'offres jugés sur leurs mots-clés
// (onglet « Mots-clés des appels d'offres ») puis leur classification (CPV, descripteurs BOAMP), offres d'emploi sur leur
// intitulé et leur catégorie.

export function ItScopeTab({ config, onChange }: { config: VeilleConfig; onChange: (config: VeilleConfig) => void }) {
  const scope = config.itScope
  const update = (patch: Partial<VeilleItScope>) => onChange({ ...config, itScope: { ...scope, ...patch } })
  const muted = { color: 'var(--admin-fg-muted)' }
  return (
    <div className="space-y-6">
      <Switch id="it-enabled" label="N'envoyer que les offres informatiques" checked={scope.enabled} onChange={enabled => update({ enabled })}
        description="Désactivé : toutes les offres des organismes suivis partent vers la boîte AO. Une offre écartée est retenue comme vue : élargir le filtre ne renvoie pas les offres déjà écartées." />
      <fieldset disabled={!scope.enabled} className="space-y-6" style={{ opacity: scope.enabled ? 1 : 0.55 }}>
        <section className="space-y-3">
          <h2 className="text-base font-bold text-admin-fg">Appels d&apos;offres</h2>
          <p className="text-sm" style={muted}>
            Retenus si deux indices concordent : le code CPV principal de l&apos;avis commence par l&apos;un de ces préfixes (sans code CPV, le
            BOAMP lui donne l&apos;un de ces descripteurs), et son intitulé contient un mot-clé des appels d&apos;offres (onglet suivant) ou, pour un
            organisme suivi, une expression ou un sigle ci-dessous. Les codes CPV secondaires ne comptent pas. Un avis sans aucune classification
            n&apos;est retenu que pour un organisme suivi, sur son intitulé.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <TokensField id="it-cpv" label="Préfixes CPV" value={scope.cpvPrefixes} onChange={cpvPrefixes => update({ cpvPrefixes })} placeholder="72, 48"
              hint="72 : services informatiques ; 48 : logiciels et systèmes d'information." />
            <LinesField id="it-descriptors" label="Descripteurs BOAMP" value={scope.boampDescriptors} rows={3} onChange={boampDescriptors => update({ boampDescriptors })}
              hint="Tels qu'affichés par le BOAMP, un par ligne." />
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-bold text-admin-fg">Offres d&apos;emploi (et intitulés des avis des organismes suivis)</h2>
          <p className="text-sm" style={muted}>
            Retenues si leur intitulé ou leur catégorie contient une expression ou un sigle, sauf si une exclusion s&apos;y trouve.
            Comparaison sans accents ni majuscules ; « * » en fin de mot accepte la suite du mot (« développeur* » : développeuse, développeurs…).
            Évitez les mots seuls ambigus (« réseau », « architecte ») : écrivez-les dans une expression (« architecte logiciel »).
          </p>
          <LinesField id="it-phrases" label="Expressions" value={scope.phrases} rows={12} onChange={phrases => update({ phrases })} />
          <div className="grid gap-4 md:grid-cols-2">
            <TokensField id="it-acronyms" label="Sigles" value={scope.acronyms} onChange={acronyms => update({ acronyms })} placeholder="SI, DSI, ERP"
              hint="Reconnus seulement écrits en majuscules (« SI », pas « si »)." />
            <LinesField id="it-exclusions" label="Exclusions" value={scope.exclusionPhrases} rows={3} onChange={exclusionPhrases => update({ exclusionPhrases })}
              hint="L'emportent sur les expressions et sigles (bâtiment : « travaux »)." />
          </div>
        </section>
      </fieldset>
    </div>
  )
}
