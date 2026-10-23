import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB request body limit — uploadFullInterviewRecording
    // (the interview's merged audio/video recording, sent as one multipart blob) blows
    // past that almost immediately for anything beyond a few seconds of audio, let alone
    // video. Every recording upload was failing with a generic "unexpected response from
    // the server" — the request never even reached the action's own code, Next.js was
    // rejecting the oversized body first. Raised to match the Appwrite recordings bucket's
    // own 25MB cap, so that limit (which returns a clear, specific error) is what actually
    // gates upload size instead of this one.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  // Modèles Word de l'export de CV au format ESN, lus sur disque par src/lib/cv-export/templates.ts (modèle Wise
  // Associates par défaut de la plateforme, exemple téléchargeable) : sans cette inclusion, ils ne seraient pas copiés
  // dans les fonctions Vercel de ces routes.
  outputFileTracingIncludes: {
    "/api/admin/cv-export/*": ["./src/lib/cv-export/templates/**/*"],
    "/api/admin/cv-templates/*": ["./src/lib/cv-export/templates/**/*"],
    // Les recruteurs n'ont que l'exemple (sans le contact commercial du modèle Wise) : seul ce dossier.
    "/api/recruiter/cv-templates/example": ["./src/lib/cv-export/templates/example/**/*"],
    // Affiche des publications sur les réseaux : polices Inter et logo lus sur disque au rendu (lib/social-poster).
    "/api/social/poster/*": ["./src/lib/social-poster/fonts/**/*", "./public/logo.png"],
  },
  // La page AO Offers s'appelle « Candidats » (2026-10-21) : l'ancienne adresse reste valable.
  async redirects() {
    return [
      { source: "/admin/ao-offers", destination: "/admin/candidats", permanent: true },
      { source: "/admin/ao-offers/:path*", destination: "/admin/candidats/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
