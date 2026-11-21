'use client'

// Configuration d'un entretien IA : candidat, poste, CV, nombre de questions et format. Écran de /recruiter/interviews/new,
// repris tel quel par la fenêtre « Entretien IA » du pipeline (demande du 2026-11-21, ADR 0054).

export interface InterviewConfig {
  candidateName: string
  candidateEmail: string
  jobTitle: string
  jobDescription: string
  /** Compétences séparées par des virgules. */
  jobSkills: string
  cvSummary: string
  questionCount: number
}

export type InterviewMediaMode = 'audio' | 'video'

/** Compétences de la configuration, une par élément. */
export const skillsOf = (config: Pick<InterviewConfig, 'jobSkills'>) => config.jobSkills.split(',').map(s => s.trim()).filter(Boolean)

const inputStyle = {
  background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)',
  color: 'var(--color-text)',
} as const

const labelClass = 'text-xs font-semibold uppercase tracking-widest mb-2 block'

export function InterviewConfigForm({ value, onChange, mediaMode, onMediaModeChange, readOnly = [] }: {
  value: InterviewConfig
  onChange: (key: keyof InterviewConfig, next: string | number) => void
  /** Format de l'entretien ; absent : pas de choix (pipeline, toujours en vidéo). */
  mediaMode?: InterviewMediaMode
  onMediaModeChange?: (mode: InterviewMediaMode) => void
  /** Champs affichés sans modification possible : dans le pipeline, le candidat et le poste viennent de la candidature. */
  readOnly?: readonly ('candidateName' | 'candidateEmail' | 'jobTitle')[]
}) {
  return (
    <div className="space-y-5 p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
      {[
        { label: 'Nom du candidat', key: 'candidateName' as const, placeholder: 'Jean Dupont' },
        { label: 'Email du candidat', key: 'candidateEmail' as const, placeholder: 'jean@exemple.fr' },
        { label: 'Titre du poste', key: 'jobTitle' as const, placeholder: 'Développeur React Senior' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <label htmlFor={`interview-${key}`} className={labelClass} style={{ color: 'var(--color-text-muted)' }}>{label}</label>
          <input id={`interview-${key}`} value={value[key]} onChange={e => onChange(key, e.target.value)} placeholder={placeholder}
            readOnly={readOnly.includes(key)}
            className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none read-only:opacity-70 read-only:cursor-default"
            style={inputStyle} />
        </div>
      ))}

      <div>
        <label htmlFor="interview-jobSkills" className={labelClass} style={{ color: 'var(--color-text-muted)' }}>Compétences requises</label>
        <input id="interview-jobSkills" value={value.jobSkills} onChange={e => onChange('jobSkills', e.target.value)} placeholder="React, TypeScript, Node.js, AWS (séparées par virgules)"
          className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
          style={inputStyle} />
      </div>

      <div>
        <label htmlFor="interview-jobDescription" className={labelClass} style={{ color: 'var(--color-text-muted)' }}>Description du poste</label>
        <textarea id="interview-jobDescription" value={value.jobDescription} onChange={e => onChange('jobDescription', e.target.value)}
          placeholder="Description du rôle, responsabilités, contexte…" rows={3}
          className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
          style={inputStyle} />
      </div>

      <div>
        <label htmlFor="interview-cvSummary" className={labelClass} style={{ color: 'var(--color-text-muted)' }}>Résumé du CV (optionnel)</label>
        <textarea id="interview-cvSummary" value={value.cvSummary} onChange={e => onChange('cvSummary', e.target.value)}
          placeholder="Parcours, expériences clés, formations…" rows={3}
          className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
          style={inputStyle} />
      </div>

      <div>
        <label htmlFor="interview-questionCount" className={labelClass} style={{ color: 'var(--color-text-muted)' }}>
          Nombre de questions : <span style={{ color: 'var(--color-text)' }}>{value.questionCount}</span>
          <span className="normal-case tracking-normal font-normal"> (questions par défaut comprises)</span>
        </label>
        <input id="interview-questionCount" type="range" min={4} max={15} value={value.questionCount} onChange={e => onChange('questionCount', Number(e.target.value))}
          className="w-full accent-violet-600" />
      </div>

      {mediaMode && onMediaModeChange && <div>
        <span className={labelClass} style={{ color: 'var(--color-text-muted)' }}>Format de l&apos;entretien</span>
        <div className="flex gap-2" role="group" aria-label="Format de l'entretien">
          {([
            { key: 'audio' as const, label: 'Audio', desc: 'Voix uniquement' },
            { key: 'video' as const, label: 'Vidéo', desc: 'Caméra activée' },
          ]).map(opt => (
            <button key={opt.key} type="button" onClick={() => onMediaModeChange(opt.key)} aria-pressed={mediaMode === opt.key}
              className="flex-1 px-4 py-3 rounded-xl text-left transition-all"
              style={mediaMode === opt.key
                ? { background: 'rgba(124,58,237,0.12)', border: '1.5px solid #7c3aed' }
                : { background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)' }}>
              <span className="block text-sm font-semibold" style={{ color: mediaMode === opt.key ? '#7c3aed' : 'var(--color-text)' }}>{opt.label}</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>}
    </div>
  )
}
