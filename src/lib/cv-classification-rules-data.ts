import type { JobFamily, Sector } from './cv-classification'

// Listes du classement des CV sans IA (ADR 0044, cv-classification-rules.ts). Une entrée = « Nom affiché|variante|… » :
// le nom est celui que la classification enregistre (et que les statistiques comptent), les variantes sont les autres
// écritures reconnues dans un CV, sans tenir compte de la casse ni des accents. Une variante précédée de « = » n'est
// reconnue qu'écrite exactement ainsi (« =SAFe » : pas l'anglais « safe »). À compléter au fil des CV : une compétence
// ou un métier absent est simplement ignoré par les règles (l'IA, elle, le trouve).

/** Compétences connues, rangées par famille de métiers (vote de la famille quand aucun métier n'est reconnu). */
export const SKILL_SEED: Record<JobFamily | 'transverse', readonly string[]> = {
  developpement: [
    'Java', 'JavaScript|JS', 'TypeScript|TS', 'Python', 'C#', 'C++', 'PHP', 'Kotlin', 'Scala', 'Go|Golang',
    'Rust', 'Ruby on Rails|Rails', 'Node.js|NodeJS|Node JS', 'React|ReactJS|React.js', 'React Native', 'Angular|AngularJS',
    'Vue.js|VueJS|Vue 3', 'Next.js|NextJS', 'Svelte', 'jQuery', 'HTML|HTML5', 'CSS|CSS3', 'Sass|SCSS', 'Tailwind CSS|Tailwind',
    'Spring Boot', 'Spring Framework', 'Hibernate', 'Java EE|J2EE|JEE|Jakarta EE', '.NET|dotnet', '.NET Core', 'ASP.NET|ASP.NET Core',
    'Django', 'Flask', 'FastAPI', 'Laravel', 'Symfony', 'Express.js|ExpressJS', 'NestJS|Nest.js', 'GraphQL',
    'API REST|REST API|REST APIs|APIs REST|RESTful|API RESTful', 'SOAP', 'Microservices|micro-services|microservice',
    'Flutter', 'Android', 'iOS', 'Cobol', 'PL/SQL|PLSQL', 'VBA', 'Bash|Shell script|scripts shell', 'PowerShell', 'Perl',
    'Groovy', 'JUnit', 'Maven', 'Gradle', 'WordPress', 'Drupal', 'Tomcat', 'JBoss|WildFly', 'WebSphere', 'WebLogic',
  ],
  data_ia: [
    'SQL', 'NoSQL', 'MySQL', 'PostgreSQL|Postgres', 'Oracle', 'SQL Server|MS SQL|MSSQL', 'MongoDB', 'Cassandra', 'Redis',
    'Elasticsearch', 'Snowflake', 'Databricks', 'BigQuery', 'Redshift', 'Teradata', 'Hadoop', 'Spark|Apache Spark|PySpark',
    'Kafka|Apache Kafka', 'Airflow|Apache Airflow', 'dbt', 'Talend', 'Informatica', 'DataStage', 'SSIS', 'SSAS', 'SSRS', 'ETL',
    'Power BI|PowerBI', 'Tableau|Tableau Software|Tableau Desktop|Tableau Server', 'Qlik|QlikView|Qlik Sense', 'Looker', 'MicroStrategy', 'Business Objects|SAP BO', 'Cognos',
    'Pandas', 'NumPy', 'Scikit-learn|sklearn', 'TensorFlow', 'PyTorch', 'Keras', 'Machine Learning|apprentissage automatique',
    'Deep Learning', 'NLP|traitement du langage naturel', 'LLM', 'IA générative|Generative AI|GenAI', 'Data Science',
    'Big Data', 'Data Warehouse|entrepôt de données|DWH', 'Data Lake', 'MLOps', 'Gouvernance des données|Data Governance',
    'Master Data Management|MDM', 'Dataiku', 'Alteryx', 'Matillion',
  ],
  infrastructure_cloud: [
    'AWS|Amazon Web Services', 'Azure|Microsoft Azure', 'GCP|Google Cloud|Google Cloud Platform', 'Docker',
    'Kubernetes|K8s', 'OpenShift', 'Terraform', 'Ansible', 'Puppet', 'Jenkins', 'GitLab CI|GitLab CI/CD', 'GitHub Actions',
    'CI/CD', 'DevOps', 'Linux', 'Unix', 'Windows Server', 'Red Hat|RHEL', 'VMware', 'Hyper-V', 'Citrix', 'Active Directory',
    'Nginx', 'Apache', 'Prometheus', 'Grafana', 'ELK', 'Datadog', 'Nagios', 'Zabbix', 'Helm', 'ArgoCD|Argo CD', 'Cisco',
    'TCP/IP', 'DNS', 'SD-WAN', 'Veeam', 'Office 365|Microsoft 365|O365|M365', 'Intune', 'SCCM',
    'Microsoft Exchange|Exchange Server',
  ],
  cybersecurite: [
    'ISO 27001|ISO27001', 'EBIOS|EBIOS RM', 'SIEM', 'Splunk', 'QRadar', 'SOC', 'IAM', 'PKI',
    "Pentest|tests d'intrusion|test d'intrusion|penetration testing", 'OWASP', 'RGPD|GDPR', 'NIST', 'Fortinet', 'Palo Alto',
    'CyberArk', 'Wireshark', 'Kali Linux', 'Burp Suite', 'Nessus', 'EDR', 'Zero Trust', '=DORA', 'NIS2|NIS 2',
    'PCI DSS|PCI-DSS', 'Analyse de risques|analyse des risques|risk analysis', 'Pare-feu|firewall',
  ],
  architecture: [
    'TOGAF', 'ArchiMate', 'UML', 'SOA', 'Urbanisation du SI|urbanisation', 'API Management', 'MuleSoft', 'Apigee', 'ESB',
    'Domain-Driven Design|DDD',
  ],
  pilotage_projet: [
    'Gestion de projet|project management|conduite de projet|pilotage de projet', 'MS Project|Microsoft Project',
    'PRINCE2', 'PMBOK', 'Suivi budgétaire|gestion budgétaire', 'Conduite du changement|change management', 'Planisware',
    'Sciforma', 'COPIL|comité de pilotage',
  ],
  produit_agilite: [
    'Scrum', 'Kanban', '=SAFe', 'Agile|agilité|méthodes agiles|méthodologie agile', 'Lean',
    'User stories|user story', 'Backlog', 'Product management', 'Design thinking', 'OKR', 'Story mapping',
  ],
  conseil_fonctionnel: [
    "AMOA|MOA|assistance à maîtrise d'ouvrage", 'Recueil des besoins|recueil du besoin|expression des besoins',
    'Spécifications fonctionnelles|spécifications fonctionnelles détaillées', 'Cahier des charges',
    'Recette|recette fonctionnelle|UAT', 'BPMN', 'Modélisation des processus|cartographie des processus',
    'Business analysis', 'Gap analysis',
  ],
  erp_crm: [
    'SAP', 'SAP S/4HANA|S/4HANA|S4HANA', 'SAP FI/CO|SAP FICO', 'SAP FI', 'SAP CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP HCM',
    'SAP BW', 'SAP ECC', 'ABAP', 'Salesforce', 'Microsoft Dynamics|Dynamics 365|D365', 'Oracle E-Business Suite|Oracle EBS',
    'Sage X3|Sage 100', 'Workday', 'HubSpot', 'Odoo', 'Cegid', 'JD Edwards', 'NetSuite', 'Siebel', 'CRM', 'ERP',
  ],
  support_exploitation: [
    'ITIL', 'ServiceNow', 'GLPI', 'Support utilisateurs|support utilisateur|support aux utilisateurs',
    'Helpdesk|help desk|service desk', 'Supervision informatique|outils de supervision', 'Gestion des incidents|incident management', 'Ordonnancement',
    'Control-M', 'Dollar Universe|$Universe', 'Tests fonctionnels', 'Tests de non-régression|non-régression',
    'Selenium', 'Cypress', 'JMeter', 'Postman', 'SoapUI', 'Squash TM', 'HP ALM|Quality Center', 'TestRail', 'Xray',
  ],
  design_ux: [
    'Figma', 'Adobe XD', 'Photoshop', 'Illustrator', 'InDesign', 'UX design|UX', 'UI design|UI', 'Design system',
    'Prototypage|prototyping', 'Wireframes|wireframing|maquettage', 'Accessibilité numérique|RGAA|WCAG',
    'User research|recherche utilisateur', 'Tests utilisateurs|tests utilisateur|user testing',
  ],
  finance_metier: [
    'IFRS', 'Bâle III|Basel III|Bâle 3', 'Solvabilité II|Solvency II|Solvabilité 2', 'Comptabilité|accounting',
    'Contrôle de gestion', 'Consolidation des comptes|consolidation comptable', 'Trésorerie|treasury', 'Risque de crédit|credit risk',
    'Risque de marché|market risk', 'KYC', 'LCB-FT|anti-blanchiment|AML', 'Murex', 'Calypso', 'Bloomberg', 'Actuariat',
    'Reporting réglementaire|regulatory reporting', 'COREP', 'FINREP', 'IRRBB',
  ],
  rh: [
    'SIRH', 'Paie|payroll', 'Recrutement|recruitment', 'Gestion des talents|talent management', 'GPEC', 'Talentsoft',
    'Droit social',
  ],
  commercial_achats: [
    'Achats|procurement|purchasing', 'Prospection|business development', 'Gestion de comptes|account management',
    'Avant-vente|presales|pre-sales', "Réponse aux appels d'offres|appels d'offres|RFP",
  ],
  autre: [],
  transverse: [
    'Git', 'GitHub', 'GitLab', 'Bitbucket', 'Jira', 'Confluence', 'Excel|Microsoft Excel|MS Excel', 'PowerPoint',
    'SharePoint', 'Trello', 'Slack', 'Visio', 'Google Workspace', 'Power Automate', 'Power Apps', 'SonarQube',
  ],
}

/** Métiers connus, par famille : la famille du premier métier reconnu est celle du CV. */
export const ROLE_SEED: Partial<Record<JobFamily, readonly string[]>> = {
  developpement: [
    'Développeur|Développeuse|Developer|Programmeur',
    'Développeur Full Stack|Développeur Fullstack|Développeur full-stack|Full Stack Developer|Fullstack Developer|Full-Stack Developer',
    'Développeur Front-end|Développeur Frontend|Front-end Developer|Frontend Developer',
    'Développeur Back-end|Développeur Backend|Back-end Developer|Backend Developer',
    'Développeur Java|Java Developer', 'Développeur .NET|.NET Developer', 'Développeur Python|Python Developer',
    'Développeur PHP', 'Développeur JavaScript', 'Développeur mobile|Mobile Developer', 'Développeur Android',
    'Développeur iOS',
    "Ingénieur logiciel|Software Engineer|Ingénieur développement|Ingénieur d'études et développement|Ingénieur études et développement",
    'Analyste programmeur', 'Tech Lead|Lead Developer|Lead Dev|Lead technique|Référent technique',
  ],
  data_ia: [
    'Data Engineer|Ingénieur data|Ingénieur données', 'Data Scientist', 'Data Analyst|Analyste de données|Analyste data',
    'Ingénieur Machine Learning|Machine Learning Engineer|ML Engineer', 'Ingénieur IA|AI Engineer',
    'Consultant BI|Développeur BI|BI Developer|Consultant décisionnel|Ingénieur décisionnel', 'Data Steward',
    'Chef de projet data|Chef de projet BI|Chef de projet décisionnel',
    'Administrateur de bases de données|Administrateur base de données|DBA|Database Administrator',
  ],
  infrastructure_cloud: [
    'Ingénieur DevOps|DevOps Engineer', 'Ingénieur cloud|Cloud Engineer', 'Ingénieur systèmes|Ingénieur système|Systems Engineer',
    'Administrateur systèmes|Administrateur système|Administrateur systèmes et réseaux|System Administrator|Sysadmin',
    'Ingénieur réseau|Ingénieur réseaux|Network Engineer|Administrateur réseau', 'Ingénieur SRE|Site Reliability Engineer',
    'Ingénieur infrastructure|Infrastructure Engineer', 'Ingénieur de production|Ingénieur production',
    'Technicien réseau',
  ],
  cybersecurite: [
    'Ingénieur sécurité|Ingénieur cybersécurité|Security Engineer', 'Analyste SOC|SOC Analyst|Analyste cybersécurité',
    "RSSI|CISO|Responsable de la sécurité des systèmes d'information", 'Pentester|Auditeur sécurité|Ethical Hacker',
    'Consultant cybersécurité|Consultant sécurité|Consultant GRC', 'Architecte sécurité|Security Architect',
  ],
  architecture: [
    'Architecte|Architect', 'Architecte solution|Architecte solutions|Solution Architect',
    'Architecte technique|Technical Architect', 'Architecte logiciel|Software Architect', 'Architecte cloud|Cloud Architect',
    "Architecte d'entreprise|Enterprise Architect", 'Architecte SI|Architecte fonctionnel', 'Urbaniste SI|Urbaniste',
    'Architecte data|Data Architect',
  ],
  pilotage_projet: [
    'Chef de projet|Cheffe de projet|Chef de projets|Project Manager|Responsable de projet',
    'Directeur de projet|Directrice de projet|Project Director|Program Manager|Directeur de programme',
    'PMO|Project Management Officer', 'Chef de projet MOA', 'Chef de projet technique',
    'Chef de projet informatique|Chef de projet SI', 'Chef de projet digital',
    "Responsable d'application|Responsable applicatif|Application Manager", 'Manager de transition',
    "Directeur des systèmes d'information|CIO", 'Directeur technique|CTO', 'Delivery Manager',
  ],
  produit_agilite: [
    'Product Owner|Proxy PO|PO', 'Product Manager|Chef de produit', 'Scrum Master', 'Coach agile|Agile Coach',
    'Release Train Engineer',
  ],
  conseil_fonctionnel: [
    'Business Analyst|Analyste métier', 'Consultant fonctionnel|Functional Consultant',
    "Consultant MOA|Consultant AMOA|Assistant à maîtrise d'ouvrage|Analyste fonctionnel", 'Consultant|Consultante',
    'Consultant SI', 'Consultant en organisation|Consultant organisation',
  ],
  erp_crm: [
    'Consultant SAP|SAP Consultant', 'Consultant SAP FI/CO|Consultant SAP FICO|Consultant SAP FI',
    'Consultant Salesforce|Salesforce Consultant|Développeur Salesforce', 'Consultant Dynamics|Consultant Microsoft Dynamics',
    'Consultant ERP', 'Consultant CRM', 'Développeur ABAP|Consultant ABAP',
  ],
  support_exploitation: [
    'Technicien support|Technicien helpdesk|Technicien informatique|Support Engineer|Technicien de proximité',
    'Ingénieur support|Analyste support', 'Administrateur fonctionnel',
    "Pilote d'exploitation|Opérateur d'exploitation|Ingénieur d'exploitation",
    'Testeur|Test Analyst|Ingénieur test|Ingénieur QA|QA Engineer|Recetteur|Ingénieur validation', 'Service Delivery Manager',
  ],
  design_ux: [
    'UX/UI Designer|UI/UX Designer|Designer UX/UI', 'UX Designer|Designer UX', 'UI Designer|Designer UI', 'Product Designer',
    'Webdesigner|Web Designer|Graphiste',
  ],
  finance_metier: [
    'Contrôleur de gestion|Financial Controller', 'Analyste financier|Financial Analyst', 'Actuaire|Actuary',
    'Comptable|Accountant', 'Trésorier', 'Analyste risques|Analyste risque|Risk Analyst', 'Analyste crédit|Credit Analyst',
    'Trader', 'Gestionnaire de portefeuille|Portfolio Manager', 'Compliance Officer|Responsable conformité|Chargé de conformité',
  ],
  rh: [
    'Chargé de recrutement|Chargée de recrutement|Recruteur|Recruiter|Talent Acquisition Manager',
    'Responsable RH|Responsable ressources humaines|HR Manager|Directeur des ressources humaines',
    'Gestionnaire de paie|Gestionnaire paie|Payroll Manager', 'HR Business Partner|HRBP|Chargé RH', 'Consultant SIRH',
  ],
  commercial_achats: [
    "Ingénieur commercial|Ingénieur d'affaires|Business Developer|Account Manager|Key Account Manager",
    'Acheteur|Acheteuse|Buyer|Responsable achats|Purchasing Manager', 'Ingénieur avant-vente|Presales Engineer|Avant-vente',
    'Business Manager', 'Directeur commercial|Sales Manager',
  ],
}

/** Métiers trop généraux, écartés dès qu'un métier plus précis est reconnu. */
export const GENERIC_ROLES = ['Développeur', 'Consultant', 'Architecte'] as const

/**
 * Mots des secteurs, sans tenir compte de la casse (« BNP PARIBAS ») ; un sigle de 4 caractères au plus (« AXA »,
 * « BRED ») et une entrée précédée de « = » (« =Orange », pas la couleur ; « =Carrefour », pas le croisement) ne sont
 * reconnus qu'écrits ainsi.
 */
export const SECTOR_KEYWORDS: Record<Exclude<Sector, 'autre'>, readonly string[]> = {
  banque: [
    'banque', 'banques', 'bancaire', 'bancaires', 'banking', 'BNP Paribas', 'Société Générale', 'Crédit Agricole', 'LCL',
    'Natixis', 'BPCE', "Caisse d'Épargne", 'Banque Populaire', 'La Banque Postale', 'HSBC', 'Crédit Mutuel', 'CIC', 'BRED',
    'Boursorama', 'Banque de France',
  ],
  assurance: [
    'assurance', 'assurances', 'assureur', 'assureurs', 'mutuelle', 'mutuelles', 'prévoyance', 'insurance', 'AXA', 'Allianz',
    'Generali', 'MAIF', 'MACIF', 'MAAF', 'Covéa', 'CNP Assurances', 'Groupama', 'AG2R', 'Malakoff Humanis', 'Swiss Life',
    'Aviva', 'Abeille Assurances', 'Harmonie Mutuelle', 'MGEN', 'Ageas',
  ],
  marches_financiers: [
    'marchés financiers', 'salle des marchés', 'trading', 'front office', 'middle office', 'asset management',
    "gestion d'actifs", 'investment banking', "banque d'investissement", 'Amundi', 'produits dérivés', 'derivatives',
    'fixed income', 'Euronext',
  ],
  energie: [
    'énergie', 'energy', 'énergétique', 'nucléaire', 'pétrole', 'pétrolier', 'électricité', 'EDF', 'Engie', 'TotalEnergies',
    'RTE', 'Enedis', 'GRDF', 'GRTgaz', 'Orano', 'Framatome', 'Dalkia', 'Veolia',
  ],
  industrie: [
    'industrie', 'industriel', 'industrielle', 'manufacturing', 'usine', 'aéronautique', 'automobile', 'aerospace', 'Airbus',
    'Safran', 'Thales', 'Dassault', 'Renault', 'Stellantis', 'Michelin', 'Valeo', 'Schneider Electric', 'Alstom',
    'Saint-Gobain', 'ArianeGroup', 'Naval Group', 'MBDA', 'Forvia', 'Faurecia',
  ],
  telecom: [
    'télécom', 'télécoms', 'télécommunications', 'telecom', 'telecommunications', 'opérateur télécom', '=Orange', 'SFR',
    'Bouygues Telecom', 'Free Mobile', 'Iliad', 'Nokia', 'Ericsson', 'Altice',
  ],
  sante_pharma: [
    'santé', 'hôpital', 'hospitalier', 'hospitalière', 'pharmaceutique', 'pharma', 'pharmacie', 'médical', 'médicale',
    'clinique', 'biotech', 'healthcare', 'Sanofi', 'AP-HP', 'Servier', 'Ipsen', 'Pierre Fabre', 'Doctolib', 'CHU',
  ],
  secteur_public: [
    'secteur public', 'fonction publique', 'administration publique', 'ministère', 'collectivité', 'collectivités',
    'collectivités territoriales', 'mairie', 'préfecture', 'conseil départemental', 'conseil régional', 'service public',
    'établissement public', 'URSSAF', 'CAF', 'Pôle emploi', 'France Travail', 'CPAM', 'Assurance Maladie', 'DGFiP', 'CNAV',
    'Caisse des Dépôts', 'INSEE',
  ],
  distribution: [
    'grande distribution', 'retail', 'e-commerce', 'commerce de détail', '=Carrefour', 'Auchan', 'E.Leclerc', 'Intermarché',
    'Monoprix', 'Fnac', 'Darty', 'Decathlon', 'Leroy Merlin', 'Galeries Lafayette', 'Sephora', 'LVMH', 'Kering', 'Cdiscount',
  ],
  transport_logistique: [
    // « transport » seul est trop général (« transport des fichiers ») : seulement des expressions du secteur.
    'transport aérien', 'transport ferroviaire', 'transport routier', 'transport de marchandises', 'transport de voyageurs',
    'transports publics', 'logistique', 'logistics', 'supply chain', 'ferroviaire',
    'compagnie aérienne', 'aéroport', 'SNCF', 'RATP', 'Air France', 'Keolis', 'Transdev', 'CMA CGM', 'Geodis', 'DHL',
    'Chronopost', 'Aéroports de Paris', 'Groupe ADP',
  ],
  medias: [
    'médias', 'média', 'presse', 'audiovisuel', 'télévision', 'agence de publicité', 'TF1', 'France Télévisions',
    'Radio France', 'Canal+', 'Vivendi', 'Lagardère', 'Publicis', 'Havas',
  ],
  conseil_services: [
    'ESN', 'SSII', 'cabinet de conseil', 'société de conseil', 'conseil en management', 'Capgemini', 'Sopra Steria',
    'Accenture', 'Atos', 'CGI', 'Deloitte', 'KPMG', 'Ernst & Young', 'PwC', 'Wavestone', 'Alten', 'Altran', 'Akkodis',
    'Inetum', 'Devoteam', 'Sia Partners', 'BearingPoint', 'McKinsey', 'BCG', 'Onepoint', 'Talan', 'Infosys', 'IBM',
  ],
  immobilier: [
    'immobilier', 'immobilière', 'foncière', 'promotion immobilière', 'bailleur social', 'real estate', 'Nexity', 'Icade',
    'Gecina', 'Foncia', 'Covivio',
  ],
}

/** Expressions qui contiennent un mot de secteur sans parler du secteur : effacées avant la recherche des secteurs. */
export const SECTOR_FALSE_FRIENDS = [
  'assurance qualité', 'quality assurance', 'banque de données', 'banques de données', 'couche transport',
  'couche de transport', 'transport layer', 'Amazon Web Services', 'santé et sécurité',
] as const

/** Langues, nom affiché en français puis variantes. */
export const LANGUAGE_NAMES = [
  'Français|French', 'Anglais|English', 'Espagnol|Spanish|Español', 'Allemand|German|Deutsch', 'Italien|Italian',
  'Portugais|Portuguese', 'Arabe|Arabic', 'Chinois|Chinese|Mandarin', 'Japonais|Japanese', 'Russe|Russian',
  'Néerlandais|Dutch', 'Polonais|Polish', 'Roumain|Romanian', 'Turc|Turkish', 'Hindi', 'Malgache|Malagasy',
  'Vietnamien|Vietnamese', 'Coréen|Korean', 'Grec|Greek', 'Suédois|Swedish', 'Ukrainien|Ukrainian', 'Wolof',
] as const

/** Pays reconnus dans l'en-tête d'un CV quand aucune ville ne l'est. */
export const COUNTRY_NAMES = [
  'France', 'Belgique|Belgium', 'Suisse|Switzerland', 'Luxembourg', 'Canada', 'Maroc|Morocco', 'Tunisie|Tunisia',
  'Algérie|Algeria', 'Sénégal|Senegal', 'Madagascar', "Côte d'Ivoire|Ivory Coast", 'Cameroun|Cameroon',
  'Île Maurice|Mauritius', 'Espagne|Spain', 'Portugal', 'Italie|Italy', 'Allemagne|Germany', 'Royaume-Uni|United Kingdom',
  'Irlande|Ireland', 'Pays-Bas|Netherlands', 'États-Unis|United States',
] as const

/** Villes de regions.ts qui sont aussi des mots courants : jamais prises pour un lieu de résidence. */
export const AMBIGUOUS_CITIES = ['nice', 'tours', 'orange', 'vienne', 'grasse', 'sens', 'agde', 'bar'] as const

/**
 * Mots courants qui sont aussi des noms d'outils : jamais reconnus seuls comme compétence (« Chef de projet »,
 * « go-live », « vue d'ensemble », « spring 2020 »…). Les écritures sans ambiguïté restent reconnues (« Golang »,
 * « Vue.js », « Spring Boot »).
 */
export const AMBIGUOUS_TERMS = [
  'go', 'vue', 'chef', 'spring', 'swift', 'rest', 'express', 'access', 'word', 'project', 'teams', 'office', 'outlook',
  'unity', 'it', 'ember', 'meteor', 'salt', 'julia', 'dart', 'ruby', 'pascal', 'ada', 'notion', 'shell', 'exchange',
  'make', 'data', 'cloud', 'web', 'mobile', 'node', 'windows', 'sas', 'sage', 'sketch', 'test', 'tests', 'po', 'tableau',
] as const

/**
 * Données sensibles (RGPD, art. 9) ou d'identité : un terme venu de l'index qui en contient un n'entre jamais dans le
 * vocabulaire — il deviendrait une « compétence » indexée et filtrable.
 */
export const SENSITIVE_WORDS = [
  'rqth', 'handicap', 'handicape', 'handicapee', 'invalidite', 'maladie', 'enceinte', 'grossesse', 'religion',
  'religieux', 'religieuse', 'syndicat', 'syndical', 'syndicale', 'syndique', 'syndiquee', 'sexuelle', 'ethnie',
  'ethnique', 'nationalite', 'casier', 'judiciaire', 'vih', 'seropositif', 'diabete', 'cancer', 'depression',
] as const

/** Mots des qualités personnelles : un terme venu de l'index qui en contient un n'entre pas dans le vocabulaire. */
export const SOFT_SKILL_WORDS = [
  'autonomie', 'autonome', 'rigueur', 'rigoureux', 'rigoureuse', 'relationnel', 'relationnelle', 'curiosite', 'curieux',
  'adaptabilite', 'adaptable', 'dynamisme', 'dynamique', 'motivation', 'motive', 'motivee', 'ponctualite', 'creativite',
  'creatif', 'empathie', 'ecoute', 'polyvalence', 'polyvalent', 'reactivite', 'reactif', 'proactivite', 'proactif',
  'bienveillance', 'patience', 'perseverance', 'aisance', 'savoir-etre', 'esprit', 'leadership', 'equipe', 'teamwork',
  'sens', 'force', 'qualites', 'personnalite', 'capacite', 'organise', 'organisee', 'souriant', 'passionne',
] as const

/**
 * Certifications reconnues dans la rubrique « Certifications » ou sur une ligne qui parle de certification : nom
 * enregistré, motif (sur le texte sans accents). Un motif sans nom garde le texte reconnu (« AZ-104 »).
 */
export const CERTIFICATION_PATTERNS: readonly { name?: string; pattern: RegExp }[] = [
  { name: 'PMP', pattern: /\bPMP\b/ },
  { name: 'PMI-ACP', pattern: /\bPMI-ACP\b/ },
  { name: 'PRINCE2', pattern: /\bPRINCE\s?2\b/i },
  { name: 'ITIL', pattern: /\bITIL\b/ },
  { name: 'TOGAF', pattern: /\bTOGAF\b/ },
  { name: 'ISTQB', pattern: /\bISTQB\b/ },
  { name: 'CISSP', pattern: /\bCISSP\b/ },
  { name: 'CISM', pattern: /\bCISM\b/ },
  { name: 'CISA', pattern: /\bCISA\b/ },
  { name: 'CEH', pattern: /\bCEH\b/ },
  { name: 'OSCP', pattern: /\bOSCP\b/ },
  { name: 'CKA', pattern: /\bCKA\b/ },
  { name: 'CKAD', pattern: /\bCKAD\b/ },
  { name: 'PSM', pattern: /\bPSM\b/ },
  { name: 'PSPO', pattern: /\bPSPO\b/ },
  { name: 'CSM', pattern: /\bCSM\b/ },
  { name: 'CSPO', pattern: /\bCSPO\b/ },
  { name: 'SAFe', pattern: /\bSAFe\b/ },
  { name: 'ISO 27001 Lead Implementer', pattern: /\bISO\s?27001 Lead Implementer\b/i },
  { name: 'ISO 27001 Lead Auditor', pattern: /\bISO\s?27001 Lead Auditor\b/i },
  { name: 'Lean Six Sigma', pattern: /\bLean Six Sigma\b/i },
  { name: 'CFA', pattern: /\bCFA\b/ },
  { name: 'FRM', pattern: /\bFRM\b/ },
  { name: 'Terraform Associate', pattern: /\bTerraform Associate\b/i },
  { pattern: /\b(?:AZ|DP|PL|SC|MS|AI|MB)-\d{3}\b/ },
  { pattern: /\bAWS Certified(?: [A-Z][\w-]*){1,4}/ },
  { pattern: /\bGoogle (?:Cloud )?Professional(?: [A-Z][\w-]*){1,3}/ },
  { pattern: /\bSalesforce Certified(?: [A-Z][\w-]*){1,4}/ },
  { pattern: /\bSAP Certified(?: [A-Z][\w-]*){1,5}/ },
]
