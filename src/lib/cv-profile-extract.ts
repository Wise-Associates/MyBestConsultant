// Scans a candidate's CV and extracts a structured profile (skills, experience summary).
// Shared by the candidate dashboard (auto-run on upload) and the admin CV Thèque
// (manual re-scan for CVs uploaded before this feature existed).
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS } from '@/lib/appwrite/config'

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

async function extractCVText(cvFileId: string, bucketId: string): Promise<string> {
  try {
    const { storage } = createAdminClient()
    const bytes = await storage.getFileDownload(bucketId, cvFileId)
    const buffer = Buffer.from(bytes)

    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50
    const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B

    if (isPdf) {
      if (typeof globalThis.DOMMatrix === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(globalThis as any).DOMMatrix = class DOMMatrix { constructor() { return this } }
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const data = await pdfParse(buffer)
      const text = data.text.replace(/\s{3,}/g, '\n').trim()
      return text.length > 30 ? text.slice(0, 8000) : ''
    }

    if (isDocx) {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value.slice(0, 8000).trim()
    }

    const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\tÀ-ɏ]/g, ' ').replace(/\s{3,}/g, '\n').trim()
    return text.length > 50 ? text.slice(0, 8000) : ''
  } catch {
    return ''
  }
}

export async function extractCvProfile(cvFileId: string, bucketId: string = BUCKETS.CVS): Promise<CvProfile | null> {
  const text = await extractCVText(cvFileId, bucketId)
  if (text.length < 30) return null

  const SYSTEM = `Tu analyses un CV et en extrais un profil structuré. Réponds UNIQUEMENT avec un JSON valide, sans markdown :
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

  try {
    const { content } = await callLLM([{ role: 'user', content: text }], SYSTEM)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
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
      extractedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}
