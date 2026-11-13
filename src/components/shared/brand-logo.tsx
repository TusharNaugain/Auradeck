import Image from 'next/image'
import { cn } from '@/lib/utils/cn'

export function BrandLogo({
  size = 'regular',
  className,
}: {
  size?: 'compact' | 'regular'
  className?: string
}) {
  const px = size === 'compact' ? 40 : 56

  return (
    <span className={cn('inline-flex min-w-0 items-center', className)}>
      <Image src="/auradeck-logo.png" alt="Auradeck" width={px} height={px} priority className="shrink-0" />
    </span>
  )
}
