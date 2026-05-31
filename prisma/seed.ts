import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NETWORKS = [
  {
    network_id: '00000001-0000-0000-0000-000000000000',
    name: 'Yelp',
    post_auth_type: 'clipboard_deeplink',
    supports_api_posting: false,
  },
  {
    network_id: '00000002-0000-0000-0000-000000000000',
    name: 'Google',
    post_auth_type: 'clipboard_deeplink',
    supports_api_posting: false,
  },
  {
    network_id: '00000003-0000-0000-0000-000000000000',
    name: 'Trustpilot',
    post_auth_type: 'clipboard_deeplink',
    supports_api_posting: false,
  },
  {
    network_id: '00000004-0000-0000-0000-000000000000',
    name: 'Facebook',
    post_auth_type: 'clipboard_deeplink',
    supports_api_posting: false,
  },
];

async function main() {
  for (const n of NETWORKS) {
    await prisma.network.upsert({
      where: { network_id: n.network_id },
      create: { network_id: n.network_id, name: n.name },
      update: { name: n.name },
    });

    await prisma.networkPreference.upsert({
      where: { network_id: n.network_id },
      create: {
        network_id: n.network_id,
        rating_type: 'star',
        post_auth_type: n.post_auth_type,
        supports_api_posting: n.supports_api_posting,
      },
      update: {
        post_auth_type: n.post_auth_type,
        supports_api_posting: n.supports_api_posting,
      },
    });

    console.log(`Seeded ${n.name}`);
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
