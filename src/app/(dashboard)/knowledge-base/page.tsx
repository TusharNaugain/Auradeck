'use client'

import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime } from '@/lib/client/format'
import { knowledgeCreateSchema, knowledgeUpdateSchema } from '@/lib/validations/knowledge'

interface ArticleRow {
  id: string
  title: string
  slug: string
  category: string | null
  tags: string[]
  isPublic: boolean
  publishedAt: string | null
  updatedAt: string
  excerpt: string
}

const columns: Column<ArticleRow>[] = [
  {
    key: 'title',
    header: 'Article',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.title}</div>
        <div className="line-clamp-1 max-w-prose text-xs text-muted-foreground">{row.excerpt}</div>
      </div>
    ),
  },
  { key: 'category', header: 'Category', hideOnMobile: true, cell: (row) => row.category ?? '—' },
  {
    key: 'tags',
    header: 'Tags',
    hideOnMobile: true,
    cell: (row) =>
      row.tags?.length ? (
        <div className="flex flex-wrap gap-1">
          {row.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
          {row.tags.length > 3 && <span className="text-xs text-muted-foreground">+{row.tags.length - 3}</span>}
        </div>
      ) : (
        '—'
      ),
  },
  {
    key: 'state',
    header: 'State',
    cell: (row) =>
      row.publishedAt ? <StatusBadge value={row.isPublic ? 'public' : 'internal'} /> : <Badge variant="outline">Draft</Badge>,
  },
  { key: 'updated', header: 'Updated', hideOnMobile: true, cell: (row) => formatDateTime(row.updatedAt) },
]

const config: ResourceConfig<ArticleRow> = {
  key: 'knowledge',
  path: '/api/knowledge',
  title: 'Knowledge base',
  singular: 'article',
  description: 'Internal playbooks and how-tos. Client-identifying or clinical detail does not belong here.',
  columns,
  createPermission: 'dashboard.view',
  editPermission: 'dashboard.view',
  createSchema: knowledgeCreateSchema,
  editSchema: knowledgeUpdateSchema,
  rowLabel: (row) => row.title,
  filters: [
    {
      key: 'isPublic',
      label: 'Audience',
      options: [
        { value: 'true', label: 'Public' },
        { value: 'false', label: 'Internal' },
      ],
    },
  ],
  createFields: [
    { name: 'title', label: 'Title', kind: 'text', half: true },
    { name: 'slug', label: 'Slug', kind: 'text', half: true, hint: 'Left blank, the title becomes the slug.' },
    { name: 'category', label: 'Category', kind: 'text', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', half: true, hint: 'Comma separated' },
    { name: 'content', label: 'Content', kind: 'textarea', hint: 'Plain text or Markdown.' },
    { name: 'isPublic', label: 'Publish outside this workspace', kind: 'checkbox' },
  ],
  editFields: [
    { name: 'title', label: 'Title', kind: 'text', half: true },
    { name: 'slug', label: 'Slug', kind: 'text', half: true },
    { name: 'category', label: 'Category', kind: 'text', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', half: true },
    { name: 'content', label: 'Content', kind: 'textarea' },
    { name: 'isPublic', label: 'Publish outside this workspace', kind: 'checkbox', half: true },
    { name: 'publish', label: 'Mark as published', kind: 'checkbox', half: true },
  ],
}

export default function KnowledgeBasePage() {
  return <ResourcePage config={config} />
}
