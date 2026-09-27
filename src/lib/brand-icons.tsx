import {
  Heart, Home, GraduationCap, Euro, Plane, Laptop, Users, Rocket, Coffee, ShieldCheck, TrainFront, Gift,
  Clock, TrendingUp, Baby, Dumbbell, type LucideIcon,
} from 'lucide-react'

// Pictogrammes proposés pour les avantages employeur (clé stockée dans le profil → icône).
export const BENEFIT_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  home: { icon: Home, label: 'Télétravail' },
  clock: { icon: Clock, label: 'Horaires flexibles' },
  heart: { icon: Heart, label: 'Santé & mutuelle' },
  shield: { icon: ShieldCheck, label: 'Prévoyance' },
  euro: { icon: Euro, label: 'Rémunération' },
  trending: { icon: TrendingUp, label: 'Intéressement' },
  graduation: { icon: GraduationCap, label: 'Formation' },
  rocket: { icon: Rocket, label: 'Évolution' },
  laptop: { icon: Laptop, label: 'Matériel' },
  plane: { icon: Plane, label: 'Congés & voyages' },
  train: { icon: TrainFront, label: 'Transports' },
  users: { icon: Users, label: 'Équipe' },
  coffee: { icon: Coffee, label: 'Ambiance' },
  baby: { icon: Baby, label: 'Parentalité' },
  dumbbell: { icon: Dumbbell, label: 'Sport & bien-être' },
  gift: { icon: Gift, label: 'Autre avantage' },
}

export function BenefitIcon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const Icon = (BENEFIT_ICONS[name] ?? BENEFIT_ICONS.gift).icon
  return <Icon className={className} style={style} />
}

export const BENEFIT_SUGGESTIONS: { icon: string; title: string }[] = [
  { icon: 'home', title: 'Télétravail flexible' },
  { icon: 'heart', title: 'Mutuelle prise en charge' },
  { icon: 'graduation', title: 'Budget formation' },
  { icon: 'euro', title: 'Primes & intéressement' },
  { icon: 'laptop', title: 'Matériel haut de gamme' },
  { icon: 'train', title: 'Transports remboursés' },
  { icon: 'plane', title: 'Congés supplémentaires' },
  { icon: 'dumbbell', title: 'Sport & bien-être' },
]

export const VALUE_SUGGESTIONS = ['Excellence', 'Bienveillance', 'Transparence', 'Innovation', 'Esprit d’équipe', 'Autonomie']
