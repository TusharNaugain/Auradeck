import {
  Activity,
  Bell,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Contact,
  Gauge,
  HeartHandshake,
  Headset,
  LayoutGrid,
  Settings,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  permission?: string
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

/**
 * Sidebar map for all 18 product areas. `permission` is matched against the
 * viewer's effective permission list, so each role only ever sees its own work.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Gauge, permission: 'dashboard.view' },
      { href: '/tasks', label: 'My tasks', icon: ClipboardList, permission: 'dashboard.view' },
      { href: '/notifications', label: 'Notifications', icon: Bell, permission: 'dashboard.view' },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    items: [
      { href: '/leads', label: 'Leads', icon: UserPlus, permission: 'leads.view' },
      { href: '/accounts', label: 'Accounts', icon: Briefcase, permission: 'accounts.view' },
      { href: '/contacts', label: 'Contacts', icon: Contact, permission: 'contacts.view' },
      { href: '/opportunities', label: 'Opportunities', icon: LayoutGrid, permission: 'opportunities.view' },
    ],
  },
  {
    id: 'practice',
    label: 'Practice',
    items: [
      { href: '/clients', label: 'Clients', icon: Users, permission: 'clients.view' },
      { href: '/appointments', label: 'Appointments', icon: CalendarClock, permission: 'appointments.view' },
      { href: '/activities', label: 'Activities', icon: Activity, permission: 'activities.view' },
    ],
  },
  {
    id: 'delivery',
    label: 'Customer success',
    items: [
      { href: '/onboarding', label: 'Onboarding', icon: UserPlus, permission: 'onboarding.view' },
      { href: '/success', label: 'Health & retention', icon: HeartHandshake, permission: 'success.view' },
      { href: '/tickets', label: 'Support tickets', icon: Headset, permission: 'tickets.view' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(group => group.items)

export function filterNav(permissions: string[]): NavGroup[] {
  // No permission list means the viewer has no active membership — show nothing
  // rather than defaulting to the full app.
  if (permissions.length === 0) return []
  return NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => !item.permission || permissions.includes(item.permission)),
  })).filter(group => group.items.length > 0)
}
