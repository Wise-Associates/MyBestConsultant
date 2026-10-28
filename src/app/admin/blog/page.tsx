import { FileText } from 'lucide-react'
import { getAdminBlogPosts } from './actions'
import { BlogManager } from './blog-manager'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

export default async function AdminBlogPage() {
  const posts = await getAdminBlogPosts()
  const published = posts.filter(p => p.isPublished).length

  return (
    <div className="min-h-full p-8 space-y-8" style={{ color: 'rgba(255,255,255,0.87)' }}>
      <AdminPageHeader title="Blog"
        description={`${posts.length} article${posts.length > 1 ? 's' : ''} — ${published} publié${published > 1 ? 's' : ''}`} />

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
