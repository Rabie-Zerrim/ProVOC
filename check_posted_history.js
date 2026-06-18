const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.review.findMany({
    where: { user_id: 'b009eaa2-fd6c-4b3e-bcf0-731ce237cf39', status: { in: ['posted', 'published'] } },
    select: { review_id: true, status: true, updated_at: true },
    orderBy: { updated_at: 'asc' },
  });
  console.log(rows);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
