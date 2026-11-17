// Mise en page du tableau de bord sur grand écran (demande du 2026-11-06 : utiliser les marges vides) :
// - à partir de 1440 px, lignes plus compactes (le rail de filtres de gauche a été retiré le 2026-11-17 : les filtres sont
//   dans le panneau du bouton « Filtres ») ;
// - à partir de 1800 px, un panneau d'aperçu à droite montre l'offre choisie, fermé par défaut : il s'ouvre par le bouton
//   « Aperçu » d'une ligne et se ferme par ce bouton ou sa croix (demande du 2026-11-17 : plus affiché d'office).
// Les classes Tailwind `min-[90rem]:` (1440 px) et `min-[112.5rem]:` (1800 px) des fichiers du tableau de bord reprennent
// ces deux largeurs : les changer ensemble. En rem et non en px : Tailwind range alors ces variantes après `sm:` / `lg:`,
// sinon `lg:py-4.5` l'emporterait.

/**
 * Colonnes de « Mes offres » à partir de 1024 px ; en dessous, la ligne passe sur deux colonnes (carte). À partir de
 * 1440 px la colonne « Candidatures » s'élargit pour que « 30 correspondances IA » tienne sur une
 * ligne et « Voir pipeline » passe en toutes lettres ; à partir de 1800 px (panneau
 * d'aperçu) elles gagnent le bouton « Aperçu ». Repris par le squelette de chargement (page-skeletons.tsx).
 */
export const ROW_GRID = 'grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_124px_200px_180px_176px] min-[90rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_272px] min-[112.5rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_316px] gap-x-5'
