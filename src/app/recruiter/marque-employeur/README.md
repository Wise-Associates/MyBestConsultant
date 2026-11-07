# Marque employeur — `/recruiter/marque-employeur`

Éditeur de la page publique de l'organisation (`/entreprises/<slug>`) : identité (nom, logo, accroche, secteur, taille,
siège, année, site, LinkedIn), image de couverture, présentation, valeurs, avantages, photos et vidéo, publication.
Toute l'équipe peut l'éditer : « c'est un contenu de communication partagé, pas un réglage de compte » (commentaire de
`actions.ts`). On y arrive par la carte « Page marque employeur » de Mon équipe et par « Modifier / publier » de la page
publique non publiée ; la page garde « Mon équipe » en surbrillance dans le sous-menu (`recruiter-nav.ts`).
Décisions : aucun ADR. Règles produit : AGENTS.md, point « Recruiter sub-menu » (« Mon équipe (marque employeur) »).

## Fichiers

```
page.tsx          composant serveur : session, getBrandByTenantId, BrandEditor
actions.ts        Server Actions saveBrandAction (enregistrer, publier) et uploadBrandImageAction (logo, couverture, photos)
brand-editor.tsx  éditeur (client) : formulaire, compression des images, complétion, aperçu, barre d'enregistrement
```

Code partagé :

- [brand.ts](../../../lib/brand.ts) — règles pures : `BrandProfile`, `LIMITS`, `BRAND_SIZES`, `sanitizeBrand`,
  `cleanUrl`, `videoEmbedUrl`, `brandCompleteness`, `canPublish`, `PUBLISH_MIN_ABOUT`, `parseBrand`.
- [brand.ts (Appwrite)](../../../lib/appwrite/brand.ts) — `getBrandByTenantId`, `getBrandBySlug`, `getPublishedBrands`.
- [brand-icons.tsx](../../../lib/brand-icons.tsx) — pictogrammes et suggestions (`BENEFIT_ICONS`, `BENEFIT_SUGGESTIONS`,
  `VALUE_SUGGESTIONS`).
- Pages publiques qui lisent ces données : [`/entreprises`](<../../(public)/entreprises/page.tsx>) et
  [`/entreprises/[slug]`](<../../(public)/entreprises/[slug]/page.tsx>).

## Accès et périmètre des données

- Page : layout de l'espace recruteur, puis `redirect('/login')` si `!user || user.role !== 'recruiter' || !user.tenantId`.
- Actions : `requireTeamMember()` (même condition, sinon « Non autorisé ») ; aucune règle de propriétaire.
- Le document écrit est toujours `tenants/<tenantId de la session>` : aucun identifiant d'organisation ne vient du
  navigateur. Client `createAdminClient()`.
- Stockage : dans le document `tenants` — `name`, `logoUrl`, `brandJson` (le `BrandProfile` en JSON), `brandPublished` ;
  `slug` n'est pas modifiable ici. Images : bucket `logos` (`BUCKETS.LOGOS`, variable `APPWRITE_STORAGE_LOGOS`), lecture
  publique (`read("any")` dans `appwrite.config.json`), 2 Mo, jpg / jpeg / png / webp.
- Page publique : publiée, visible de tous ; non publiée, visible seulement d'un recruteur de la même organisation
  (aperçu), sinon 404 (`/entreprises/[slug]`).

## Chargement de la page

1. `getBrandByTenantId(tenantId)` : document `tenants`, `brandJson` relu par `parseBrand` (passe par `sanitizeBrand` ;
   JSON illisible = profil vide).
2. Lecture impossible (`null`) : `redirect('/recruiter/dashboard')`, sans message.
3. `BrandEditor` reçoit `EmployerBrand` (`tenantId`, `slug`, `name`, `logoUrl`, `published`, `profile`).
4. Pas de `loading.tsx` propre : celui de l'espace recruteur ([`../loading.tsx`](../loading.tsx)).

## Logique et algorithmes

### Nettoyage du profil (`sanitizeBrand`)

Appliqué à l'enregistrement et à chaque lecture : tout champ absent ou d'un autre type devient vide.

| Champ | Règle |
|---|---|
| `tagline`, `about`, `sector`, `headquarters` | texte coupé à `LIMITS` (140, 2 500, 80, 100) |
| `size` | une valeur de `BRAND_SIZES` (`1-10` … `1000+`), sinon vide |
| `foundedYear` | 4 chiffres exactement |
| `website`, `linkedin`, `coverUrl`, photos | `cleanUrl` : 500 caractères, URL valide en `http:` ou `https:` seulement |
| `videoUrl` | gardée seulement si `videoEmbedUrl` la reconnaît |
| `values` | 6 au plus, titre 60 / texte 300, valeur sans titre retirée |
| `benefits` | 12 au plus, pictogramme 20 caractères (`gift` par défaut), titre 60 / texte 160, sans titre retiré |
| `gallery` | URLs valides, 8 au plus |

Le nom de l'organisation est coupé à 120 caractères (`LIMITS.name`) et doit en faire au moins 2.

### Vidéo (`videoEmbedUrl`)

Deux hébergeurs seulement. YouTube (`youtube.com/watch?v=`, `youtube.com/embed/`, `m.youtube.com`, `youtu.be/`,
identifiant de 11 caractères) → `https://www.youtube-nocookie.com/embed/<id>` ; Vimeo (`vimeo.com/<nombre>`) →
`https://player.vimeo.com/video/<id>`. Tout autre lien est refusé (message dans l'éditeur, champ vidé à
l'enregistrement).

### Publication (`canPublish`)

Seule condition : une présentation (« À propos ») d'au moins 30 caractères (`PUBLISH_MIN_ABOUT`). Si la publication est
demandée sans la remplir, `saveBrandAction` **enregistre quand même tout le reste** en brouillon
(`brandPublished: false`) et renvoie `publishError` : « rien n'est perdu » (commentaire de l'action). L'éditeur affiche
la même raison avant le clic (`publishBlocker`).

### Complétion (`brandCompleteness`)

Indication seulement, sans effet sur la publication : 8 contrôles (logo ; couverture ; accroche ≥ 10 caractères ;
présentation ≥ 150 ; secteur, taille et siège ; ≥ 3 valeurs ; ≥ 4 avantages ; ≥ 2 photos ou une vidéo), pourcentage
arrondi et liste de ce qui manque.

### Images

1. Navigateur (`prepareImage`) : redimensionnement (plus grand côté 512 px pour le logo, gardé en PNG pour sa
   transparence ; 1 920 px pour la couverture et 1 600 px pour les photos, en JPEG), puis qualités 0,86, 0,72, 0,58
   jusqu'à moins de 1,9 Mo, sinon « Image trop lourde, même après compression ». Raison : le bucket plafonne à 2 Mo et
   une photo d'appareil en fait souvent plus (commentaire).
2. Serveur (`uploadBrandImageAction`) : type déclaré `image/jpeg`, `image/png` ou `image/webp`, 2 Mo au plus
   (`MAX_IMAGE_BYTES`), fichier créé dans le bucket `logos` ; renvoie l'URL
   `<APPWRITE_ENDPOINT>/storage/buckets/<bucket>/files/<id>/view?project=<NEXT_PUBLIC_APPWRITE_PROJECT_ID>`.
3. L'URL n'entre dans le profil qu'à l'enregistrement. Retirer ou remplacer une image ne supprime pas le fichier.

### État « modifié »

L'éditeur compare un instantané JSON (nom, logo, profil, publication) à celui du dernier enregistrement : le bouton
« Enregistrer » n'est actif que s'il diffère, et jamais pendant un envoi d'image.

## Actions serveur

| Action | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|
| `saveBrandAction({ name, logoUrl, brand, published })` | enregistre et publie | `requireTeamMember` ; nom ≥ 2 caractères ; `sanitizeBrand`, `cleanUrl` ; `canPublish` si publication demandée | `tenants` : `name`, `logoUrl`, `brandJson`, `brandPublished` ; `revalidatePath` de `/entreprises`, `/entreprises/<slug>`, `/recruiter/marque-employeur` ; renvoie les valeurs nettoyées, que l'éditeur reprend |
| `uploadBrandImageAction(formData)` | envoie une image | `requireTeamMember` ; `File` présent ; type déclaré ; 2 Mo | fichier dans le bucket `logos` |

## Erreurs et cas limites

- `tenants.name` est le nom de l'organisation partout ailleurs : le modifier ici change aussi le nom des e-mails
  d'invitation (`team.ts`), le nom repris dans les modèles de message (layout recruteur) et l'auteur des exports
  « CV format cabinet » (`organisationName`, `src/lib/cv-export/recruiter.ts`).
- Deux recruteurs qui enregistrent en même temps : le dernier écrase le document entier (pas de version relue).
- Erreur d'enregistrement ou d'envoi : message en rouge dans la barre du bas ; l'image n'est pas ajoutée.
- `/entreprises` liste les pages publiées (200 au plus, `getPublishedBrands`) ; une lecture en échec y donne une liste
  vide.

## Tests

Aucun test de `brand.ts` ni des actions. Commande : `npm test`.

## Modifier cette page

- Nouveau champ du profil : `BrandProfile`, `EMPTY_BRAND`, `sanitizeBrand` (sinon il est effacé à la lecture comme à
  l'enregistrement), éditeur, page publique `/entreprises/[slug]`, et éventuellement `brandCompleteness`.
- La règle de publication (`canPublish`, `PUBLISH_MIN_ABOUT`) est aussi annoncée dans
  [knowledge.ts](../../../lib/assistant/knowledge.ts) (« 30 caractères minimum pour publier »).
- Le plafond de 2 Mo est écrit trois fois : bucket `logos` (`appwrite.config.json`), `MAX_IMAGE_BYTES` (`actions.ts`)
  et la cible de 1,9 Mo de `prepareImage`.
- L'aperçu de l'éditeur est une maquette réduite de la page publique : à garder cohérent avec `/entreprises/[slug]`.
