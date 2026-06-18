const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'b009eaa2-fd6c-4b3e-bcf0-731ce237cf39';

  const counts = await prisma.review.groupBy({
    by: ['status'],
    where: { user_id: userId, deleted_at: null },
    _count: { status: true },
  });

  console.log('=== REAL DB COUNTS (your test user) ===');
  let total = 0;
  for (const c of counts) {
    console.log(`${c.status}: ${c._count.status}`);
    total += c._count.status;
  }
  console.log('TOTAL:', total);

  const avg = await prisma.review.aggregate({
    where: { user_id: userId, deleted_at: null },
    _avg: { rating: true },
  });
  console.log('AVERAGE RATING:', avg._avg.rating);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
