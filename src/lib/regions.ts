// French region → major cities, so searching a region name (e.g. "Île-de-France") also
// matches jobs whose location is a city within it (e.g. "Paris", "Charenton-le-Pont").
// Not exhaustive at commune level — covers the 13 metropolitan regions with their
// best-known cities, which is what recruiters actually type into job locations.
export const FRANCE_REGIONS: Record<string, string[]> = {
  'île-de-france': [
    'paris', 'charenton-le-pont', 'boulogne-billancourt', 'saint-denis', 'versailles',
    'nanterre', 'créteil', 'montreuil', 'ivry-sur-seine', 'vincennes', 'issy-les-moulineaux',
    'levallois-perret', 'courbevoie', 'colombes', 'asnières-sur-seine', 'rueil-malmaison',
    'argenteuil', 'clichy', 'aubervilliers', 'la défense', 'melun', 'évry', 'cergy',
    'bagneux', 'châtillon', 'conflans-sainte-honorine', 'épinay-sous-sénart', 'antony',
    'massy', 'vélizy-villacoublay', 'saint-cloud', 'meudon', 'fontenay-sous-bois',
  ],
  'auvergne-rhône-alpes': [
    'lyon', 'grenoble', 'saint-étienne', 'clermont-ferrand', 'annecy', 'chambéry',
    'valence', 'villeurbanne', 'bourg-en-bresse',
  ],
  'nouvelle-aquitaine': [
    'bordeaux', 'limoges', 'poitiers', 'pau', 'la rochelle', 'bayonne', 'périgueux', 'niort',
  ],
  'occitanie': [
    'toulouse', 'montpellier', 'nîmes', 'perpignan', 'béziers', 'albi', 'carcassonne',
  ],
  'hauts-de-france': [
    'lille', 'amiens', 'roubaix', 'tourcoing', 'dunkerque', 'calais', 'saint-quentin',
  ],
  'grand est': [
    'strasbourg', 'reims', 'metz', 'nancy', 'mulhouse', 'colmar', 'troyes', 'charleville-mézières',
  ],
  'provence-alpes-côte d\'azur': [
    'marseille', 'nice', 'toulon', 'aix-en-provence', 'avignon', 'cannes', 'antibes', 'gap',
  ],
  'pays de la loire': [
    'nantes', 'angers', 'le mans', 'saint-nazaire', 'laval', 'cholet',
  ],
  'bretagne': [
    'rennes', 'brest', 'quimper', 'lorient', 'vannes', 'saint-malo',
  ],
  'normandie': [
    'rouen', 'le havre', 'caen', 'cherbourg', 'évreux', 'dieppe',
  ],
  'bourgogne-franche-comté': [
    'dijon', 'besançon', 'belfort', 'chalon-sur-saône', 'auxerre', 'nevers',
  ],
  'centre-val de loire': [
    'orléans', 'tours', 'bourges', 'chartres', 'blois', 'châteauroux',
  ],
  'corse': [
    'ajaccio', 'bastia', 'porto-vecchio', 'corte',
  ],
}

// A meaningful share of candidates are based outside France (mostly Francophone Africa,
// per what's actually in the database) — a "location" free-text field with no country
// data behind it, so a search for "Madagascar" only ever found candidates who happened
// to type "Madagascar" themselves, not e.g. "Antananarivo" alone. Same country -> cities
// expansion as FRANCE_REGIONS, just not French regions.
export const INTERNATIONAL_LOCATIONS: Record<string, string[]> = {
  'madagascar': [
    'antananarivo', 'tananarive', 'moramanga', 'toamasina', 'tamatave', 'antsirabe',
    'mahajanga', 'majunga', 'fianarantsoa', 'toliara', 'tuléar', 'antsiranana', 'diego suarez',
  ],
  'maroc': [
    'casablanca', 'rabat', 'marrakech', 'fès', 'tanger', 'agadir', 'meknès', 'oujda',
    'kénitra', 'nador', 'el jadida', 'bir jdid',
  ],
  'tunisie': [
    'tunis', 'sfax', 'sousse', 'kairouan', 'bizerte', 'gabès', 'ariana', 'monastir',
  ],
  'sénégal': [
    'dakar', 'thiès', 'kaolack', 'saint-louis', 'ziguinchor', 'touba',
  ],
}

// Strips accents and treats hyphens/spaces/commas the same way, so "Ile de France",
// "île-de-france" and "Île-de-France" all compare equal — nobody types the accented,
// hyphenated form a French admin region is technically spelled with — and so
// "Nador,Maroc" (no space after the comma, as recruiters actually type it) still
// splits into separately-matchable "nador" and "maroc".
export function normalizeLocation(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-,\s]+/g, ' ')
    .trim()
}

const ALL_LOCATIONS: Record<string, string[]> = { ...FRANCE_REGIONS, ...INTERNATIONAL_LOCATIONS }

const NORMALIZED_REGIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALL_LOCATIONS).map(([region, cities]) => [
    normalizeLocation(region),
    cities.map(normalizeLocation),
  ]),
)

// Returns the list of city keywords a location search term should also match —
// the term itself if it's a known region/country, or its own region's other cities if
// it's a known city (so searching "Paris" doesn't need to know about the region either).
// A multi-word term (e.g. "Antananarivo Madagascar", once normalized) is expanded word
// by word too, so a messy free-text location still resolves to something.
export function expandLocationSearch(term: string): string[] {
  const q = normalizeLocation(term)
  if (!q) return []

  const results = new Set<string>()
  for (const word of [q, ...q.split(' ').filter(Boolean)]) {
    results.add(word)
    if (NORMALIZED_REGIONS[word]) NORMALIZED_REGIONS[word].forEach(c => results.add(c))
    for (const [region, cities] of Object.entries(NORMALIZED_REGIONS)) {
      if (cities.includes(word)) { results.add(region); cities.forEach(c => results.add(c)) }
    }
  }
  return [...results]
}
