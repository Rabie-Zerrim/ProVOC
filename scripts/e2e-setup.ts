import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GOOGLE_NET    = '00000002-0000-0000-0000-000000000000';
const YELP_NET      = '00000001-0000-0000-0000-000000000000';
const FACEBOOK_NET  = '00000004-0000-0000-0000-000000000000';

async function main() {
  // ── business ─────────────────────────────────────────────────────────────────
  const business = await prisma.business.create({
    data: {
      name: "McDonald's Paris Rivoli",
      address: '1 Rue de Rivoli, 75001 Paris, France',
      business_type: 'restaurant',
      latitude: 48.8601,
      longitude: 2.3481,
      is_active: true,
    },
  });

  // ── Google listing (clipboard_deeplink) ───────────────────────────────────────
  const googleListing = await prisma.listing.create({
    data: {
      business_id: business.business_id,
      network_id: GOOGLE_NET,
      external_listing_id: 'ChIJD7fiBh9u5kcRYJSMaMOCCwQ',
      external_url: 'https://maps.google.com/?cid=12345',
      external_rating: 3.9,
      is_active: true,
    },
  });

  // ── Yelp listing (clipboard_deeplink) ─────────────────────────────────────────
  const yelpListing = await prisma.listing.create({
    data: {
      business_id: business.business_id,
      network_id: YELP_NET,
      external_listing_id: 'mcdonalds-paris-rivoli',
      external_url: 'https://www.yelp.com/biz/mcdonalds-paris-rivoli',
      external_rating: 2.5,
      is_active: true,
    },
  });

  // ── Facebook listing (api_oauth / supports_api_posting) ───────────────────────
  const facebookListing = await prisma.listing.create({
    data: {
      business_id: business.business_id,
      network_id: FACEBOOK_NET,
      external_listing_id: 'mcdonalds.paris.rivoli',
      external_url: 'https://www.facebook.com/mcdonalds.paris.rivoli',
      external_rating: 4.0,
      is_active: true,
    },
  });

  console.log(JSON.stringify({
    business_id:         business.business_id,
    google_listing_id:   googleListing.listing_id,
    yelp_listing_id:     yelpListing.listing_id,
    facebook_listing_id: facebookListing.listing_id,
    google_network_id:   GOOGLE_NET,
    yelp_network_id:     YELP_NET,
    facebook_network_id: FACEBOOK_NET,
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
