/**
 * Knowledge base validation: internal how-to articles for the practice.
 * No client-identifying content is allowed here by product rule — clinical detail
 * belongs in clinical notes, which this module cannot read.
 */

import { z } from 'zod'
import {
  safeText,
  safeTextOptional,
  longText,
  tagsSchema,
  paginationSchema,
} from './common'

export const articleSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(120)

export const knowledgeCreateSchema = z.object({
  title: safeText(200),
  slug: articleSlugSchema.optional(),
  content: longText(200_000),
  category: safeTextOptional(100),
  tags: tagsSchema,
  isPublic: z.boolean().optional().default(false),
})

export const knowledgeUpdateSchema = z.object({
  title: safeText(200).optional(),
  slug: articleSlugSchema.optional(),
  content: longText(200_000).optional(),
  category: safeTextOptional(100),
  tags: tagsSchema,
  isPublic: z.boolean().optional(),
  publish: z.boolean().optional(),
})

export const knowledgeListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  isPublic: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).optional().default('updatedAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})
