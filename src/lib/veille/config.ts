import { z } from 'zod'

// Réglages de la veille marchés et emplois (projet veille-marches-emplois, ADR 0012) : organismes suivis et règles qui
// reconnaissent leurs appels d'offres, sources lues, périmètre informatique, mots-clés des appels d'offres (recherche
// chez tous les acheteurs, ADR 0006 du scanner). Modifiés dans /admin/veille, enregistrés
// en versions dans la collection veille_config, lus par le scanner (GET /api/veille/config). Le scanner valide le même
// format (src/settings/veille-settings.ts, même `schemaVersion`) : toute évolution se fait dans les deux projets, et
// `schemaVersion` change si un ancien scanner ne peut pas lire le nouveau format. Règles pures, testées dans
// config.test.ts.

export const VEILLE_SCHEMA_VERSION = 1

/** Taille de l'attribut `config` de veille_config (appwrite.config.json) : réglages en JSON, 100 000 caractères au plus. */
export const MAX_CONFIG_LENGTH = 100_000

/**
 * Sites lus par un code propre au scanner : ils se désactivent mais ne se suppriment pas, et leur organisme est fixé
 * par ce code. Identifiants = clés du fichier d'état du scanner, à ne jamais changer.
 */
export const BUILTIN_SOURCES = {
  'autorite-concurrence-carrieres': { label: 'Autorité de la concurrence — site de recrutement', organisationId: 'autorite-concurrence' },
  'banque-postale-carrieres': { label: 'La Banque Postale — site carrières', organisationId: 'banque-postale' },
  'afd-carrieres': { label: 'Proparco — site carrières du groupe AFD', organisationId: 'proparco' },
  'crh-site': { label: "CRH — page d'accueil (annonce PDF)", organisationId: 'crh' },
} as const
export type BuiltinSourceId = keyof typeof BUILTIN_SOURCES
const BUILTIN_IDS = Object.keys(BUILTIN_SOURCES) as [BuiltinSourceId, ...BuiltinSourceId[]]

/**
 * Comme le scanner (normalizePhrase de src/phrases.ts) : sans accents ni majuscules, ponctuation remplacée par des espaces ;
 * un `*` en fin de mot (« développeur* ») accepte la suite du mot et est gardé. Chaîne vide : rien à chercher.
 */
export function normalizePhrase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(word => {
      const prefix = word.endsWith('*')
      const core = word.replace(/\*+$/, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      return core ? `${core}${prefix ? '*' : ''}` : ''
    })
    .filter(Boolean)
    .join(' ')
}

/** Liste saisie ligne par ligne : espaces retirés, lignes vides ignorées, doublons retirés, puis chaque valeur validée. */
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    value => (Array.isArray(value) ? [...new Set(value.map(v => (typeof v === 'string' ? v.trim() : v)).filter(v => v !== ''))] : value),
    z.array(item).max(max, `${max} valeurs au plus.`),
  )

/** Identifiant d'organisme ou de source : clé du fichier d'état du scanner, jamais modifiée après sa création. */
const Key = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])$/, 'Identifiant : lettres minuscules, chiffres et tirets (2 à 50 caractères).')
const Phrase = z.string().max(120, '120 caractères au plus.').refine(p => normalizePhrase(p) !== '', 'Expression vide une fois accents et ponctuation retirés.')
const Label = z.string().trim().min(1, 'Libellé obligatoire.').max(120, '120 caractères au plus.')

const TenderRule = z
  .object({
    sirens: list(z.string().regex(/^\d{9}$/, 'SIREN à 9 chiffres.'), 20),
    names: list(Phrase, 40),
    excludedNames: list(Phrase, 40),
    requiredText: list(Phrase, 20),
    /** Pourquoi cette règle (homonymes, acheteur partagé…) : savoir du métier, sans effet sur la reconnaissance. */
    note: z.string().trim().max(300, '300 caractères au plus.').default(''),
  })
  .refine(r => r.sirens.length + r.names.length > 0, 'Une règle reconnaît l\'acheteur par au moins un SIREN ou un nom.')

const Organisation = z.object({
  id: Key,
  name: z.string().trim().min(1, 'Nom obligatoire.').max(80, '80 caractères au plus.'),
  enabled: z.boolean(),
  /** Vide : l'organisme n'est suivi que par ses offres d'emploi. */
  tenderRules: z.array(TenderRule).max(10, '10 règles au plus.'),
})

/** Flux RSS officiel d'un site carrières : https et nom de domaine public (ni adresse IP, ni identifiants). */
const FeedUrl = z.string().trim().max(500, '500 caractères au plus.').refine(value => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname)
}, 'Adresse de flux en https:// attendue, sur un nom de domaine public.')

const Source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('boamp'), id: z.literal('boamp'), enabled: z.boolean() }),
  z.object({ kind: z.literal('ted'), id: z.literal('ted'), enabled: z.boolean() }),
  z.object({ kind: z.literal('builtin'), id: z.enum(BUILTIN_IDS), enabled: z.boolean() }),
  z.object({
    kind: z.literal('csp'), id: Key, enabled: z.boolean(), organisationId: Key, label: Label,
    /** Codes d'organisme de Choisir le service public (nombre dans …/nos-offres/filtres/organisme/<code>/). */
    codes: list(z.string().regex(/^\d{1,8}$/, 'Code d\'organisme : un nombre.'), 10).refine(c => c.length > 0, 'Au moins un code d\'organisme.'),
  }),
  z.object({
    kind: z.literal('rss'), id: Key, enabled: z.boolean(), organisationId: Key, label: Label, url: FeedUrl,
    /** Lire la page de chaque offre (données JobPosting de schema.org) quand le flux ne donne que le titre. */
    readOfferPage: z.boolean(),
  }),
])

const Acronym = z.string().regex(/^[A-Z0-9]{2,10}$/, 'Sigle en majuscules et chiffres (2 à 10 caractères).')

const ItScope = z.object({
  /** false : toutes les offres des organismes suivis sont envoyées, informatiques ou non. */
  enabled: z.boolean(),
  cpvPrefixes: list(z.string().regex(/^\d{1,8}$/, 'Code CPV : 1 à 8 chiffres (préfixe).'), 50),
  // Les descripteurs entrent dans la requête BOAMP de tous les acheteurs : ni guillemet ni barre oblique inverse.
  boampDescriptors: list(z.string().max(120, '120 caractères au plus.').regex(/^[^"\\]+$/, 'Descripteur sans guillemet ni barre oblique inverse.'), 50),
  phrases: list(Phrase, 1000),
  acronyms: list(Acronym, 200),
  /** Vocabulaire qui l'emporte sur les expressions et sigles (bâtiment : « travaux »). */
  exclusionPhrases: list(Phrase, 200),
})

/** Famille de mots-clés (« SaaS, logiciels », « Gouvernance des données »…) : le scanner fait une recherche par famille. */
const KeywordFamily = z
  .object({ id: Key, label: Label, phrases: list(Phrase, 200), acronyms: list(Acronym, 50) })
  .refine(f => f.phrases.length + f.acronyms.length > 0, 'Au moins une expression ou un sigle.')

/**
 * Mots-clés des appels d'offres (décision du 2026-10-27). Absents des réglages enregistrés avant : recherche limitée aux
 * organismes suivis, sans mot-clé (même valeur par défaut que le scanner).
 */
const TenderKeywords = z
  .object({
    /** Chercher aussi les avis des acheteurs non suivis (BOAMP et TED), envoyés sous « Autres acheteurs ». */
    allBuyers: z.boolean(),
    families: z.array(KeywordFamily).max(30, '30 familles au plus.'),
    /** Écartent un avis classé informatique dont l'intitulé en parle sans aucun mot-clé (serveurs, réseau…). */
    infrastructurePhrases: list(Phrase, 200),
  })
  .default({ allBuyers: false, families: [], infrastructurePhrases: [] })

const VeilleConfigSchema = z
  .object({
    schemaVersion: z.literal(VEILLE_SCHEMA_VERSION),
    organisations: z.array(Organisation).min(1, 'Au moins un organisme.').max(100, '100 organismes au plus.'),
    sources: z.array(Source).max(200, '200 sources au plus.'),
    itScope: ItScope,
    tenderKeywords: TenderKeywords,
  })
  .superRefine((config, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    const duplicates = (ids: string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    for (const id of duplicates(config.organisations.map(o => o.id))) fail(`Identifiant d'organisme « ${id} » utilisé plusieurs fois.`)
    for (const id of duplicates(config.sources.map(s => s.id))) fail(`Identifiant de source « ${id} » utilisé plusieurs fois.`)
    for (const id of duplicates(config.tenderKeywords.families.map(f => f.id))) fail(`Identifiant de famille de mots-clés « ${id} » utilisé plusieurs fois.`)
    const organisations = new Set(config.organisations.map(o => o.id))
    for (const source of config.sources) {
      if ((source.kind === 'csp' || source.kind === 'rss') && !organisations.has(source.organisationId)) {
        fail(`Source « ${source.label} » : organisme « ${source.organisationId} » introuvable.`)
      }
    }
    const present = new Set(config.sources.map(s => s.id))
    for (const [id, label] of [['boamp', 'BOAMP'], ['ted', 'TED']] as const) {
      if (!present.has(id)) fail(`La source ${label} doit figurer dans les réglages (désactivez-la au besoin).`)
    }
    for (const id of BUILTIN_IDS) {
      const builtin = BUILTIN_SOURCES[id]
      if (!present.has(id)) fail(`Le site intégré « ${id} » (${builtin.label}) doit figurer dans les réglages (désactivez-le au besoin).`)
      else if (!organisations.has(builtin.organisationId)) fail(`La source « ${id} » (${builtin.label}) a besoin de l'organisme « ${builtin.organisationId} ».`)
    }
  })

export type VeilleConfig = z.infer<typeof VeilleConfigSchema>
export type VeilleOrganisation = VeilleConfig['organisations'][number]
export type VeilleSource = VeilleConfig['sources'][number]
export type VeilleItScope = VeilleConfig['itScope']
export type VeilleTenderKeywords = VeilleConfig['tenderKeywords']
export type VeilleKeywordFamily = VeilleTenderKeywords['families'][number]

const FIELD_LABEL: Record<string, string> = {
  id: 'identifiant', name: 'nom', label: 'libellé', tenderRules: 'règles', sirens: 'SIREN', names: 'noms d\'acheteur',
  excludedNames: 'noms exclus', requiredText: 'texte exigé', note: 'raison', organisationId: 'organisme', codes: 'codes', url: 'adresse du flux',
  cpvPrefixes: 'codes CPV', boampDescriptors: 'descripteurs BOAMP', phrases: 'expressions', acronyms: 'sigles',
  exclusionPhrases: 'exclusions', schemaVersion: 'version du format', allBuyers: 'tous les acheteurs',
  infrastructurePhrases: 'infrastructure seule',
}

const at = (node: unknown, key: PropertyKey): unknown =>
  node && typeof node === 'object' ? (node as Record<PropertyKey, unknown>)[key] : undefined
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** Emplacement d'une erreur en mots (« Organisme « INSEE », règle 1, SIREN, « 12345 » »), d'après la saisie. */
function placeOf(path: PropertyKey[], input: unknown): string {
  const parts: string[] = []
  let node: unknown = input
  for (let i = 0; i < path.length; i++) {
    const key = path[i]
    const next = path[i + 1]
    if ((key === 'organisations' || key === 'sources' || key === 'tenderRules' || key === 'families') && typeof next === 'number') {
      const item = at(at(node, key), next)
      if (key === 'organisations') parts.push(`Organisme « ${text(at(item, 'name')) ?? text(at(item, 'id')) ?? next + 1} »`)
      else if (key === 'sources') parts.push(`Source « ${text(at(item, 'label')) ?? text(at(item, 'id')) ?? next + 1} »`)
      else if (key === 'families') parts.push(`famille « ${text(at(item, 'label')) ?? next + 1} »`)
      else parts.push(`règle ${next + 1}`)
      node = item
      i++
      continue
    }
    node = at(node, key)
    if (key === 'itScope') parts.push('Filtre informatique')
    else if (key === 'tenderKeywords') parts.push('Mots-clés des appels d\'offres')
    else if (typeof key === 'number') {
      const value = text(node)
      if (value) parts.push(`« ${value.slice(0, 60)} »`)
    } else parts.push(FIELD_LABEL[String(key)] ?? String(key))
  }
  return parts.join(', ')
}

/** Valide des réglages complets ; erreurs en français, chacune avec son emplacement. */
export function parseVeilleConfig(input: unknown): { success: true; config: VeilleConfig } | { success: false; errors: string[] } {
  const parsed = VeilleConfigSchema.safeParse(input)
  if (parsed.success) return { success: true, config: parsed.data }
  return {
    success: false,
    errors: parsed.error.issues.slice(0, 30).map(issue => {
      const place = placeOf(issue.path, input)
      const message = issue.code === 'invalid_type' && issue.path.length === 0 ? 'Réglages illisibles (objet attendu).' : issue.message
      return place ? `${place} : ${message}` : message
    }),
  }
}
