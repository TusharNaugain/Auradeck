/**
 * /api/search — global tenant-scoped search across permitted entities.
 * Each result is permission-checked; protected client PII never surfaces here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { searchWords } from '@/lib/utils/list'
import { resolveLeadScope } from '@/lib/reports/scope'
import { v4 as uuidv4 } from 'uuid'

const ENTITY_LIMIT = 5
const LEAD_LIMIT = 10

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { searchParams } = new URL(req.url)
  // `search` is the documented name; `q` is accepted too.
  const search = (searchParams.get('search') ?? searchParams.get('q') ?? '').trim()
  if (search.length < 2) {
    return NextResponse.json({ success: true, data: { results: [] }, requestId: uuidv4() })
  }

  const contains = { contains: search, mode: 'insensitive' as const }
  const results: Array<{ type: string; id: string; title: string; subtitle?: string; url: string }> = []

  // Leads
  if (ctx.permissions.has(PERMISSIONS.LEADS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    // Same record scope as the Leads page: a rep who only sees their own leads only finds those.
    const leadScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
    const leads = await db.lead.findMany({
      where: {
        organisationId, deletedAt: null,
        AND: [leadScope, ...searchWords(search, ['fullName', 'firstName', 'lastName', 'email', 'leadNumber', 'organisationName', 'phoneNumber', 'city'])] as never,
      },
      orderBy: { createdAt: 'desc' },
      take: LEAD_LIMIT,
      select: { id: true, leadNumber: true, fullName: true, email: true, organisationName: true, lifecycleStage: true },
    })
    // The Leads page opens the lead's panel for ?lead=<id>, wherever that lead sits in the list.
    results.push(...leads.map((l) => ({
      type: 'lead', id: l.id, title: l.fullName,
      subtitle: [l.leadNumber, l.email ?? l.organisationName, l.lifecycleStage === 'LOST' ? 'Dead' : null].filter(Boolean).join(' · '),
      url: `/leads?lead=${l.id}`,
    })))
  }

  // Accounts
  if (ctx.permissions.has(PERMISSIONS.ACCOUNTS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    const accounts = await db.account.findMany({
      where: { organisationId, OR: [{ accountName: contains }, { customerAccountCode: contains }] },
      take: ENTITY_LIMIT,
      select: { id: true, accountName: true, customerAccountCode: true },
    })
    results.push(...accounts.map((a) => ({
      type: 'account', id: a.id, title: a.accountName,
      subtitle: a.customerAccountCode ?? undefined,
      url: '/accounts',
    })))
  }

  // Contacts
  if (ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    const contacts = await db.contact.findMany({
      where: { organisationId, deletedAt: null, OR: [{ fullName: contains }, { email: contains }, { jobTitle: contains }] },
      take: ENTITY_LIMIT,
      select: { id: true, fullName: true, email: true },
    })
    results.push(...contacts.map((c) => ({
      type: 'contact', id: c.id, title: c.fullName, subtitle: c.email ?? undefined, url: '/contacts',
    })))
  }

  // Opportunities
  if (ctx.permissions.has(PERMISSIONS.OPPORTUNITIES_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    const opps = await db.opportunity.findMany({
      where: { organisationId, deletedAt: null, OR: [{ name: contains }, { opportunityNumber: contains }] },
      take: ENTITY_LIMIT,
      select: { id: true, opportunityNumber: true, name: true, stage: true },
    })
    results.push(...opps.map((o) => ({
      type: 'opportunity', id: o.id, title: o.name, subtitle: `${o.opportunityNumber} · ${o.stage}`, url: '/opportunities',
    })))
  }

  // Tickets
  if (ctx.permissions.has(PERMISSIONS.TICKETS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    const tickets = await db.supportTicket.findMany({
      where: { organisationId, OR: [{ subject: contains }, { ticketNumber: contains }] },
      take: ENTITY_LIMIT,
      select: { id: true, ticketNumber: true, subject: true, status: true },
    })
    results.push(...tickets.map((t) => ({
      type: 'ticket', id: t.id, title: t.subject, subtitle: `${t.ticketNumber} · ${t.status}`, url: '/tickets',
    })))
  }

  // Clients — names only, never PII; respects narrow practitioner scope
  if (ctx.permissions.has(PERMISSIONS.CLIENTS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    const clients = await db.client.findMany({
      where: {
        organisationId, deletedAt: null,
        ...(ctx.scopeType === 'OWN' ? { assignedPractitionerId: user.id } : {}),
        OR: [{ firstName: contains }, { lastName: contains }, { clientNumber: contains }],
      },
      take: ENTITY_LIMIT,
      select: { id: true, clientNumber: true, firstName: true, lastName: true },
    })
    results.push(...clients.map((c) => ({
      type: 'client', id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: c.clientNumber, url: '/clients',
    })))
  }

  void ctx
  return NextResponse.json({ success: true, data: { results: results.slice(0, 40) }, requestId: uuidv4() })
})
