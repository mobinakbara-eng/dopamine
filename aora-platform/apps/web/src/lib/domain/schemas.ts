import { z } from "zod";

const idSchema = z.string().trim().min(2).max(120);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const localeSchema = z.enum(["de", "en", "fa", "tr"]);

export const createStoreSchema = z.object({
  organizationId: idSchema,
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens."),
  city: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(16),
  addressLine: z.string().trim().min(3).max(180),
  countryCode: z.string().trim().toUpperCase().length(2),
  timezone: z.string().trim().min(3).max(80),
  locale: localeSchema,
});

export const inviteManagerSchema = z.object({
  organizationId: idSchema,
  locationId: idSchema,
  email: emailSchema,
  displayName: z.string().trim().min(2).max(100),
  locale: localeSchema,
});

export const inviteEmployeeSchema = z.object({
  organizationId: idSchema,
  locationId: idSchema,
  email: emailSchema,
  displayName: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(80),
  locale: localeSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(32).max(256),
  locale: localeSchema,
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type InviteManagerInput = z.infer<typeof inviteManagerSchema>;
export type InviteEmployeeInput = z.infer<typeof inviteEmployeeSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
