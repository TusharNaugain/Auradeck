import Link from 'next/link'
import { BrandLogo } from '@/components/shared/brand-logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-primary/8 to-transparent"
      />
      <Link
        href="/login"
        className="mb-8 flex items-center"
      >
        <BrandLogo />
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 max-w-md text-center text-xs text-muted-foreground">
        Protected health information must never be entered into CRM notes, search, or exports.
      </p>
    </div>
  )
}
