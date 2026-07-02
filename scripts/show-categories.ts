import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.itemCategory.findMany({
    orderBy: { name: 'asc' },
    select: { name: true, shortCode: true, isProtected: true },
  });
  console.log('Category shortCode backfill:');
  console.table(rows);
}

main()
  .finally(() => prisma.$disconnect());
