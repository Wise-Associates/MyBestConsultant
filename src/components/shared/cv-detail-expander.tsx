'use client'

import { useState } from 'react'
import { ChevronDown, Briefcase, GraduationCap, Languages as LanguagesIcon } from 'lucide-react'
import type { CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'

// Vue synthétique (par défaut) vs. vue exhaustive du CV, dépliable sans changer de page
// — même logique que "grouper / dégrouper" dans Excel. Utilisé à l'identique côté
// candidat (mini-cv-card) et côté recruteur (fiche candidat).
export function CvDetailExpander({ experiences, education, languages }: {
  experiences: CvExperience[]
  education: CvEducation[]
  languages: CvLanguage[]
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = experiences.length > 0 || education.length > 0 || languages.length > 0
  if (!hasDetail) return null

  return (
    <div>
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-bold transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-primary)' }}>
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
        {expanded ? 'Réduire' : 'Voir le détail complet (expériences, formation, langues)'}
      </button>

      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 0.3s ease' }}>
        <div style={{ overflow: 'hidden' }}>
          <div className="pt-4 space-y-5">
            {experiences.length > 0 && (
              <div>
                <SectionLabel icon={Briefcase} label="Expériences professionnelles" />
                <div className="mt-2.5 space-y-4 pl-4" style={{ borderLeft: '2px solid var(--color-border)' }}>
                  {experiences.map((exp, i) => (
                    <div key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{exp.title}</p>
                        {exp.period && <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>{exp.period}</span>}
                      </div>
                      {exp.company && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{exp.company}</p>}
                      {exp.missions.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {exp.missions.map((m, j) => (
                            <li key={j} className="text-xs leading-relaxed flex items-start gap-1.5" style={{ color: 'var(--color-text)' }}>
                              <span style={{ color: 'var(--color-primary)' }}>·</span>{m}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {education.length > 0 && (
              <div>
                <SectionLabel icon={GraduationCap} label="Formation" />
                <div className="mt-2.5 space-y-2">
                  {education.map((ed, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2 flex-wrap text-sm">
                      <span style={{ color: 'var(--color-text)' }}>
                        <strong>{ed.degree}</strong>{ed.school ? ` — ${ed.school}` : ''}
                      </span>
                      {ed.year && <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>{ed.year}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {languages.length > 0 && (
              <div>
                <SectionLabel icon={LanguagesIcon} label="Langues" />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {languages.map((l, i) => (
                    <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold"
                      style={{ background: 'rgba(11,29,81,0.05)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                      {l.name}{l.level ? ` · ${l.level}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
      <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </div>
  )
}
