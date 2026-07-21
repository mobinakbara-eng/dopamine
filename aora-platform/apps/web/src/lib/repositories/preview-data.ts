import type {
  EmployeeDashboardData,
  ManagerDashboardData,
  OwnerDashboardData,
  StoreSummary,
} from "@/lib/domain/types";

const stores: StoreSummary[] = [
  {
    id: "loc_berlin_mitte",
    organizationId: "org_aora_demo",
    name: "Aora Café Mitte",
    slug: "berlin-mitte",
    city: "Berlin",
    countryCode: "DE",
    timezone: "Europe/Berlin",
    status: "active",
    managerCount: 1,
    employeeCount: 12,
  },
  {
    id: "loc_wilmersdorf",
    organizationId: "org_aora_demo",
    name: "Aora Café Wilmersdorf",
    slug: "wilmersdorf",
    city: "Berlin",
    countryCode: "DE",
    timezone: "Europe/Berlin",
    status: "active",
    managerCount: 1,
    employeeCount: 8,
  },
];

export const previewOwnerDashboard: OwnerDashboardData = {
  mode: "preview",
  organizationId: "org_aora_demo",
  organizationName: "Aora Demo Group",
  stores,
  managers: [
    {
      membershipId: "membership_manager_mitte",
      displayName: "Nora Klein",
      email: "nora.manager@example.com",
      locationId: "loc_berlin_mitte",
      locationName: "Aora Café Mitte",
      status: "active",
    },
    {
      membershipId: "membership_manager_wilmersdorf",
      displayName: "David Yilmaz",
      email: "david.manager@example.com",
      locationId: "loc_wilmersdorf",
      locationName: "Aora Café Wilmersdorf",
      status: "invited",
    },
  ],
  invitations: [
    {
      id: "invite_manager_wilmersdorf",
      email: "david.manager@example.com",
      role: "manager",
      locationId: "loc_wilmersdorf",
      locationName: "Aora Café Wilmersdorf",
      status: "pending",
      expiresAt: "2026-07-28T12:00:00.000Z",
    },
  ],
};

export const previewManagerDashboard: ManagerDashboardData = {
  mode: "preview",
  organizationId: "org_aora_demo",
  organizationName: "Aora Demo Group",
  selectedStore: stores[0]!,
  availableStores: [stores[0]!],
  employees: [
    {
      id: "emp_anna",
      name: "Anna Berger",
      email: "anna.berger@example.com",
      title: "Schichtleitung",
      locationId: "loc_berlin_mitte",
      status: "active",
    },
    {
      id: "emp_kerem",
      name: "Kerem Aydin",
      email: "kerem.aydin@example.com",
      title: "Barista",
      locationId: "loc_berlin_mitte",
      status: "active",
    },
    {
      id: "emp_lina",
      name: "Lina Hoffmann",
      email: "lina.hoffmann@example.com",
      title: "Service",
      locationId: "loc_berlin_mitte",
      status: "invited",
    },
  ],
  invitations: [
    {
      id: "invite_lina",
      email: "lina.hoffmann@example.com",
      role: "employee",
      locationId: "loc_berlin_mitte",
      locationName: "Aora Café Mitte",
      status: "pending",
      expiresAt: "2026-07-28T12:00:00.000Z",
    },
  ],
};

export const previewEmployeeDashboard: EmployeeDashboardData = {
  mode: "preview",
  employeeName: "Anna Berger",
  storeName: "Aora Café Mitte",
  nextShift: "Heute · 10:00–18:00",
  clockState: "off",
  openTaskCount: 3,
  unreadNoticeCount: 2,
};
