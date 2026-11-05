import type { SessionPayload } from '@/lib/auth/session-payload'
import type { RequestOptions } from '@/lib/client/api'

const now = new Date()
const date = (daysFromNow: number) =>
  new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
const dateInCurrentMonth = (day: number) =>
  new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()), 12).toISOString()

const demoUser = {
  id: 'demo-user',
  fullName: 'Alex Morgan',
  email: 'alex@example.test',
  avatarUrl: null,
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  mfaEnabled: false,
  emailVerified: true,
}

const demoOrganisation = {
  id: 'demo-organisation',
  displayName: 'Northstar Wellness (Demo)',
  slug: 'northstar-wellness-demo',
  type: 'CUSTOMER_PRACTICE',
  status: 'ACTIVE',
  logoUrl: null,
}

const DEMO_LEADS_STORAGE_KEY = 'auradeck-demo-leads-v1'
const DEMO_SHEET_LEADS_STORAGE_KEY = 'auradeck-demo-sheet-leads-v1'
const DEMO_ACTIVITIES_STORAGE_KEY = 'auradeck-demo-activities-v1'
const DEMO_SUBSCRIPTIONS_STORAGE_KEY = 'auradeck-demo-subscriptions-v1'

const viewPermissions = [
  'dashboard.view',
  'leads.view',
  'leads.create',
  'leads.update',
  'accounts.view',
  'contacts.view',
  'opportunities.view',
  'clients.view',
  'appointments.view',
  'activities.view',
  'activities.create',
  'onboarding.view',
  'success.view',
  'tickets.view',
  'billing.view',
  'billing.manage',
  'reports.view',
  'automations.view',
]

export const DEMO_SESSION: SessionPayload = {
  user: demoUser,
  currentOrganisationId: demoOrganisation.id,
  roleSlug: 'demo_viewer',
  scopeType: 'ORGANISATION',
  permissions: viewPermissions,
  memberships: [{
    organisationId: demoOrganisation.id,
    organisation: demoOrganisation,
    role: { slug: 'demo_viewer', name: 'Demo viewer' },
    isPrimary: true,
  }],
}

const records: Record<string, Record<string, unknown>[]> = {
  '/api/leads': [
    { id: 'demo-lead-1', leadNumber: 'LEAD-000101', firstName: 'Jordan', lastName: 'Lee', fullName: 'Jordan Lee', email: 'jordan@example.test', phoneNumber: '+919876543210', whatsappNumber: '+919876543210', website: 'https://harbortherapy.example.test', organisationName: 'Harbor Therapy', leadSource: 'WEBSITE', lifecycleStage: 'QUALIFIED', leadScore: 82, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(0), firstContactedAt: date(-2), lastContactedAt: date(-1), createdAt: dateInCurrentMonth(1), city: 'Pune', state: 'Maharashtra', tags: ['website', 'priority'] },
    { id: 'demo-lead-2', leadNumber: 'LEAD-000102', firstName: 'Sam', lastName: 'Taylor', fullName: 'Sam Taylor', email: 'sam@example.test', phoneNumber: '+919876543211', whatsappNumber: null, website: null, organisationName: 'Willow Wellness', leadSource: 'REFERRAL', lifecycleStage: 'CONTACTED', leadScore: 64, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(0), firstContactedAt: date(-4), lastContactedAt: date(-2), createdAt: dateInCurrentMonth(2), city: 'Mumbai', state: 'Maharashtra', tags: ['referral'] },
    { id: 'demo-lead-3', leadNumber: 'LEAD-000103', firstName: 'Casey', lastName: 'Patel', fullName: 'Casey Patel', email: 'casey@example.test', phoneNumber: null, whatsappNumber: '+919876543212', website: null, organisationName: 'Cedar Care Clinic', leadSource: 'PARTNER', lifecycleStage: 'NEW', leadScore: 48, assignedToUserId: null, assignedTo: null, nextFollowUpAt: date(-2), firstContactedAt: null, lastContactedAt: null, createdAt: dateInCurrentMonth(3), city: 'Bengaluru', state: 'Karnataka', tags: [] },
    { id: 'demo-lead-5', leadNumber: 'LEAD-000105', firstName: 'Aisha', lastName: 'Noor', fullName: 'Aisha Noor', email: 'aisha@example.test', phoneNumber: '+919876543214', whatsappNumber: '+919876543214', website: null, organisationName: 'Maple Family Care', leadSource: 'REFERRAL', lifecycleStage: 'CONTACTED', leadScore: 72, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(2), firstContactedAt: date(-1), lastContactedAt: date(-1), createdAt: dateInCurrentMonth(4), city: 'Delhi', state: 'Delhi', tags: ['priority'], jobTitle: 'Practice Manager', preferredContactMethod: 'PHONE', currentSoftware: 'Paper records', estimatedUsers: 8, painPoints: 'Manual appointment reminders' },
    { id: 'demo-lead-6', leadNumber: 'LEAD-000106', firstName: 'Rahul', lastName: 'Mehta', fullName: 'Rahul Mehta', email: 'rahul@example.test', phoneNumber: '+919876543215', whatsappNumber: null, website: null, organisationName: 'BrightPath Clinic', leadSource: 'WEBSITE', lifecycleStage: 'NEW', leadScore: 55, assignedToUserId: null, assignedTo: null, nextFollowUpAt: date(3), firstContactedAt: null, lastContactedAt: null, createdAt: dateInCurrentMonth(5), city: 'Jaipur', state: 'Rajasthan', tags: ['website'], estimatedUsers: 12, useCase: 'Online booking and client records' },
    { id: 'demo-lead-7', leadNumber: 'LEAD-000107', firstName: 'Nisha', lastName: 'Gupta', fullName: 'Nisha Gupta', email: 'nisha@example.test', phoneNumber: '+919876543216', whatsappNumber: '+919876543216', website: 'https://sunrisewellness.example.test', organisationName: 'Sunrise Wellness', leadSource: 'WEBSITE', lifecycleStage: 'QUALIFIED', leadScore: 86, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(1), firstContactedAt: date(-5), lastContactedAt: date(-2), createdAt: dateInCurrentMonth(6), city: 'Hyderabad', state: 'Telangana', tags: ['qualified', 'priority'], jobTitle: 'Owner', budgetRange: '₹10,000–₹20,000/month', expectedTimeline: 'This quarter' },
    { id: 'demo-lead-8', leadNumber: 'LEAD-000108', firstName: 'Arjun', lastName: 'Kapoor', fullName: 'Arjun Kapoor', email: 'arjun@example.test', phoneNumber: '+919876543217', whatsappNumber: null, website: null, organisationName: 'Evergreen Health', leadSource: 'PARTNER', lifecycleStage: 'CONTACTED', leadScore: 61, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(4), firstContactedAt: date(-30), lastContactedAt: date(-7), createdAt: date(-35), city: 'Chandigarh', state: 'Punjab', tags: ['partner'] },
    { id: 'demo-lead-9', leadNumber: 'LEAD-000109', firstName: 'Kavya', lastName: 'Rao', fullName: 'Kavya Rao', email: 'kavya@example.test', phoneNumber: '+919876543218', whatsappNumber: '+919876543218', website: null, organisationName: 'Lotus Care', leadSource: 'REFERRAL', lifecycleStage: 'NEW', leadScore: 46, assignedToUserId: null, assignedTo: null, nextFollowUpAt: null, firstContactedAt: null, lastContactedAt: null, createdAt: date(-50), city: 'Kochi', state: 'Kerala', tags: ['referral'] },
    { id: 'demo-lead-10', leadNumber: 'LEAD-000110', firstName: 'Dev', lastName: 'Shah', fullName: 'Dev Shah', email: 'dev@example.test', phoneNumber: '+919876543219', whatsappNumber: null, website: null, organisationName: 'CalmMind Center', leadSource: 'WEBSITE', lifecycleStage: 'PROPOSAL_SENT', leadScore: 78, assignedToUserId: 'demo-user', assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' }, nextFollowUpAt: date(2), firstContactedAt: date(-55), lastContactedAt: date(-3), createdAt: date(-60), city: 'Ahmedabad', state: 'Gujarat', tags: ['proposal'], budgetRange: '₹25,000/month', expectedTimeline: 'Next month' },
    {
      id: 'demo-lead-4',
      leadNumber: 'LEAD-000104',
      firstName: 'Priya',
      lastName: 'Shah',
      fullName: 'Priya Shah',
      email: 'priya@example.test',
      phoneNumber: '+919876543213',
      whatsappNumber: '+919876543213',
      website: null,
      organisationName: 'Willow Wellness',
      leadSource: 'CAMPAIGN',
      lifecycleStage: 'CONVERTED',
      leadScore: 91,
      assignedToUserId: 'demo-user',
      assignedTo: { id: 'demo-user', fullName: 'Alex Morgan' },
      nextFollowUpAt: null,
      firstContactedAt: date(-40),
      lastContactedAt: date(-8),
      createdAt: date(-45),
      city: 'Mumbai',
      state: 'Maharashtra',
      tags: ['converted'],
      convertedAccountId: 'demo-account-1',
      convertedAccount: {
        id: 'demo-account-1',
        accountName: 'Willow Wellness',
        paymentStatus: 'PAID',
        mrr: 14900,
        subscriptions: [{ id: 'demo-subscription-3', status: 'ACTIVE', startDate: date(-30), renewalDate: date(335), amount: 14900, currency: 'INR' }],
        invoices: [{
          invoiceNumber: 'INV-DEMO-001',
          status: 'PAID',
          issueDate: date(-30),
          dueDate: date(-20),
          total: 14900,
          amountPaid: 14900,
          amountDue: 0,
          payments: [{ paidAt: date(-28), amount: 14900, currency: 'INR' }],
        }],
        onboardingProjects: [{ status: 'IN_PROGRESS', targetGoLiveDate: date(12), progressPercentage: 65 }],
      },
    },
  ],
  '/api/accounts': [
    { id: 'demo-account-1', customerAccountCode: 'ACC-000101', accountName: 'Harbor Therapy', accountType: 'Clinic', segment: 'Growth', healthStatus: 'HEALTHY', healthScore: 88, mrr: 24900, renewalDate: date(20), createdAt: date(-120), contacts: [{ id: 'demo-contact-1', fullName: 'Jordan Lee', email: 'jordan@example.test', phoneNumber: '+919876543210', whatsappNumber: '+919876543210', jobTitle: 'Practice Director', lastContactedAt: date(-1) }] },
    { id: 'demo-account-2', customerAccountCode: 'ACC-000102', accountName: 'Willow Wellness', accountType: 'Wellness studio', segment: 'Standard', healthStatus: 'AT_RISK', healthScore: 54, mrr: 14900, renewalDate: date(75), createdAt: date(-95), contacts: [{ id: 'demo-contact-2', fullName: 'Priya Shah', email: 'priya@example.test', phoneNumber: '+919876543213', whatsappNumber: '+919876543213', jobTitle: 'Owner', lastContactedAt: date(-8) }] },
    { id: 'demo-account-3', customerAccountCode: 'ACC-000103', accountName: 'Cedar Care Clinic', accountType: 'Clinic', segment: 'Standard', healthStatus: 'HEALTHY', healthScore: 82, mrr: 9900, renewalDate: date(90), createdAt: date(-60), contacts: [{ id: 'demo-contact-3', fullName: 'Casey Patel', email: 'casey@example.test', phoneNumber: '+919876543212', whatsappNumber: '+919876543212', jobTitle: 'Clinic Owner' }] },
    { id: 'demo-account-4', customerAccountCode: 'ACC-000104', accountName: 'Maple Family Care', accountType: 'Clinic', segment: 'Growth', healthStatus: 'HEALTHY', healthScore: 90, mrr: 19900, renewalDate: date(120), createdAt: date(-40), contacts: [{ id: 'demo-contact-4', fullName: 'Aisha Noor', email: 'aisha@example.test', phoneNumber: '+919876543214', whatsappNumber: '+919876543214', jobTitle: 'Practice Manager', lastContactedAt: date(-1) }] },
    { id: 'demo-account-5', customerAccountCode: 'ACC-000105', accountName: 'BrightPath Clinic', accountType: 'Clinic', segment: 'Standard', healthStatus: 'CRITICAL', healthScore: 42, mrr: 0, renewalDate: null, createdAt: date(-30), contacts: [{ id: 'demo-contact-5', fullName: 'Rahul Mehta', email: 'rahul@example.test', phoneNumber: '+919876543215', whatsappNumber: null, jobTitle: 'Director' }] },
    { id: 'demo-account-6', customerAccountCode: 'ACC-000106', accountName: 'Sunrise Wellness', accountType: 'Wellness studio', segment: 'Growth', healthStatus: 'HEALTHY', healthScore: 93, mrr: 29900, renewalDate: date(180), createdAt: date(-25), contacts: [{ id: 'demo-contact-6', fullName: 'Nisha Gupta', email: 'nisha@example.test', phoneNumber: '+919876543216', whatsappNumber: '+919876543216', jobTitle: 'Owner', lastContactedAt: date(-2) }] },
    { id: 'demo-account-7', customerAccountCode: 'ACC-000107', accountName: 'Evergreen Health', accountType: 'Clinic', segment: 'Standard', healthStatus: 'AT_RISK', healthScore: 58, mrr: 14900, renewalDate: date(210), createdAt: date(-20), contacts: [{ id: 'demo-contact-7', fullName: 'Arjun Kapoor', email: 'arjun@example.test', phoneNumber: '+919876543217', whatsappNumber: null, jobTitle: 'Operations Lead', lastContactedAt: date(-7) }] },
    { id: 'demo-account-8', customerAccountCode: 'ACC-000108', accountName: 'Lotus Care', accountType: 'Clinic', segment: 'Standard', healthStatus: 'HEALTHY', healthScore: 84, mrr: 0, renewalDate: null, createdAt: date(-15), contacts: [{ id: 'demo-contact-8', fullName: 'Kavya Rao', email: 'kavya@example.test', phoneNumber: '+919876543218', whatsappNumber: '+919876543218', jobTitle: 'Practice Director' }] },
  ],
  '/api/contacts': [
    { id: 'demo-contact-1', fullName: 'Jordan Lee', preferredName: 'Jordan', email: 'jordan@example.test', jobTitle: 'Practice Director', contactType: 'OWNER', isDecisionMaker: true, lastContactedAt: date(-2), createdAt: date(-30) },
    { id: 'demo-contact-2', fullName: 'Sam Taylor', preferredName: null, email: 'sam@example.test', jobTitle: 'Operations Lead', contactType: 'PRIMARY', isDecisionMaker: true, lastContactedAt: date(-7), createdAt: date(-20) },
  ],
  '/api/opportunities': [
    { id: 'demo-opportunity-1', opportunityNumber: 'OPP-000041', name: 'Harbor Therapy rollout', type: 'NEW_BUSINESS', stage: 'PROPOSAL', amount: 298800, weightedAmount: 179280, probability: 60, expectedCloseDate: date(30), forecastCategory: 'BEST_CASE', createdAt: date(-12), account: { id: 'demo-account-1', accountName: 'Harbor Therapy' }, primaryContact: { id: 'demo-contact-1', fullName: 'Jordan Lee', email: 'jordan@example.test', phoneNumber: '+919876543210', whatsappNumber: '+919876543210' }, owner: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-opportunity-2', opportunityNumber: 'OPP-000042', name: 'Willow Wellness expansion', type: 'EXPANSION', stage: 'DISCOVERY', amount: 178800, weightedAmount: 35760, probability: 20, expectedCloseDate: date(60), forecastCategory: 'PIPELINE', createdAt: date(-4), account: { id: 'demo-account-2', accountName: 'Willow Wellness' }, primaryContact: { id: 'demo-contact-2', fullName: 'Priya Shah', email: 'priya@example.test', phoneNumber: '+919876543213', whatsappNumber: '+919876543213' }, owner: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-opportunity-3', opportunityNumber: 'OPP-000043', name: 'Cedar Care subscription', type: 'NEW_BUSINESS', stage: 'WON', amount: 110000, weightedAmount: 110000, probability: 100, wonAt: dateInCurrentMonth(1), expectedCloseDate: dateInCurrentMonth(1), forecastCategory: 'CLOSED', createdAt: date(-12), account: { id: 'demo-account-3', accountName: 'Cedar Care Clinic' }, primaryContact: { id: 'demo-contact-3', fullName: 'Casey Patel', email: 'casey@example.test', phoneNumber: '+919876543212' }, owner: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-opportunity-4', opportunityNumber: 'OPP-000044', name: 'Maple Family Care plan', type: 'NEW_BUSINESS', stage: 'WON', amount: 120000, weightedAmount: 120000, probability: 100, wonAt: dateInCurrentMonth(2), expectedCloseDate: dateInCurrentMonth(2), forecastCategory: 'CLOSED', createdAt: date(-20), account: { id: 'demo-account-4', accountName: 'Maple Family Care' }, primaryContact: { id: 'demo-contact-4', fullName: 'Aisha Noor', email: 'aisha@example.test', phoneNumber: '+919876543214' }, owner: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-opportunity-5', opportunityNumber: 'OPP-000045', name: 'Sunrise Wellness plan', type: 'NEW_BUSINESS', stage: 'WON', amount: 95000, weightedAmount: 95000, probability: 100, wonAt: dateInCurrentMonth(3), expectedCloseDate: dateInCurrentMonth(3), forecastCategory: 'CLOSED', createdAt: date(-25), account: { id: 'demo-account-6', accountName: 'Sunrise Wellness' }, primaryContact: { id: 'demo-contact-6', fullName: 'Nisha Gupta', email: 'nisha@example.test', phoneNumber: '+919876543216' }, owner: { id: 'demo-user', fullName: demoUser.fullName } },
  ],
  '/api/clients': [
    { id: 'demo-client-1', clientNumber: 'CLIENT-00021', firstName: 'Demo', lastName: 'Client One', preferredName: 'Client One', status: 'ACTIVE', lastAppointmentAt: date(-7), nextAppointmentAt: date(2), outstandingBalance: 1200, createdAt: date(-2) },
    { id: 'demo-client-2', clientNumber: 'CLIENT-00022', firstName: 'Demo', lastName: 'Client Two', preferredName: null, status: 'ACTIVE', lastAppointmentAt: date(-14), nextAppointmentAt: date(4), outstandingBalance: 0, createdAt: date(-60) },
  ],
  '/api/tasks': [
    { id: 'demo-task-1', title: 'Follow up with Harbor Therapy', status: 'OPEN', priority: 'HIGH', dueAt: date(0), completedAt: null, relatedEntityType: 'lead', createdAt: date(-2), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-task-2', title: 'Prepare onboarding checklist', status: 'IN_PROGRESS', priority: 'NORMAL', dueAt: date(2), completedAt: null, relatedEntityType: 'account', createdAt: date(-1), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-task-3', title: 'Confirm Willow Wellness requirements', status: 'OPEN', priority: 'NORMAL', dueAt: date(0), completedAt: null, relatedEntityType: 'lead', createdAt: date(-1), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-task-4', title: 'Send Cedar Care renewal follow-up', status: 'OPEN', priority: 'HIGH', dueAt: date(-2), completedAt: null, relatedEntityType: 'account', createdAt: date(-4), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
  ],
  '/api/activities': [
    { id: 'demo-activity-1', relatedLeadId: 'demo-lead-1', relatedAccountId: 'demo-account-1', subject: 'Product walkthrough with Harbor Therapy', description: 'Reviewed appointment scheduling, client records and reporting.', outcome: 'Jordan requested a pricing proposal.', activityType: 'DEMO', status: 'SCHEDULED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(1), completedAt: null, createdAt: date(-1), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-activity-2', relatedLeadId: 'demo-lead-2', relatedAccountId: 'demo-account-2', subject: 'Discovery call with Willow Wellness', description: 'Discussed team size and onboarding timeline.', outcome: 'Send the onboarding checklist.', activityType: 'CALL', status: 'COMPLETED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(-4), completedAt: date(-4), createdAt: date(-5), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-activity-3', relatedLeadId: 'demo-lead-5', relatedAccountId: 'demo-account-4', subject: 'Follow-up with Aisha Noor', description: 'Talked through appointment reminder needs.', outcome: 'Schedule a product walkthrough.', activityType: 'CALL', status: 'COMPLETED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(-1), completedAt: date(-1), createdAt: date(-1), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-activity-4', relatedLeadId: 'demo-lead-7', relatedAccountId: 'demo-account-6', subject: 'Qualification call with Nisha Gupta', description: 'Confirmed decision maker, target users and implementation timeline.', outcome: 'Qualified for a team demo.', activityType: 'CALL', status: 'COMPLETED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(-2), completedAt: date(-2), createdAt: date(-2), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-activity-5', relatedLeadId: 'demo-lead-10', subject: 'Proposal review with Dev Shah', description: 'Reviewed the proposed onboarding plan and monthly pricing.', outcome: 'Waiting for the practice director’s approval.', activityType: 'MEETING', status: 'COMPLETED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(-3), completedAt: date(-3), createdAt: date(-3), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
    { id: 'demo-activity-6', relatedAccountId: 'demo-account-3', relatedOpportunityId: 'demo-opportunity-3', subject: 'Cedar Care plan signed', description: 'Finalized subscription seats and start date.', outcome: 'Subscription activated.', activityType: 'MEETING', status: 'COMPLETED', visibility: 'ORGANISATION', priority: 'NORMAL', dueAt: date(-2), completedAt: date(-2), createdAt: date(-2), assignedTo: { id: 'demo-user', fullName: demoUser.fullName } },
  ],
  '/api/appointments': [
    { id: 'demo-appointment-1', startAt: date(0), endAt: date(0.05), status: 'CONFIRMED', appointmentType: 'THERAPY_SESSION', client: { firstName: 'Demo', lastName: 'Client One', preferredName: 'Client One' }, practitioner: { fullName: demoUser.fullName } },
  ],
  '/api/onboarding': [
    {
      id: 'demo-onboarding-1',
      projectName: 'Harbor Therapy onboarding',
      status: 'IN_PROGRESS',
      kickoffDate: date(-10),
      targetGoLiveDate: date(20),
      actualGoLiveDate: null,
      progressPercentage: 65,
      currentPhase: 'Configuration',
      createdAt: date(-10),
      account: { id: 'demo-account-1', accountName: 'Harbor Therapy' },
      _count: { tasks: 8 },
    },
    { id: 'demo-onboarding-2', projectName: 'BrightPath Clinic onboarding', status: 'SCHEDULED', kickoffDate: date(3), targetGoLiveDate: date(35), actualGoLiveDate: null, progressPercentage: 10, currentPhase: 'Kickoff', createdAt: date(-2), account: { id: 'demo-account-5', accountName: 'BrightPath Clinic' }, _count: { tasks: 6 } },
    { id: 'demo-onboarding-3', projectName: 'Cedar Care rollout', status: 'COMPLETED', kickoffDate: date(-90), targetGoLiveDate: date(-30), actualGoLiveDate: date(-28), progressPercentage: 100, currentPhase: 'Live', createdAt: date(-95), account: { id: 'demo-account-3', accountName: 'Cedar Care Clinic' }, _count: { tasks: 8 } },
    { id: 'demo-onboarding-4', projectName: 'Maple Family Care rollout', status: 'COMPLETED', kickoffDate: date(-85), targetGoLiveDate: date(-20), actualGoLiveDate: date(-18), progressPercentage: 100, currentPhase: 'Live', createdAt: date(-90), account: { id: 'demo-account-4', accountName: 'Maple Family Care' }, _count: { tasks: 7 } },
    { id: 'demo-onboarding-5', projectName: 'Sunrise Wellness rollout', status: 'COMPLETED', kickoffDate: date(-60), targetGoLiveDate: date(-15), actualGoLiveDate: date(-12), progressPercentage: 100, currentPhase: 'Live', createdAt: date(-65), account: { id: 'demo-account-6', accountName: 'Sunrise Wellness' }, _count: { tasks: 9 } },
    { id: 'demo-onboarding-6', projectName: 'Willow Wellness rollout', status: 'COMPLETED', kickoffDate: date(-55), targetGoLiveDate: date(-10), actualGoLiveDate: date(-9), progressPercentage: 100, currentPhase: 'Live', createdAt: date(-60), account: { id: 'demo-account-2', accountName: 'Willow Wellness' }, _count: { tasks: 5 } },
  ],
  '/api/success': [
    { id: 'demo-success-1', accountId: 'demo-account-1', healthStatus: 'HEALTHY', healthScore: 88, nextReviewAt: date(15), account: { accountName: 'Harbor Therapy' }, owner: { fullName: demoUser.fullName } },
  ],
  '/api/tickets': [
    { id: 'demo-ticket-1', ticketNumber: 'TCK-00121', subject: 'Help configuring appointment reminders', status: 'OPEN', priority: 'NORMAL', category: 'HOW_TO', createdAt: date(-2), updatedAt: date(-1), account: { accountName: 'Harbor Therapy' }, assignee: { fullName: demoUser.fullName } },
  ],
  '/api/billing': [
    { id: 'demo-subscription-1', accountId: 'demo-account-1', status: 'TRIAL', amount: 0, currency: 'INR', renewalDate: date(12), account: { id: 'demo-account-1', accountName: 'Harbor Therapy' }, plan: { name: 'Growth' } },
    { id: 'demo-subscription-2', accountId: 'demo-account-5', status: 'TRIAL', amount: 0, currency: 'INR', renewalDate: date(18), account: { id: 'demo-account-5', accountName: 'BrightPath Clinic' }, plan: { name: 'Starter' } },
    { id: 'demo-subscription-3', accountId: 'demo-account-2', status: 'ACTIVE', amount: 14900, currency: 'INR', renewalDate: date(75), account: { id: 'demo-account-2', accountName: 'Willow Wellness' }, plan: { name: 'Standard' } },
    { id: 'demo-subscription-4', accountId: 'demo-account-3', status: 'ACTIVE', amount: 9900, currency: 'INR', renewalDate: date(90), account: { id: 'demo-account-3', accountName: 'Cedar Care Clinic' }, plan: { name: 'Starter' } },
    { id: 'demo-subscription-5', accountId: 'demo-account-4', status: 'ACTIVE', amount: 19900, currency: 'INR', renewalDate: date(120), account: { id: 'demo-account-4', accountName: 'Maple Family Care' }, plan: { name: 'Growth' } },
    { id: 'demo-subscription-6', accountId: 'demo-account-6', status: 'ACTIVE', amount: 29900, currency: 'INR', renewalDate: date(180), account: { id: 'demo-account-6', accountName: 'Sunrise Wellness' }, plan: { name: 'Growth' } },
    { id: 'demo-subscription-7', accountId: 'demo-account-7', status: 'ACTIVE', amount: 14900, currency: 'INR', renewalDate: date(210), account: { id: 'demo-account-7', accountName: 'Evergreen Health' }, plan: { name: 'Standard' } },
    { id: 'demo-subscription-8', accountId: 'demo-account-8', status: 'ACTIVE', amount: 14900, currency: 'INR', renewalDate: date(240), account: { id: 'demo-account-8', accountName: 'Lotus Care' }, plan: { name: 'Standard' } },
  ],
  '/api/automations': [
    { id: 'demo-automation-1', name: 'New lead follow-up', description: 'Create a follow-up task when a lead arrives.', trigger: 'LEAD_CREATED', status: 'ACTIVE', conditions: [], actions: [{ type: 'create_task' }], delaySeconds: 0, updatedAt: date(-3), _count: { executions: 12 } },
  ],
  '/api/knowledge': [
    { id: 'demo-article-1', title: 'Getting started with AuraDeck', category: 'Getting started', status: 'PUBLISHED', updatedAt: date(-2), createdAt: date(-20) },
  ],
  '/api/notifications': [
    { id: 'demo-notification-1', type: 'TASK_DUE', title: 'Follow-up due today', message: 'A sample follow-up task is due today.', severity: 'INFO', actionUrl: '/tasks', readAt: null, createdAt: date(-0.2) },
  ],
  '/api/users': [
    { id: 'demo-user', fullName: demoUser.fullName, email: demoUser.email, status: 'ACTIVE', user: demoUser, role: { name: 'Demo viewer', slug: 'demo_viewer' } },
  ],
  '/api/teams': [
    { id: 'demo-team', name: 'Customer Success', description: 'Demo workspace team', isActive: true, _count: { members: 1 } },
  ],
  '/api/audit': [],
}

const demoOverview = {
  dashboard: {
    sales: {
      canViewLeads: true,
      canViewOpportunities: true,
      totalLeads: 10,
      leadsToday: 0,
      leadsThisWeek: 5,
      leadsThisMonth: 6,
      qualifiedLeads: 2,
      leadsByStage: [
        { stage: 'NEW', count: 3 },
        { stage: 'CONTACTED', count: 3 },
        { stage: 'QUALIFIED', count: 2 },
        { stage: 'PROPOSAL_SENT', count: 1 },
        { stage: 'CONVERTED', count: 1 },
      ],
      leadsBySource: [
        { source: 'WEBSITE', count: 4 },
        { source: 'REFERRAL', count: 3 },
        { source: 'PARTNER', count: 2 },
        { source: 'CAMPAIGN', count: 1 },
      ],
      salesThisMonth: 325000,
      wonThisMonth: 3,
      salesByOwner: [
        { userId: 'demo-user', name: 'Alex Morgan', deals: 3, amount: 325000 },
      ],
      pipelineValue: 477600,
      weightedForecast: 215040,
      openCount: 2,
      winRate: 62,
      followupsDueToday: 2,
      overdueFollowups: 1,
    },
    success: {
      accountsByHealth: [
        { status: 'HEALTHY', count: 6 },
        { status: 'AT_RISK', count: 2 },
        { status: 'CRITICAL', count: 1 },
      ],
      renewalsIn30: 1,
      renewalsIn60: 2,
      renewalsIn90: 3,
      onboardingActive: 2,
      onboardingCompleted: 4,
      onboardingByStatus: [
        { status: 'SCHEDULED', count: 1 },
        { status: 'IN_PROGRESS', count: 1 },
        { status: 'COMPLETED', count: 4 },
      ],
      atRiskAccounts: 3,
    },
    billing: {
      trialSubscriptions: 2,
      paidSubscriptions: 6,
      subscriptionsByStatus: [
        { status: 'TRIAL', count: 2, amount: 0 },
      { status: 'ACTIVE', count: 6, amount: 104400 },
        { status: 'PAST_DUE', count: 1, amount: 24900 },
      ],
    },
    practice: {
      appointmentsToday: 1,
      activeClients: 2,
      newEnquiriesThisWeek: 1,
      outstandingBalance: 1200,
    },
    own: { tasksDueToday: 2, overdueTasks: 1 },
  },
}

function matchesFilters(record: Record<string, unknown>, query: RequestOptions['query']): boolean {
  return Object.entries(query ?? {}).every(([key, value]) => {
    if (value === undefined || value === null || value === '' ||
        ['page', 'pageSize', 'sort', 'sortBy', 'search', 'q', 'unread', 'dueAfter', 'dueBefore', 'overdue', 'from', 'to', 'renewalWithinDays'].includes(key)) return true
    if (key === 'hasOutstandingBalance') {
      return (Number(record.outstandingBalance ?? 0) > 0) === (value === 'true')
    }
    const field = key === 'source'
      ? 'leadSource'
      : key === 'stage'
        ? record.lifecycleStage !== undefined ? 'lifecycleStage' : 'stage'
        : key
    const recordValue = record[field]
    return recordValue !== undefined && String(recordValue).toLowerCase() === String(value).toLowerCase()
  })
}

function getDemoLeads(): Record<string, unknown>[] {
  const sampleLeads = records['/api/leads']
  if (typeof window === 'undefined') return sampleLeads

  const stored = window.localStorage.getItem(DEMO_LEADS_STORAGE_KEY)
  let savedLeads: unknown = []
  if (stored) {
    try {
      savedLeads = JSON.parse(stored)
    } catch {
      throw new Error('Saved demo leads could not be read. Clear this browser’s demo lead data and try again.')
    }
    if (!Array.isArray(savedLeads) || savedLeads.some((lead) =>
      !lead || typeof lead !== 'object' || typeof (lead as Record<string, unknown>).id !== 'string'
    )) {
      throw new Error('Saved demo leads are invalid. Clear this browser’s demo lead data and try again.')
    }
  }

  const sheetStored = window.localStorage.getItem(DEMO_SHEET_LEADS_STORAGE_KEY)
  if (sheetStored !== null) {
    let sheetLeads: unknown
    try {
      sheetLeads = JSON.parse(sheetStored)
    } catch {
      throw new Error('Imported sheet leads could not be read. Re-import the sheet data and try again.')
    }
    if (!Array.isArray(sheetLeads) || sheetLeads.some((lead) =>
      !lead || typeof lead !== 'object' ||
      typeof (lead as Record<string, unknown>).id !== 'string' ||
      typeof (lead as Record<string, unknown>).email !== 'string'
    )) {
      throw new Error('Imported sheet leads are invalid. Re-import the sheet data and try again.')
    }

    const sampleIds = new Set(sampleLeads.map((lead) => String(lead.id)))
    const importedLeads = sheetLeads as Record<string, unknown>[]
    const importedEmails = new Set(importedLeads
      .map((lead) => String(lead.email).trim().toLowerCase()))
    const existingLeads = (savedLeads as Record<string, unknown>[]).filter((lead) =>
      !sampleIds.has(String(lead.id)) &&
      !importedEmails.has(String(lead.email ?? '').trim().toLowerCase())
    )
    return [...importedLeads, ...existingLeads]
  }

  if (!stored) return sampleLeads

  const overrides = new Map((savedLeads as Record<string, unknown>[]).map((lead) => [String(lead.id), lead]))
  return sampleLeads.map((lead) => overrides.get(String(lead.id)) ?? lead)
    .concat((savedLeads as Record<string, unknown>[]).filter((lead) =>
      !sampleLeads.some((sample) => sample.id === lead.id)
    ))
}

export function isSheetImportMode(): boolean {
  return typeof window !== 'undefined' &&
    window.localStorage.getItem(DEMO_SHEET_LEADS_STORAGE_KEY) !== null
}

function clearSampleValues(value: unknown): unknown {
  if (Array.isArray(value)) return []
  if (typeof value === 'number') return 0
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clearSampleValues(item)])
    )
  }
  return value
}

function getSheetImportOverview(): typeof demoOverview {
  const overview = clearSampleValues(demoOverview) as typeof demoOverview
  const leads = getDemoLeads()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const createdAt = (lead: Record<string, unknown>) => {
    const time = new Date(String(lead.createdAt ?? '')).getTime()
    return Number.isFinite(time) ? time : null
  }
  const countCreatedSince = (threshold: number) =>
    leads.filter((lead) => {
      const time = createdAt(lead)
      return time !== null && time >= threshold
    }).length
  const stages = new Map<string, number>()
  const sources = new Map<string, number>()
  for (const lead of leads) {
    const stage = String(lead.lifecycleStage ?? 'NEW')
    const source = String(lead.leadSource ?? 'OTHER')
    stages.set(stage, (stages.get(stage) ?? 0) + 1)
    sources.set(source, (sources.get(source) ?? 0) + 1)
  }

  overview.dashboard.sales.totalLeads = leads.length
  overview.dashboard.sales.leadsToday = leads.filter((lead) => {
    const time = createdAt(lead)
    return time !== null && new Date(time).toISOString().slice(0, 10) === today
  }).length
  overview.dashboard.sales.leadsThisWeek = countCreatedSince(weekAgo)
  overview.dashboard.sales.leadsThisMonth = countCreatedSince(monthStart)
  overview.dashboard.sales.qualifiedLeads = leads.filter((lead) =>
    lead.lifecycleStage === 'QUALIFIED'
  ).length
  overview.dashboard.sales.leadsByStage = Array.from(stages, ([stage, count]) => ({ stage, count }))
  overview.dashboard.sales.leadsBySource = Array.from(sources, ([source, count]) => ({ source, count }))
  return overview
}

function getStoredRows(key: string): Record<string, unknown>[] {
  if (typeof window === 'undefined') return []
  const stored = window.localStorage.getItem(key)
  if (!stored) return []
  let rows: unknown
  try {
    rows = JSON.parse(stored)
  } catch {
    throw new Error('Saved demo CRM data could not be read. Clear this browser’s demo data and try again.')
  }
  if (!Array.isArray(rows) || rows.some((row) =>
    !row || typeof row !== 'object' || typeof (row as Record<string, unknown>).id !== 'string'
  )) {
    throw new Error('Saved demo CRM data is invalid. Clear this browser’s demo data and try again.')
  }
  return rows as Record<string, unknown>[]
}

function getDemoActivities(): Record<string, unknown>[] {
  const sampleActivities = records['/api/activities']
  const savedActivities = getStoredRows(DEMO_ACTIVITIES_STORAGE_KEY)
  const overrides = new Map(savedActivities.map((activity) => [String(activity.id), activity]))
  return sampleActivities.map((activity) => overrides.get(String(activity.id)) ?? activity)
    .concat(savedActivities.filter((activity) =>
      !sampleActivities.some((sample) => sample.id === activity.id)
    ))
}

function createDemoActivity(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Interaction details are missing or invalid.')
  }
  const values = input as Record<string, unknown>
  if (!values.relatedLeadId && !values.relatedAccountId && !values.relatedContactId &&
      !values.relatedOpportunityId && !values.relatedTicketId) {
    throw new Error('An interaction must be linked to a CRM record.')
  }
  const activity = {
    ...values,
    id: `demo-activity-${crypto.randomUUID()}`,
    activityType: String(values.activityType ?? 'note').toUpperCase(),
    status: String(values.status ?? 'completed').toUpperCase(),
    visibility: String(values.visibility ?? 'team').toUpperCase(),
    createdAt: new Date().toISOString(),
    assignedTo: { id: demoUser.id, fullName: demoUser.fullName },
  }
  const saved = getStoredRows(DEMO_ACTIVITIES_STORAGE_KEY)
  window.localStorage.setItem(DEMO_ACTIVITIES_STORAGE_KEY, JSON.stringify([...saved, activity]))
  return activity
}

function getDemoSubscriptions(): Record<string, unknown>[] {
  const sampleSubscriptions = records['/api/billing']
  const savedSubscriptions = getStoredRows(DEMO_SUBSCRIPTIONS_STORAGE_KEY)
  const overrides = new Map(savedSubscriptions.map((subscription) => [String(subscription.id), subscription]))
  return sampleSubscriptions.map((subscription) => overrides.get(String(subscription.id)) ?? subscription)
    .concat(savedSubscriptions.filter((subscription) =>
      !sampleSubscriptions.some((sample) => sample.id === subscription.id)
    ))
}

function updateDemoSubscription(id: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input as Record<string, unknown>).confirmManualActivation !== true) {
    throw new Error('Explicit confirmation is required to mark this subscription active.')
  }
  const subscription = getDemoSubscriptions().find((item) => item.id === id)
  if (!subscription) throw new Error('Demo subscription not found.')
  if (!['TRIAL', 'PAST_DUE'].includes(String(subscription.status))) {
    throw new Error('Only trial or past-due subscriptions can be manually activated.')
  }
  const updated = { ...subscription, status: 'ACTIVE' }
  const saved = getStoredRows(DEMO_SUBSCRIPTIONS_STORAGE_KEY)
  window.localStorage.setItem(
    DEMO_SUBSCRIPTIONS_STORAGE_KEY,
    JSON.stringify([...saved.filter((item) => item.id !== id), updated])
  )
  createDemoActivity({
    activityType: 'note',
    subject: 'Subscription manually marked active',
    description: 'CRM status manually changed to active. No payment was verified or recorded.',
    outcome: 'Manual activation confirmed',
    status: 'completed',
    relatedAccountId: (subscription.account as { id?: string } | undefined)?.id ?? subscription.accountId,
    visibility: 'team',
  })
  return updated
}

function saveDemoLead(lead: Record<string, unknown>): Record<string, unknown> {
  if (typeof window === 'undefined') {
    throw new Error('Browser-only demo leads can only be saved in a browser.')
  }
  const saved = getDemoLeads().filter((item) =>
    item.id !== lead.id && !records['/api/leads'].some((sample) => sample.id === item.id)
  )
  const sampleOverride = records['/api/leads'].some((sample) => sample.id === lead.id)
  if (sampleOverride) {
    const stored = window.localStorage.getItem(DEMO_LEADS_STORAGE_KEY)
    const savedOverrides = stored ? JSON.parse(stored) as Record<string, unknown>[] : []
    const nextOverrides = savedOverrides.filter((item) => item.id !== lead.id).concat(lead)
    window.localStorage.setItem(DEMO_LEADS_STORAGE_KEY, JSON.stringify(nextOverrides))
  } else {
    saved.push(lead)
    window.localStorage.setItem(DEMO_LEADS_STORAGE_KEY, JSON.stringify(saved))
  }
  return lead
}

function createDemoLead(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Lead details are missing or invalid.')
  }
  const values = input as Record<string, unknown>
  const createdAt = new Date().toISOString()
  const existing = getDemoLeads()
  const number = existing.length + 101
  const userId = values.assignedToUserId
  return saveDemoLead({
    ...values,
    id: `demo-lead-${crypto.randomUUID()}`,
    leadNumber: `LEAD-${String(number).padStart(6, '0')}`,
    fullName: `${String(values.firstName ?? '').trim()} ${String(values.lastName ?? '').trim()}`.trim(),
    phoneNumber: values.phone ?? null,
    phoneCountryCode: typeof values.phone === 'string' && values.phone.startsWith('+') ? values.phone.slice(1, 3) : null,
    leadSource: String(values.leadSource ?? 'other').toUpperCase(),
    lifecycleStage: 'NEW',
    leadScore: values.email || values.phone || values.whatsappNumber ? 50 : 0,
    assignedToUserId: userId ?? null,
    assignedTo: userId === demoUser.id ? { id: demoUser.id, fullName: demoUser.fullName } : null,
    nextFollowUpAt: values.nextFollowUpAt ?? null,
    firstContactedAt: null,
    lastContactedAt: null,
    createdAt,
    city: values.city ?? null,
    state: values.state ?? null,
    tags: Array.isArray(values.tags) ? values.tags : [],
  })
}

function updateDemoLead(id: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Lead changes are missing or invalid.')
  }
  const lead = getDemoLeads().find((item) => item.id === id)
  if (!lead) throw new Error('Demo lead not found')
  const values = input as Record<string, unknown>
  const updated = {
    ...lead,
    ...values,
    ...(values.phone !== undefined ? { phoneNumber: values.phone } : {}),
    ...(values.leadSource !== undefined ? { leadSource: String(values.leadSource).toUpperCase() } : {}),
    ...(values.lifecycleStage !== undefined ? { lifecycleStage: String(values.lifecycleStage).toUpperCase() } : {}),
    ...(values.firstName !== undefined || values.lastName !== undefined
      ? {
          fullName: `${String(values.firstName ?? lead.firstName ?? '').trim()} ${String(values.lastName ?? lead.lastName ?? '').trim()}`.trim(),
        }
      : {}),
  }
  const saved = saveDemoLead(updated)
  const nextStage = String(updated.lifecycleStage ?? '').toUpperCase()
  if (nextStage !== String(lead.lifecycleStage ?? '').toUpperCase() && ['LOST', 'DISQUALIFIED'].includes(nextStage)) {
    createDemoActivity({
      activityType: 'note',
      subject: nextStage === 'LOST' ? 'Lead marked as dead' : 'Lead disqualified',
      description: `Lead moved from ${String(lead.lifecycleStage)} to ${nextStage}.`,
      outcome: nextStage === 'LOST' ? 'Lead closed as lost' : 'Lead disqualified',
      status: 'completed',
      relatedLeadId: id,
      visibility: 'team',
    })
  }
  return saved
}

function listDemoRows<T>(
  rows: Record<string, unknown>[],
  query: RequestOptions['query'],
  includeStageCounts: boolean,
): T {
  const search = String(query?.search ?? query?.q ?? '').trim().toLowerCase()
  const filtered = rows.filter((row) =>
    matchesFilters(row, query) &&
    (!search || Object.values(row).some((value) =>
      typeof value === 'string' && value.toLowerCase().includes(search)
    ))
  )
  const pageSize = Math.max(1, Math.min(100, Number(query?.pageSize ?? 20) || 20))
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const stageCounts = includeStageCounts
    ? Array.from(filtered.reduce((counts, row) => {
        const stage = String(row.lifecycleStage ?? '')
        counts.set(stage, (counts.get(stage) ?? 0) + 1)
        return counts
      }, new Map<string, number>()), ([stage, count]) => ({ stage, count }))
    : undefined
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.ceil(filtered.length / pageSize),
    ...(stageCounts ? { stageCounts } : {}),
  } as T
}

export function getDemoResponse<T>(
  path: string,
  query?: RequestOptions['query'],
  method = 'GET',
  body?: unknown,
): T {
  const url = new URL(path, 'http://demo.local')
  if (url.pathname === '/api/leads' && method === 'POST') {
    return createDemoLead(body) as T
  }
  if (url.pathname === '/api/activities' && method === 'POST') {
    return createDemoActivity(body) as T
  }
  const subscriptionMatch = url.pathname.match(/^\/api\/billing\/subscriptions\/([^/]+)$/)
  if (subscriptionMatch && method === 'PATCH') {
    return updateDemoSubscription(subscriptionMatch[1], body) as T
  }
  const leadDetailMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/)
  if (leadDetailMatch && method === 'PATCH') {
    return updateDemoLead(leadDetailMatch[1], body) as T
  }
  if (method !== 'GET') {
    throw new Error(`This action is not available in browser-only demo mode: ${method} ${url.pathname}`)
  }
  if (isSheetImportMode() && url.pathname !== '/api/leads') {
    if (url.pathname === '/api/me') return DEMO_SESSION as T
    if (url.pathname === '/api/reports/overview') return getSheetImportOverview() as T
    if (url.pathname === '/api/search') {
      const term = String(query?.q ?? '').trim().toLowerCase()
      const results = term.length < 2
        ? []
        : getDemoLeads()
            .filter((lead) => Object.values(lead).some((value) =>
              typeof value === 'string' && value.toLowerCase().includes(term)
            ))
            .map((lead) => ({
              type: 'lead',
              id: String(lead.id),
              title: String(lead.fullName),
              url: '/leads',
            }))
            .slice(0, 10)
      return { results } as T
    }
    if (url.pathname === '/api/auth/mfa') return { enabled: false, secret: '', otpauthUri: '' } as T
    if (url.pathname === '/api/auth/sessions') return { sessions: [] } as T
    if (url.pathname === '/api/notifications') {
      return {
        items: [],
        total: 0,
        page: Number(query?.page ?? 1),
        pageSize: Number(query?.pageSize ?? 20),
        totalPages: 0,
        unreadCount: 0,
      } as T
    }
    if (/^\/api\/(accounts|opportunities|onboarding)\/[^/]+$/.test(url.pathname)) {
      throw new Error(`No imported CRM record exists for ${url.pathname}`)
    }
    if (Object.prototype.hasOwnProperty.call(records, url.pathname)) {
      const savedRows = url.pathname === '/api/activities'
        ? getStoredRows(DEMO_ACTIVITIES_STORAGE_KEY)
        : url.pathname === '/api/billing'
          ? getStoredRows(DEMO_SUBSCRIPTIONS_STORAGE_KEY)
          : []
      return listDemoRows<T>(savedRows, query, false)
    }
  }
  if (url.pathname === '/api/leads') {
    const rows = getDemoLeads()
    return listDemoRows<T>(rows, query, true)
  }
  if (url.pathname === '/api/me') return DEMO_SESSION as T
  if (url.pathname === '/api/reports/overview') return demoOverview as T
  if (url.pathname === '/api/search') {
    const term = String(query?.q ?? '').trim().toLowerCase()
    const results = term.length < 2
      ? []
      : Object.entries(records).flatMap(([resourcePath, rows]) =>
          rows
            .filter(row => Object.values(row).some(value =>
              typeof value === 'string' && value.toLowerCase().includes(term)
            ))
            .map(row => ({
              type: resourcePath.split('/').pop()?.replace(/s$/, '') ?? 'record',
              id: String(row.id),
              title: String(row.fullName ?? row.accountName ?? row.name ?? row.title ?? row.subject ?? 'Demo record'),
              url: resourcePath.replace('/api/', '/'),
            }))
        ).slice(0, 10)
    return { results } as T
  }
  if (url.pathname === '/api/auth/mfa') return { enabled: false, secret: '', otpauthUri: '' } as T
  if (url.pathname === '/api/auth/sessions') return { sessions: [] } as T

  const accountDetailMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/)
  if (accountDetailMatch) {
    const account = records['/api/accounts'].find((row) => row.id === accountDetailMatch[1])
    if (!account) throw new Error('Demo account not found')
    return {
      account,
      activities: getDemoActivities().filter((activity) => activity.relatedAccountId === account.id),
    } as T
  }

  const opportunityDetailMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)$/)
  if (opportunityDetailMatch) {
    const opportunity = records['/api/opportunities'].find((row) => row.id === opportunityDetailMatch[1])
    if (!opportunity) throw new Error('Demo opportunity not found')
    return {
      opportunity,
      activities: getDemoActivities().filter((activity) => activity.relatedOpportunityId === opportunity.id),
    } as T
  }

  const onboardingDetailMatch = url.pathname.match(/^\/api\/onboarding\/([^/]+)$/)
  if (onboardingDetailMatch) {
    const project = records['/api/onboarding'].find((row) => row.id === onboardingDetailMatch[1])
    if (!project) throw new Error('Demo onboarding project not found')
    return { project: { ...project, tasks: [] } } as T
  }

  if (leadDetailMatch) {
    const lead = getDemoLeads().find((row) => row.id === leadDetailMatch[1])
    if (!lead) throw new Error('Demo lead not found')
    return {
      lead: { ...lead, convertedAccount: lead.convertedAccount ?? null },
      activities: getDemoActivities().filter((activity) => activity.relatedLeadId === lead.id),
    } as T
  }

  const rows = url.pathname === '/api/activities'
    ? getDemoActivities()
    : url.pathname === '/api/billing'
      ? getDemoSubscriptions()
      : records[url.pathname]
  if (!rows) {
    throw new Error(`This screen is not available in demo mode: ${url.pathname}`)
  }
  const rowsWithAccountContacts = ['/api/billing', '/api/onboarding'].includes(url.pathname)
    ? rows.map((row) => {
        const accountId = (row.account as { id?: string } | undefined)?.id
        const account = records['/api/accounts'].find((item) => item.id === accountId)
        return account
          ? { ...row, account: { ...(row.account as Record<string, unknown>), contacts: account.contacts ?? [] } }
          : row
      })
    : rows
  if (url.pathname === '/api/notifications') {
    const filtered = rows.filter(row =>
      (query?.unread !== 'true' || !row.readAt) && matchesFilters(row, query)
    )
    return {
      items: filtered,
      total: filtered.length,
      page: Number(query?.page ?? 1),
      pageSize: Number(query?.pageSize ?? 20),
      totalPages: 1,
      unreadCount: rows.filter(row => !row.readAt).length,
    } as T
  }

  const search = String(query?.search ?? query?.q ?? '').trim().toLowerCase()
  const filtered = rowsWithAccountContacts.filter(row =>
    matchesFilters(row, query) &&
    (!search || Object.values(row).some(value =>
      typeof value === 'string' && value.toLowerCase().includes(search)
    ))
  )
  const pageSize = Math.max(1, Math.min(100, Number(query?.pageSize ?? 20) || 20))
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)
  const stageCounts = url.pathname === '/api/leads'
    ? Array.from(filtered.reduce((counts, row) => {
        const stage = String(row.lifecycleStage ?? '')
        counts.set(stage, (counts.get(stage) ?? 0) + 1)
        return counts
      }, new Map<string, number>()), ([stage, count]) => ({ stage, count }))
    : undefined
  return {
    items,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.ceil(filtered.length / pageSize),
    ...(stageCounts ? { stageCounts } : {}),
  } as T
}
