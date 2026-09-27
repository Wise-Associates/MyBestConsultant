import { HeroCardCarousel } from './hero-card-carousel'

export function HomepageHero() {
  return (
    <section className="mbc-hero" style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(150deg, #E6B94F 0%, #D4A73E 50%, #B8862E 100%)',
    }}>
      {/* Card zone — desktop/tablet: the giant wordmark sits absolutely behind the card,
          Bumble-style, deliberately cut across by it. Mobile hides this overlapping
          wordmark (too cramped on narrow screens) in favor of the dedicated text zone below. */}
      <div className="mbc-hero-cardzone">
        <span aria-hidden className="mbc-hero-wordmark">MY BEST CONSULTANT</span>
        <div style={{ position: 'relative', zIndex: 2, width: '100%' }}>
          <HeroCardCarousel />
        </div>
      </div>

      {/* Mobile-only text zone — bottom 1/4 of the hero, cards take the top 3/4. */}
      <div aria-hidden className="mbc-hero-textzone">MY BEST CONSULTANT</div>

      <style>{`
        .mbc-hero {
          display: flex; flex-direction: column;
          padding-top: 108px; padding-bottom: 64px; min-height: 75vh;
        }
        .mbc-hero-cardzone {
          position: relative; flex: 1;
          display: flex; align-items: center; justify-content: center;
        }
        @keyframes mbc-wordmark-in {
          from { opacity: 0; transform: translateY(34px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .mbc-hero-wordmark {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          pointer-events: none; user-select: none; overflow: hidden;
          font-family: var(--font-heading); font-weight: 800; letter-spacing: -0.02em;
          /* Plus petit, centré, avec des marges latérales : le texte n'est plus coupé sur les côtés. */
          font-size: clamp(1.8rem, 6.1vw, 7.4rem); line-height: 1; white-space: nowrap; text-align: center;
          padding: 0 clamp(32px, 8vw, 140px); box-sizing: border-box;
          color: #2C2C2E;
          opacity: 0;
          animation: mbc-wordmark-in 1s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
        }
        .mbc-hero-textzone { display: none; }

        @media (max-width: 620px) {
          /* Total hero height (padding + zones) targets ~3/4 of the viewport, so the
             next section is already peeking at the bottom on first load. */
          .mbc-hero { padding-top: 76px; padding-bottom: 0; min-height: 0; }
          .mbc-hero-cardzone { flex: none; height: 52vh; }
          .mbc-hero-wordmark { display: none; }
          .mbc-hero-textzone {
            display: flex; align-items: center; justify-content: center; height: 17vh;
            color: #2C2C2E; font-family: var(--font-heading); font-weight: 800;
            letter-spacing: -0.02em; font-size: clamp(1.5rem, 8vw, 2.3rem); text-align: center;
            line-height: 1.1; padding: 0 20px;
            opacity: 0;
            animation: mbc-wordmark-in 1s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
          }
        }
      `}</style>
    </section>
  )
}
