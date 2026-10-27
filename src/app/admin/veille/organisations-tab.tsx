'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { secondaryButton } from '@/app/admin/candidats/labels'
import { BUILTIN_SOURCES, type VeilleConfig, type VeilleOrganisation } from '@/lib/veille/config'
import { ConfirmDelete, LinesField, Switch, TextField, TokensField, freeKey, toKey } from './fields'

type Rule = VeilleOrganisation['tenderRules'][number]
const EMPTY_RULE: Rule = { sirens: [], names: [], excludedNames: [], requiredText: [], note: '' }
const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$/

interface Props {
  config: VeilleConfig
  onChange: (config: VeilleConfig) => void
  /** Organismes déjà enregistrés : leur identifiant (clé d'état du scanner) ne change plus. */
  savedIds: Set<string>
}

export function OrganisationsTab({ config, onChange, savedIds }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const organisations = config.organisations

  const setOrganisations = (next: VeilleOrganisation[]) => onChange({ ...config, organisations: next })
  const update = (index: number, patch: Partial<VeilleOrganisation>) =>
    setOrganisations(organisations.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  const updateRule = (index: number, ruleIndex: number, patch: Partial<Rule>) =>
    update(index, { tenderRules: organisations[index].tenderRules.map((r, j) => (j === ruleIndex ? { ...r, ...patch } : r)) })

  /** Organisme utilisé par une source : il ne peut pas être supprimé (désactivez-le). */
  const usedBy = (id: string): string | null => {
    const builtin = Object.values(BUILTIN_SOURCES).find(s => s.organisationId === id)
    if (builtin) return `Utilisé par le site intégré « ${builtin.label} » : désactivez-le plutôt.`
    const source = config.sources.find(s => (s.kind === 'csp' || s.kind === 'rss') && s.organisationId === id)
    return source && 'label' in source ? `Utilisé par la source « ${source.label} » : supprimez-la d'abord, ou désactivez l'organisme.` : null
  }

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>
        Un appel d&apos;offres BOAMP ou TED est rattaché au premier organisme dont une règle reconnaît l&apos;acheteur (l&apos;ordre compte).
        Un organisme désactivé n&apos;est plus suivi : ni ses appels d&apos;offres, ni ses sources d&apos;offres d&apos;emploi.
      </p>
      <ul className="space-y-2">
        {organisations.map((org, index) => {
          const open = openId === org.id
          const sirens = org.tenderRules.reduce((n, r) => n + r.sirens.filter(Boolean).length, 0)
          const names = org.tenderRules.reduce((n, r) => n + r.names.filter(v => v.trim()).length, 0)
          const editableId = !savedIds.has(org.id)
          return (
            <li key={index} className="rounded-xl" style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <button type="button" onClick={() => setOpenId(open ? null : org.id)} aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-admin-fg">{org.name || 'Organisme sans nom'}</span>
                    <span className="block truncate text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
                      <code className="font-mono">{org.id}</code>
                      {' · '}{org.tenderRules.length ? `${sirens} SIREN, ${names} nom${names > 1 ? 's' : ''} d'acheteur` : 'pas suivi dans les appels d\'offres'}
                    </span>
                  </span>
                </button>
                <Switch id={`org-${index}-enabled`} label="Suivi" checked={org.enabled} onChange={enabled => update(index, { enabled })} />
              </div>
              {open && (
                <div className="space-y-4 px-4 pb-4 pt-1" style={{ borderTop: '1px solid var(--admin-line)' }}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField id={`org-${index}-name`} label="Nom affiché (client des offres)" value={org.name} onChange={name => update(index, { name })} />
                    {editableId ? (
                      <TextField id={`org-${index}-id`} label="Identifiant" value={org.id} mono onChange={id => { update(index, { id }); setOpenId(id) }}
                        hint="Minuscules, chiffres et tirets. Fixé à l'enregistrement : il sert de clé au scanner." />
                    ) : (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--admin-fg-muted)' }}>Identifiant</p>
                        <p className="font-mono text-sm text-admin-fg">{org.id}</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--admin-fg-muted)' }}>Ne change plus : c&apos;est la clé du scanner pour cet organisme.</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-admin-fg">Reconnaître ses appels d&apos;offres (BOAMP, TED)</h3>
                    {org.tenderRules.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>Aucune règle : cet organisme n&apos;est suivi que par ses offres d&apos;emploi.</p>
                    )}
                    {org.tenderRules.map((rule, ruleIndex) => (
                      <fieldset key={ruleIndex} className="space-y-3 rounded-lg p-3" style={{ border: '1px solid var(--admin-line)' }}>
                        <legend className="px-1 text-xs font-semibold text-admin-fg">Règle {ruleIndex + 1}</legend>
                        <TokensField id={`org-${index}-r${ruleIndex}-sirens`} label="SIREN de l'acheteur" value={rule.sirens}
                          onChange={sirens => updateRule(index, ruleIndex, { sirens })} placeholder="130004955"
                          hint="Un acheteur dont le SIRET commence par l'un d'eux est reconnu, quel que soit son nom." />
                        <div className="grid gap-3 md:grid-cols-3">
                          <LinesField id={`org-${index}-r${ruleIndex}-names`} label="Noms d'acheteur" value={rule.names} onChange={names => updateRule(index, ruleIndex, { names })}
                            hint="Un par ligne ; comparés sans accents ni majuscules. « * » en fin de mot : la suite du mot est acceptée." />
                          <LinesField id={`org-${index}-r${ruleIndex}-excluded`} label="Noms exclus" value={rule.excludedNames}
                            onChange={excludedNames => updateRule(index, ruleIndex, { excludedNames })} hint="Écartent un homonyme reconnu par son nom." />
                          <LinesField id={`org-${index}-r${ruleIndex}-required`} label="Texte exigé dans l'avis" value={rule.requiredText}
                            onChange={requiredText => updateRule(index, ruleIndex, { requiredText })} hint="Pour un acheteur qui achète pour plusieurs services." />
                        </div>
                        <TextField id={`org-${index}-r${ruleIndex}-note`} label="Pourquoi cette règle" value={rule.note} onChange={note => updateRule(index, ruleIndex, { note })}
                          placeholder="ex. « CNAM » désigne aussi le Conservatoire national des arts et métiers." hint="Pour la personne qui reprendra ces réglages : sans effet sur la reconnaissance." />
                        <button type="button" onClick={() => update(index, { tenderRules: org.tenderRules.filter((_, j) => j !== ruleIndex) })}
                          style={{ ...secondaryButton, padding: '6px 10px', fontSize: 12 }}>
                          <Trash2 size={13} aria-hidden /> Retirer la règle
                        </button>
                      </fieldset>
                    ))}
                    <button type="button" onClick={() => update(index, { tenderRules: [...org.tenderRules, EMPTY_RULE] })} style={{ ...secondaryButton, padding: '8px 12px', fontSize: 13 }}>
                      <Plus size={14} aria-hidden /> Ajouter une règle
                    </button>
                  </div>
                  <div className="flex justify-end">
                    <ConfirmDelete label="Supprimer l'organisme" warning="Ses offres déjà envoyées restent dans la boîte AO."
                      disabledReason={usedBy(org.id) ?? undefined}
                      onConfirm={() => { setOrganisations(organisations.filter((_, i) => i !== index)); setOpenId(null) }} />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <AddOrganisation taken={new Set(organisations.map(o => o.id))} onAdd={org => { setOrganisations([...organisations, org]); setOpenId(org.id) }} />
    </div>
  )
}

function AddOrganisation({ taken, onAdd }: { taken: Set<string>; onAdd: (org: VeilleOrganisation) => void }) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const key = idTouched ? id : freeKey(toKey(name), taken)
  const problem = !name.trim() ? null : !KEY_PATTERN.test(key) ? 'Identifiant : minuscules, chiffres et tirets (2 à 50 caractères).' : taken.has(key) ? 'Identifiant déjà utilisé.' : null
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl p-4" style={{ background: 'var(--admin-panel)', border: '1px dashed var(--admin-line-strong)' }}
      onSubmit={e => {
        e.preventDefault()
        if (!name.trim() || problem) return
        onAdd({ id: key, name: name.trim(), enabled: true, tenderRules: [] })
        setName(''); setId(''); setIdTouched(false)
      }}>
      <div className="min-w-56 flex-1">
        <TextField id="new-org-name" label="Nouvel organisme" value={name} onChange={setName} placeholder="ex. Agence fictive du numérique" />
      </div>
      <div className="min-w-48">
        <TextField id="new-org-id" label="Identifiant" value={key} mono onChange={value => { setId(value); setIdTouched(true) }} />
      </div>
      <button type="submit" disabled={!name.trim() || Boolean(problem)} style={{ ...secondaryButton, opacity: !name.trim() || problem ? 0.5 : 1 }}>
        <Plus size={14} aria-hidden /> Ajouter
      </button>
      {problem && <p role="alert" className="w-full text-xs" style={{ color: '#b91c1c' }}>{problem}</p>}
    </form>
  )
}
