import "server-only";

import { hasSupabaseEnvironment } from "@/lib/env";
import type { MembershipContext, MembershipRole } from "@/lib/domain/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class AccessDeniedError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

interface MembershipRow {
  user_id: string;
  organization_id: string;
  role: string;
  employee_id: string | null;
  location_id: string | null;
  status: string;
  organizations: { name: string } | { name: string }[] | null;
}

function organizationNameFromRelation(
  relation: MembershipRow["organizations"],
): string {
  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Organization";
  }

  return relation?.name ?? "Organization";
}

export async function requireMembership(options: {
  allowedRoles: readonly MembershipRole[];
  organizationId?: string;
  locationId?: string;
}): Promise<MembershipContext> {
  if (!hasSupabaseEnvironment()) {
    throw new AccessDeniedError("Live Supabase environment is not configured.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") {
    throw new AccessDeniedError("Authentication is required.");
  }

  let query = supabase
    .from("organization_memberships")
    .select(
      "user_id, organization_id, role, employee_id, location_id, status, organizations(name)",
    )
    .eq("user_id", userId)
    .eq("status", "active");

  if (options.organizationId) {
    query = query.eq("organization_id", options.organizationId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AccessDeniedError("Membership could not be verified.");
  }

  const memberships = (data ?? []) as MembershipRow[];
  const membership = memberships.find((candidate) => {
    if (!options.allowedRoles.includes(candidate.role as MembershipRole)) {
      return false;
    }

    if (!options.locationId) {
      return true;
    }

    return (
      candidate.role === "owner" ||
      candidate.location_id === options.locationId
    );
  });

  if (!membership) {
    throw new AccessDeniedError();
  }

  return {
    userId,
    organizationId: membership.organization_id,
    organizationName: organizationNameFromRelation(membership.organizations),
    role: membership.role as MembershipRole,
    locationId: membership.location_id,
    employeeId: membership.employee_id,
    status: "active",
  };
}

export async function requireOwner(organizationId?: string) {
  return requireMembership({
    allowedRoles: ["owner"],
    organizationId,
  });
}

export async function requireStoreManager(
  organizationId: string,
  locationId: string,
) {
  return requireMembership({
    allowedRoles: ["owner", "manager"],
    organizationId,
    locationId,
  });
}
