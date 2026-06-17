const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({
    where: { name: { contains: 'Shake Shack', mode: 'insensitive' } },
    include: { listings: { include: { network: true } } },
  });

  for (const b of businesses) {
    if (b.listings.length < 2) continue;
    console.log('=== BUSINESS ===', b.name, b.business_id);
    for (const l of b.listings) {
      console.log(`  [${l.network.name}] listing_id=${l.listing_id} ext_id=${l.external_listing_id} created_at=${l.created_at?.toISOString?.() ?? l.created_at}`);
    }
    console.log('');
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
