// One-off cleanup script for the duplicate-Google-network bug
// (ensureNetwork() used to create a separate 'google_1', 'google_2', ...
// Network row per Google Places search result instead of reusing 'Google').
//
// Run manually, same as check_shake_shack.js — override DATABASE_URL to
// target the right environment, e.g. against Railway production:
//
//   $env:DATABASE_URL="<railway-public-connection-string-for-pv-bff-db>"
//   node cleanup_duplicate_google_networks.js
//
// This script is NOT run automatically by anything in the app.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BAD_GOOGLE_NETWORK_RE = /^google_\d+$/i;

async function ensureCanonicalGoogleNetwork() {
  let google = await prisma.network.findFirst({ where: { name: 'Google' } });
  if (!google) {
    console.log('No canonical "Google" network found — creating one.');
    google = await prisma.network.create({ data: { name: 'Google', is_active: true } });
  }

  const prefs = await prisma.networkPreference.findUnique({ where: { network_id: google.network_id } });
  if (!prefs) {
    console.log(`Canonical Google network ${google.network_id} has no NetworkPreference — creating one.`);
    await prisma.networkPreference.create({
      data: {
        network_id: google.network_id,
        post_auth_type: 'clipboard_deeplink',
        supports_api_posting: false,
        supports_api_reply: false,
        rating_type: 'star',
        rating_scale_min: 1,
        rating_scale_max: 5,
      },
    });
  }

  return google;
}

async function main() {
  const canonicalGoogle = await ensureCanonicalGoogleNetwork();
  console.log(`Canonical Google network: ${canonicalGoogle.network_id}\n`);

  const allNetworks = await prisma.network.findMany();
  const badNetworks = allNetworks.filter((n) => BAD_GOOGLE_NETWORK_RE.test(n.name));

  if (badNetworks.length === 0) {
    console.log('No duplicate google_N networks found. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(
    `Found ${badNetworks.length} duplicate google_N network(s): ${badNetworks.map((n) => n.name).join(', ')}\n`,
  );

  for (const bad of badNetworks) {
    console.log(`=== Processing bad network "${bad.name}" (${bad.network_id}) ===`);

    const listings = await prisma.listing.findMany({
      where: { network_id: bad.network_id },
      include: { business: true },
    });

    if (listings.length === 0) {
      console.log('  No listings reference this network.');
    }

    for (const listing of listings) {
      await prisma.listing.update({
        where: { listing_id: listing.listing_id },
        data: { network_id: canonicalGoogle.network_id },
      });
      console.log(
        `  Re-pointed listing ${listing.listing_id} (business: "${listing.business.name}") ` +
          `from network ${bad.network_id} -> ${canonicalGoogle.network_id}`,
      );
    }

    // The bad network's own NetworkPreference row must be removed first —
    // network_preferences.network_id is a unique FK that would otherwise
    // block deleting the Network row.
    const badPrefs = await prisma.networkPreference.findUnique({ where: { network_id: bad.network_id } });
    if (badPrefs) {
      await prisma.networkPreference.delete({ where: { network_id: bad.network_id } });
      console.log(`  Deleted orphaned NetworkPreference for ${bad.network_id}`);
    }

    try {
      await prisma.network.delete({ where: { network_id: bad.network_id } });
      console.log(`  Deleted bad network "${bad.name}" (${bad.network_id})`);
    } catch (err) {
      console.error(
        `  FAILED to delete network "${bad.name}" (${bad.network_id}) — it is likely still referenced by ` +
          `another table (ReviewDraft / ReviewPlatformPost / UserPlatformAccount). Listings have already been ` +
          `re-pointed; investigate and delete this network manually. Error: ${err.message}`,
      );
    }

    console.log('');
  }

  console.log('Done.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
