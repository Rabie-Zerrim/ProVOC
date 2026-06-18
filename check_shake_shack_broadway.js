const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.findFirst({
    where: { name: { contains: "Shake Shack", mode: "insensitive" }, address: { contains: "Broadway" } },
    include: { listings: { include: { network: true } } },
  });
  console.log(JSON.stringify(business, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
