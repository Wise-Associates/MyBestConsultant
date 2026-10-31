# 0022 — « Mon espace » du recruteur et affectation des recrutements

- Statut : accepté
- Date : 2026-10-31
- Complète : 0021 (parcours consultant)

## Contexte

Demande de Dav (2026-10-31) : un espace pour chaque recruteur, avec une vue d'ensemble de ses recrutements en cours et
de leur avancement, d'où il entre dans chaque recrutement pour le faire avancer ; en haut, le nombre de recrutements en
cours, combien sont en matching, combien ont eu au moins un entretien, combien ont une recrue validée ; la liste des
recrutements en ligne avec leur statut ; l'import de son vivier depuis son ordinateur ; et, sur la page d'un appel
d'offres, l'affectation du besoin à un recruteur (« Fanny », « Hanta ») : à la publication, le besoin arrive dans son
espace.

## Décision

- **Recrutement = offre de l'organisation** (`jobs`). Recruteur affecté : `jobs.recruiterId`, attribut déjà présent
  et inutilisé (16/16 attributs), = identifiant Auth du recruteur (`UserProfile.userId`, comme `tenants.recruiterId`).
  Une offre créée depuis le tableau de bord est affectée à celui qui la crée.
- **Appel d'offres non publié** : recruteur gardé dans `ao_offer_details.assigneeId` (`ao_offers` est à 16/16), choisi
  sur la page de l'offre (`AoAssignee`, recruteurs de l'organisation seulement) et repris par la publication. Changer
  le recruteur d'un AO déjà publié change aussi celui de l'offre publiée, et inversement depuis « Mon espace ».
- **Niveau d'un recrutement** (`src/lib/recruiter-workspace.ts`, pur, testé) : celui de son candidat le plus avancé.
  Recrue validée = candidature acceptée ou parcours consultant arrivé au contrat (le client l'a retenu) ; entretiens =
  au moins un entretien IA, candidature à l'étape « entretien » ou parcours arrivé aux entretiens ; sinon matching
  (aussi sans candidat). Candidats refusés et parcours abandonnés écartés. Les chiffres du haut portent sur les
  recrutements en ligne.
- **Page** `/recruiter/espace` (première rubrique du sous-menu) : « Mes recrutements » (affectés au recruteur) et
  « Toute l'équipe » (tous, avec un sélecteur pour réaffecter). « Ouvrir » mène au pipeline de l'offre, où le
  processus avance. Le vivier reste la page du vivier (CV visibles de celui qui les importe) : l'espace en montre le
  nombre et un bouton « Importer mes CV ».
- **Un seul bloc, sans onglets** (demande du 2026-10-31, après la première version) : « Mon espace » n'a pas le
  sous-menu des autres pages (`showsRecruiterSubnav`, `recruiter-nav.ts`, testé). Un même bloc regroupe les chiffres,
  une tuile par rubrique de l'espace recruteur (mêmes libellés et adresses que le sous-menu) avec son chiffre — offres
  en ligne, appels d'offres à valider, parcours en cours, CV du vivier, recruteurs, entretiens — et la liste des
  recrutements. Un chiffre illisible laisse la tuile sans chiffre. Les autres pages gardent le sous-menu, dont
  « Mon espace » est la première rubrique.

## Conséquences

- Les offres existantes n'ont pas de recruteur : elles apparaissent dans « Toute l'équipe » comme « Non affecté »,
  à affecter une fois.
- Mise en place : attribut `assigneeId` de `ao_offer_details` (`npm run schema:push -- dev` ; production par un
  humain avant la mise en production). Sans lui, l'affectation d'un AO non publié échoue avec un message ; le reste
  marche.
- Les appels d'offres de la plateforme (`/admin/candidats`) n'ont pas d'affectation : la plateforme n'a pas d'équipe
  de recruteurs.
