const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({
    where: { name: { contains: 'Shake Shack', mode: 'insensitive' } },
    include: {
      listings: {
        include: { network: true },
      },
    },
  });

  for (const b of businesses) {
    console.log('=== BUSINESS ===');
    console.log('business_id:', b.business_id);
    console.log('name:', b.name);
    console.log('address:', b.address);
    console.log('--- listings ---');
    for (const l of b.listings) {
      console.log(`  [${l.network.name}] external_listing_id=${l.external_listing_id} external_url=${l.external_url}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
