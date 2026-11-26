// Libellés en français des fonctions du journal de consommation de l'IA (ADR 0064), pour la page « Consommation IA ».
// Une fonction absente d'ici s'affiche sous son identifiant : ajouter son libellé quand un appel d'IA est ajouté.

const FEATURE_LABELS: Record<string, string> = {
  'admin-job-import': 'Import d’offres (admin)',
  'ao-criteria-proposal': 'AO : critères proposés',
  'ao-extract': 'AO : lecture des e-mails',
  'ao-extract-page': 'AO : lecture de l’annonce d’origine',
  'ao-publication-rewrite': 'AO : version publique',
  'ao-vision': 'AO : lecture des scans',
  assistant: 'Assistant IA',
  'criteria-assistant': 'Assistant des critères',
  'cv-classify': 'Classification des CV',
  'cv-export-extract': 'Export CV : lecture',
  'cv-export-translate': 'Export CV : traduction',
  'cv-profile-extract': 'Profil tiré d’un CV',
  'cv-template-mapping': 'Modèle CV : cartographie',
  'funnel-step-report': 'Compte rendu d’étape',
  'interview-analysis': 'Entretien : analyse (recruteur)',
  'interview-analysis-auto': 'Entretien : analyse de fin',
  'interview-followup': 'Entretien : relance (recruteur)',
  'interview-live-answer': 'Entretien : réponse au candidat',
  'interview-live-followup': 'Entretien : relance (candidat)',
  'interview-questions': 'Entretien : questions',
  'interview-questions-tune': 'Entretien : ajustement des questions',
  'job-draft': 'Offre : rédaction',
  'job-import-extract': 'Import d’offres',
  'job-import-improve': 'Import : amélioration d’une offre',
  'job-improve': 'Offre : amélioration',
  'linkedin-groups': 'Groupes LinkedIn',
  'llm-config-test': 'Test de Config IA',
  'mbc-search-criteria': 'MBC Search : critères',
  'mbc-search-evaluation': 'MBC Search : évaluation d’un profil',
  'mbc-search-outreach': 'MBC Search : message d’approche',
  'mbc-search-questions': 'MBC Search : questions',
  'mbc-search-refine': 'MBC Search : ajustement',
  'mbc-search-strategies': 'MBC Search : stratégies',
  'mbc-search-title-fit': 'MBC Search : intitulés',
  'recommendation-message': 'Demande de recommandation',
  'scoring-criteria': 'Notation sur critères',
  'scoring-final': 'Notation : score final',
  'scoring-matching': 'Notation : matching',
  'social-copy': 'Publication sociale',
  'sourcing-outreach': 'Message d’approche (sourcing)',
  'title-check': 'Comparaison des intitulés',
  'vivier-matching': 'Vivier général',
  unlabelled: 'Sans fonction renseignée',
}

export const featureLabel = (feature: string) => FEATURE_LABELS[feature] ?? feature

/** Résultat d'un essai, en clair. */
export function outcomeLabel(outcome: string): string {
  if (outcome === 'ok') return 'Réussi'
  if (outcome === 'timeout') return 'Délai dépassé'
  if (outcome === 'unreachable') return 'Injoignable'
  if (outcome === 'not-configured') return 'Non configuré'
  if (outcome.startsWith('http-')) return `Erreur HTTP ${outcome.slice(5)}`
  return 'Erreur'
}
