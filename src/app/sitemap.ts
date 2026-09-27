import type { MetadataRoute } from 'next'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { getPublishedBlogPosts } from '@/lib/appwrite/blog'
import { getPublishedBrands } from '@/lib/appwrite/brand'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [jobs, posts, brands] = await Promise.all([
    getActiveJobs().catch(() => []),
    getPublishedBlogPosts().catch(() => []),
    getPublishedBrands(),
  ])

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/jobs`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${BASE_URL}/blog`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/entreprises`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/a-propos-de-nous`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/contact`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/abonnement`, changeFrequency: 'monthly', priority: 0.4 },
  ]

  const jobPages: MetadataRoute.Sitemap = jobs.map(job => ({
    url: `${BASE_URL}/jobs/${job.$id}`,
    lastModified: job.createdAt,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  const blogPages: MetadataRoute.Sitemap = posts.map(post => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: post.publishedAt,
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  const employerPages: MetadataRoute.Sitemap = brands.map(b => ({
    url: `${BASE_URL}/entreprises/${b.slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [...staticPages, ...jobPages, ...employerPages, ...blogPages]
}
