'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileUp, FolderSearch, Gauge, LifeBuoy, MessageCircle, Mic, Sparkles, Wand2, Columns3, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

// ── Catalogue : les 9 fonctionnalités, dans l'ordre du parcours de recrutement ─────────────────
// Chaque capture est une vraie page de la plateforme (public/homepage/features/app-*.png).

type Feature = {
  title: string
  short: string        // une ligne, visible dans la liste
  tag: string
  desc: string
  points: string[]
  stat: { value: string; label: string }
  image: string
  alt: string
  Icon: LucideIcon
}

const P = '/homepage/features/'

const FEATURES: Feature[] = [
  {
    title: "Import automatique d'offres", short: 'CSV, Excel, Word, PDF ou texte brut', tag: 'Publication', Icon: FileUp,
    desc: "Déposez vos besoins dans le format de votre choix : l'IA en extrait les informations et structure l'annonce à votre place.",
    points: ['PDF, Word, Excel, PowerPoint, CSV ou TXT (5 Mo max)', 'Ou collez simplement le texte de l’offre', "Choix du modèle d'IA : rapide ou précis", 'Extraction et mise en forme automatiques'],
    stat: { value: '6 formats', label: 'de fichiers pris en charge' },
    image: P + 'app-import.png', alt: "Écran d'import automatique d'offres : dépôt d'un fichier ou collage de texte",
  },
  {
    title: "Assistant IA de rédaction d'annonce", short: 'Une annonce complète en un clic', tag: 'Publication', Icon: Wand2,
    desc: "Décrivez le besoin en quelques mots : l'assistant rédige l'annonce complète, que vous ajustez avant de publier.",
    points: ["Génération à partir d'un simple brief libre", 'Bibliothèque de vos anciennes offres comme point de départ', 'Titre, lieu, contrat, télétravail, TJM et compétences', 'Offre visible 1 mois puis désactivée automatiquement'],
    stat: { value: '1 clic', label: "pour générer l'annonce" },
    image: P + 'app-redaction.png', alt: "Fenêtre « Nouvelle offre » avec l'assistant IA de rédaction",
  },
  {
    title: 'CVthèque avec filtres avancés', short: 'Trouvez le bon profil en quelques secondes', tag: 'Sourcing', Icon: FolderSearch,
    desc: 'Recherchez dans toute la base candidats par compétence, secteur ou mission recherchée, avec des critères précis.',
    points: ['Mots-clés à inclure et mots à exclure', 'Rayon de mobilité, de 0 à 100 km et plus', "Séniorité, de 0 à plus de 15 ans d'expérience", 'Localisation et secteur'],
    stat: { value: '5 filtres', label: 'combinables pour cibler' },
    image: P + 'app-cvtheque.png', alt: 'CVthèque : critères de recherche par mots-clés, mobilité et séniorité',
  },
  {
    title: 'Matching & Scoring', short: "L'IA rapproche profils et offres", tag: 'Matching IA', Icon: Sparkles,
    desc: "Pour chaque offre, l'IA compare la base de candidats, votre vivier et les candidatures reçues, puis classe les profils les plus pertinents.",
    points: ['Score de compatibilité sur 100, justifié en quelques lignes', 'Origine de chaque profil : base, vivier, candidature ou chasseur', 'Date et heure du matching, mis à jour à chaque nouveau candidat', 'Sélectionnez qui lancer en screening ou passer au pipeline'],
    stat: { value: '/100', label: 'un score clair pour chaque profil' },
    image: P + 'app-matching.webp', alt: 'Matching IA : profils classés avec score de compatibilité',
  },
  {
    title: 'Screening et scoring des CV', short: 'Score, résumé et recommandation', tag: 'Screening IA', Icon: Gauge,
    desc: "Analysez tous les CV d'une offre d'un coup : chacun reçoit un score, un niveau de profil et une recommandation argumentée.",
    points: ['Répartition : top profil, bon, moyen, faible, à rejeter', 'Score moyen et recherche dans les résultats', 'Critères de scoring pondérés selon vos priorités', 'Invitation à un entretien IA ou message personnalisé en un clic'],
    stat: { value: '5 niveaux', label: 'de profil, du top au à-rejeter' },
    image: P + 'app-screening.png', alt: 'Screening IA : répartition des profils par score et actions rapides',
  },
  {
    title: "Entretien virtuel mené par l'IA", short: 'Alex, votre recruteur IA', tag: 'Entretien IA', Icon: Mic,
    desc: "Un agent IA fait passer l'entretien au candidat, à la voix ou par écrit, puis transcrit et analyse chaque réponse pour vous.",
    points: ["Questions adaptées à l'offre (12 questions, 15 à 20 min)", 'Réponses à la voix ou par écrit, voix de l’IA activable', 'Entretien vidéo, caméra activable', 'Transcription et analyse remises au recruteur'],
    stat: { value: '15–20 min', label: "d'entretien, sans mobiliser votre équipe" },
    image: P + 'app-entretien-ia.webp', alt: "Page d'accueil de l'entretien IA présentée au candidat",
  },
  {
    title: 'Pipeline de recrutement', short: 'Chaque candidature, étape par étape', tag: 'Pipeline', Icon: Columns3,
    desc: 'Suivez vos candidats de la réception à la décision, avec le score de matching et les actions utiles sur chaque carte.',
    points: ['En attente, screening IA, entretien, accepté, vivier, refusé', 'Étapes personnalisables selon votre process', 'Score minimum réglable et tri par score', 'Entretien vidéo, message, WhatsApp et historique en un tap'],
    stat: { value: '6 étapes', label: 'par défaut, entièrement personnalisables' },
    image: P + 'app-pipeline.webp', alt: 'Pipeline de recrutement : cartes candidats par étape avec scores',
  },
  {
    title: 'Contact direct WhatsApp', short: 'Écrivez au candidat en un clic', tag: 'Contact', Icon: MessageCircle,
    desc: 'Depuis le pipeline ou la CVthèque, ouvrez une conversation WhatsApp avec un message déjà rédigé, prêt à être envoyé.',
    points: ['Modèles : premier contact, proposer un échange, relance, libre', 'Message pré-rempli et modifiable', 'Envoyé depuis votre propre WhatsApp', "Réservé aux candidats qui ont accepté d'être contactés"],
    stat: { value: '4 modèles', label: 'de message prêts à l’emploi' },
    image: P + 'app-whatsapp.png', alt: 'Fenêtre de contact WhatsApp avec choix du modèle de message',
  },
  {
    title: 'Help Desk et gestion des tickets', short: 'Un support intégré à la plateforme', tag: 'Support', Icon: LifeBuoy,
    desc: 'Vos utilisateurs ouvrent une demande sans quitter la plateforme, et suivent son traitement jusqu’à la réponse.',
    points: ['Création de demande : question, problème ou suggestion', 'Suivi par statut : toutes, en cours, terminées', 'Réponses dans la plateforme et par email', 'Numéro de ticket pour chaque demande'],
    stat: { value: 'Suivi', label: "de chaque demande, de l'envoi à la réponse" },
    image: P + 'app-helpdesk.png', alt: 'Aide et support : liste des demandes avec leur statut',
  },
]

const GOLD = '#C49A3C'
const TEXT_DARK = '#221B0C'
const TEXT_MUTED = '#736B5A'
const AUTO_MS = 3500   // délai entre deux fonctionnalités
const HOLD_MS = 9000   // pause après une action de l'utilisateur, puis le défilement reprend

function Detail({ f }: { f: Feature }) {
  return (
    <>
      <p className="mbc-fx-desc">{f.desc}</p>
      <ul className="mbc-fx-points">
        {f.points.map(p => (
          <li key={p}><span className="mbc-fx-check"><Check style={{ width: 11, height: 11 }} strokeWidth={3} /></span>{p}</li>
        ))}
      </ul>
      <div className="mbc-fx-stat"><strong>{f.stat.value}</strong><span>{f.stat.label}</span></div>
    </>
  )
}

export function HomepageFeatures({ title, subtitle }: { title: string; subtitle: string }) {
  const [active, setActive] = useState(0)
  const [hold, setHold] = useState(false)       // le visiteur vient d'agir : on laisse lire
  const [touched, setTouched] = useState(false) // les flèches arrêtent de « respirer » après la 1re action
  const [inView, setInView] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const N = FEATURES.length
  const playing = inView && !hold

  // Action du visiteur (clic, flèche, balayage) : on change et on suspend un instant le défilement automatique.
  const choose = (i: number) => {
    setActive(((i % N) + N) % N)
    setTouched(true)
    setHold(true)
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => setHold(false), HOLD_MS)
  }

  // Défilement automatique : chaque fonctionnalité reste AUTO_MS, seulement quand la section est visible.
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => setActive(a => (a + 1) % N), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, playing, N])

  // On charge d'avance la capture suivante pour que le fondu ne passe jamais par un blanc.
  useEffect(() => { new Image().src = FEATURES[(active + 1) % N].image }, [active, N])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current; swipe.current = null
    if (!s) return
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) choose(active + (dx < 0 ? 1 : -1))
  }

  const f = FEATURES[active]

  return (
    <section id="fonctionnalites" className="mbc-fx">
      <div className="mbc-fx-wrap">
        <div className="mbc-fx-hd">
          <div>
            <span className="mbc-fx-eyebrow">De l’offre à l’embauche</span>
            <h2 style={{ color: TEXT_DARK, fontWeight: 700 }}>{title}</h2>
          </div>
          <p>{subtitle}</p>
        </div>

        <div ref={stageRef} className="mbc-fx-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="mbc-fx-glow" aria-hidden />

          {/* Liste des fonctionnalités (ordinateur) */}
          <div className="mbc-fx-tabs" role="list">
            {FEATURES.map((x, i) => {
              const on = i === active
              return (
                <div key={x.title} role="listitem" className={`mbc-fx-row${on ? ' on' : ''}`}>
                  <button type="button" className="mbc-fx-head" onClick={() => choose(i)} aria-current={on ? 'true' : undefined}>
                    <span className="mbc-fx-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="mbc-fx-ico"><x.Icon style={{ width: 17, height: 17 }} /></span>
                    <span className="mbc-fx-tt"><strong>{x.title}</strong><em>{x.short}</em></span>
                  </button>
                  {on && playing && <span className="mbc-fx-bar" />}
                </div>
              )
            })}
          </div>

          {/* Téléphone : les 9 captures sont empilées, on fond de l'une à l'autre */}
          <div className="mbc-fx-phone-col">
            <div className="mbc-fx-phone-row">
              <button type="button" className={`mbc-fx-arrow prev${touched ? '' : ' nudge'}`} onClick={() => choose(active - 1)} aria-label="Fonctionnalité précédente"><ChevronLeft strokeWidth={2.75} /></button>
              <div className="mbc-fx-phone">
                <div className="mbc-fx-frame">
                  {FEATURES.map((x, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={x.image} src={x.image} alt={i === active ? x.alt : ''} aria-hidden={i !== active} width={370} height={786}
                      loading={i < 2 ? 'eager' : 'lazy'} decoding="async" className={`mbc-fx-shot${i === active ? ' on' : ''}`} />
                  ))}
                </div>
              </div>
              <button type="button" className={`mbc-fx-arrow next${touched ? '' : ' nudge'}`} onClick={() => choose(active + 1)} aria-label="Fonctionnalité suivante"><ChevronRight strokeWidth={2.75} /></button>
            </div>
            <div className="mbc-fx-dots" role="tablist" aria-label="Choisir une fonctionnalité">
              {FEATURES.map((x, i) => (
                <button key={x.title} type="button" role="tab" aria-selected={i === active} aria-label={x.title} className={i === active ? 'on' : ''} onClick={() => choose(i)} />
              ))}
            </div>
            <p className="mbc-fx-caption">{String(active + 1).padStart(2, '0')} / {String(N).padStart(2, '0')} · {f.tag}</p>
          </div>

          {/* Détail de la fonctionnalité affichée */}
          <div className="mbc-fx-detail" key={active} aria-live="polite">
            <span className="mbc-fx-tag">{f.tag}</span>
            <h3>{f.title}</h3>
            <Detail f={f} />
          </div>
        </div>
      </div>

      <style>{`
        /* La section occupe tout l'écran : l'encadré sombre s'y ajuste (mesures en svh, replis en vh). */
        .mbc-fx { background: #FFFFFF; min-height: 100vh; min-height: 100svh; display: flex; flex-direction: column; justify-content: center; padding: 84px 0 24px; box-sizing: border-box; }
        .mbc-fx-wrap { width: 100%; max-width: 1280px; margin: 0 auto; padding: 0 24px; box-sizing: border-box; }
        .mbc-fx-hd { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 32px; flex-wrap: wrap; margin-bottom: 18px; }
        .mbc-fx-eyebrow { display: inline-block; padding: 3px 12px; border-radius: 999px; background: rgba(196,154,60,0.12); color: #8a6d1f; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
        .mbc-fx-hd h2 { margin: 0; font-size: clamp(24px, 2.6vw, 34px); line-height: 1.1; }
        .mbc-fx-hd p { margin: 0; max-width: 540px; font-size: 14px; line-height: 1.5; color: ${TEXT_MUTED}; }

        .mbc-fx-stage {
          --fx-h: max(520px, calc(100vh - 200px)); --fx-h: max(520px, calc(100svh - 200px));
          position: relative; overflow: hidden; box-sizing: border-box; min-height: var(--fx-h);
          border-radius: 32px; padding: 24px 32px;
          background: linear-gradient(160deg, #5b6270 0%, #454b57 100%);
          border: 1px solid rgba(196,154,60,0.28); box-shadow: 0 30px 70px rgba(20,16,6,0.22);
          display: grid; grid-template-columns: minmax(290px, 390px) auto minmax(0, 1fr); gap: 34px; align-items: center;
        }
        .mbc-fx-glow { position: absolute; left: 44%; top: 50%; width: 560px; height: 560px; transform: translate(-50%, -50%); border-radius: 50%;
          background: radial-gradient(circle, rgba(196,154,60,0.2), transparent 68%); pointer-events: none; }

        /* ── Liste ── */
        .mbc-fx-tabs { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .mbc-fx-row { position: relative; overflow: hidden; border-radius: 14px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); transition: background 0.45s ease, border-color 0.45s ease, transform 0.45s ease; }
        .mbc-fx-row:hover { background: rgba(255,255,255,0.07); }
        .mbc-fx-row.on { background: rgba(196,154,60,0.13); border-color: rgba(196,154,60,0.6); transform: translateX(6px); }
        .mbc-fx-head { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 12px; cursor: pointer; }
        .mbc-fx-head:focus-visible { outline: 2px solid ${GOLD}; outline-offset: -2px; border-radius: 14px; }
        .mbc-fx-num { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: rgba(255,255,255,0.32); width: 18px; flex-shrink: 0; transition: color 0.45s ease; }
        .mbc-fx-row.on .mbc-fx-num { color: ${GOLD}; }
        .mbc-fx-ico { width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.72); transition: background 0.45s ease, color 0.45s ease, box-shadow 0.45s ease; }
        .mbc-fx-row.on .mbc-fx-ico { background: linear-gradient(135deg, ${GOLD}, #B8862A); color: #fff; box-shadow: 0 8px 20px rgba(196,154,60,0.35); }
        .mbc-fx-tt { display: flex; flex-direction: column; min-width: 0; }
        .mbc-fx-tt strong { font-size: 13.5px; font-weight: 700; color: rgba(255,255,255,0.82); line-height: 1.3; transition: color 0.45s ease; }
        .mbc-fx-row.on .mbc-fx-tt strong { color: #fff; }
        .mbc-fx-tt em { font-style: normal; font-size: 12px; line-height: 1.4; color: rgba(255,255,255,0.55); max-height: 0; opacity: 0; overflow: hidden; transition: max-height 0.45s ease, opacity 0.45s ease; }
        .mbc-fx-row.on .mbc-fx-tt em { max-height: 20px; opacity: 1; margin-top: 2px; }
        .mbc-fx-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; transform-origin: left; background: linear-gradient(90deg, ${GOLD}, #e6c374); animation: mbc-fx-fill ${AUTO_MS}ms linear forwards; }
        @keyframes mbc-fx-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes mbc-fx-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

        /* ── Téléphone (dimensionné d'après la hauteur disponible) ── */
        .mbc-fx-phone-col { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
        .mbc-fx-phone-row { display: flex; align-items: center; justify-content: center; }
        .mbc-fx-phone { container-type: inline-size; height: calc(var(--fx-h) - 48px - 34px); width: calc((var(--fx-h) - 82px) * 0.5); }
        .mbc-fx-frame { position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; border-radius: 37px; border-radius: 12.6cqw; box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 40px 80px rgba(0,0,0,0.55); }
        .mbc-fx-shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transform: scale(1.03); transition: opacity 0.7s ease, transform 0.9s ease; }
        .mbc-fx-shot.on { opacity: 1; transform: none; }
        .mbc-fx-caption { margin: 12px 0 0; font-size: 11.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45); text-align: center; }
        .mbc-fx-arrow, .mbc-fx-dots { display: none; }

        /* ── Détail ── */
        .mbc-fx-detail { position: relative; z-index: 1; min-width: 0; animation: mbc-fx-in 0.55s ease; }
        .mbc-fx-tag { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(196,154,60,0.2); color: #e6c374; }
        .mbc-fx-detail h3 { margin: 12px 0 10px; font-size: clamp(22px, 2.3vw, 30px); font-weight: 700; line-height: 1.2; color: #fff; }
        .mbc-fx-desc { margin: 0 0 16px; font-size: 15px; line-height: 1.65; color: rgba(255,255,255,0.74); }
        .mbc-fx-points { list-style: none; margin: 0 0 18px; padding: 0; display: grid; gap: 10px; }
        .mbc-fx-points li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.5; color: rgba(255,255,255,0.86); }
        .mbc-fx-check { width: 19px; height: 19px; border-radius: 50%; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; background: rgba(196,154,60,0.22); color: #e6c374; }
        .mbc-fx-stat { display: inline-flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 10px 16px; border-radius: 12px; background: rgba(0,0,0,0.28); border: 1px solid rgba(196,154,60,0.28); }
        .mbc-fx-stat strong { font-size: 22px; font-weight: 800; color: #e6c374; }
        .mbc-fx-stat span { font-size: 13px; color: rgba(255,255,255,0.62); }

        @media (max-width: 1100px) {
          .mbc-fx-stage { grid-template-columns: minmax(230px, 290px) auto minmax(0, 1fr); gap: 26px; padding: 22px 24px; }
          .mbc-fx-tt em { display: none; }
          .mbc-fx-desc { font-size: 14px; }
          .mbc-fx-points li { font-size: 13px; }
        }

        /* ── Mobile et tablette : une fonctionnalité à la fois, flèches + balayage ── */
        @media (max-width: 899px) {
          .mbc-fx { padding: 78px 0 14px; }
          .mbc-fx-wrap { padding: 0 12px; }
          .mbc-fx-hd { margin-bottom: 10px; }
          .mbc-fx-hd p, .mbc-fx-eyebrow { display: none; }
          .mbc-fx-hd h2 { font-size: 24px; }
          .mbc-fx-stage {
            --fx-h: max(500px, calc(100vh - 150px)); --fx-h: max(500px, calc(100svh - 150px));
            grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 14px 14px 18px; border-radius: 26px; align-content: center;
          }
          .mbc-fx-glow { left: 50%; top: 26%; width: 380px; height: 380px; }
          .mbc-fx-tabs { display: none; }

          .mbc-fx-phone-col { width: 100%; }
          .mbc-fx-phone-row { width: 100%; gap: 6px; justify-content: space-between; }
          /* Le téléphone est « coupé » en bas et se fond dans le fond sombre : on lit l'écran sans qu'il prenne toute la hauteur. */
          .mbc-fx-phone { width: min(236px, 58vw); height: clamp(190px, 33vh, 330px); height: clamp(190px, 33svh, 330px); }
          .mbc-fx-frame { border-radius: 12.6cqw 12.6cqw 0 0; box-shadow: none;
            -webkit-mask-image: linear-gradient(to bottom, #000 68%, transparent 100%); mask-image: linear-gradient(to bottom, #000 68%, transparent 100%); }
          .mbc-fx-shot { height: auto; inset: 0 0 auto 0; object-fit: fill; }

          .mbc-fx-arrow { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 46px; height: 46px; border-radius: 50%; border: 0; cursor: pointer; color: #fff;
            background: linear-gradient(135deg, ${GOLD}, #B8862A); box-shadow: 0 8px 22px rgba(196,154,60,0.45), 0 0 0 4px rgba(196,154,60,0.18); -webkit-tap-highlight-color: transparent; }
          .mbc-fx-arrow svg { width: 26px; height: 26px; }
          .mbc-fx-arrow:active { transform: scale(0.92); }
          .mbc-fx-arrow.nudge.prev { animation: mbc-fx-nudge-l 1.5s ease-in-out infinite; }
          .mbc-fx-arrow.nudge.next { animation: mbc-fx-nudge-r 1.5s ease-in-out infinite; }
          @keyframes mbc-fx-nudge-l { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-5px); } }
          @keyframes mbc-fx-nudge-r { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(5px); } }

          .mbc-fx-dots { display: flex; justify-content: center; gap: 6px; margin-top: 4px; }
          .mbc-fx-dots button { all: unset; box-sizing: border-box; width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.25); cursor: pointer; transition: width 0.4s ease, background 0.4s ease; }
          .mbc-fx-dots button.on { width: 24px; background: ${GOLD}; }
          .mbc-fx-caption { margin-top: 8px; }

          .mbc-fx-detail { padding: 16px 16px 16px; border-radius: 20px; background: rgba(196,154,60,0.1); border: 1px solid rgba(196,154,60,0.4); }
          .mbc-fx-detail h3 { margin: 10px 0 8px; font-size: 19px; }
          .mbc-fx-desc { font-size: 13.5px; line-height: 1.55; margin-bottom: 12px; }
          .mbc-fx-points { gap: 7px; margin-bottom: 12px; }
          .mbc-fx-points li { font-size: 12.5px; }
          .mbc-fx-points li:nth-child(n+3) { display: none; }
          .mbc-fx-stat { padding: 7px 13px; }
          .mbc-fx-stat strong { font-size: 18px; }
        }
        /* Écrans courts : on garde l'essentiel pour que tout tienne dans l'écran */
        @media (max-width: 899px) and (max-height: 760px) {
          .mbc-fx-points { display: none; }
          .mbc-fx-desc { margin-bottom: 10px; }
        }
        @media (max-width: 899px) and (max-height: 640px) {
          .mbc-fx-caption { display: none; }
          .mbc-fx-phone { height: clamp(150px, 28vh, 330px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mbc-fx-shot, .mbc-fx-row, .mbc-fx-tt em { transition: none; }
          .mbc-fx-detail { animation: none; }
          .mbc-fx-arrow.nudge { animation: none !important; }
        }
      `}</style>
    </section>
  )
}
