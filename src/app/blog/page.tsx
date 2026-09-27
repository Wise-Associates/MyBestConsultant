import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublishedBlogPosts } from '@/lib/appwrite/blog'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'
import { ImageIcon } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Blog | MyBestConsultant',
  description: 'Analyses, conseils et retours d\'expérience de nos consultants en recrutement IT.',
}

export default async function BlogPage() {
  const posts = await getPublishedBlogPosts()

  return (
    <div className="mbc-app-dark" style={{ background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', minHeight: '100vh' }}>
      <SiteNavbar />

      {/* Second header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <p className="text-sm font-bold tracking-[0.2em] uppercase mb-3" style={{ color: '#E8A33D' }}>
            Blog
          </p>
          <h1 style={{ color: 'white' }}>Actualités &amp; expertise</h1>
          <p className="mt-3 text-base md:text-lg max-w-2xl" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Analyses, conseils et retours d&apos;expérience de nos consultants.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-20 md:pb-28">
        {posts.length === 0 ? (
          <div className="py-20 text-center" style={{ color: 'var(--color-text-muted)' }}>
            Aucun article publié pour l&apos;instant.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {posts.map(post => (
              <Link key={post.$id} href={`/blog/${post.slug}`} className="group block no-underline"
                style={{ color: 'inherit' }}>
                <article className="h-full rounded-[var(--border-radius-lg)] overflow-hidden hairline transition-transform duration-300 group-hover:-translate-y-1"
                  style={{ background: 'var(--color-surface)' }}>
                  <div className="w-full aspect-[16/10] overflow-hidden" style={{ background: 'var(--color-secondary)' }}>
                    {post.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.coverImageUrl} alt={post.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    )}
                  </div>
                  <div className="p-6 space-y-2.5">
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(post.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {post.author && ` · ${post.author}`}
                    </p>
                    <h3 className="transition-colors group-hover:opacity-75" style={{ color: 'var(--color-text)' }}>
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--color-text-muted)' }}>
                        {post.excerpt}
                      </p>
                    )}
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>

      <SiteFooter currentSlug="blog" />
    </div>
  )
}
