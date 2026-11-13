// Export CSV des résultats du screening (pur, testé dans screening-csv.test.ts). Chaque cellule est entre guillemets
// (une virgule dans un nom ne décale plus les colonnes) et une cellule qui commencerait une formule est neutralisée par
// une apostrophe : un nom de candidat comme `=HYPERLINK(…)` ne s'exécute pas dans le tableur du recruteur.

export interface ScreeningCsvRow {
  candidateName: string
  candidateEmail: string
  score: number
  recommendation: string
  summary: string
  strengths: string[]
  concerns: string[]
}

/** Cellule CSV sûre : guillemets doublés, formule neutralisée. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function screeningCsv(results: ScreeningCsvRow[]): string {
  const header = ['Candidat', 'Email', 'Score', 'Recommandation', 'Résumé', 'Points forts', 'Points de vigilance']
  const rows = results.map(r => [
    r.candidateName, r.candidateEmail, String(r.score), r.recommendation, r.summary, r.strengths.join(' | '), r.concerns.join(' | '),
  ].map(csvCell))
  return [header.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n')
}
