// One-off cleanup script for the duplicate-Google-listing bug
// (pv-app's app/search.tsx saveAllPlatforms() compared a Google Places
// primarySlug like 'google_1' / 'google_3' against Zembra's plain 'google'
// key with a strict !== check, so it failed to exclude Zembra's Google
// match and saved it as a SECOND Listing for the same business — both
// resolving to the same canonical Google network_id after ensureNetwork().
// Confirmed affected: the Istanbul "Retro Burger" business searched
// 2026-06-17, before the pv-app fix to saveAllPlatforms's exclusion filter).
//
// This script finds every (business_id, network_id) pair that has MORE
// THAN ONE Listing row, picks one "keeper" per group, and deletes the rest.
//
// Keeper selection:
//   1. If the group has at least one listing with a real Google Place ID
//      (external_listing_id starting with "ChIJ") AND at least one with a
//      synthetic Zembra ID (external_listing_id starting with "zembra-"),
//      keep a real ChIJ... listing (oldest among them if several) and
//      delete the synthetic one(s).
//   2. Otherwise (no real-vs-synthetic split to prefer) keep the oldest
//      listing by created_at and delete the rest.
//
// Run manually, same as check_shake_shack.js / cleanup_duplicate_google_networks.js
// — override DATABASE_URL to target the right environment, e.g. against
// Railway production:
//
//   $env:DATABASE_URL="<railway-public-connection-string-for-pv-bff-db>"
//   node cleanup_duplicate_google_listings.js
//
// This script is NOT run automatically by anything in the app.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const REAL_PLACE_ID_RE = /^ChIJ/;
const SYNTHETIC_ZEMBRA_ID_RE = /^zembra-/i;

function isRealPlaceId(id) {
  return typeof id === 'string' && REAL_PLACE_ID_RE.test(id);
}

function isSyntheticZembraId(id) {
  return typeof id === 'string' && SYNTHETIC_ZEMBRA_ID_RE.test(id);
}

function byCreatedAtAsc(a, b) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function pickKeeper(listings) {
  const real = listings.filter((l) => isRealPlaceId(l.external_listing_id));
  const synthetic = listings.filter((l) => isSyntheticZembraId(l.external_listing_id));

  if (real.length > 0 && synthetic.length > 0) {
    const keeper = [...real].sort(byCreatedAtAsc)[0];
    return { keeper, reason: 'real ChIJ... Place ID preferred over synthetic zembra- ID' };
  }

  const keeper = [...listings].sort(byCreatedAtAsc)[0];
  return { keeper, reason: 'oldest listing (no real-vs-synthetic split to prefer)' };
}

async function main() {
  const listings = await prisma.listing.findMany({
    include: { business: true, network: true },
  });

  const groups = new Map();
  for (const l of listings) {
    const key = `${l.business_id}::${l.network_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);

  if (dupGroups.length === 0) {
    console.log('No businesses with duplicate listings on the same network. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${dupGroups.length} business/network pair(s) with duplicate listings.\n`);

  for (const group of dupGroups) {
    const { business, network } = group[0];
    console.log(`=== "${business.name}" (business_id: ${business.business_id}) — network "${network.name}" (${network.network_id}) ===`);
    for (const l of group) {
      console.log(
        `  candidate listing ${l.listing_id}: external_listing_id="${l.external_listing_id}" ` +
          `created_at=${l.created_at.toISOString()}`,
      );
    }

    const { keeper, reason } = pickKeeper(group);
    console.log(`  KEEPING ${keeper.listing_id} (external_listing_id="${keeper.external_listing_id}") — ${reason}`);

    const toDelete = group.filter((l) => l.listing_id !== keeper.listing_id);
    for (const l of toDelete) {
      try {
        await prisma.listing.delete({ where: { listing_id: l.listing_id } });
        console.log(`  DELETED ${l.listing_id} (external_listing_id="${l.external_listing_id}")`);
      } catch (err) {
        console.error(
          `  FAILED to delete listing ${l.listing_id} — it is likely still referenced by another table ` +
            `(Review / ReviewPlatformPost). Investigate and delete manually. Error: ${err.message}`,
        );
      }
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
