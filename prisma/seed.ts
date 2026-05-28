import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { name: 'stock:view',      module: 'stock',    description: 'View stock items' },
  { name: 'stock:create',    module: 'stock',    description: 'Add new stock items' },
  { name: 'stock:edit',      module: 'stock',    description: 'Edit stock items' },
  { name: 'stock:delete',    module: 'stock',    description: 'Scrap / remove stock items' },
  { name: 'trade:view',      module: 'trade',    description: 'View trade parties and trades' },
  { name: 'trade:create',    module: 'trade',    description: 'Create new trades' },
  { name: 'trade:edit',      module: 'trade',    description: 'Edit trade status' },
  { name: 'customer:view',   module: 'customer', description: 'View customers' },
  { name: 'customer:create', module: 'customer', description: 'Add new customers' },
  { name: 'customer:edit',   module: 'customer', description: 'Edit customer details' },
  { name: 'sales:view',      module: 'sales',    description: 'View transactions and bills' },
  { name: 'sales:create',    module: 'sales',    description: 'Create sales, returns, exchanges' },
  { name: 'rates:view',      module: 'rates',    description: 'View daily rates' },
  { name: 'rates:edit',      module: 'rates',    description: 'Set daily gold/silver rates' },
  { name: 'report:view',     module: 'report',   description: 'View reports and summaries' },
  { name: 'report:export',   module: 'report',   description: 'Export reports as PDF' },
  { name: 'user:manage',     module: 'admin',    description: 'Create and manage users and roles' },
  { name: 'purchase:view',   module: 'purchase', description: 'View suppliers and purchase orders' },
  { name: 'purchase:create', module: 'purchase', description: 'Create purchase orders' },
  { name: 'purchase:edit',   module: 'purchase', description: 'Edit and receive purchase orders' },
  { name: 'karigar:view',    module: 'karigar',  description: 'View karigars and production orders' },
  { name: 'karigar:create',  module: 'karigar',  description: 'Create production orders and issues' },
  { name: 'karigar:edit',    module: 'karigar',  description: 'Record returns, payments, resolve disputes' },
];

const ROLES = {
  OWNER: {
    description: 'Full access to everything including user management',
    permissions:  PERMISSIONS.map((p) => p.name),
  },
  MANAGER: {
    description: 'Can manage stock, trades, customers, sales and view reports',
    permissions: [
      'stock:view', 'stock:create', 'stock:edit',
      'trade:view', 'trade:create', 'trade:edit',
      'customer:view', 'customer:create', 'customer:edit',
      'sales:view', 'sales:create',
      'rates:view', 'rates:edit',
      'report:view', 'report:export',
      'purchase:view', 'purchase:create', 'purchase:edit',
      'karigar:view', 'karigar:create', 'karigar:edit',
    ],
  },
  STAFF: {
    description: 'Can view stock, create sales, and manage customers',
    permissions: [
      'stock:view',
      'trade:view',
      'customer:view', 'customer:create',
      'sales:view', 'sales:create',
      'rates:view',
      'report:view',
    ],
  },
};

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Permissions
  console.log('  Creating permissions...');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where:  { name: perm.name },
      update: { description: perm.description, module: perm.module },
      create: perm,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions`);

  // 2. Roles
  console.log('  Creating roles...');
  for (const [roleName, roleData] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where:  { name: roleName },
      update: { description: roleData.description },
      create: { name: roleName, description: roleData.description },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    const permissions = await prisma.permission.findMany({
      where: { name: { in: roleData.permissions } },
    });

    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });

    console.log(`  ✓ Role ${roleName} — ${permissions.length} permissions`);
  }

  // 3. Default owner (only if no users exist)
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log('  Creating default owner account...');
    const ownerRole = await prisma.role.findUnique({ where: { name: 'OWNER' } });
    if (!ownerRole) throw new Error('OWNER role not found');

    const passwordHash = await bcrypt.hash('owner123', 12);
    await prisma.user.create({
      data: {
        name:          'Shop Owner',
        email:         'owner@jewelryflow.com',
        passwordHash,
        emailVerified: true,
        userRoles: { create: [{ roleId: ownerRole.id }] },
      },
    });
    console.log('  ✓ Default owner: owner@jewelryflow.com / owner123');
  } else {
    console.log('  ℹ️  Users exist — skipping default owner');
  }

  // 4. Metal types — with metalGroup field
  const metalTypes = [
  { name: 'Gold 24K', purityFactor: 1.0000 },
  { name: 'Gold 22K', purityFactor: 0.9167 },
  { name: 'Gold 18K', purityFactor: 0.7500 },
  { name: 'Gold 14K', purityFactor: 0.5833 },
  { name: 'Silver',   purityFactor: 0.9250 },
];

  console.log('  Creating metal types...');
  for (const metal of metalTypes) {
    await prisma.metalType.upsert({
      where:  { name: metal.name },
      update: {},
      create: metal as any,
    });
  }
  console.log(`  ✓ ${metalTypes.length} metal types`);

  // 5. Item categories — with metalGroup
  const categories = [
  'Ring', 'Bangle', 'Necklace', 'Earring',
  'Bracelet', 'Pendant', 'Mala', 'Chain',
  'Haar', 'Silver Ring', 'Silver Bangle',
  'Silver Necklace', 'Silver Payal', 'Uncategorised',
];

  console.log('  Creating item categories...');
  for (const name of categories) {
    await prisma.itemCategory.upsert({
      where:  { name},
      update: {},
      create: { name},
    });
  }
  console.log(`  ✓ ${categories.length} categories`);

  // 6. Addon types
  const addonTypes = [
    { name: 'Diamond',  description: 'Diamond stones' },
    { name: 'Ruby',     description: 'Ruby stones'    },
    { name: 'Emerald',  description: 'Emerald stones' },
    { name: 'Pearl',    description: 'Natural or cultured pearls' },
    { name: 'Sapphire', description: 'Sapphire stones' },
    { name: 'Moti',     description: 'Moti / Pearl mala' },
    { name: 'Coral',    description: 'Coral stones' },
    { name: 'Other',    description: 'Other stones or addons' },
  ];

  console.log('  Creating addon types...');
  for (const addon of addonTypes) {
    await prisma.addonType.upsert({
      where:  { name: addon.name },
      update: {},
      create: addon,
    });
  }
  console.log(`  ✓ ${addonTypes.length} addon types`);

// 7. Today's sample rates
console.log('  Creating sample daily rates...');

// Get the owner user to satisfy updatedByUserId
const ownerUser = await prisma.user.findFirst()
if (!ownerUser) throw new Error('No user found — run seed after creating a user')

const gold22k = await prisma.metalType.findUnique({ where: { name: 'Gold 22K' } })
const gold24k = await prisma.metalType.findUnique({ where: { name: 'Gold 24K' } })
const silver  = await prisma.metalType.findUnique({ where: { name: 'Silver'   } })

const sampleRates = [
  {
    metal:          gold24k,
    sellRatePerTola: 152400, sellRatePerGram: 13060.43, sellRatePerLal: 1524.00,
    buyRatePerTola:  148000, buyRatePerGram:  12683.00, buyRatePerLal:  1480.00,
  },
  {
    metal:          gold22k,
    sellRatePerTola: 142500, sellRatePerGram: 12215.85, sellRatePerLal: 1425.00,
    buyRatePerTola:  138000, buyRatePerGram:  11830.00, buyRatePerLal:  1380.00,
  },
  {
    metal:          silver,
    sellRatePerTola: 1680,   sellRatePerGram: 144.10,   sellRatePerLal: 16.80,
    buyRatePerTola:  1600,   buyRatePerGram:  137.20,   buyRatePerLal:  16.00,
  },
]

for (const r of sampleRates) {
  if (!r.metal) continue

  // delete existing rates for this metal first
  await prisma.dailyRate.deleteMany({
    where: { metalTypeId: r.metal.id }
  })

  await prisma.dailyRate.create({
    data: {
      metalTypeId:     r.metal.id,
      sellRatePerGram: r.sellRatePerGram,
      sellRatePerTola: r.sellRatePerTola,
      sellRatePerLal:  r.sellRatePerLal,
      buyRatePerGram:  r.buyRatePerGram,
      buyRatePerTola:  r.buyRatePerTola,
      buyRatePerLal:   r.buyRatePerLal,
      isCurrent:       true,
      updatedByUserId: ownerUser.id,
    },
  })
}
console.log('  ✓ Sample rates seeded (sell + buy rates)')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());