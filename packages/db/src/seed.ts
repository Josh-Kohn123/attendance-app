import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create default org
  const org = await prisma.org.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Orbs Ltd",
      monthStartDay: 1,
      timezone: "Asia/Jerusalem",
      autoLogoutEnabled: false,
      reminderEnabled: true,
      reminderTime: "09:00",
    },
  });

  // Create default site
  const site = await prisma.site.upsert({
    where: { id: "00000000-0000-0000-0000-000000000010" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000010",
      orgId: org.id,
      name: "HQ",
      address: "Tel Aviv, Israel",
    },
  });

  // Create default department
  const dept = await prisma.department.upsert({
    where: { id: "00000000-0000-0000-0000-000000000020" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000020",
      orgId: org.id,
      siteId: site.id,
      name: "Engineering",
    },
  });

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: "josh@orbs.com" } },
    update: {},
    create: {
      orgId: org.id,
      email: "josh@orbs.com",
      displayName: "Josh (Admin)",
      isActive: true,
    },
  });

  // Assign admin role
  await prisma.userRole.upsert({
    where: { userId_role: { userId: adminUser.id, role: "admin" } },
    update: {},
    create: {
      userId: adminUser.id,
      role: "admin",
    },
  });

  // Create admin employee record
  await prisma.employee.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      orgId: org.id,
      userId: adminUser.id,
      email: adminUser.email,
      firstName: "Josh",
      lastName: "Admin",
      siteId: site.id,
      departmentId: dept.id,
      startDate: new Date("2024-01-01"),
    },
  });

  // Create a sample manager
  const managerUser = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: "manager@orbs.com" } },
    update: {},
    create: {
      orgId: org.id,
      email: "manager@orbs.com",
      displayName: "Team Manager",
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: managerUser.id, role: "manager" } },
    update: {},
    create: { userId: managerUser.id, role: "manager" },
  });

  // Assign manager scope to department
  await prisma.userScope.upsert({
    where: {
      userId_scopeType_scopeId: {
        userId: managerUser.id,
        scopeType: "department",
        scopeId: dept.id,
      },
    },
    update: {},
    create: {
      userId: managerUser.id,
      scopeType: "department",
      scopeId: dept.id,
    },
  });

  await prisma.employee.upsert({
    where: { userId: managerUser.id },
    update: {},
    create: {
      orgId: org.id,
      userId: managerUser.id,
      email: managerUser.email,
      firstName: "Team",
      lastName: "Manager",
      siteId: site.id,
      departmentId: dept.id,
      startDate: new Date("2024-01-01"),
    },
  });

  // Create sample employee
  const empUser = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: "employee@orbs.com" } },
    update: {},
    create: {
      orgId: org.id,
      email: "employee@orbs.com",
      displayName: "Sample Employee",
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: empUser.id, role: "employee" } },
    update: {},
    create: { userId: empUser.id, role: "employee" },
  });

  await prisma.employee.upsert({
    where: { userId: empUser.id },
    update: {},
    create: {
      orgId: org.id,
      userId: empUser.id,
      email: empUser.email,
      firstName: "Sample",
      lastName: "Employee",
      siteId: site.id,
      departmentId: dept.id,
      startDate: new Date("2024-06-01"),
    },
  });

  console.log("✅ Seed complete!");
  console.log({ org: org.name, site: site.name, dept: dept.name });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
