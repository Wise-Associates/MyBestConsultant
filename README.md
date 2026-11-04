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
- **Production** : un VPS (Docker, Caddy, bascule sans coupure), déployé par `.github/workflows/deploy-vps.yml` à
  chaque mise à jour de `prod`. Installation, bascule du DNS et exploitation : [docs/deploiement-vps.md](docs/deploiement-vps.md)
  (décision : [ADR 0027](docs/adr/0027-production-sur-vps.md)). Tant que le serveur n'est pas en service, la
  production reste sur Vercel.
