import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { logoutAction } from '@/app/(auth)/actions'
import { getPendingGroupsCount } from './linkedin-groups/actions'
import { AdminNav } from './admin-nav'
import { countTicketsNeedingSupport } from '@/lib/support'
import { VerifyEmailBanner } from '@/components/shared/verify-email-banner'
import { LogOut, Bell } from 'lucide-react'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/login')

  const [pendingGroupsCount, supportCount] = await Promise.all([
    getPendingGroupsCount().catch(() => 0),
    countTicketsNeedingSupport().catch(() => 0),
  ])

  const initials = `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase()

  return (
    <>
    <VerifyEmailBanner verified={user.emailVerification} />
    <div className="h-screen flex" style={{ background: '#0F1117' }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      <aside className="w-[240px] shrink-0 hidden lg:flex flex-col fixed top-0 left-0 h-screen z-30" style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f8 60%, #eceef4 100%)',
        borderRight: '1px solid #e2e4ec',
        boxShadow: '2px 0 12px rgba(11,29,81,0.06)',
      }}>

        {/* Logo */}
        <div className="h-[64px] flex items-center gap-3 px-4" style={{ borderBottom: '1px solid #e8eaf0' }}>
          <img src="/logo.png" alt="MyBestConsultant" className="h-10 w-auto object-contain shrink-0" />
          <div>
            <p className="text-sm font-bold leading-tight" style={{ color: '#0B1D51' }}>My Best Consultant</p>
            <p className="text-[11px] font-medium leading-tight" style={{ color: '#9298b0' }}>Admin</p>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <AdminNav pendingGroupsCount={pendingGroupsCount} supportCount={supportCount} />
        </div>

        {/* User footer */}
        <div className="p-3" style={{ borderTop: '1px solid #e8eaf0' }}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(11,29,81,0.04)', border: '1px solid rgba(11,29,81,0.07)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, #0B1D51 0%, #1a3a8f 100%)' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-tight truncate" style={{ color: '#0B1D51' }}>{user.firstName} {user.lastName}</p>
              <p className="text-[10px] leading-tight truncate" style={{ color: '#9298b0' }}>{user.email}</p>
            </div>
            <form action={logoutAction}>
              <button type="submit" title="Déconnexion"
                className="p-1.5 rounded-lg transition-all"
                style={{ color: '#9298b0' }}>
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── CONTENT ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 lg:ml-[240px]">

        {/* Topbar */}
        <header className="h-[64px] flex items-center justify-between px-6 shrink-0" style={{
          background: '#13151E',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-black"
              style={{ background: 'linear-gradient(135deg, #B8860B 0%, #DAA520 100%)' }}>M</div>
            <span className="text-white font-bold text-sm">Admin</span>
          </div>
          {/* Desktop: empty left side - breadcrumb could go here */}
          <div className="hidden lg:block" />

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <button className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white/8"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <Bell className="h-4 w-4" />
            </button>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #0B1D51 0%, #1a3a8f 100%)' }}>
              {initials}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto" style={{ color: 'rgba(255,255,255,0.87)' }}>
          {children}
        </main>
      </div>
    </div>
    </>
  )
}
