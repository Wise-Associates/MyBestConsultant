// Équivalences de compétences de la CV Thèque (ADR 0057, décision du 2026-11-23) : données seulement, lues par
// skillMatcher (cvtheque-search.ts). Elles servent la liste de la CV Thèque, ses compteurs et les alertes des recherches
// enregistrées, qui appliquent la même règle.
//
// Les compétences d'un candidat sont tirées de son CV par l'IA : leur écriture dépend du CV (« NodeJS », « Node »),
// et un CV qui cite NestJS ne cite pas toujours Node.js. Sans ces tables, un candidat qui a la compétence n'était ni
// listé ni signalé.
//
// - Deux écritures qui donnent les mêmes mots collés se valent déjà sans table (« Node.js », « NodeJS », « node js »,
//   « CI/CD » et « CICD ») : n'ajouter ici que ce que la règle ne devine pas (sigles, nom court, autre langue).
// - Une équivalence ne retient qu'une compétence entière du profil, jamais un mot dans une autre : « Go » ne trouve pas
//   « Go-to-market ». La correspondance mot à mot d'avant reste inchangée (« React » trouve « React Native »).
// - Ne jamais rapprocher deux technologies différentes par leur nom : « Java » ne doit pas trouver « JavaScript »,
//   ni « Angular » « AngularJS » (deux frameworks distincts).

/** Écritures d'une même compétence, la forme usuelle d'abord. Une compétence n'apparaît que dans un groupe. */
export const SKILL_VARIANTS: readonly (readonly string[])[] = [
  ['JavaScript', 'JS', 'ECMAScript'],
  ['TypeScript', 'TS'],
  ['Node.js', 'Node'],
  ['React', 'React.js'],
  ['Vue.js', 'Vue'],
  ['Nuxt.js', 'Nuxt'],
  ['Express', 'Express.js'],
  ['C#', 'CSharp'],
  ['.NET', 'dotnet'],
  ['Golang', 'Go'],
  ['PostgreSQL', 'Postgres', 'PgSQL'],
  ['MongoDB', 'Mongo'],
  ['SQL Server', 'MSSQL', 'Microsoft SQL Server'],
  ['Kubernetes', 'K8s'],
  ['AWS', 'Amazon Web Services'],
  ['GCP', 'Google Cloud', 'Google Cloud Platform'],
  ['Azure', 'Microsoft Azure'],
  ['HTML', 'HTML5'],
  ['CSS', 'CSS3'],
  ['Tailwind CSS', 'Tailwind'],
  ['Ruby on Rails', 'Rails', 'RoR'],
  ['Apache Spark', 'Spark'],
  ['Apache Kafka', 'Kafka'],
  ['SAP S/4HANA', 'S/4HANA'],
  ['Microsoft 365', 'Office 365', 'O365', 'M365'],
  ['Machine Learning', 'ML', 'Apprentissage automatique'],
  ['Intelligence artificielle', 'IA', 'AI', 'Artificial Intelligence'],
  ['Agile', 'Agilité', 'Méthodes agiles', 'Méthodologie agile'],
  ['UX/UI', 'UI/UX'],
  // Pas de « PO » ni de « BA » : seuls dans une liste de compétences, ils peuvent dire autre chose (bon de commande,
  // diplôme) et feraient retenir des profils sans rapport.
  ['AMOA', "Assistance à maîtrise d'ouvrage"],
  ['MOA', "Maîtrise d'ouvrage"],
]

/**
 * Compétences voisines, dans un seul sens : avoir la première vaut pour chacune des suivantes (un développeur NestJS
 * fait du Node.js, pas l'inverse). Les implications s'enchaînent : NestJS ⇒ Node.js ⇒ JavaScript. Les noms sont lus
 * avec leurs variantes (« Node » vaut « Node.js »).
 */
export const SKILL_IMPLIES: readonly (readonly [string, readonly string[]])[] = [
  // JavaScript et ses frameworks
  ['NestJS', ['Node.js', 'TypeScript']],
  ['Express', ['Node.js']],
  ['Fastify', ['Node.js']],
  ['Koa', ['Node.js']],
  ['Node.js', ['JavaScript']],
  ['TypeScript', ['JavaScript']],
  ['React', ['JavaScript']],
  ['Next.js', ['React']],
  ['Gatsby', ['React']],
  ['Vue.js', ['JavaScript']],
  ['Nuxt.js', ['Vue.js']],
  ['Angular', ['TypeScript']],
  ['Svelte', ['JavaScript']],
  ['jQuery', ['JavaScript']],
  ['Sass', ['CSS']],
  ['SCSS', ['CSS']],
  // Java
  ['Spring Boot', ['Spring', 'Java']],
  ['Spring', ['Java']],
  ['Hibernate', ['Java']],
  ['Quarkus', ['Java']],
  // Python
  ['Django', ['Python']],
  ['Flask', ['Python']],
  ['FastAPI', ['Python']],
  ['Pandas', ['Python']],
  ['PySpark', ['Python', 'Apache Spark']],
  // PHP, Ruby, .NET
  ['Laravel', ['PHP']],
  ['Symfony', ['PHP']],
  ['Ruby on Rails', ['Ruby']],
  ['C#', ['.NET']],
  ['Entity Framework', ['.NET']],
  ['Blazor', ['.NET', 'C#']],
  // Bases de données
  ['PostgreSQL', ['SQL']],
  ['MySQL', ['SQL']],
  ['MariaDB', ['SQL']],
  // Cloud et conteneurs
  ['EKS', ['Kubernetes', 'AWS']],
  ['AKS', ['Kubernetes', 'Azure']],
  ['GKE', ['Kubernetes', 'GCP']],
  ['OpenShift', ['Kubernetes']],
  // Données et IA
  ['Deep Learning', ['Machine Learning']],
  ['TensorFlow', ['Machine Learning']],
  ['PyTorch', ['Machine Learning']],
  ['scikit-learn', ['Machine Learning', 'Python']],
  ['Machine Learning', ['Intelligence artificielle']],
  // Méthodes
  ['Scrum', ['Agile']],
  ['SAFe', ['Agile']],
  ['Kanban', ['Agile']],
]
