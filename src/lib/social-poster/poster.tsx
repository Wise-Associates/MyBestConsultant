import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import type { PostImage } from '../social-content'
import { POSTER_HEIGHT, POSTER_WIDTH, titleFontSize } from './rules'

// Affiche des publications sur les réseaux (ADR 0015), dessinée par la plateforme : logo exact, textes exacts (accents
// compris), charte My Best Consultant. La scène photo (scene.ts) est facultative : sans elle, l'affiche reste complète.
// Rendu par next/og (Satori) : flexbox et positionnement absolu seulement, pas de grid.

const ANTHRACITE = '#2C2C2E'
const GOLD = '#E8A33D'
const SCENE_HEIGHT = 640

// Lus sur disque à la première affiche : next.config.ts les inclut dans la fonction de la route (outputFileTracingIncludes).
const FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'social-poster', 'fonts')
const LOGO_PATH = path.join(process.cwd(), 'public', 'logo.png')

type PosterFonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>['fonts']>

let assets: Promise<{ fonts: PosterFonts; logo: string }> | null = null

function loadAssets() {
  assets ??= (async () => {
    const font = (file: string) => readFile(path.join(FONT_DIR, file)).then(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
    const [regular, semibold, extrabold, italic, logo] = await Promise.all([
      font('Inter-Regular.ttf'), font('Inter-SemiBold.ttf'), font('Inter-ExtraBold.ttf'), font('Inter-Italic.ttf'), readFile(LOGO_PATH),
    ])
    return {
      fonts: [
        { name: 'Inter', data: regular, weight: 400 as const, style: 'normal' as const },
        { name: 'Inter', data: semibold, weight: 600 as const, style: 'normal' as const },
        { name: 'Inter', data: extrabold, weight: 800 as const, style: 'normal' as const },
        { name: 'Inter', data: italic, weight: 400 as const, style: 'italic' as const },
      ],
      logo: `data:image/png;base64,${logo.toString('base64')}`,
    }
  })().catch(err => {
    assets = null // nouvel essai à la prochaine affiche plutôt qu'un échec mémorisé
    throw err
  })
  return assets
}

/** Scène photo déjà générée (JPEG ou PNG), en data URI. */
export interface PosterScene { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }

function Poster({ image, logo, scene }: { image: PostImage; logo: string; scene: string | null }) {
  const where = [image.company, image.location].filter(Boolean).join(' — ')
  return (
    <div style={{ width: POSTER_WIDTH, height: POSTER_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', background: ANTHRACITE, fontFamily: 'Inter', color: '#FFFFFF' }}>
      {/* Fond dans son propre calque : dans Satori, un enfant en position absolue subit encore le centrage du parent. */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: POSTER_WIDTH, height: POSTER_HEIGHT, display: 'flex' }}>
        {scene ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og) ne dessine que des <img>, pas next/image */}
            <img src={scene} alt="" width={POSTER_WIDTH} height={SCENE_HEIGHT} style={{ width: POSTER_WIDTH, height: SCENE_HEIGHT, objectFit: 'cover' }} />
            <div style={{ position: 'absolute', top: 0, left: 0, width: POSTER_WIDTH, height: SCENE_HEIGHT, display: 'flex', backgroundImage: `linear-gradient(to bottom, rgba(44,44,46,0.55) 0%, rgba(44,44,46,0.05) 30%, rgba(44,44,46,0.45) 72%, ${ANTHRACITE} 100%)` }} />
          </>
        ) : (
          <div style={{ position: 'absolute', top: -260, left: 140, width: 800, height: 800, display: 'flex', borderRadius: 400, backgroundImage: 'radial-gradient(circle, rgba(232,163,61,0.28) 0%, rgba(232,163,61,0) 70%)' }} />
        )}
      </div>

      {/* Disque sombre derrière le logo sur une photo : il reste lisible quelle que soit la scène. */}
      <div style={{ display: 'flex', marginTop: 48, padding: 8, borderRadius: 90, background: scene ? 'rgba(32,32,34,0.6)' : 'transparent' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og) ne dessine que des <img>, pas next/image */}
        <img src={logo} alt="" width={156} height={156} style={{ width: 156, height: 156 }} />
      </div>
      <div style={{ display: 'flex', width: 120, height: 3, marginTop: 28, background: GOLD }} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: scene ? 'flex-end' : 'center', flexGrow: 1, width: '100%', padding: '0 80px', marginTop: scene ? 0 : 24 }}>
        <div style={{ display: 'flex', textAlign: 'center', justifyContent: 'center', fontSize: titleFontSize(image.title), fontWeight: 800, lineHeight: 1.08, letterSpacing: -1 }}>{image.title}</div>
        <div style={{ display: 'flex', width: 96, height: 6, marginTop: 26, borderRadius: 3, background: GOLD }} />
        {where && <div style={{ display: 'flex', marginTop: 26, fontSize: 36, fontWeight: 600, color: 'rgba(255,255,255,0.88)', textAlign: 'center' }}>{where}</div>}
        {image.facts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginTop: 30 }}>
            {image.facts.map(f => (
              <div key={f} style={{ display: 'flex', margin: '0 8px 12px', padding: '10px 26px', borderRadius: 40, background: GOLD, color: ANTHRACITE, fontSize: 28, fontWeight: 600 }}>{f}</div>
            ))}
          </div>
        )}
        {image.skills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            {image.skills.map(k => (
              <div key={k} style={{ display: 'flex', margin: '0 7px 10px', padding: '7px 20px', borderRadius: 30, border: `2px solid ${GOLD}`, fontSize: 24, fontWeight: 600 }}>{k}</div>
            ))}
          </div>
        )}
        {image.tagline && <div style={{ display: 'flex', marginTop: 22, fontSize: 32, fontStyle: 'italic', textAlign: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.92)', lineHeight: 1.3 }}>{image.tagline}</div>}
        <div style={{ display: 'flex', marginTop: 36, marginBottom: 40, padding: '20px 46px', borderRadius: 50, background: GOLD, color: ANTHRACITE, fontSize: 30, fontWeight: 800 }}>Postulez sur mybestconsultant.fr</div>
      </div>

      <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', padding: '22px 64px', background: '#202022', fontSize: 22, color: 'rgba(255,255,255,0.75)' }}>
        <span style={{ fontWeight: 600 }}>My Best Consultant</span>
        <span>mybestconsultant.fr</span>
      </div>
    </div>
  )
}

/** Affiche PNG 1080 × 1350 d'une publication (ou de l'exemple), avec la scène photo si elle existe. */
export async function renderPoster(image: PostImage, scene: PosterScene | null): Promise<Uint8Array> {
  const { fonts, logo } = await loadAssets()
  const sceneUri = scene ? `data:${scene.mime};base64,${Buffer.from(scene.bytes).toString('base64')}` : null
  const response = new ImageResponse(<Poster image={image} logo={logo} scene={sceneUri} />, { width: POSTER_WIDTH, height: POSTER_HEIGHT, fonts })
  return new Uint8Array(await response.arrayBuffer())
}
