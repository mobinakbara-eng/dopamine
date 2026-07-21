export const membershipRoles = ["owner", "manager", "employee"] as const;

export type MembershipRole = (typeof membershipRoles)[number];
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type StoreStatus = "active" | "archived";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface MembershipContext {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
  locationId: string | null;
  employeeId: string | null;
  status: MembershipStatus;
}

export interface StoreSummary {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  city: string;
  countryCode: string;
  timezone: string;
  status: StoreStatus;
  managerCount: number;
  employeeCount: number;
}

export interface ManagerSummary {
  membershipId: string;
  displayName: string;
  email: string;
  locationId: string;
  locationName: string;
  status: MembershipStatus;
}

export interface EmployeeSummary {
  id: string;
  name: string;
  email: string;
  title: string;
  locationId: string;
  status: MembershipStatus;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: MembershipRole;
  locationId: string | null;
  locationName: string | null;
  status: InvitationStatus;
  expiresAt: string;
}

export interface OwnerDashboardData {
  mode: "live" | "preview";
  organizationId: string;
  organizationName: string;
  stores: StoreSummary[];
  managers: ManagerSummary[];
  invitations: InvitationSummary[];
}

export interface ManagerDashboardData {
  mode: "live" | "preview";
  organizationId: string;
  organizationName: string;
  selectedStore: StoreSummary;
  availableStores: StoreSummary[];
  employees: EmployeeSummary[];
  invitations: InvitationSummary[];
}

export interface EmployeeDashboardData {
  mode: "live" | "preview";
  employeeName: string;
  storeName: string;
  nextShift: string;
  clockState: "off" | "working" | "paused";
  openTaskCount: number;
  unreadNoticeCount: number;
}
