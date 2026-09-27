'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const CARDS = [
  { image: '/homepage/role-data-engineer.jpg', firstName: 'Nicolas', title: 'Ingénieur Data', desc: "8 ans d'expérience en architecture data" },
  { image: '/homepage/role-data-scientist.jpg', firstName: 'Manon', title: 'Data Scientiste', desc: 'Machine Learning & modèles prédictifs' },
  { image: '/homepage/role-cybersecurity.jpg', firstName: 'Julien', title: 'Expert Cybersécurité', desc: 'Sécurité des systèmes & conformité' },
  { image: '/homepage/role-business-analyst.jpg', firstName: 'Camille', title: 'Business Analyste', desc: 'Pilotage de projets & analyse des besoins' },
  { image: '/homepage/role-project-manager.jpg', firstName: 'Sophie', title: 'Chef de Projet IT', desc: 'Gestion agile de projets complexes' },
  { image: '/homepage/role-fullstack-dev.jpg', firstName: 'Thomas', title: 'Développeur Full-Stack', desc: 'React, Node.js & architecture cloud' },
  { image: '/homepage/role-devops.jpg', firstName: 'Maxime', title: 'Consultant DevOps', desc: 'CI/CD, Kubernetes & infrastructure cloud' },
  { image: '/homepage/role-ux-designer.jpg', firstName: 'Léa', title: 'UX/UI Designer', desc: "Design d'interfaces centrées utilisateur" },
]

const N = CARDS.length
const EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

// o2 / o3 : décalage des cartes 2 et 3 (en fraction de la largeur de la carte 1). Plus grand = éventail plus ouvert, plus d'image visible.
type Size = { cardW: number; cardH: number; o2: number; o3: number }

const SIZES: Record<'desktop' | 'tablet' | 'mobile', Size> = {
  desktop: { cardW: 500, cardH: 630, o2: 0.66, o3: 1.16 },
  tablet: { cardW: 410, cardH: 520, o2: 0.62, o3: 1.08 },
  mobile: { cardW: 228, cardH: 300, o2: 0.46, o3: 0.78 },
}

function useBreakpoint() {
  const [bp, setBp] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth
      setBp(w < 620 ? 'mobile' : w < 960 ? 'tablet' : 'desktop')
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  return bp
}

// Bumble-style nested deck: three cards side by side with a slight overlap, all
// sheared by the exact same clip-path parallelogram (no per-card rotation in the
// flat plane — the shared slant is what makes them look like they interlock).
// All three cards share the exact same rotateY tilt (via a per-card
// `perspective()`), like a fan of book pages all seen from the same angle, on top
// of shrinking from their own box center (CSS `scale()` default transform-origin),
// so they stay vertically centered on card 1 automatically, same top/bottom space.
// Offsets are expressed as fractions of the current breakpoint's card width (not
// fixed desktop pixel values) so the fan doesn't overflow narrower screens — that
// mismatch was leaving a blank strip on mobile. The whole cluster is shifted left
// by GROUP_SHIFT_FRAC so it's centered as a group, not just the front card.
// Everything beyond card 3 parks invisibly at card 3's spot so it fades cleanly
// into view. Advancing slides the front card off to the left while cards 2 and 3
// each glide one slot forward.
// Tailles bien étagées : carte 1 = 100 %, carte 2 = 3/4, carte 3 = 1/2 (la différence se voit au premier regard).
const SCALE_2 = 0.75
const SCALE_3 = 0.5
// Inclinaison faible : l'effet 3D reste, mais on voit bien les images (le « livre » est ouvert).
const ROTATE_Y = -16
function positionFor(dist: number, size: Size) {
  const { cardW, o2, o3 } = size
  // L'ensemble des trois cartes est centré : de la gauche de la carte 1 au bord droit de la carte 3.
  const shift = (-((o3 + SCALE_3 / 2) - 0.5) / 2 - 0.05) * cardW
  if (dist === 0) return { x: shift + 0, scale: 1, rotateY: ROTATE_Y, opacity: 1, zIndex: 30 }
  if (dist === 1) return { x: shift + cardW * o2, scale: SCALE_2, rotateY: ROTATE_Y, opacity: 1, zIndex: 20 }
  if (dist === 2) return { x: shift + cardW * o3, scale: SCALE_3, rotateY: ROTATE_Y, opacity: 1, zIndex: 10 }
  if (dist === N - 1) return { x: shift - cardW * 0.6, scale: 0.9, rotateY: ROTATE_Y, opacity: 0, zIndex: 5 }
  return { x: shift + cardW * o3, scale: SCALE_3, rotateY: ROTATE_Y, opacity: 0, zIndex: 8 }
}

export function HeroCardCarousel() {
  const [active, setActive] = useState(0)
  const [hovering, setHovering] = useState(false)
  // Staggered entrance: 0 = nothing shown yet, 1 = front card in, 2 = + second
  // card, 3 = + third card (all revealed) — instead of all three fading in at once.
  const [revealStage, setRevealStage] = useState(0)
  const bp = useBreakpoint()
  const size = SIZES[bp]
  const revealed = revealStage >= 3

  // Keep the cards hidden for 2s so visitors see the MY BEST CONSULTANT wordmark
  // first, then bring them in one at a time: front, then the two peeks behind it.
  useEffect(() => {
    const t1 = setTimeout(() => setRevealStage(1), 4600)
    const t2 = setTimeout(() => setRevealStage(2), 5000)
    const t3 = setTimeout(() => setRevealStage(3), 5350)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  useEffect(() => {
    if (hovering || !revealed) return
    const id = setInterval(() => setActive(a => (a + 1) % N), 2800)
    return () => clearInterval(id)
  }, [hovering, revealed])

  const goTo = (delta: number) => setActive(a => (a + delta + N) % N)

  return (
    <div style={{ position: 'relative', zIndex: 2, width: '100%' }}>
      <div
        className="mbc-hero-stage"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>

        <button aria-label="Précédent" onClick={() => goTo(-1)} className="mbc-hero-arrow mbc-hero-arrow-left"
          style={{ pointerEvents: revealed ? undefined : 'none' }}>
          <ChevronLeft style={{ width: 20, height: 20 }} />
        </button>
        <button aria-label="Suivant" onClick={() => goTo(1)} className="mbc-hero-arrow mbc-hero-arrow-right"
          style={{ pointerEvents: revealed ? undefined : 'none' }}>
          <ChevronRight style={{ width: 20, height: 20 }} />
        </button>

        <div style={{ position: 'relative', width: size.cardW, height: size.cardH }}>
          {CARDS.map((card, i) => {
            const dist = (i - active + N) % N
            const pos = positionFor(dist, size)
            const isFront = dist === 0
            // Each tier (front / 2nd / 3rd) only becomes visible once its own
            // reveal stage has been reached, so the front card arrives first and
            // the other two follow — instead of everything fading in together.
            const revealGate = dist === 0 ? 1 : dist === 1 ? 2 : 3
            const isRevealed = revealStage >= revealGate
            return (
              <div key={card.title}
                onClick={() => (dist === 1 || dist === 2) && goTo(dist)}
                style={{
                  position: 'absolute', inset: 0, borderRadius: 20,
                  clipPath: 'polygon(4% 0%, 100% 0%, 96% 100%, 0% 100%)',
                  overflow: 'hidden', cursor: (dist === 1 || dist === 2) ? 'pointer' : 'default',
                  transform: `perspective(1000px) translateX(${pos.x}px) translateY(${isRevealed ? 0 : 36}px) scale(${isRevealed ? pos.scale : pos.scale * 0.92}) rotateY(${pos.rotateY}deg)`,
                  opacity: isRevealed ? pos.opacity : 0,
                  zIndex: pos.zIndex, pointerEvents: pos.opacity === 0 || !isRevealed ? 'none' : 'auto',
                  transition: `transform 0.85s ${EASE}, opacity 0.7s ease`,
                  boxShadow: isFront
                    ? '0 40px 90px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.35)'
                    : '0 20px 50px rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.image} alt={`${card.firstName} — ${card.title}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, padding: '40px 22px 20px',
                  background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.9))',
                }}>
                  <p style={{ margin: 0, fontSize: 21, fontWeight: 800, color: 'white' }}>{card.firstName}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 700, color: '#F0D48A' }}>{card.title}</p>
                  {isFront && (
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>{card.desc}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Dots — quick jump + progress indication */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 22 }}>
        {CARDS.map((card, i) => (
          <button key={card.title} aria-label={card.firstName} onClick={() => setActive(i)}
            style={{
              width: i === active ? 20 : 7, height: 7, borderRadius: 999, border: 'none', cursor: 'pointer',
              background: i === active ? 'white' : 'rgba(255,255,255,0.4)',
              transition: 'width 0.3s ease, background 0.3s ease', padding: 0,
            }} />
        ))}
      </div>

      <style>{`
        .mbc-hero-arrow {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 44px; height: 44px; border-radius: 999px; z-index: 60;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.18); backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.5); color: white;
          cursor: pointer; opacity: 0; transition: opacity 0.25s ease, background 0.2s ease;
        }
        .mbc-hero-arrow:hover { background: rgba(0,0,0,0.3); }
        .mbc-hero-arrow-left { left: max(12px, calc(50% - 560px)); }
        .mbc-hero-arrow-right { right: max(12px, calc(50% - 560px)); }
        .mbc-hero-stage:hover .mbc-hero-arrow { opacity: 1; }

        @media (max-width: 620px) {
          .mbc-hero-arrow { display: none; }
        }
      `}</style>
    </div>
  )
}
