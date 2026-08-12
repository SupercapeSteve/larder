/**
 * Household roles and what each one can do.
 *
 * This mirrors the RLS policies in
 * supabase/migrations/20260814000000_granular_roles.sql. The database is the
 * authority — this table decides what to *show*, never what to *allow*. If the
 * two ever disagree, the database wins and the user gets an error toast rather
 * than a silent success.
 */

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const DEFAULT_ROLE: Role = 'member'

export function toRole(value: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(value ?? '') ? (value as Role) : DEFAULT_ROLE
}

/** Higher number = more authority. Used for "can I act on this person?". */
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export const ROLE_SUMMARY: Record<Role, string> = {
  owner: 'Full control, including roles and deleting the household',
  admin: 'Manages the list, the name, the code and members',
  member: 'Adds and checks off items',
  viewer: 'Can look, but not change anything',
}

export const CAPABILITIES = [
  { key: 'viewList', label: 'See the list', min: 'viewer' },
  { key: 'addItems', label: 'Add items', min: 'member' },
  { key: 'checkItems', label: 'Check items off', min: 'member' },
  { key: 'editItems', label: 'Edit and delete items', min: 'member' },
  { key: 'clearChecked', label: 'Clear checked items', min: 'member' },
  { key: 'seeCode', label: 'See the invite code', min: 'member' },
  { key: 'useSiri', label: 'Use Siri shortcuts', min: 'member' },
  { key: 'rotateCode', label: 'Change the invite code', min: 'admin' },
  { key: 'renameHousehold', label: 'Rename the household', min: 'admin' },
  { key: 'removeMembers', label: 'Remove members', min: 'admin' },
  { key: 'removeAdmins', label: 'Remove an admin', min: 'owner' },
  { key: 'changeRoles', label: "Change people's roles", min: 'owner' },
] as const satisfies ReadonlyArray<{ key: string; label: string; min: Role }>
// Deliberately absent: "delete the household". `authenticated` holds no DELETE
// grant on households, and there is no UI for it — a household is removed when
// its last member leaves, via the handle_member_removed trigger. Listing a
// capability nobody has would make the whole table untrustworthy.

export type Capability = (typeof CAPABILITIES)[number]['key']

const MIN_ROLE = Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.min])) as Record<
  Capability,
  Role
>

/** Does this role clear the bar for that capability? */
export function can(role: Role, capability: Capability): boolean {
  return RANK[role] >= RANK[MIN_ROLE[capability]]
}

/**
 * Whether `actor` may change or remove `target`.
 *
 * Owners may act on anyone. Admins may act on members and viewers only —
 * otherwise an admin could remove every other admin and the owner, which would
 * make "admin" and "owner" the same thing one step apart.
 */
export function canActOn(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') return RANK[target] < RANK.admin
  return false
}
