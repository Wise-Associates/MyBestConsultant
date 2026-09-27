import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { getBlogPostBySlug } from '@/lib/appwrite/blog'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)
  if (!post) return {}
  return { title: `${post.title} — MyBestConsultant`, description: post.excerpt }
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params
  const post = await getBlogPostBySlug(slug)
  if (!post) notFound()

  return (
    <div style={{ background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', minHeight: '100vh' }}>
      <SiteNavbar />

      <article className="max-w-3xl mx-auto px-6 pt-12 pb-20 md:pt-16 md:pb-28">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm no-underline mb-8 transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour au blog
        </Link>

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {new Date(post.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          {post.author && ` · ${post.author}`}
        </p>
        <h1 className="mt-3 mb-8 md:mb-10" style={{ color: 'var(--color-text)' }}>{post.title}</h1>

        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt={post.title}
            className="w-full h-56 sm:h-80 md:h-[26rem] object-cover rounded-[var(--border-radius-lg)] mb-10 md:mb-12"
            style={{ boxShadow: 'var(--shadow-card)' }} />
        )}

        <div className="space-y-5 text-base md:text-lg" style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height, 1.7)' }}>
          {post.content.split('\n').filter(p => p.trim()).map((para, i) => <p key={i}>{para}</p>)}
        </div>
      </article>

      <SiteFooter currentSlug="blog" />
    </div>
  )
}
