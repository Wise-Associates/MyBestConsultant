import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ChartColumn, TrendingUp } from 'lucide-react'
import type { CvStatsResult } from '@/lib/search/cv-stats-store'
import { RISING_MIN_CVS, RISING_RECENT_MONTHS, type CvStatsView, type RisingSkill, type StatRow } from '@/lib/search/cv-stats'
import { parseSelection, type StatSelection } from '@/lib/search/cv-stats-selection'

// Affichage des statistiques des CV classés (ADR 0044, phase 3), partagé par la page des recruteurs
// (/recruiter/cvtheque/statistiques) et celle de l'admin (/admin/cvtheque/statistiques). Couleurs : jetons --color-*
// ; l'admin les fait pointer vers ses jetons --admin-* (ADMIN_STATS_VARS). Avec `listHref` (page des recruteurs seulement,
// demande du 2026-11-19), chaque nombre ouvre la liste des profils qu'il compte ; sans lui, aucun lien.

/** Adresse de la liste des profils d'une sélection ; absente : les nombres ne sont pas des liens. */
type ListHref = (selection: StatSelection) => string

/** Lien vers les profils de la ligne `champ` = `valeur`, si la page en donne et si la ligne est une sélection valide. */
function hrefOf(listHref: ListHref | undefined, champ: string, valeur?: string): string | undefined {
  const selection = listHref ? parseSelection({ champ, valeur }) : null
  return selection ? listHref!(selection) : undefined
}

const rowLink = 'block rounded-lg -mx-2 px-2 py-1 no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-(--color-text)'

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const text: CSSProperties = { color: 'var(--color-text)' }
const card: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const number = new Intl.NumberFormat('fr-FR')
const percent = (share: number) => (share > 0 && share < 0.005 ? '< 1 %' : `${Math.round(share * 100)} %`)

/** Jetons des statistiques dans le back-office clair (`.admin-light`, globals.css) : mêmes rôles, couleurs de l'admin. */
export const ADMIN_STATS_VARS = {
  '--color-background': 'var(--admin-bg)', '--color-surface': 'var(--admin-panel)', '--color-border': 'var(--admin-line)',
  '--color-text': 'var(--admin-fg)', '--color-text-muted': 'var(--admin-fg-muted)',
} as CSSProperties

/** Choix du périmètre (liens : la page se recharge avec le nouveau). */
export function ScopeTabs({ items }: { items: { key: string; label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label="Périmètre des statistiques" className="flex flex-wrap gap-1 p-1 rounded-xl" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
      {items.map(item => (
        <Link key={item.key} href={item.href} aria-current={item.current ? 'page' : undefined}
          className="inline-flex items-center h-9 px-3 rounded-lg text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-(--color-text)"
          style={item.current ? { background: 'var(--color-surface)', color: 'var(--color-text)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : muted}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Contenu de la page pour un périmètre : états (index absent, panne, aucun CV classé), chiffres clés, fraîcheur et
 * tendances, profils. `scopeName` : « la base candidats », « votre vivier »… ; `emptyHint` : conseil quand rien n'est classé.
 */
export function CvStatsBody({ result, scopeName, emptyHint, offMessage = 'Elles s’afficheront dès que l’index de recherche des CV sera activé sur la plateforme.', listHref }: {
  result: CvStatsResult; scopeName: string; emptyHint?: string
  /** Texte quand l'index n'est pas configuré (l'admin reçoit la raison technique). */
  offMessage?: string
  listHref?: ListHref
}) {
  return (
    <>
      {result.state === 'off' && (
        <Notice title="Statistiques pas encore disponibles">{offMessage}</Notice>
      )}
      {result.state === 'error' && (
        <Notice title="Statistiques momentanément indisponibles" alert>Rechargez la page dans quelques instants.</Notice>
      )}
      {result.state === 'ok' && result.view.total === 0 && (
        <Notice title={`Aucun CV classé dans ${scopeName} pour l’instant`}>
          Chaque CV est classé (métier, compétences, séniorité…) à son dépôt ; les CV déjà présents le sont progressivement.
          {emptyHint && ` ${emptyHint}`}
        </Notice>
      )}
      {result.state === 'ok' && result.view.total > 0 && (() => {
        const v = result.view
        const seasoned = v.seniority.filter(r => r.key === 'senior' || r.key === 'expert').reduce((sum, r) => sum + r.count, 0)
        return (
          <>
            <p className="text-[13px]" style={muted}>
              {number.format(v.total)} CV classés dans {scopeName}
              {result.cvCount !== null && result.cvCount > v.total && ` sur ${number.format(result.cvCount)} (${percent(v.total / result.cvCount)}) : les autres sont en cours de classement`}.
              {listHref ? ' Chaque nombre ouvre la liste des profils qu’il compte.' : ' Chiffres tirés des CV, sans nom ni coordonnées.'}
            </p>

            <section aria-label="Chiffres clés" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="CV classés" value={number.format(v.total)} href={hrefOf(listHref, 'tous')} />
              <Tile label="Seniors et experts" value={percent(seasoned / v.total)} hint="8 ans d’expérience ou plus" href={seasoned > 0 ? hrefOf(listHref, 'seniors') : undefined} />
              <Tile label="Déposés depuis un an" value={v.lastYearShare === null ? '—' : percent(v.lastYearShare)} hint="CV de moins de 12 mois" href={v.lastYearShare ? hrefOf(listHref, 'annee') : undefined} />
              <Tile label="TJM indiqués" value={v.dailyRate ? `${number.format(v.dailyRate.min)} à ${number.format(v.dailyRate.max)} €` : '—'} hint="quand le CV l’indique" />
            </section>

            <h2 className="sr-only">Fraîcheur et tendances</h2>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 items-start">
              <Monthly months={v.monthly} listHref={listHref} />
              <Bars title="Fraîcheur des CV" rows={v.freshness} scale note="Âge du CV actuel : son dépôt, ou son import au vivier." field="fraicheur" listHref={listHref} />
              <Rising skills={result.rising} listHref={listHref} />
            </div>

            <h2 className="sr-only">Profils</h2>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 items-start">
              <Bars title="Familles de métiers" rows={v.families} field="famille" listHref={listHref} />
              <Bars title="Métiers les plus présents" rows={v.roles} field="metier" listHref={listHref} />
              <Bars title="Compétences les plus présentes" rows={v.skills} field="competence" listHref={listHref} />
              <Bars title="Séniorité" rows={v.seniority} scale field="seniorite" listHref={listHref} />
              <Bars title="Secteurs" rows={v.sectors} note="Un CV peut compter dans plusieurs secteurs." field="secteur" listHref={listHref} />
              <Bars title="Langues" rows={v.languages} field="langue" listHref={listHref} />
              <Bars title="Villes" rows={v.cities} field="ville" listHref={listHref} />
              <Bars title="Niveau d’études" rows={v.education} scale field="etudes" listHref={listHref} />
            </div>
          </>
        )
      })()}
    </>
  )
}

function Notice({ title, alert, children }: { title: string; alert?: boolean; children: ReactNode }) {
  return (
    <div role={alert ? 'alert' : 'status'} className="rounded-2xl p-5 flex items-start gap-3" style={card}>
      <ChartColumn className="h-5 w-5 shrink-0 mt-0.5" style={muted} aria-hidden />
      <div>
        <p className="text-sm font-semibold" style={text}>{title}</p>
        <p className="text-[13px] mt-0.5" style={muted}>{children}</p>
      </div>
    </div>
  )
}

function Tile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold" style={muted}>{label}</p>
      <p className="font-bold tabular-nums mt-1" style={{ ...text, fontSize: '1.375rem', lineHeight: 1.2 }}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={muted}>{hint}</p>}
    </>
  )
  return href ? (
    // Couleurs en classes et non en style : un style écrit dans l'élément l'emporterait sur la bordure du survol.
    <Link href={href} className="block rounded-2xl px-4 py-3.5 no-underline bg-(--color-surface) border border-(--color-border) hover:border-(--color-text-muted) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)">{body}</Link>
  ) : (
    <div className="rounded-2xl px-4 py-3.5" style={card}>{body}</div>
  )
}

/**
 * Une liste de valeurs et leur nombre de CV, la plus longue barre pour la plus fréquente (`scale` : échelle dans son
 * ordre, séniorité ou études). Chiffres écrits à côté de chaque barre : la couleur ne porte aucune information seule.
 */
function Bars({ title, rows, scale, note, field, listHref }: {
  title: string; rows: StatRow[]; scale?: boolean; note?: string
  /** Champ de la sélection (`champ` de l'adresse) : avec `listHref`, chaque ligne ouvre ses profils. */
  field?: string; listHref?: ListHref
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  const List = scale ? 'ul' : 'ol'
  // Identifiant sans espace ni accent : aria-labelledby lit une liste d'identifiants séparés par des espaces.
  const headingId = `stat-${title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={headingId} className="rounded-2xl p-4 sm:p-5" style={card}>
      <h3 id={headingId} className="text-sm font-semibold mb-3" style={text}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={muted}>Non indiqué dans les CV classés.</p>
      ) : (
        <List className="flex flex-col gap-1">
          {rows.map(r => {
            const href = field ? hrefOf(listHref, field, r.key) : undefined
            const row = (
              <>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate" style={text}>{r.label}</span>
                  <span className="shrink-0 tabular-nums" style={muted}>
                    <span className="font-semibold" style={text}>{number.format(r.count)}</span> · {percent(r.share)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-sm overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }} aria-hidden>
                  <div className="h-full rounded-r-sm" style={{ width: `${(r.count / max) * 100}%`, background: 'var(--color-primary)' }} />
                </div>
              </>
            )
            return (
              <li key={r.key} title={`${r.label} : ${number.format(r.count)} CV, ${percent(r.share)}`}>
                {href ? <Link href={href} className={rowLink}>{row}</Link> : <div className="py-1">{row}</div>}
              </li>
            )
          })}
        </List>
      )}
      {note && <p className="text-[11px] mt-3" style={muted}>{note}</p>}
    </section>
  )
}

/**
 * CV déposés chaque mois, les 12 derniers mois : une colonne par mois (survol : le nombre), le mois en cours et le plus
 * fort écrits sous le graphique, et le tableau des valeurs pour les lecteurs d'écran.
 */
function Monthly({ months, listHref }: { months: CvStatsView['monthly']; listHref?: ListHref }) {
  const max = Math.max(1, ...months.map(m => m.count))
  const peak = months.reduce((best, m) => (m.count > best.count ? m : best), months[0])
  const current = months[months.length - 1]
  return (
    <section aria-labelledby="stat-mois" className="rounded-2xl p-4 sm:p-5" style={card}>
      <h3 id="stat-mois" className="text-sm font-semibold mb-3" style={text}>CV déposés par mois</h3>
      {/* Colonnes liées (recruteurs) : chacune est un lien nommé, atteint au clavier ; le tableau ci-dessous donne toujours
          les valeurs de tous les mois aux lecteurs d'écran, y compris les mois sans CV (sans lien). */}
      <div className="flex items-end gap-0.5 h-32" aria-hidden={listHref ? undefined : true}>
        {months.map(m => {
          const href = m.count > 0 ? hrefOf(listHref, 'mois', m.month) : undefined
          const bar = <div className="rounded-t-sm" style={{ height: `${(m.count / max) * 100}%`, minHeight: m.count > 0 ? 2 : 0, background: 'var(--color-primary)' }} />
          // Toute la hauteur de la colonne réagit au survol, pas seulement la barre (cible plus grande que la marque).
          const column = 'flex-1 h-full flex flex-col justify-end'
          return href ? (
            <Link key={m.month} href={href} className={`${column} rounded-sm hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-(--color-text)`}
              title={`${m.label} : ${number.format(m.count)} CV`} aria-label={`${m.label} : ${number.format(m.count)} CV, voir les profils`}>{bar}</Link>
          ) : (
            <div key={m.month} className={column} title={`${m.label} : ${number.format(m.count)} CV`}>{bar}</div>
          )
        })}
      </div>
      <div className="flex gap-0.5 mt-1.5 pt-1.5 text-[10px] tabular-nums" style={{ ...muted, borderTop: '1px solid var(--color-border)' }} aria-hidden>
        {months.map((m, i) => (
          // Un mois sur trois, et le dernier : douze étiquettes ne tiennent pas sur un téléphone.
          <span key={m.month} className="flex-1 text-center truncate">{i % 3 === 2 || i === months.length - 1 ? m.label.replace(/\.? \d{4}$/, '') : ''}</span>
        ))}
      </div>
      <p className="text-[12px] mt-2.5" style={muted}>
        Ce mois-ci : <span className="font-semibold" style={text}>{number.format(current.count)}</span>
        {peak.count > 0 && <> · le plus : <span className="font-semibold" style={text}>{number.format(peak.count)}</span> en {peak.label}</>}
      </p>
      <table className="sr-only">
        <caption>CV déposés par mois, les 12 derniers mois</caption>
        <thead><tr><th scope="col">Mois</th><th scope="col">CV déposés</th></tr></thead>
        <tbody>{months.map(m => <tr key={m.month}><th scope="row">{m.label}</th><td>{m.count}</td></tr>)}</tbody>
      </table>
    </section>
  )
}

/** Compétences plus citées par les CV récents que par les plus anciens (parts des deux côtés, écart en points). */
function Rising({ skills, listHref }: { skills: RisingSkill[] | null; listHref?: ListHref }) {
  return (
    <section aria-labelledby="stat-hausse" className="rounded-2xl p-4 sm:p-5" style={card}>
      <h3 id="stat-hausse" className="text-sm font-semibold mb-3" style={text}>Compétences en hausse</h3>
      {skills === null ? (
        <p className="text-[13px]" style={muted}>Pas encore assez de CV datés : il en faut {RISING_MIN_CVS} au moins de moins de {RISING_RECENT_MONTHS} mois et autant de plus anciens.</p>
      ) : skills.length === 0 ? (
        <p className="text-[13px]" style={muted}>Aucune compétence nettement plus citée dans les CV récents.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {skills.map(s => {
            const href = hrefOf(listHref, 'recente', s.label)
            const row = (
              <span className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate" style={text}>{s.label}</span>
                  <span className="block text-[11px]" style={muted}>{percent(s.recentShare)} des CV récents, {percent(s.olderShare)} avant</span>
                </span>
                <span className="shrink-0 inline-flex items-center gap-1 font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />+{s.delta} pts
                </span>
              </span>
            )
            return <li key={s.label}>{href ? <Link href={href} className={rowLink}>{row}</Link> : <div className="py-1">{row}</div>}</li>
          })}
        </ol>
      )}
      <p className="text-[11px] mt-3" style={muted}>CV de moins de {RISING_RECENT_MONTHS} mois comparés aux plus anciens.</p>
    </section>
  )
}
