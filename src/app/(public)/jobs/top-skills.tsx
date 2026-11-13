import Link from 'next/link'
import { fieldStyle, muted } from '@/components/shared/list-styles'
import { Skeleton, SkeletonRegion } from '@/components/shared/skeleton'
import { getTopJobSkills } from '@/lib/appwrite/jobs'

// « Compétences les plus demandées » de /jobs : celles de toutes les offres actives (pas seulement de la recherche en
// cours), lues à part de la liste et chargées après elle (Suspense de page.tsx, forme grise en attendant). Un clic
// cherche cette compétence, les autres critères gardés.

const TOP_SKILLS = 6
const label = <span className="text-[13px]" style={muted}>Compétences les plus demandées :</span>
const chip = 'inline-flex items-center h-11 sm:h-8 px-3 rounded-full text-[13px] font-medium no-underline transition-colors hover:border-(--color-text-muted) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'

export async function TopSkills({ hrefFor }: { hrefFor: (skill: string) => string }) {
  let skills: string[]
  try {
    skills = await getTopJobSkills(TOP_SKILLS)
  } catch (err) {
    console.error('[jobs] compétences les plus demandées illisibles', err instanceof Error ? err.message : String(err))
    return <p className="text-[13px]" style={muted}>Compétences les plus demandées momentanément indisponibles.</p>
  }
  if (skills.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label}
      {skills.map(skill => (
        <Link key={skill} href={hrefFor(skill)} className={chip} style={fieldStyle}>
          {skill}
        </Link>
      ))}
    </div>
  )
}

/** Forme grise des chips, à leur place et à leur taille, le temps du chargement. */
export function TopSkillsSkeleton() {
  return (
    <SkeletonRegion label="Chargement des compétences les plus demandées…" className="flex flex-wrap items-center gap-2">
      {label}
      {[72, 132, 64, 112, 56, 60].map((w, i) => (
        <Skeleton key={i} className="h-11 sm:h-8" style={{ width: w, borderRadius: 9999 }} />
      ))}
    </SkeletonRegion>
  )
}
