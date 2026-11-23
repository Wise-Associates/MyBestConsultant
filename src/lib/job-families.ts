// Familles de métiers de la classification des CV (ADR 0044) : liste fermée, sans dépendance au serveur, lue aussi dans
// le navigateur par le filtre « Métier » de la CV Thèque (ADR 0057). cv-classification.ts la réexporte.
export const JOB_FAMILIES = {
  developpement: 'Développement',
  data_ia: 'Data et IA',
  infrastructure_cloud: 'Infrastructure, cloud, DevOps',
  cybersecurite: 'Cybersécurité',
  architecture: 'Architecture',
  pilotage_projet: 'Pilotage de projet, PMO',
  produit_agilite: 'Produit et agilité',
  conseil_fonctionnel: 'Conseil fonctionnel, MOA',
  erp_crm: 'ERP et CRM',
  support_exploitation: 'Support et exploitation',
  design_ux: 'Design, UX',
  finance_metier: 'Finance, banque, assurance (métier)',
  rh: 'Ressources humaines',
  commercial_achats: 'Commercial, achats',
  autre: 'Autre',
} as const
export type JobFamily = keyof typeof JOB_FAMILIES

export const isJobFamily = (v: unknown): v is JobFamily => typeof v === 'string' && Object.hasOwn(JOB_FAMILIES, v)
