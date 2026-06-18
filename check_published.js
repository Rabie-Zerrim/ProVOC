const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const r = await prisma.review.findFirst({
    where: { user_id: 'b009eaa2-fd6c-4b3e-bcf0-731ce237cf39', status: 'published' },
  });
  console.log(r);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
