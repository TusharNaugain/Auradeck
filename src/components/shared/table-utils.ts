export interface ListResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Column<T> {
  key: string
  header: string
  cell: (row: T, index: number) => React.ReactNode
  className?: string
  hideOnMobile?: boolean
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / (pageSize || 1)))
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? singular : plural}`
}
