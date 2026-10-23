# Module assistant IA (portable)

Assistant de chat qui répond aux questions d'utilisation d'un site à partir de son contenu d'aide, et transmet la
conversation au support à la demande de l'utilisateur. Ce dossier n'importe rien de l'application qui l'accueille
(règle ESLint dans `eslint.config.mjs`) : il peut être copié ou publié en paquet pour un autre site.
Décisions : `docs/adr/0007-assistant-ia-portable.md`.

```
core/types.ts            contrat AssistantHost (ce que le site fournit)
core/rules.ts            règles pures : saisie, historique, consignes du modèle, transcription, conservation
core/turn.ts             points d'entrée : runTurn, loadLatest, handoffToSupport
core/*.test.ts           tests (node:test), avec un site fictif
react/assistant-chat.tsx fenêtre de chat (React, sans Next.js) et sa feuille de style (.module.css)
```

## Dépendances

- React 19 ou plus (la fenêtre utilise une transition asynchrone pour l'état « envoi en cours »).
- `zod` (validation de la saisie, `core/turn.ts`) et `lucide-react` (icônes de la fenêtre).
- Un outil de build qui gère les CSS Modules (`.module.css`) : Next.js, Vite…
- Tests : `node:test` avec `tsx` (`node --import tsx --test "src/assistant/**/*.test.ts"`).

## Ce que le site fournit (`AssistantHost`)

| Élément | Rôle | MyBestConsultant (`src/lib/assistant/host.ts`) |
|---|---|---|
| `getUser()` | utilisateur de la session qui a droit à l'assistant, sinon `null` | `getCurrentUser()`, candidat ou recruteur à l'adresse vérifiée |
| `store` | conversations : lecture **par utilisateur**, ajout d'un échange, purge, suppression d'un utilisateur | collection Appwrite `assistant_turns` |
| `takeQuota()` | quotas du jour, atomiques : `'ok'`, `'user-limit'` ou `'site-limit'` | `takeDailySlot` : 30 par utilisateur, 1 000 pour la plateforme |
| `complete()` | appel au modèle ; ne jamais laisser le texte de l'utilisateur dans le message d'erreur | `callLLM` module « assistant », sans repli |
| `knowledge()` | contenu d'aide par rôle, seule source des réponses | `src/lib/assistant/knowledge.ts` |
| `handoff()` | transmission à une personne | ticket du Help Desk (`createTicket`) |

## Brancher le module sur un autre site

1. Copier `src/assistant/` (ou installer le paquet quand il existera).
2. Écrire les adaptateurs `AssistantHost` du site. `store.list` et `store.latest` filtrent **toujours** sur
   l'utilisateur : c'est ce qui empêche de lire la conversation d'un autre.
3. Exposer trois actions serveur (ou routes) qui créent un hôte par requête et appellent `runTurn`, `loadLatest`,
   `handoffToSupport` ; traduire une exception (base indisponible) en erreur affichable. Modèle :
   `src/lib/assistant-actions.ts`.
4. Afficher `<AssistantChat welcome="…" send={…} loadLatest={…} handoff={…} />` dans les pages des utilisateurs
   connectés, dans un élément qui définit les variables de style :
   `--assistant-accent`, `--assistant-accent-fg`, `--assistant-surface`, `--assistant-muted`, `--assistant-border`,
   `--assistant-text`, `--assistant-text-muted`, `--assistant-header-bg`, `--assistant-header-fg`,
   `--assistant-danger` (MyBestConsultant : `.mbc-assistant` dans `src/app/globals.css`).
5. Planifier la purge (`store.purgeBefore(retentionCutoff(now, jours))`) et appeler `store.deleteForUser` dans
   **chaque** chemin qui supprime un compte (MyBestConsultant : suppression par l'admin et retrait d'un membre d'équipe).
   Garder la possibilité de masquer l'assistant sans couper la purge (MyBestConsultant : `ASSISTANT_ENABLED` séparé de
   la variable de la collection).
6. Mettre à jour la politique de confidentialité du site (assistant, fournisseur du modèle, durée de conservation).

## Limites connues (v1)

- Pas de streaming : la réponse s'affiche en une fois.
- Si l'enregistrement échoue après la réponse, `runTurn` renvoie quand même la réponse avec `saved: false` (la
  fenêtre l'affiche avec un avertissement) : elle ne sera ni reprise ni transmise.
- Un message refusé par une panne du modèle compte dans les quotas (pas de restitution).
- Aucun accès aux données de l'utilisateur, aucun outil : questions d'utilisation seulement.
- Texte simple : la réponse n'est jamais interprétée comme du HTML ou du Markdown.
