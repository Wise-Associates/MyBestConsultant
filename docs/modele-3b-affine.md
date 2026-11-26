# Modèle 3B affiné (Ministral 3 3B) : déployer, brancher, refaire

Guide d'exploitation de l'adaptateur LoRA qui fait tourner les fonctions d'IA de MyBestConsultant sur **Ministral 3 3B**,
loué à l'heure sur le réseau GPU Nosana avec le déployeur `nosana-llm-deployer`. Décisions : [ADR 0063](adr/0063-affinage-multi-taches-ministral-3b.md)
(multi-tâches), [ADR 0058](adr/0058-export-exemples-affinage-classification-cv.md) (classification), ADR 0057 (modèles
open source dans Config IA).

**Résultats détaillés** (page privée, à partager depuis son menu) : https://claude.ai/artifact/HwLfx2bVALon2rPN5BeXAu

## 1. Ce qui existe

| Version | Affinage (seau S3) | Ce qu'il sait faire | Hugging Face (dépôt privé `herilala19/ministral-3-3b-mbc-classification-cv-lora`) |
|---|---|---|---|
| **v3 (à utiliser)** | `20261125-1730-0239` | toutes les fonctions d'IA passant par Config IA (33 tâches), LoRA rang 32 | commit `59469654` |
| v2 | `20261125-0536-4146` | classification des CV seule (51/60 familles justes) | commit `00fbff0e` |
| v1 | `20261124-0815-8392` | classification des CV seule (49/60) | commit `ccb3c489` |

Mesure de la v3 (25 novembre 2026, 463 demandes de test) : 100 % des réponses lisibles par l'application sur les
32 tâches mesurées (le 3B sans affinage échoue souvent : notation sur critères 14 %, comparaison des intitulés 31 %),
notations proches de Claude Sonnet 5.5 (même décision « correspond » sur 81 à 100 % des CV), plus rapide. **Export CV :
pas au niveau** (75 % du CV repris contre 84 % pour Sonnet) : garder Claude. Qualité des textes libres pas encore jugée.

## 2. Déployer

Depuis `nosana-llm-deployer` (clés `NOSANA_API_KEY`, `LLM_API_KEY` et variables `FT_*` du seau dans son `.env`,
crédits Nosana) :

```bash
npm run deployer -- deploy --yes --model ministral-3-3b-bf16 --revision 9f806198 \
  --lora 20261125-1730-0239 --market nvidia-3090 \
  --kv-cache-dtype auto --max-model-len 32768 --max-num-seqs 2 \
  --timeout-minutes 180 --name mbc-3b
```

- `--lora` : l'adaptateur est lu dans le seau S3 et **vérifié** (forme, rang, empreinte) avant le chargement.
- `--kv-cache-dtype auto` : **obligatoire**. Le cache en FP8 (réglage par défaut du préréglage sur les cartes récentes)
  fait perdre de la justesse (mesure du 2026-11-25 : 4 CV de moins sur 60 pour la classification).
- `--max-model-len 32768` : l'export CV demande jusqu'à 16 000 jetons de réponse.
- Carte : RTX 3090 (0,19 $/h) ou RTX 4090 (0,40 $/h, un peu plus rapide) ; mêmes réponses à réglages égaux.
- `--timeout-minutes` : durée avant l'arrêt automatique. Pour un service continu : `--strategy SIMPLE-EXTEND` (prolongé
  tant que le compte Nosana a des crédits).
- Mise en ligne en 5 à 30 minutes. À la fin, le déployeur affiche l'adresse (`https://….node.k8s.prd.nos.ci/v1`),
  l'identifiant du déploiement et le nom du modèle affiné : `ft-20261125-1730-0239`.

## 3. Brancher dans Config IA

Dans `/admin/llm-config` (DEV pour essayer ; production : un humain, voir §6) :

1. « Ajouter un modèle », hébergeur **Autre (URL personnalisée)** : URL = l'adresse affichée (avec `/v1`), clé =
   `LLM_API_KEY` du `.env` du déployeur, modèle = `ft-20261125-1730-0239`, température `0,15`.
2. « Tester », puis choisir ce modèle ligne par ligne :

| Ligne de Config IA | Conseil |
|---|---|
| Matching IA, Classification des CV, Entretiens IA, Publication des AO, Modèle par défaut | 3B affiné possible (à essayer en DEV d'abord) |
| Assistant IA | garder Claude : ligne **sans repli**, une panne du nœud affiche une erreur |
| Export CV (format cabinet) | garder Claude : moins de contenu repris, et **sans repli** |

Les autres lignes ont un repli : si le nœud ne répond plus, l'application passe au modèle par défaut puis aux autres
(Claude, GPT…), avec un essai perdu à chaque appel. **Chaque nouveau déploiement a une nouvelle adresse** : modifier
l'URL du même modèle dans Config IA plutôt qu'en ajouter un.

## 4. Arrêter

```bash
npm run deployer -- stop <identifiant du déploiement>
```

Avant l'arrêt (ou juste après), remettre les lignes de Config IA sur leur modèle habituel, ou désactiver le modèle :
sinon chaque appel essaie d'abord une adresse morte. Le déploiement s'arrête aussi seul au bout de `--timeout-minutes`.

## 5. Refaire l'affinage

À refaire quand une consigne d'IA change (elles vivent dans des modules purs : voir AGENTS.md) ou pour ajouter une
tâche. Déroulé du 25 novembre 2026 (environ 26 $ en tout) :

1. **Export** (lecture seule, DEV puis production) :
   `npm run finetune:mbc-dataset -- collect .env.dev --out <dossier privé>` puis
   `collect .env.prod --prod --out <dossier privé>` (familles : `--tasks scoring,cv-export,content,interviews,jobs,ao,mbc-search,assistant`).
   Dossier hors de tout dépôt git (refusé sinon), 0700 : il contient des textes de CV (noms remplacés, coordonnées masquées).
2. **Réponses de l'enseignant** : `teach --out <dossier>` (coût estimé, rien d'envoyé), puis
   `teach --out <dossier> --sample 2 --apply --max-usd 2` (essai), puis `--apply --max-usd <plafond>` (lot complet,
   moitié prix). Relancer `teach` pour lire le résultat, puis pour les demandes qui suivent (intitulés, traductions,
   ajustements MBC Search). Clé dédiée `FT_ANTHROPIC_API_KEY` du `.env` du déployeur, jamais celle de Config IA ;
   crédits Claude épuisés : repli sur OpenAI (`FT_OPENAI_API_KEY`, GPT-4o).
3. **Répartition** : `split --out <dossier> --classification <dossier des exemples de classification>` (le test de
   classification gardé tel quel).
4. **Entraînement** (déployeur) : `npm run deployer -- train --data <dossier> --max-length 16384 --market nvidia-a6000
   --epochs 2 --lora-rank 32 --revision 9f806198` (plan), puis `--yes` (≈ 2 h, < 2 $). Suivi : `train-status <affinage>`.
5. **Mesure** : déployer le nouvel adaptateur (§2), puis
   `npm run finetune:mbc-dataset -- eval --out <dossier> --url <adresse>/v1 --model ft-<affinage> --label <nom>` et la
   même chose avec `--model ministral-3-3b-bf16` (modèle de base) pour comparer.
6. **Copie** sur Hugging Face (dépôt privé), puis **suppression du dossier d'export** une fois l'adaptateur gardé.

## 6. Avant la production (un humain)

- Vérifier les conditions d'Anthropic et d'OpenAI sur l'usage de leurs réponses pour entraîner un modèle (réponses de
  Claude Sonnet 5.5 et de GPT-4o mini dans les exemples).
- Accord du DPO pour un usage continu (requêtes réelles traitées par un hôte Nosana tiers).
- Déploiement continu (`SIMPLE-EXTEND`) : environ 140 $ par mois sur une RTX 3090, 290 $ sur une RTX 4090 ; surveiller
  qu'il répond (les nœuds Nosana tombent parfois : téléchargement lent, DNS en panne au démarrage).
- Config IA de production modifiée par un humain, ligne par ligne, d'après les mesures.

## 7. Où sont les choses

- Adaptateur : seau S3 `finetune/20261125-1730-0239/output/` (source du déployeur) et Hugging Face (copie, commit `59469654`).
- Code de l'export : `scripts/finetune-mbc-dataset.mts`, `src/lib/finetune/` (`mbc-dataset.ts` : tâches et lecture des
  réponses ; `collect-*.ts` : sources ; `pseudonymize.ts` : noms inventés ; `mbc-eval.ts` : mesure).
- Fichiers d'export, de réponses et de mesures : hors du dépôt, sur le poste qui a fait l'affinage (données personnelles).
