'use client'

import Link from 'next/link'
import { BrainCircuit, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { logoutAction } from '@/app/(auth)/actions'
import type { UserRole } from '@/types'

const roleLabel: Record<UserRole, string> = {
  admin: 'Super Admin',
  recruiter: 'Recruteur',
  candidate: 'Candidat',
  hunter: 'Chasseur',
}

const roleColor: Record<UserRole, 'default' | 'secondary' | 'destructive'> = {
  admin: 'destructive',
  recruiter: 'default',
  candidate: 'secondary',
  hunter: 'secondary',
}

interface NavbarProps {
  role: UserRole
  name: string
}

export function Navbar({ role, name }: NavbarProps) {
  return (
    <header className="border-b bg-background sticky top-0 z-40">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <span className="hidden sm:inline">MyBestConsultant</span>
        </Link>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden md:inline">{name}</span>
          <Badge variant={roleColor[role]}>{roleLabel[role]}</Badge>
          <form action={logoutAction}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Déconnexion</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
