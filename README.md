This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Déploiement

- **Previews** : Vercel déploie `pre-dev` et `dev`, branchées sur le projet Appwrite DEV.
- **Pull requests** : toutes vers `main`, fusionnées par « Rebase and merge ». Une fusion dans `main` ne déploie rien.
- **Mise en production** : à la main, GitHub → Actions → **Déployer en production** → Run workflow, branche `main`,
  champ vide. Le workflow (`.github/workflows/deploy-vps.yml`) vérifie `main` (types, tests), place `prod` sur `main`
  (avance rapide, ou remplacement seulement si rien de `prod` ne manque à `main`), puis déploie le VPS (Docker, Caddy,
  bascule sans coupure).
  Personne ne pousse sur `prod` à la main. Décisions : [ADR 0025](docs/adr/0025-mise-en-production-manuelle.md)
  (procédure) et [ADR 0027](docs/adr/0027-production-sur-vps.md) (VPS) ; installation, bascule du DNS et
  exploitation : [docs/deploiement-vps.md](docs/deploiement-vps.md). Tant que le DNS pointe vers Vercel, la production
  reste sur Vercel, qui redéploie aussi `prod` à chaque mise en production.
