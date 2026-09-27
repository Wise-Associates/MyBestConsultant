import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/recruiter', '/candidate', '/api', '/login', '/register'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
