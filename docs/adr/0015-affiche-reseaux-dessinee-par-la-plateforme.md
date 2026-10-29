# 0015 — Affiche des publications sur les réseaux : dessinée par la plateforme, photo par OpenAI, fin de kie.ai

- Statut : accepté
- Date : 2026-10-23

## Contexte

Chaque offre publiée sur les réseaux de My Best Consultant (LinkedIn, Instagram, Facebook, X) part avec une affiche
unique. Jusqu'ici, le scénario Make la faisait générer entièrement par kie.ai (revendeur du modèle d'image
`gpt-image-2` d'OpenAI) : une consigne de 3 000 caractères décrivait logo, scène photo et tous les textes, puis Make
attendait 90 s avant de publier via Buffer.

Depuis le 5 octobre 2026, toutes les publications restaient « envoyées » sans jamais être confirmées : les crédits
kie.ai épuisés arrêtaient le scénario avant tout rappel, et rien ne le signalait dans la plateforme. Les modèles
d'image écorchaient aussi régulièrement les accents des textes en français. Claude ne génère pas d'images (il lit des
images et écrit du texte).

## Décision

**La plateforme dessine l'affiche** (`src/lib/social-poster/poster.tsx`, `next/og` : JSX + CSS → PNG, déjà fourni par
Next.js, aucune dépendance ajoutée) : logo exact, textes exacts, charte (anthracite `#2C2C2E`, or `#E8A33D`, police
Inter du site, fichiers TTF sous licence SIL OFL dans `src/lib/social-poster/fonts/`), format 1080 × 1350 (4:5).
Elle est servie par une route publique, `GET /api/social/poster/<id de la publication>.png` (et `exemple.png`), que
Buffer, Facebook et Make téléchargent : Make ne génère plus rien.

**Seule la photo de la scène est demandée à OpenAI** (`scene.ts`, API d'images, modèle `gpt-image-2` par défaut,
`OPENAI_IMAGE_MODEL` pour en changer, clé OpenAI de Config IA ou `OPENAI_API_KEY`), sans aucun texte dans l'image.
Elle est gardée dans un bucket privé (`social_scenes`, un fichier par publication) pour que l'affiche, redessinée à
chaque téléchargement, montre toujours la même. **Elle est facultative** : sans clé, sans bucket, ou si OpenAI échoue
(crédits, délai de 150 s, modération), l'affiche part sans photo et la raison est notée sur la publication (« Affiche
publiée sans photo : … » dans `/admin/social`). Un problème de crédits ne bloque plus jamais une publication.

**Publication en deux temps** (`lib/social.ts`) : `prepareSocialPost` (contrôles, textes par l'IA de Config IA,
document « queued » qui contient déjà tout ce qui partira chez Make, adresse de l'affiche comprise) dans la Server
Action, sous un verrou par offre (pas de double publication entre la publication automatique et un clic), puis
`deliverSocialPost` (photo dans le temps restant, puis envoi à Make) en arrière-plan avec `after()`, pour ne pas faire
attendre le recruteur jusqu'à 2 minutes. « sent » est écrit avant l'appel à Make : un rappel rapide de Make n'est pas
écrasé et une erreur d'écriture après l'envoi ne déclenche pas de republication. Une fonction interrompue (300 s) laisse
la publication « queued » : elle est tenue pour échouée au bout de 6 min et se relance. Les pages qui lancent ces
actions déclarent `maxDuration = 300`. La publication LinkedIn directe (ancien circuit) ne sert plus que si aucune
publication n'a pu être créée.

**Route publique** : aucune connexion (les réseaux doivent pouvoir télécharger l'image). Elle ne montre que ce que
l'offre publiée montre déjà, relu dans la publication enregistrée (l'image est celle annoncée à Make). Identifiant
vérifié (format d'identifiant Appwrite), publication inconnue, document de réglages, offre désactivée, expirée ou
supprimée → 404 ; un paramètre d'URL est refusé (il ne servirait qu'à contourner le cache). Les identifiants de
publication ne sont pas secrets (horodatage + 7 caractères aléatoires) : acceptable, rien n'y est confidentiel. Cache
au CDN (`s-maxage`) : un jour pour une publication envoyée avec sa photo, une minute sans photo (une relance peut en
ajouter une à la même adresse), aucun en file ou en échec, 5 min pour l'exemple. Stockage de la photo injoignable :
affiche sans photo, non mise en cache.

**Coût borné** : la clé OpenAI de Config IA paie chaque photo (et sert aussi à la lecture des scans des appels
d'offres) ; 10 photos par organisation et 100 pour la plateforme par jour (`takeDailySlot`, places atomiques).
Au-delà, l'affiche part sans photo. L'intitulé et les compétences, fournis par le recruteur, sont insérés dans la
consigne sans guillemets ni caractères de contrôle.

## Conséquences

- Plus de kie.ai : `KIE_API_KEY` et `src/lib/kie-image.ts` sont supprimés. Le scénario Make doit être simplifié
  (guide dans `/admin/social`, étape « Ancien scénario ») : modules kie.ai, pause, routeur « image prête / échec »,
  lecture JSON et rappel « visuels prêts » retirés ; l'image des modules Buffer et Facebook devient
  `{{1.content.image.url}}`. Tant que ce n'est pas fait, les publications échouent comme avant.
- Coût : une photo OpenAI par publication (qualité `medium`), facturée sur le compte OpenAI de Config IA ; aucune pour
  le test de connexion, l'exemple et le pilote Zernio (affiche d'exemple sans photo).
- Les photos ne contiennent que des personnes fictives et aucune donnée de candidat ; elles ne sont pas purgées (une
  par publication, quelques centaines de Ko). Une purge pourra suivre celle des publications si elle est décidée.
- Changer le dessin de l'affiche ne modifie pas les affiches déjà publiées (déjà téléchargées par les réseaux) ; le
  CDN garde au plus un jour l'ancienne version de celles qui ont été servies.
- Mise en place : bucket `social_scenes` créé par `npm run schema:push -- dev|prod` (ADR 0017, qui remplace le script
  `social:setup` du 2026-10-23), puis `APPWRITE_STORAGE_SOCIAL_SCENES`.
  Le code fonctionne sans (affiches sans photo).
