// Mise en page du tableau de bord sur grand écran (demande du 2026-11-06 : utiliser les marges vides) :
// - à partir de 1440 px, la recherche, « À traiter » et les filtres passent dans un rail collant à gauche de la liste ;
// - à partir de 1800 px, un panneau d'aperçu à droite montre l'offre choisie (clic sur la ligne).
// En dessous de 1440 px, la page reste celle d'avant. Les classes Tailwind `min-[1440px]:` et `min-[1800px]:` des
// fichiers du tableau de bord reprennent ces deux largeurs : les changer ensemble.

/** Requête média du panneau d'aperçu, lue au clic sur une ligne (aperçu ou ouverture du matching). */
export const PREVIEW_MEDIA = '(min-width: 1800px)'
