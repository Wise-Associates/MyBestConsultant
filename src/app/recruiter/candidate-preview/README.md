# Profil du candidat — `/recruiter/candidate-preview/[source]/[id]`

Fiche légère d'un candidat qui **n'a pas postulé** à l'offre, ouverte depuis le Matching IA d'une offre
(`/recruiter/pipeline/<offre>/matching`) : un candidat de la base (`source` = `pool`) ou un CV d'un vivier (`source` =
`vivier`). La fiche complète `/recruiter/candidates/[applicationId]` exige une candidature, d'où cette page
(commentaire du code). Elle montre l'identité, les coordonnées, le résumé d'expérience, les compétences et le lien vers
le CV ; aucune action.
Décisions : [0026](../../../../docs/adr/0026-correspondances-vivier-general-indexees.md) (vivier personnel dans le
Matching IA). Règles produit : [AGENTS.md](../../../../AGENTS.md), section « Vivier général des recruteurs (matching
automatique) », point « Matching IA d'une offre » (« Fiche (`/recruiter/candidate-preview/vivier/<id>`) et CV … »).

## Fichiers

```
[source]/[id]/page.tsx   composant serveur : choix de la source, contrôle d'accès, lecture du profil, rendu
```

Code partagé :

- [matching-client.tsx](<../pipeline/[jobId]/matching/matching-client.tsx>) — `profileHref` construit les liens vers
  cette page (`pool/<candidateId>`, `vivier/<id du CV>`) et vers la fiche d'une candidature.
- [cv-profile-extract.ts](../../../lib/cv-profile-extract.ts) — type `CvProfile` (contenu de `cvProfileJson`).
- [api/cv/[fileId]/route.ts](<../../api/cv/[fileId]/route.ts>) et
  [api/vivier-cv/[fileId]/route.ts](<../../api/vivier-cv/[fileId]/route.ts>) — « Voir le CV ».
- [back-link.tsx](../../../components/recruiter/back-link.tsx) — « Retour ».

## Accès et périmètre des données

- `src/middleware.ts` puis le layout `src/app/recruiter/layout.tsx` (rôle `recruiter` seulement).
- `page.tsx` : rôle `recruiter` ou `admin`, sinon `redirect('/login')`. À vérifier : la branche `admin` n'est pas
  atteignable, le layout ne laissant passer que `recruiter`.
- Lectures par `createAdminClient()` (clé API serveur).
- `source` :
  - `application` → `redirect('/recruiter/candidates/<id>')` (la fiche complète fait ses propres contrôles) ;
  - `pool` → document `users[id]` ; illisible ou de rôle autre que `candidate` → `notFound()`. **Aucun contrôle
    d'organisation** : comme la CV Thèque, tout candidat de la base est lisible par son identifiant ;
  - `vivier` → document `vivier_cvs[id]` ; illisible → `notFound()` ; **vivier personnel** : le CV doit être de
    l'organisation de l'appelant (`doc.tenantId === user.tenantId`) et importé par lui (`doc.recruiterId === user.$id`),
    un admin voyant tous ceux de son organisation ; sinon `notFound()`, comme un CV inexistant. Même règle que
    `ownVivierDoc` (`src/app/recruiter/vivier/actions.ts`) et `/api/vivier-cv/[fileId]` ;
  - toute autre valeur → `notFound()`.

## Chargement de la page

1. `params` (`source`, `id`), `getCurrentUser()`, contrôle du rôle, aiguillage selon `source` (ci-dessus).
2. `pool` : nom = prénom + nom (sinon e-mail), e-mail, `cvFileId`, lien `/api/cv/<cvFileId>`, profil `cvProfileJson`.
   Le téléphone n'est pas affiché.
3. `vivier` : nom = `candidateName`, sinon `fileName`, sinon « CV importé » ; e-mail, téléphone, `cvFileId`, lien
   `/api/vivier-cv/<cvFileId>`, profil `cvProfileJson`. Puis le profil du recruteur qui a importé le CV
   (`users[recruiterId]`, 404 → aucun nom ; autre erreur → erreur de rendu) pour l'en-tête « Vivier de <Prénom Nom> ».
4. Page parente de « Retour » quand l'onglet n'a pas de page précédente (`BackLink fallbackHref`) : `pool` →
   `/recruiter/dashboard` ; `vivier` → `/recruiter/vivier/<jobId>` pour le vivier d'une offre, sinon
   `/recruiter/vivier?vue=general`.
5. Rendu : en-tête (source, nom, e-mail, téléphone), « Voir le CV » si un fichier existe, « Expérience »
   (`experienceSummary`, `yearsOfExperience`), « Compétences » ; sans résumé ni compétence, « Aucun profil détaillé
   disponible — consultez le CV directement ».
6. Pas de `loading.tsx` propre : `src/app/recruiter/loading.tsx` (`SectionPageSkeleton`).

## Logique et algorithmes

Aucune au-delà de l'aiguillage et des contrôles ci-dessus. Les expériences détaillées, formations et langues du profil
ne sont pas affichées (seuls résumé, années d'expérience et compétences).

## Actions serveur

Aucune.

## Erreurs et cas limites

- `cvProfileJson` illisible : `JSON.parse` non protégé, erreur de rendu de la page.
- CV du vivier ajouté depuis MBC Search : pas de fichier (`cvFileId` vide), donc pas de « Voir le CV ».
- Profil du recruteur importateur supprimé : en-tête « Vivier » sans nom.
- CV d'un collègue ou d'une autre organisation : 404, que le CV existe ou non.

## Tests

- [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) — nom « Profil du candidat » ;
  [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts) — rubrique « Tableau de bord ».
- Aucun test de la page (contrôle d'accès compris).

Commandes : `npm test` (`node --import tsx --test "src/**/*.test.ts"`), `npm run typecheck`, `npm run lint`.

## Modifier cette page

- Le contrôle du vivier doit rester aligné sur `ownVivierDoc` (actions du vivier), `/api/vivier-cv/[fileId]` et
  `ownsVivierCv` (export « CV format cabinet ») : voir [le README du vivier](../vivier/README.md).
- Les adresses sont construites par `profileHref` (`matching-client.tsx`) : un changement de forme (`source`, identifiant)
  se fait dans les deux fichiers.
- Pages parentes : `?vue=general` est le paramètre de l'onglet du vivier général (`vivier-tabs.tsx`).
- Nom de la page dans « Retour » : `PAGE_LABELS` (« Profil du candidat », `src/lib/recruiter-trail.ts`) ; rubrique :
  `also` de « Tableau de bord » (`src/lib/recruiter-nav.ts`).
