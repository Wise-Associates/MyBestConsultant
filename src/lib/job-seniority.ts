export const SENIORITY_MAX = 15

// Job postings have no stored seniority/years-of-experience field — the JOBS collection
// is already at Appwrite's 16-attribute ceiling (verified live against the self-hosted
// instance), so seniority is estimated from the job's own text instead of a new field.
export function estimateJobSeniorityYears(title: string, description: string): number | null {
  const text = `${title} ${description}`.toLowerCase()

  // A range like "3 à 5 ans" / "3-5 years" — take the midpoint.
  const range = text.match(/(\d{1,2})\s*(?:-|à|to)\s*(\d{1,2})\s*(?:ans?|années?|years?)/i)
  if (range) {
    const a = parseInt(range[1], 10)
    const b = parseInt(range[2], 10)
    if (a >= 0 && b >= a && b <= 40) return Math.round((a + b) / 2)
  }

  // A single explicit mention — "5 ans d'expérience", "5+ years of experience".
  const explicit = text.match(/(\d{1,2})\s*\+?\s*(?:ans?|années?|years?)\s*(?:d['e]|of)?\s*(?:expérience|experience)?/i)
  if (explicit) {
    const n = parseInt(explicit[1], 10)
    if (n >= 0 && n <= 40) return n
  }

  // Fallback to seniority-level wording when no explicit number is given. JS's \b treats
  // accented letters as non-word characters, so \bconfirmé\b silently never matches
  // "confirmé(e)" or "expérimenté" — every keyword here is checked with an explicit
  // French-aware letter boundary instead of relying on \b.
  const hasWord = (word: string) => new RegExp(`(?<![a-zà-ÿ])${word}(?![a-zà-ÿ])`, 'i').test(text)

  if (['junior', 'débutant', 'stagiaire', 'alternant', 'alternance'].some(hasWord)) return 1
  if (['confirmé', 'confirmée', 'intermédiaire'].some(hasWord)) return 4
  if (['senior', 'expérimenté', 'expérimentée', 'expérience significative'].some(hasWord)) return 7
  if (['expert', 'lead', 'principal', 'staff', 'directeur', 'head of'].some(hasWord)) return 10

  return null
}
