# 0025 — Mise en production lancée à la main, `prod` placée sur `main`

- Statut : accepté (réglages GitHub et rattrapage de `main` à faire par un humain : « Mise en place » ci-dessous)
- Date : 2026-11-05
- Remplace : le déclenchement de l'ADR 0027 (déploiement à chaque mise à jour de `prod`, pull request `dev` → `prod`),
  et le brouillon de cet ADR du 2026-11-03, jamais fusionné (production sur Vercel).

## Contexte

Demande du 2026-11-05 : toutes les pull requests vont vers `main`, **fusionnées par « Rebase and merge »** (règle de
l'équipe). La mise en production se lance à la main : onglet Actions, « Déployer en production » ; le workflow met
`prod` à jour depuis `main`, puis le déploiement commence.

Jusque-là, `.github/workflows/deploy-vps.yml` déployait le VPS à chaque mise à jour de `prod` (ADR 0027), et des
commits arrivaient directement sur `prod`.

État des branches le 2026-11-05 : `main` et `prod` n'ont **aucun commit commun** (l'historique de `main` commence par
un « Initial commit » qui reprend tout d'un bloc). Le contenu de `main` (`ed9d38f`) est exactement celui du commit
`dd05be3` de `prod` (2026-11-03), que `prod` prolonge de 13 commits. Aucune des deux n'a de commit de fusion.

Contraintes vérifiées :

- « Rebase and merge » recopie chaque commit sous un nouvel identifiant. Un commit passé par `prod` puis entré dans
  `main` par une pull request (le rattrapage ci-dessous, une correction poussée sur `prod`) n'est donc jamais un
  ancêtre de `main` : une simple avance rapide de `prod` devient impossible.
- `GITHUB_TOKEN` ne peut pas recevoir la permission `workflows` : GitHub refuse qu'il fasse avancer une branche sur un
  commit qui modifie un fichier de `.github/workflows/`.
- Une branche mise à jour par `GITHUB_TOKEN` ne déclenche aucun autre workflow : la mise à jour de `prod` et le
  déploiement doivent se faire dans le même run.
- `mbc-deploy` (serveur) n'accepte, pour un déploiement comme pour un retour arrière, qu'un commit contenu dans `prod`.

## Décision

- **Workflow lancé à la main seulement** : `.github/workflows/deploy-vps.yml`, nommé « Déployer en production »,
  n'a plus que `workflow_dispatch` et refuse de tourner depuis une autre branche que `main` (il mettrait cette
  branche en production). Champ vide : le dernier commit de `main`. Champ rempli : retour arrière vers un commit de
  `prod` déjà mis en production (règles de l'ADR 0027 inchangées), sans toucher à `prod`.
- **`prod` placée sur le commit de `main`**, contrôlé par le job `verify` avant les tests :
  - cas normal, `prod` est un ancêtre du commit : **avance rapide** ;
  - sinon, **remplacement** seulement si chaque commit de `prod` absent de l'historique de `main` y a son équivalent,
    c'est-à-dire la même modification (`git cherry`, qui compare les modifications et non les identifiants) ; une
    seule modification de `prod` absente de `main` et le workflow s'arrête en la citant, sans rien modifier.
  La mise à jour se fait par `git push --force-with-lease` sur le commit de `prod` contrôlé : si `prod` a changé
  depuis (commit arrivé pendant le run), GitHub refuse et rien n'est écrasé.
- **Ordre dans le job `deploy`** : image, puis mise à jour de `prod`, puis envoi et bascule. Une image qui ne se
  construit pas ne touche pas `prod` ; le serveur exige que le commit soit dans `prod`. Si la bascule échoue, `prod` a
  changé mais l'ancienne version reste en ligne : relancer réessaie la même version.
- **Jeton dédié `PROD_BRANCH_TOKEN`** : jeton fin (fine-grained), ce dépôt seulement, Contents et Workflows en
  écriture, créé par un administrateur, secret de l'environnement `production`, donné à la seule étape
  « Mise à jour de prod ». Le job `verify`, qui exécute le code des dépendances, n'a toujours ni secret ni droit
  d'écriture.
- **Protections** : environnement `production` limité à `main` (au lieu de `prod`) ; `main` protégée (pull request
  obligatoire, ni poussée forcée ni suppression) ; `prod` fermée aux mises à jour, aux poussées forcées et à la
  suppression, sauf pour les administrateurs, rôle du propriétaire du jeton.

## Mise en place (une fois, par un humain)

1. **Rattrapage de `main`** : les 13 commits de `prod` qui manquent à `main`, rejoués sur `main` (sans conflit : `main`
   a exactement le contenu de `dd05be3`), par une pull request comme les autres :

   ```bash
   git fetch origin
   # Doit afficher un commit de prod au contenu identique à main (dd05be3 le 2026-11-05). Rien : main a du contenu
   # absent de prod, à faire entrer dans prod avant de continuer.
   git log --format='%T %h %s' origin/prod | grep "^$(git rev-parse 'origin/main^{tree}')"
   git switch -c rattrapage-prod origin/prod
   git rebase --onto origin/main dd05be3
   git diff --stat origin/prod      # attendu : rien (même contenu que prod)
   git push -u origin rattrapage-prod
   ```

   Pull request `rattrapage-prod` → `main`, « Rebase and merge ».
2. Réglages GitHub : parties 4.1, 4.1 bis et 4.2 de `docs/deploiement-vps.md` (branche de l'environnement, protections,
   jeton).
3. Ce workflow fusionné dans `main` (le bouton n'apparaît dans Actions qu'une fois le fichier sur `main`), puis une
   première mise en production. Le job `verify` annonce alors le remplacement de `prod` (« ses 101 commits absents de
   l'historique de main y ont tous leur équivalent ») : c'est la seule fois où l'historique de `prod` change d'un bloc.

## Conséquences

- Fusionner dans `main` ne met rien en production. Mettre en production met **tout `main`** en production : un travail
  pas prêt n'entre pas dans `main`.
- Correction urgente : pull request vers `main`, puis mise en production. Un commit poussé directement sur `prod`
  (administrateurs seulement) bloque la mise en production suivante jusqu'à ce que la même modification entre dans
  `main` par une pull request ; le workflow remplace alors `prod`. Si la modification a changé en route (conflit
  résolu pendant le rebase), le workflow ne la reconnaît pas et continue de refuser : un administrateur vérifie que
  rien ne manque à `main`, puis place `prod` sur `main` à la main (`git push --force-with-lease`).
- Après le rattrapage, les commits de l'ancienne branche `prod` n'y sont plus : un retour arrière vers une version
  déployée avant (workflow ou `mbc-deploy rollback`) est refusé. Le même contenu est celui de la première mise en
  production qui suit. Ces commits restent lisibles sur `dev`, `pre-dev` et les autres branches qui les portent.
- Un remplacement ne retire de `prod` que des commits jamais déployés (seul `main` est déployé) : les retours arrière
  vers les versions mises en production restent possibles.
- Redéployer la version en ligne sans rien ajouter (après un changement de `app.env`) : champ vide si `main` n'a pas
  changé, sinon le commit en ligne dans le champ, ou `mbc-deploy rollback` sur le serveur.
- Le jeton appartient à une personne et expire : le renouveler avant son échéance, en refaire un si son propriétaire
  quitte l'équipe. Symptôme : l'étape « Mise à jour de prod » échoue, rien n'est déployé.
- Tant que la branche de production de Vercel est `prod` (jusqu'à l'étape 7 du guide), Vercel déploie aussi chaque
  mise à jour de `prod` : sa production reste alignée sur le VPS, ce qui garde possible le retour du DNS vers Vercel.
  Vercel construit des previews de `main` (projet Appwrite DEV).
- `pre-dev` et `dev` restent des previews Vercel ; leur contenu va en production par une pull request vers `main`.
- Le hook `.claude/hooks/guard-git-vercel.mjs` parle encore de « pull request dev → prod » dans ses messages : à
  mettre à jour par un humain (Claude ne peut pas le modifier).

## Écartés

- **Déployer à chaque fusion dans `main`** : la demande est une mise en production choisie, pas continue.
- **Avance rapide seule** (première version de cet ADR, le 2026-11-05) : incompatible avec « Rebase and merge », qui
  ne fait jamais de `prod` un ancêtre de `main` après un rattrapage ou une correction poussée sur `prod`.
- **Remplacer `prod` sans contrôle** : effacerait sans prévenir une modification poussée sur `prod` seulement.
- **Rattrapage par un commit de fusion poussé directement sur `main`** : garderait l'historique de `prod`, mais
  contourne la pull request et la méthode de fusion de l'équipe.
- **`GITHUB_TOKEN`** : refusé par GitHub dès qu'une version modifie un workflow.
- **GitHub App** : n'expire pas, n'appartient à personne, et la protection de `prod` pourrait ne s'ouvrir qu'à elle ;
  mais une application à créer et à installer, et une action de plus dans le workflow. À reprendre si le jeton
  personnel pose problème.
- **Clé de déploiement en écriture** : son droit de modifier des fichiers de workflow n'est pas documenté par GitHub.
- **Ne plus utiliser `prod`** (déployer `main` directement, historique dans les déploiements GitHub) : contraire à la
  demande ; `mbc-deploy`, la copie du dépôt sur le serveur et Vercel s'appuient sur `prod`.
