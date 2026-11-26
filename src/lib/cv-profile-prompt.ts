// Extraction du profil d'un CV par l'IA (extractCvProfile, cv-profile-extract.ts) : consignes envoyées et lecture de la
// réponse. Pur (ni Appwrite ni appel d'IA) : un script reproduit exactement l'appel de l'application et relit une
// réponse comme elle (exemples d'affinage). Le message de l'utilisateur est le texte du CV seul (cv-profile-text.ts).

import { parseModelJson } from '@/lib/ai/model-json'

export interface CvExperience {
  title: string
  company: string
  period: string      // ex: "2019 - 2022" ou "Depuis 2023" — texte libre, tel que déductible du CV
  missions: string[]
}

export interface CvEducation {
  degree: string
  school: string
  year: string
}

export interface CvLanguage {
  name: string
  level: string
}

export interface CvProfile {
  skills: string[]
  experienceSummary: string
  experiences: CvExperience[]
  education: CvEducation[]
  languages: CvLanguage[]
  yearsOfExperience: number | null
  // Détectés sur le CV lui-même — utile pour un CV importé hors plateforme (vivier
  // recruteur) qui n'a pas de compte candidat associé pour fournir ces infos.
  candidateName: string | null
  candidateEmail: string | null
  candidatePhone: string | null
  extractedAt: string
}

/** Texte de CV plus court : pas d'appel d'IA, pas de profil (CV scanné, fichier vide). */
export const CV_PROFILE_MIN_TEXT = 30

export const CV_PROFILE_SYSTEM = `Tu analyses un CV et en extrais un profil structuré. Réponds UNIQUEMENT avec un JSON valide, sans markdown :
{
  "skills": ["compétence1", "compétence2"],
  "experienceSummary": "résumé factuel en 2-3 phrases",
  "experiences": [{"title": "intitulé du poste", "company": "entreprise", "period": "ex: 2019 - 2022", "missions": ["mission 1", "mission 2"]}],
  "education": [{"degree": "diplôme", "school": "établissement", "year": "ex: 2018"}],
  "languages": [{"name": "langue", "level": "niveau tel qu'indiqué (ex: courant, natif, B2)"}],
  "yearsOfExperience": <nombre total d'années d'expérience professionnelle, estimé à partir des dates des postes listés, ou null si non déductible>,
  "candidateName": "<nom complet tel qu'il apparaît sur le CV, ou null si absent>",
  "candidateEmail": "<email tel qu'il apparaît sur le CV, ou null si absent>",
  "candidatePhone": "<téléphone tel qu'il apparaît sur le CV, ou null si absent>"
}
- "skills" : 5 à 15 compétences techniques ou métier concrètes réellement mentionnées dans le CV (pas de généralités comme "esprit d'équipe")
- "experienceSummary" : résumé factuel du parcours (nombre d'années d'expérience si déductible, secteurs, types de postes), sans jugement de valeur
- "experiences" : liste chronologique (la plus récente en premier) de tous les postes occupés réellement mentionnés dans le CV, avec 1 à 4 missions concrètes par poste. Tableau vide si aucune expérience listée.
- "education" et "languages" : tableaux vides si non mentionnés dans le CV — n'invente rien
- "yearsOfExperience" : entier arrondi (ex: 7), calculé à partir de l'étendue réelle des dates de postes occupés — null si le CV ne permet pas de le déduire`

/**
 * Profil lu dans la réponse de l'IA : du premier « { » au dernier « } », listes bornées, valeurs converties en texte,
 * champs absents laissés vides ; null sans objet JSON. Lève si ce JSON est illisible ou si un élément d'une liste n'est
 * pas un objet : extractCvProfile n'a alors pas de profil non plus. `now` : date de l'extraction (`extractedAt`).
 */
export function parseCvProfileResponse(content: string, now: Date): CvProfile | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  const parsed = parseModelJson(jsonMatch[0]) as Record<string, unknown>
  return {
    skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 20).map(String) : [],
    experienceSummary: String(parsed.experienceSummary ?? ''),
    experiences: Array.isArray(parsed.experiences) ? parsed.experiences.slice(0, 25).map((e: Record<string, unknown>) => ({
      title: String(e.title ?? ''),
      company: String(e.company ?? ''),
      period: String(e.period ?? ''),
      missions: Array.isArray(e.missions) ? e.missions.slice(0, 6).map(String) : [],
    })) : [],
    education: Array.isArray(parsed.education) ? parsed.education.slice(0, 10).map((e: Record<string, unknown>) => ({
      degree: String(e.degree ?? ''),
      school: String(e.school ?? ''),
      year: String(e.year ?? ''),
    })) : [],
    languages: Array.isArray(parsed.languages) ? parsed.languages.slice(0, 10).map((l: Record<string, unknown>) => ({
      name: String(l.name ?? ''),
      level: String(l.level ?? ''),
    })) : [],
    yearsOfExperience: typeof parsed.yearsOfExperience === 'number' && Number.isFinite(parsed.yearsOfExperience)
      ? Math.max(0, Math.round(parsed.yearsOfExperience))
      : null,
    candidateName: typeof parsed.candidateName === 'string' && parsed.candidateName.trim() ? parsed.candidateName.trim() : null,
    candidateEmail: typeof parsed.candidateEmail === 'string' && parsed.candidateEmail.trim() ? parsed.candidateEmail.trim() : null,
    candidatePhone: typeof parsed.candidatePhone === 'string' && parsed.candidatePhone.trim() ? parsed.candidatePhone.trim() : null,
    extractedAt: now.toISOString(),
  }
}
