/**
 * /api/knowledge — internal knowledge base: list (GET), create (POST).
 * Article bodies are trimmed to an excerpt in the list so search results and the
 * table never pull full text across the wire.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { knowledgeCreateSchema, knowledgeListSchema } from '@/lib/validations/knowledge'
import { searchTerm } from '@/lib/utils/list'
import { slugify } from '@/lib/utils/slugify'
import { createAuditLog } from '@/lib/audit'
import { ConflictError } from '@/lib/services/errors'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.DASHBOARD_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = knowledgeListSchema.parse(Object.fromEntries(searchParams))

  const searchOr = searchTerm(query.search, ['title', 'content', 'category'])

  const where = {
    organisationId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.isPublic ? { isPublic: query.isPublic === 'true' } : {}),
    ...(searchOr ? { OR: searchOr } : {}),
  }

  const [articles, total] = await Promise.all([
    db.knowledgeArticle.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, title: true, slug: true, category: true, tags: true,
        isPublic: true, publishedAt: true, updatedAt: true, createdAt: true,
        content: true,
      },
    }),
    db.knowledgeArticle.count({ where }),
  ])

  const items = articles.map(({ content, ...article }) => ({
    ...article,
    excerpt: content.replace(/\s+/g, ' ').slice(0, 160),
  }))

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.DASHBOARD_VIEW,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, knowledgeCreateSchema)
  const slug = body.slug ?? slugify(body.title)

  const clash = await db.knowledgeArticle.findFirst({ where: { slug }, select: { id: true } })
  if (clash) throw new ConflictError('Another article already uses this slug')

  const article = await db.knowledgeArticle.create({
    data: {
      organisationId,
      title: body.title,
      slug,
      content: body.content,
      category: body.category,
      tags: body.tags ?? [],
      isPublic: body.isPublic ?? false,
      authorUserId: user.id,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'knowledge.create',
    resourceType: 'knowledge_article',
    resourceId: article.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: article, requestId: uuidv4() }, { status: 201 })
})
