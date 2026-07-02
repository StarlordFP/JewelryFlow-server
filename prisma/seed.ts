import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

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

    const passwordHash = await bcrypt.hash('password123', 12);
    await prisma.user.create({
      data: {
        name:          'Shop Owner',
        email:         'owner@jewelryflow.test',
        passwordHash,
        emailVerified: true,
        userRoles: { create: [{ roleId: ownerRole.id }] },
      },
    });
    console.log('  ✓ Default owner: owner@jewelryflow.test / password123');
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

  await prisma.systemSetting.upsert({
    where:  { key: 'buyDiscountPct' },
    update: {},
    create: { key: 'buyDiscountPct', value: '5' },
  });
  console.log('  ✓ System settings (buyDiscountPct)');

  // 5. Item categories — with metalGroup
  const categories = [
  'Ring', 'Bangle', 'Necklace', 'Earring',
  'Bracelet', 'Pendant', 'Mala', 'Chain',
  'Haar', 'Silver Ring', 'Silver Bangle',
  'Silver Necklace', 'Silver Payal', 'Uncategorised',
];

  console.log('  Creating item categories...');
  for (const name of categories) {
    const shortCodes: Record<string, string> = {
      Ring: 'RNG', Bangle: 'BNG', Necklace: 'NCK', Earring: 'EAR',
      Bracelet: 'BRC', Pendant: 'PEN', Mala: 'MAL', Chain: 'CHN',
      Haar: 'HAR', 'Silver Ring': 'SVR', 'Silver Bangle': 'SVB',
      'Silver Necklace': 'SVN', 'Silver Payal': 'SVP', Uncategorised: 'UNC',
    };
    await prisma.itemCategory.upsert({
      where:  { name },
      update: {},
      create: {
        name,
        shortCode: shortCodes[name] ?? name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3),
        isProtected: true,
      },
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

// In seed.ts
await prisma.luxuryTaxRule.upsert({
  where:  { id: 'luxury-tax-rule-default' },
  update: {},
  create: {
    id:            'luxury-tax-rule-default',
    rate:          0.02,          // 2%
    appliesTo:     'GOLD',
    effectiveDate: new Date('2024-01-01'),
    isActive:      false,         // starts inactive — owner enables when needed
  },
});

await prisma.vatRule.upsert({
  where:  { id: 'vat-rule-default' },
  update: {},
  create: {
    id:            'vat-rule-default',
    rate:          0.13,          // 13%
    appliesTo:     'JYALA',
    effectiveDate: new Date('2024-01-01'),
    isActive:      true,
  },
});

console.log('  ✓ Sample rates seeded (sell + buy rates)');

  // Call demo data seed
  await seedDemoData();
}

// ─── IDEMPOTENT DEMO SEED HELPERS ─────────────────────────────────────────────

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

async function upsertSupplier(data: { name: string; phone: string; address: string; supplierType: 'DIRECT' | 'TRADE' }) {
  const existing = await prisma.supplier.findFirst({ where: { name: data.name } });
  if (existing) {
    return prisma.supplier.update({
      where: { id: existing.id },
      data,
    });
  } else {
    return prisma.supplier.create({
      data,
    });
  }
}

async function upsertCustomer(data: { name: string; phone: string; address: string; notes?: string }) {
  const phoneHash = hashPhone(data.phone);
  const phoneHint = `${data.phone.substring(0, 2)}****${data.phone.substring(data.phone.length - 2)}`;
  
  return prisma.customer.upsert({
    where: { phoneHash },
    update: {
      name: data.name,
      phoneHint,
      address: data.address,
      notes: data.notes,
    },
    create: {
      name: data.name,
      phoneHash,
      phoneHint,
      address: data.address,
      notes: data.notes,
    },
  });
}

async function upsertKarigar(data: { name: string; phone: string; address: string }) {
  const existing = await prisma.karigar.findFirst({ where: { name: data.name } });
  if (existing) {
    return prisma.karigar.update({
      where: { id: existing.id },
      data: {
        phone: data.phone,
        address: data.address,
      },
    });
  } else {
    return prisma.karigar.create({
      data,
    });
  }
}

async function upsertStockItem(data: {
  sku: string;
  name: string;
  origin: 'PURCHASED' | 'KARIGAR' | 'TRADE';
  categoryName: string;
  metalTypeName: string | null;
  karat: number | null;
  grossWeightGram: number;
  jertyGram: number;
  makingChargeNpr: number;
  totalJyalaNpr: number;
  entryRateId: string | null;
  status?: 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'RESERVED' | 'SCRAPPED';
}) {
  const category = await prisma.itemCategory.findUnique({ where: { name: data.categoryName } });
  if (!category) throw new Error(`Category ${data.categoryName} not found`);

  let metalTypeId: string | null = null;
  if (data.metalTypeName) {
    const metal = await prisma.metalType.findUnique({ where: { name: data.metalTypeName } });
    if (!metal) throw new Error(`Metal ${data.metalTypeName} not found`);
    metalTypeId = metal.id;
  }

  const grossWeightTola = data.grossWeightGram / 11.664;
  const grossWeightLal = data.grossWeightGram / 0.11664;
  const jertyTola = data.jertyGram / 11.664;
  const jertyLal = data.jertyGram / 0.11664;

  const fields = {
    name: data.name,
    origin: data.origin,
    categoryId: category.id,
    metalTypeId,
    karat: data.karat,
    entryRateId: data.entryRateId,
    grossWeightGram: data.grossWeightGram,
    grossWeightTola,
    grossWeightLal,
    jertyGram: data.jertyGram,
    jertyTola,
    jertyLal,
    makingChargeNpr: data.makingChargeNpr,
    totalJyalaNpr: data.totalJyalaNpr,
    applyLuxuryTax: false,
    applyVat: false,
    status: data.status ?? 'IN_STOCK',
    stoneChargeNpr: 0,
    motiChargeNpr: 0,
    malaChargeNpr: 0,
    otherChargeNpr: 0,
  };

  return prisma.stockItem.upsert({
    where: { sku: data.sku },
    update: fields,
    create: {
      sku: data.sku,
      ...fields,
    },
  });
}

async function upsertTransaction(
  billNumber: string,
  txData: any,
  linesData: any[],
  paymentData: any
) {
  const existing = await prisma.transaction.findUnique({ where: { billNumber } });
  if (existing) {
    await prisma.transaction.delete({ where: { id: existing.id } });
  }

  return prisma.$transaction(async (tx) => {
    const createdTx = await tx.transaction.create({
      data: {
        billNumber,
        ...txData,
      },
    });

    for (const line of linesData) {
      await tx.transactionLine.create({
        data: {
          transactionId: createdTx.id,
          ...line,
        },
      });
    }

    if (paymentData) {
      await tx.paymentRecord.create({
        data: {
          transactionId: createdTx.id,
          ...paymentData,
        },
      });
    }

    return createdTx;
  });
}

async function upsertPurchaseOrder(
  notes: string,
  poData: any,
  linesData: any[]
) {
  const existing = await prisma.purchaseOrder.findFirst({
    where: { notes },
  });

  if (existing) {
    await prisma.purchaseOrder.delete({ where: { id: existing.id } });
  }

  return prisma.purchaseOrder.create({
    data: {
      ...poData,
      notes,
      lines: {
        create: linesData,
      },
    },
  });
}

async function upsertProductionOrder(
  notes: string,
  poData: any,
  issueData: any
) {
  const existing = await prisma.productionOrder.findFirst({
    where: { notes },
  });

  if (existing) {
    await prisma.productionIssue.deleteMany({ where: { productionOrderId: existing.id } });
    await prisma.productionOrder.delete({ where: { id: existing.id } });
  }

  const createdOrder = await prisma.productionOrder.create({
    data: {
      ...poData,
      notes,
    },
  });

  if (issueData) {
    await prisma.productionIssue.create({
      data: {
        productionOrderId: createdOrder.id,
        ...issueData,
      },
    });
  }

  return createdOrder;
}

async function upsertTrade(
  notes: string,
  tradeData: any,
  itemsData: any[]
) {
  const existing = await prisma.trade.findFirst({
    where: { notes },
  });

  if (existing) {
    await prisma.stockItem.updateMany({
      where: { tradeItem: { tradeId: existing.id } },
      data: { tradeItemId: null },
    });
    await prisma.trade.delete({ where: { id: existing.id } });
  }

  const createdTrade = await prisma.trade.create({
    data: {
      ...tradeData,
      notes,
    },
  });

  const createdItems = [];
  for (const item of itemsData) {
    const createdItem = await prisma.tradeItem.create({
      data: {
        tradeId: createdTrade.id,
        ...item,
      },
    });
    createdItems.push(createdItem);
  }

  return { trade: createdTrade, items: createdItems };
}

// ─── MAIN DEMO SEED FUNCTION ──────────────────────────────────────────────────

async function seedDemoData() {
  try {
    console.log('🌱 Seeding client demo data...');

    const today = new Date();
    const dateDaysAgo = (days: number) => {
      const d = new Date();
      d.setDate(today.getDate() - days);
      return d;
    };

    // 1. Roles
    const managerRole = await prisma.role.findUnique({ where: { name: 'MANAGER' } });
    const staffRole = await prisma.role.findUnique({ where: { name: 'STAFF' } });
    if (!managerRole || !staffRole) {
      throw new Error('MANAGER or STAFF role not found');
    }

    // 2. Users (Sita Sharma & Hari Thapa)
    console.log('  Seeding users...');
    const demoPasswordHash = await bcrypt.hash('Demo@1234', 12);
    await prisma.user.upsert({
      where: { email: 'manager@jewelryflow.demo' },
      update: {},
      create: {
        name: 'Sita Sharma',
        email: 'manager@jewelryflow.demo',
        passwordHash: demoPasswordHash,
        emailVerified: true,
        userRoles: { create: [{ roleId: managerRole.id }] },
      },
    });

    await prisma.user.upsert({
      where: { email: 'staff@jewelryflow.demo' },
      update: {},
      create: {
        name: 'Hari Thapa',
        email: 'staff@jewelryflow.demo',
        passwordHash: demoPasswordHash,
        emailVerified: true,
        userRoles: { create: [{ roleId: staffRole.id }] },
      },
    });
    console.log('  ✅ Seeded: Sita Sharma (Manager), Hari Thapa (Staff)');

    // 3. Daily Rates
    console.log('  Seeding daily rates...');
    const ownerUser = await prisma.user.findFirst();
    if (!ownerUser) throw new Error('No owner user found');

    const gold24k = await prisma.metalType.findUnique({ where: { name: 'Gold 24K' } });
    const gold22k = await prisma.metalType.findUnique({ where: { name: 'Gold 22K' } });
    const gold18k = await prisma.metalType.findUnique({ where: { name: 'Gold 18K' } });
    const gold14k = await prisma.metalType.findUnique({ where: { name: 'Gold 14K' } });
    const silver = await prisma.metalType.findUnique({ where: { name: 'Silver' } });

    if (!gold24k || !gold22k || !gold18k || !gold14k || !silver) {
      throw new Error('Metal types not found in DB');
    }

    // Mark previous rates as not current
    await prisma.dailyRate.updateMany({
      where: { isCurrent: true },
      data: { isCurrent: false },
    });

    const ratesToSeed = [
      {
        metal: gold24k,
        sellRatePerTola: 120000,
        sellRatePerGram: 10288.07,
        sellRatePerLal: 1200.00,
        buyRatePerTola: 118000,
        buyRatePerGram: 10116.60,
        buyRatePerLal: 1180.00,
      },
      {
        metal: gold22k,
        sellRatePerTola: 110004,
        sellRatePerGram: 9431.07,
        sellRatePerLal: 1100.04,
        buyRatePerTola: 108170.60,
        buyRatePerGram: 9273.88,
        buyRatePerLal: 1081.71,
      },
      {
        metal: gold18k,
        sellRatePerTola: 90000,
        sellRatePerGram: 7716.05,
        sellRatePerLal: 900.00,
        buyRatePerTola: 88500,
        buyRatePerGram: 7587.45,
        buyRatePerLal: 885.00,
      },
      {
        metal: gold14k,
        sellRatePerTola: 69996,
        sellRatePerGram: 6001.03,
        sellRatePerLal: 699.96,
        buyRatePerTola: 68829.40,
        buyRatePerGram: 5901.01,
        buyRatePerLal: 688.29,
      },
      {
        metal: silver,
        sellRatePerTola: 1450,
        sellRatePerGram: 124.32,
        sellRatePerLal: 14.43,
        buyRatePerTola: 1400,
        buyRatePerGram: 120.03,
        buyRatePerLal: 13.92,
      },
    ];

    const dailyRateMap: Record<string, string> = {};

    for (const r of ratesToSeed) {
      const createdRate = await prisma.dailyRate.create({
        data: {
          metalTypeId: r.metal.id,
          sellRatePerTola: r.sellRatePerTola,
          sellRatePerGram: r.sellRatePerGram,
          sellRatePerLal: r.sellRatePerLal,
          buyRatePerTola: r.buyRatePerTola,
          buyRatePerGram: r.buyRatePerGram,
          buyRatePerLal: r.buyRatePerLal,
          isCurrent: true,
          effectiveDate: today,
          updatedByUserId: ownerUser.id,
        },
      });
      dailyRateMap[r.metal.name] = createdRate.id;
    }
    console.log('  ✅ Seeded: Daily rates for Gold & Silver');

    // 4. Suppliers
    console.log('  Seeding suppliers...');
    const s1 = await upsertSupplier({
      name: 'Sharma Gold Traders',
      supplierType: 'DIRECT',
      phone: '01-4567890',
      address: 'New Road, Kathmandu',
    });
    const s2 = await upsertSupplier({
      name: 'Nepal Silver House',
      supplierType: 'DIRECT',
      phone: '01-4234567',
      address: 'Asan, Kathmandu',
    });
    const s3 = await upsertSupplier({
      name: 'Himalayan Metal Works',
      supplierType: 'TRADE',
      phone: '01-4789012',
      address: 'Thamel, Kathmandu',
    });
    console.log('  ✅ Seeded: 3 Suppliers');

    // 5. Customers
    console.log('  Seeding customers...');
    const customers = [
      { name: 'Ram Bahadur Shrestha', phone: '9841234567', address: 'Lalitpur, Nepal' },
      { name: 'Sita Devi Maharjan', phone: '9852345678', address: 'Bhaktapur, Nepal' },
      { name: 'Bikram Tamang', phone: '9863456789', address: 'Pokhara, Nepal' },
      { name: 'Kamala Gurung', phone: '9874567890', address: 'Butwal, Nepal' },
      { name: 'Deepak Rajbhandari', phone: '9845678901', address: 'Kathmandu, Nepal' },
      { name: 'Mina Shahi', phone: '9856789012', address: 'Birgunj, Nepal' },
      { name: 'Suresh Basnet', phone: '9867890123', address: 'Dharan, Nepal' },
      { name: 'Anita Karmacharya', phone: '9878901234', address: 'Kathmandu, Nepal' },
    ];
    const customerMap: Record<string, string> = {};
    for (const c of customers) {
      const createdCustomer = await upsertCustomer(c);
      customerMap[c.name] = createdCustomer.id;
    }
    console.log('  ✅ Seeded: 8 Customers (phone numbers hashed)');

    // 6. Karigars
    console.log('  Seeding karigars...');
    const k1 = await upsertKarigar({
      name: 'Krishna Maharjan',
      phone: '9801234567',
      address: 'Patan, Lalitpur',
    });
    const k2 = await upsertKarigar({
      name: 'Govinda Shakya',
      phone: '9812345678',
      address: 'Bhaktapur',
    });
    console.log('  ✅ Seeded: 2 Karigars');

    // 7. Trade
    console.log('  Seeding trade...');
    const tradeResult = await upsertTrade(
      'Seed completed trade (Himalayan Metal Works)',
      {
        supplierId: s3.id,
        createdByUserId: ownerUser.id,
        givenMetalTypeId: gold22k.id,
        givenWeightGram: 58.32,
        givenWeightTola: 5.0,
        givenWeightLal: 500,
        rateAtTradePerGram: 9430.89,
        status: 'COMPLETED',
        createdAt: dateDaysAgo(10),
      },
      [
        {
          description: 'Trade Gold Necklace',
          grossWeightGram: 29.16,
          grossWeightTola: 29.16 / 11.664,
          grossWeightLal: 29.16 / 0.11664,
          createdAt: dateDaysAgo(10),
        },
        {
          description: 'Trade Gold Bracelet',
          grossWeightGram: 29.16,
          grossWeightTola: 29.16 / 11.664,
          grossWeightLal: 29.16 / 0.11664,
          createdAt: dateDaysAgo(10),
        },
      ]
    );
    const tradeItemNecklace = tradeResult.items[0];
    const tradeItemBracelet = tradeResult.items[1];
    console.log('  ✅ Seeded: Completed trade and 2 trade items');

    // 8. Stock Items (1-13)
    console.log('  Seeding stock items...');
    const stockItemsData = [
      {
        sku: 'PUR-20260601-000001',
        name: 'Gold Ring 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Ring',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 5.832,
        jertyGram: 0.5,
        makingChargeNpr: 2000,
        totalJyalaNpr: 2000,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000002',
        name: 'Gold Necklace 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Necklace',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 23.328,
        jertyGram: 1.5,
        makingChargeNpr: 8000,
        totalJyalaNpr: 8000,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000003',
        name: 'Gold Bangle Set 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Bangle',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 17.496,
        jertyGram: 1.0,
        makingChargeNpr: 5000,
        totalJyalaNpr: 5000,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000004',
        name: 'Gold Chain 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Chain',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 11.664,
        jertyGram: 0.8,
        makingChargeNpr: 3500,
        totalJyalaNpr: 3500,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000005',
        name: 'Gold Earrings 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Earring',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 4.666,
        jertyGram: 0.3,
        makingChargeNpr: 1500,
        totalJyalaNpr: 1500,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000006',
        name: 'Gold Pendant 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Pendant',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 3.499,
        jertyGram: 0.2,
        makingChargeNpr: 1200,
        totalJyalaNpr: 1200,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000007',
        name: 'Gold Bracelet 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Bracelet',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 8.748,
        jertyGram: 0.6,
        makingChargeNpr: 2800,
        totalJyalaNpr: 2800,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000008',
        name: 'Gold Ring 24K (Tejabi)',
        origin: 'PURCHASED' as const,
        categoryName: 'Ring',
        metalTypeName: 'Gold 24K',
        karat: 24,
        grossWeightGram: 11.664,
        jertyGram: 0.0,
        makingChargeNpr: 1000,
        totalJyalaNpr: 1000,
        entryRateId: dailyRateMap['Gold 24K'],
      },
      {
        sku: 'PUR-20260601-000009',
        name: 'Gold Anklet 22K',
        origin: 'PURCHASED' as const,
        categoryName: 'Uncategorised',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 14.580,
        jertyGram: 1.0,
        makingChargeNpr: 4500,
        totalJyalaNpr: 4500,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'PUR-20260601-000010',
        name: 'Silver Necklace',
        origin: 'PURCHASED' as const,
        categoryName: 'Necklace',
        metalTypeName: 'Silver',
        karat: null,
        grossWeightGram: 58.32,
        jertyGram: 2.0,
        makingChargeNpr: 3000,
        totalJyalaNpr: 3000,
        entryRateId: dailyRateMap['Silver'],
      },
      {
        sku: 'KAR-20260601-000001',
        name: 'Handmade Gold Ring',
        origin: 'KARIGAR' as const,
        categoryName: 'Ring',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 5.832,
        jertyGram: 0.4,
        makingChargeNpr: 2500,
        totalJyalaNpr: 2500,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'KAR-20260601-000002',
        name: 'Handmade Gold Bangle',
        origin: 'KARIGAR' as const,
        categoryName: 'Bangle',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 11.664,
        jertyGram: 0.8,
        makingChargeNpr: 4000,
        totalJyalaNpr: 4000,
        entryRateId: dailyRateMap['Gold 22K'],
      },
      {
        sku: 'KAR-20260601-000003',
        name: 'Handmade Gold Chain',
        origin: 'KARIGAR' as const,
        categoryName: 'Chain',
        metalTypeName: 'Gold 22K',
        karat: 22,
        grossWeightGram: 17.496,
        jertyGram: 1.2,
        makingChargeNpr: 6000,
        totalJyalaNpr: 6000,
        entryRateId: dailyRateMap['Gold 22K'],
      },
    ];

    const stockItemMap: Record<string, string> = {};
    for (const item of stockItemsData) {
      const createdItem = await upsertStockItem(item);
      stockItemMap[item.sku] = createdItem.id;
    }

    // Seed trade stock items linking to tradeItems (Items 14 and 15)
    const tradeItem1 = await upsertStockItem({
      sku: 'TRD-20260601-000001',
      name: 'Trade Gold Necklace',
      origin: 'TRADE' as const,
      categoryName: 'Necklace',
      metalTypeName: 'Gold 22K',
      karat: 22,
      grossWeightGram: 29.16,
      jertyGram: 2.0,
      makingChargeNpr: 9000,
      totalJyalaNpr: 9000,
      entryRateId: dailyRateMap['Gold 22K'],
    });
    await prisma.stockItem.update({
      where: { id: tradeItem1.id },
      data: { tradeItemId: tradeItemNecklace.id },
    });
    stockItemMap['TRD-20260601-000001'] = tradeItem1.id;

    const tradeItem2 = await upsertStockItem({
      sku: 'TRD-20260601-000002',
      name: 'Trade Gold Bracelet',
      origin: 'TRADE' as const,
      categoryName: 'Bracelet',
      metalTypeName: 'Gold 18K',
      karat: 18,
      grossWeightGram: 8.748,
      jertyGram: 0.5,
      makingChargeNpr: 3000,
      totalJyalaNpr: 3000,
      entryRateId: dailyRateMap['Gold 18K'],
    });
    await prisma.stockItem.update({
      where: { id: tradeItem2.id },
      data: { tradeItemId: tradeItemBracelet.id },
    });
    stockItemMap['TRD-20260601-000002'] = tradeItem2.id;

    console.log('  ✅ Seeded: 15 Stock items (SKUs mapped)');

    // 9. Transactions
    console.log('  Seeding transactions...');
    
    // Reset stock statuses before re-running transactions to avoid out-of-order issues
    for (const sku of ['PUR-20260601-000001', 'PUR-20260601-000002', 'PUR-20260601-000003', 'PUR-20260601-000004', 'PUR-20260601-000005']) {
      await prisma.stockItem.update({
        where: { sku: sku },
        data: { status: 'IN_STOCK' },
      });
    }

    const t1 = await upsertTransaction(
      'BILL-000001',
      {
        txType:          'SELL',
        customerId:      customerMap['Ram Bahadur Shrestha'],
        createdByUserId: ownerUser.id,
        dailyRateId:     dailyRateMap['Gold 22K'],
        subTotalNpr:     61725.04,
        discountNpr:     0,
        grandTotalNpr:   61725.04,
        paidAmountNpr:   61725.04,
        balanceNpr:      0,
        paymentMethod:   'CASH',
        createdAt:       dateDaysAgo(5),
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000001'],
          grossWeightGram: 5.832,
          jertyGram:       0.5,
          billableGram:    6.332,
          ratePerGram:     9430.89,
          metalValueNpr:   59725.04,
          makingChargeNpr: 2000,
          jyalaNpr:        2000,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    61725.04,
        },
      ],
      {
        amountNpr: 61725.04,
        method:    'CASH',
      }
    );
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000001'] },
      data: { status: 'SOLD' },
    });

    const t2 = await upsertTransaction(
      'BILL-000002',
      {
        txType:          'SELL',
        customerId:      customerMap['Sita Devi Maharjan'],
        createdByUserId: ownerUser.id,
        dailyRateId:     dailyRateMap['Gold 22K'],
        subTotalNpr:     242148.52,
        discountNpr:     0,
        grandTotalNpr:   242148.52,
        paidAmountNpr:   200000.00,
        balanceNpr:      42148.52,
        paymentMethod:   'CASH',
        createdAt:       dateDaysAgo(4),
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000002'],
          grossWeightGram: 23.328,
          jertyGram:       1.5,
          billableGram:    24.828,
          ratePerGram:     9430.89,
          metalValueNpr:   234148.52,
          makingChargeNpr: 8000,
          jyalaNpr:        8000,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    242148.52,
        },
      ],
      {
        amountNpr: 200000.00,
        method:    'CASH',
      }
    );
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000002'] },
      data: { status: 'SOLD' },
    });

    const t3 = await upsertTransaction(
      'BILL-000003',
      {
        txType:          'SELL',
        customerId:      customerMap['Bikram Tamang'],
        createdByUserId: ownerUser.id,
        dailyRateId:     dailyRateMap['Gold 22K'],
        subTotalNpr:     179470.93,
        discountNpr:     0,
        grandTotalNpr:   179470.93,
        paidAmountNpr:   179470.93,
        balanceNpr:      0,
        paymentMethod:   'ONLINE',
        createdAt:       dateDaysAgo(3),
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000003'],
          grossWeightGram: 17.496,
          jertyGram:       1.0,
          billableGram:    18.496,
          ratePerGram:     9430.89,
          metalValueNpr:   174470.93,
          makingChargeNpr: 5000,
          jyalaNpr:        5000,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    179470.93,
        },
      ],
      {
        amountNpr: 179470.93,
        method:    'ONLINE',
      }
    );
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000003'] },
      data: { status: 'SOLD' },
    });

    const t4 = await upsertTransaction(
      'BILL-000004',
      {
        txType:          'SELL',
        customerId:      customerMap['Kamala Gurung'],
        createdByUserId: ownerUser.id,
        dailyRateId:     dailyRateMap['Gold 22K'],
        subTotalNpr:     121065.90,
        discountNpr:     0,
        grandTotalNpr:   121065.90,
        paidAmountNpr:   121065.90,
        balanceNpr:      0,
        paymentMethod:   'CASH',
        createdAt:       dateDaysAgo(2),
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000004'],
          grossWeightGram: 11.664,
          jertyGram:       0.8,
          billableGram:    12.464,
          ratePerGram:     9430.89,
          metalValueNpr:   117565.90,
          makingChargeNpr: 3500,
          jyalaNpr:        3500,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    121065.90,
        },
      ],
      {
        amountNpr: 121065.90,
        method:    'CASH',
      }
    );
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000004'] },
      data: { status: 'SOLD' },
    });

    await upsertTransaction(
      'BILL-000005',
      {
        txType:          'RETURN',
        customerId:      customerMap['Kamala Gurung'],
        createdByUserId: ownerUser.id,
        relatedTxId:     t4.id,
        subTotalNpr:     121065.90,
        discountNpr:     0,
        grandTotalNpr:   121065.90,
        paidAmountNpr:   121065.90,
        balanceNpr:      0,
        paymentMethod:   'CASH',
        createdAt:       dateDaysAgo(1),
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000004'],
          grossWeightGram: 11.664,
          jertyGram:       0.8,
          billableGram:    12.464,
          ratePerGram:     9430.89,
          metalValueNpr:   117565.90,
          makingChargeNpr: 3500,
          jyalaNpr:        3500,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    121065.90,
        },
      ],
      {
        amountNpr: 121065.90,
        method:    'CASH',
      }
    );
    // returned item goes back to IN_STOCK
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000004'] },
      data: { status: 'IN_STOCK' },
    });

    const t6 = await upsertTransaction(
      'BILL-000006',
      {
        txType:          'SELL',
        customerId:      customerMap['Deepak Rajbhandari'],
        createdByUserId: ownerUser.id,
        dailyRateId:     dailyRateMap['Gold 22K'],
        subTotalNpr:     48329.82,
        discountNpr:     0,
        grandTotalNpr:   48329.82,
        paidAmountNpr:   48329.82,
        balanceNpr:      0,
        paymentMethod:   'CASH',
        createdAt:       today,
      },
      [
        {
          stockItemId:     stockItemMap['PUR-20260601-000005'],
          grossWeightGram: 4.666,
          jertyGram:       0.3,
          billableGram:    4.966,
          ratePerGram:     9430.89,
          metalValueNpr:   46829.82,
          makingChargeNpr: 1500,
          jyalaNpr:        1500,
          luxuryTaxNpr:    0,
          vatNpr:          0,
          addonValueNpr:   0,
          lineTotalNpr:    48329.82,
        },
      ],
      {
        amountNpr: 48329.82,
        method:    'CASH',
      }
    );
    await prisma.stockItem.update({
      where: { id: stockItemMap['PUR-20260601-000005'] },
      data: { status: 'SOLD' },
    });

    console.log('  ✅ Seeded: 6 Transactions (SELL, SELL, SELL, SELL, RETURN, SELL)');

    // 10. Purchase Orders
    console.log('  Seeding purchase orders...');
    const order1Total = 50000 + 200000 + 150000 + 100000 + 40000;
    await upsertPurchaseOrder(
      'Seed Purchase Order 1 (Sharma Gold Traders)',
      {
        supplierId:      s1.id,
        createdByUserId: ownerUser.id,
        totalNpr:        order1Total,
        status:          'RECEIVED',
        purchaseDate:    dateDaysAgo(7),
        createdAt:       dateDaysAgo(5),
      },
      [
        {
          description:     'Gold Ring 22K',
          grossWeightGram: 5.832,
          grossWeightTola: 5.832 / 11.664,
          grossWeightLal:  5.832 / 0.11664,
          jertyGram:       0.5,
          jertyTola:       0.5 / 11.664,
          jertyLal:        0.5 / 0.11664,
          priceNpr:        50000,
          rateAtPurchasePerGram: 50000 / 5.832,
          stockItemId:     stockItemMap['PUR-20260601-000001'],
        },
        {
          description:     'Gold Necklace 22K',
          grossWeightGram: 23.328,
          grossWeightTola: 23.328 / 11.664,
          grossWeightLal:  23.328 / 0.11664,
          jertyGram:       1.5,
          jertyTola:       1.5 / 11.664,
          jertyLal:        1.5 / 0.11664,
          priceNpr:        200000,
          rateAtPurchasePerGram: 200000 / 23.328,
          stockItemId:     stockItemMap['PUR-20260601-000002'],
        },
        {
          description:     'Gold Bangle Set 22K',
          grossWeightGram: 17.496,
          grossWeightTola: 17.496 / 11.664,
          grossWeightLal:  17.496 / 0.11664,
          jertyGram:       1.0,
          jertyTola:       1.0 / 11.664,
          jertyLal:        1.0 / 0.11664,
          priceNpr:        150000,
          rateAtPurchasePerGram: 150000 / 17.496,
          stockItemId:     stockItemMap['PUR-20260601-000003'],
        },
        {
          description:     'Gold Chain 22K',
          grossWeightGram: 11.664,
          grossWeightTola: 11.664 / 11.664,
          grossWeightLal:  11.664 / 0.11664,
          jertyGram:       0.8,
          jertyTola:       0.8 / 11.664,
          jertyLal:        0.8 / 0.11664,
          priceNpr:        100000,
          rateAtPurchasePerGram: 100000 / 11.664,
          stockItemId:     stockItemMap['PUR-20260601-000004'],
        },
        {
          description:     'Gold Earrings 22K',
          grossWeightGram: 4.666,
          grossWeightTola: 4.666 / 11.664,
          grossWeightLal:  4.666 / 0.11664,
          jertyGram:       0.3,
          jertyTola:       0.3 / 11.664,
          jertyLal:        0.3 / 0.11664,
          priceNpr:        40000,
          rateAtPurchasePerGram: 40000 / 4.666,
          stockItemId:     stockItemMap['PUR-20260601-000005'],
        },
      ]
    );

    await upsertPurchaseOrder(
      'Seed Purchase Order 2 (Nepal Silver House)',
      {
        supplierId:      s2.id,
        createdByUserId: ownerUser.id,
        totalNpr:        80000,
        status:          'PENDING',
        purchaseDate:    today,
        createdAt:       today,
      },
      [
        {
          description:     'Silver Necklace Set',
          categoryId:      (await prisma.itemCategory.findUnique({ where: { name: 'Necklace' } }))?.id,
          metalTypeId:     silver.id,
          karat:           null,
          grossWeightGram: 116.64,
          grossWeightTola: 10,
          grossWeightLal:  1000,
          jertyGram:       0,
          jertyTola:       0,
          jertyLal:        0,
          priceNpr:        80000,
        },
      ]
    );
    console.log('  ✅ Seeded: 2 Purchase orders');

    // 11. Production Order
    console.log('  Seeding production order...');
    await upsertProductionOrder(
      '3 rings, 2 bangles — due by end of week',
      {
        karigarId:    k1.id,
        tolerancePct: 2.5,
        status:       'OPEN',
        createdAt:    dateDaysAgo(3),
      },
      {
        metalTypeId:        gold22k.id,
        issuedWeightGram:   29.16,
        issuedWeightTola:   2.5,
        issuedWeightLal:    250,
        rateAtIssuePerGram: 9430.89,
        issuedAt:           dateDaysAgo(3),
      }
    );
    console.log('  ✅ Seeded: 1 Production order & issue');

    console.log('🎉 Demo data seeded successfully!');
    console.log(`📊 Summary: 8 customers, 15 stock items, 6 transactions`);

  } catch (error) {
    console.error('❌ Error during demo data seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());