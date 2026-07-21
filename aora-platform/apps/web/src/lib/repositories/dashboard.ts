import "server-only";

import { requireMembership, requireOwner } from "@/lib/auth/permissions";
import type {
  EmployeeDashboardData,
  EmployeeSummary,
  InvitationSummary,
  ManagerDashboardData,
  ManagerSummary,
  MembershipStatus,
  OwnerDashboardData,
  StoreStatus,
  StoreSummary,
} from "@/lib/domain/types";
import { hasSupabaseEnvironment } from "@/lib/env";
import {
  previewEmployeeDashboard,
  previewManagerDashboard,
  previewOwnerDashboard,
} from "@/lib/repositories/preview-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function membershipStatus(value: unknown): MembershipStatus {
  return ["invited", "active", "suspended", "revoked"].includes(
    stringValue(value),
  )
    ? (value as MembershipStatus)
    : "invited";
}

function storeStatus(value: unknown): StoreStatus {
  return stringValue(value) === "archived" ? "archived" : "active";
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function relationName(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "object" && first !== null
      ? stringValue((first as Record<string, unknown>).name)
      : "";
  }

  return typeof value === "object" && value !== null
    ? stringValue((value as Record<string, unknown>).name)
    : "";
}

function mapStore(row: Record<string, unknown>): StoreSummary {
  const payload =
    typeof row.payload === "object" && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {};

  return {
    id: stringValue(row.id),
    organizationId: stringValue(row.organization_id),
    name: stringValue(row.name, "Unnamed store"),
    slug: stringValue(row.slug, stringValue(payload.slug, stringValue(row.id))),
    city: stringValue(row.city),
    countryCode: stringValue(row.country_code, stringValue(payload.countryCode, "DE")),
    timezone: stringValue(
      row.timezone,
      stringValue(payload.timezone, "Europe/Berlin"),
    ),
    status: storeStatus(row.status ?? (row.active === false ? "archived" : "active")),
    managerCount: numberValue(row.manager_count),
    employeeCount: numberValue(row.employee_count),
  };
}

function mapInvitation(row: Record<string, unknown>): InvitationSummary {
  return {
    id: stringValue(row.id),
    email: stringValue(row.email),
    role: stringValue(row.role) === "manager" ? "manager" : "employee",
    locationId: stringValue(row.location_id) || null,
    locationName: relationName(row.locations) || null,
    status: ["pending", "accepted", "revoked", "expired"].includes(
      stringValue(row.status),
    )
      ? (row.status as InvitationSummary["status"])
      : "pending",
    expiresAt: stringValue(row.expires_at),
  };
}

export async function loadOwnerDashboard(): Promise<OwnerDashboardData> {
  if (!hasSupabaseEnvironment()) {
    return previewOwnerDashboard;
  }

  const membership = await requireOwner();
  const supabase = await createSupabaseServerClient();

  const [storeResult, managerResult, invitationResult] = await Promise.all([
    supabase
      .from("locations")
      .select(
        "id, organization_id, name, slug, city, country_code, timezone, status, active, payload, manager_count, employee_count",
      )
      .eq("organization_id", membership.organizationId)
      .order("name"),
    supabase
      .from("organization_memberships")
      .select(
        "id, organization_id, location_id, role, status, member_email, profiles(display_name), locations(name)",
      )
      .eq("organization_id", membership.organizationId)
      .eq("role", "manager")
      .order("created_at", { ascending: false }),
    supabase
      .from("member_invitations")
      .select("id, email, role, location_id, status, expires_at, locations(name)")
      .eq("organization_id", membership.organizationId)
      .eq("role", "manager")
      .order("created_at", { ascending: false }),
  ]);

  if (storeResult.error || managerResult.error || invitationResult.error) {
    throw new Error("Owner workspace could not be loaded.");
  }

  const managers: ManagerSummary[] = rows(managerResult.data).map((row) => ({
    membershipId: stringValue(row.id),
    displayName: relationName(row.profiles) || stringValue(row.member_email),
    email: stringValue(row.member_email),
    locationId: stringValue(row.location_id),
    locationName: relationName(row.locations),
    status: membershipStatus(row.status),
  }));

  return {
    mode: "live",
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    stores: rows(storeResult.data).map(mapStore),
    managers,
    invitations: rows(invitationResult.data).map(mapInvitation),
  };
}

export async function loadManagerDashboard(
  requestedLocationId?: string,
): Promise<ManagerDashboardData> {
  if (!hasSupabaseEnvironment()) {
    return previewManagerDashboard;
  }

  const membership = await requireMembership({
    allowedRoles: ["owner", "manager"],
  });
  const locationId = requestedLocationId ?? membership.locationId;

  if (!locationId) {
    throw new Error("No store is assigned to this manager account.");
  }

  await requireMembership({
    allowedRoles: ["owner", "manager"],
    organizationId: membership.organizationId,
    locationId,
  });

  const supabase = await createSupabaseServerClient();
  const [storeResult, employeeResult, invitationResult] = await Promise.all([
    supabase
      .from("locations")
      .select(
        "id, organization_id, name, slug, city, country_code, timezone, status, active, payload, manager_count, employee_count",
      )
      .eq("organization_id", membership.organizationId)
      .in(
        "id",
        membership.role === "owner" || !membership.locationId
          ? [locationId]
          : [membership.locationId],
      ),
    supabase
      .from("employees")
      .select("id, name, email, role, location_id, active, payload")
      .eq("organization_id", membership.organizationId)
      .eq("location_id", locationId)
      .order("name"),
    supabase
      .from("member_invitations")
      .select("id, email, role, location_id, status, expires_at, locations(name)")
      .eq("organization_id", membership.organizationId)
      .eq("location_id", locationId)
      .eq("role", "employee")
      .order("created_at", { ascending: false }),
  ]);

  if (storeResult.error || employeeResult.error || invitationResult.error) {
    throw new Error("Manager workspace could not be loaded.");
  }

  const availableStores = rows(storeResult.data).map(mapStore);
  const selectedStore = availableStores.find((store) => store.id === locationId);

  if (!selectedStore) {
    throw new Error("The requested store is outside your access scope.");
  }

  const employees: EmployeeSummary[] = rows(employeeResult.data).map((row) => {
    const payload =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {};

    return {
      id: stringValue(row.id),
      name: stringValue(row.name),
      email: stringValue(row.email),
      title: stringValue(row.role, stringValue(payload.title, "Employee")),
      locationId: stringValue(row.location_id),
      status: row.active === false ? "suspended" : "active",
    };
  });

  return {
    mode: "live",
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    selectedStore,
    availableStores,
    employees,
    invitations: rows(invitationResult.data).map(mapInvitation),
  };
}

export async function loadEmployeeDashboard(): Promise<EmployeeDashboardData> {
  if (!hasSupabaseEnvironment()) {
    return previewEmployeeDashboard;
  }

  const membership = await requireMembership({ allowedRoles: ["employee"] });

  if (!membership.employeeId) {
    throw new Error("No employee profile is linked to this account.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employees")
    .select("name, locations(name)")
    .eq("organization_id", membership.organizationId)
    .eq("id", membership.employeeId)
    .single();

  if (error || typeof data !== "object" || data === null) {
    throw new Error("Employee workspace could not be loaded.");
  }

  const row = data as Record<string, unknown>;

  return {
    mode: "live",
    employeeName: stringValue(row.name, "Employee"),
    storeName: relationName(row.locations),
    nextShift: "Loaded from the scheduling module",
    clockState: "off",
    openTaskCount: 0,
    unreadNoticeCount: 0,
  };
}
