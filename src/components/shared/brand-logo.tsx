import Image from 'next/image'
import { cn } from '@/lib/utils/cn'

export function BrandLogo({
  size = 'regular',
  className,
}: {
  size?: 'compact' | 'regular'
  className?: string
}) {
  const compact = size === 'compact'

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Image
        src="/auradeck-mark.svg"
        alt=""
        width={compact ? 30 : 36}
        height={compact ? 30 : 36}
        priority
        className="shrink-0"
      />
      <span className={cn('truncate font-serif font-normal leading-none', compact ? 'text-xl' : 'text-2xl')}>
        Auradeck
      </span>
    </span>
  )
}