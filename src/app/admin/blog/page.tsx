import { FileText } from 'lucide-react'
import { getAdminBlogPosts } from './actions'
import { BlogManager } from './blog-manager'

export default async function AdminBlogPage() {
  const posts = await getAdminBlogPosts()
  const published = posts.filter(p => p.isPublished).length

  return (
    <div className="min-h-full p-8 space-y-8" style={{ color: 'rgba(255,255,255,0.87)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>SITE</p>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Blog</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {posts.length} article{posts.length > 1 ? 's' : ''} — {published} publié{published > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-semibold text-sm text-white flex items-center gap-2">
            <FileText className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.4)' }} />
            Articles
          </h2>
        </div>
        <BlogManager initialPosts={posts} />
      </div>
    </div>
  )
}
