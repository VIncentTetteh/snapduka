/**
 * Catalog definition for the Sika Threads demo shop.
 *
 * Split out from seed-demo.mjs so the IDs stay in one obvious place: every id
 * here is fixed, which is what makes the seeder idempotent — re-running it
 * updates the same rows instead of creating a second demo shop.
 */

export const AUTH_USER_ID = "024fc8a8-3c0f-4d31-8351-5f35ae674b56"; // +233542880528
export const SELLER_ID = "b7f3c2a1-4d5e-4f60-9a71-8c2d3e4f5a60";
export const SHOP_ID = "c8e4d3b2-5f60-4a71-8b82-9d3e4f5a6b71";
export const SHOP_SLUG = "sika-threads";

export const FULFILLMENT = [
  {
    id: "d1000000-0000-4000-8000-000000000001",
    type: "pickup",
    name: "Pickup — Osu studio",
    fee_minor: 0,
    instructions: "Mon–Sat, 9am–6pm. 14 Oxford St, Osu, Accra.",
    position: 0,
  },
  {
    id: "d1000000-0000-4000-8000-000000000002",
    type: "delivery",
    name: "Accra same-day dispatch",
    fee_minor: 2500,
    instructions: "Ordered before 1pm ships the same day.",
    position: 1,
  },
  {
    id: "d1000000-0000-4000-8000-000000000003",
    type: "delivery",
    name: "Nationwide courier (2–4 days)",
    fee_minor: 4500,
    instructions: "Tracked via VIP Transport to any region.",
    position: 2,
  },
];

export const CATEGORIES = [
  { id: "e1000000-0000-4000-8000-000000000001", name: "Clothing", slug: "clothing", position: 0 },
  { id: "e1000000-0000-4000-8000-000000000002", name: "Bags", slug: "bags", position: 1 },
  { id: "e1000000-0000-4000-8000-000000000003", name: "Jewellery", slug: "jewellery", position: 2 },
  { id: "e1000000-0000-4000-8000-000000000004", name: "Footwear", slug: "footwear", position: 3 },
  { id: "e1000000-0000-4000-8000-000000000005", name: "Home", slug: "home", position: 4 },
  { id: "e1000000-0000-4000-8000-000000000006", name: "Beauty", slug: "beauty", position: 5 },
  { id: "e1000000-0000-4000-8000-000000000007", name: "Accessories", slug: "accessories", position: 6 },
];

/**
 * `stock` null means the product does not track inventory (continue_selling).
 * `variants` prices are absolute, not deltas — matching product_variants.price_minor.
 *
 * `video_url`: paste a YouTube watch/shorts/youtu.be link and re-run
 * `pnpm seed:demo`; the seeder derives provider, id and thumbnail. Left null
 * here deliberately — a guessed video id renders a broken player, so these
 * want real links to your own product footage.
 */
export const PRODUCTS = [
  {
    id: "f1000000-0000-4000-8000-000000000001",
    slug: "kente-tote",
    name: "Kente Weave Tote",
    category: "bags",
    price_minor: 24000,
    compare_at_price_minor: null,
    cost_minor: 11000,
    stock: 42,
    status: "active",
    sku: "SKT-BAG-001",
    description:
      "Hand-woven kente strip stitched onto full-grain leather. Fits a 14-inch laptop, a notebook and everything you actually carry. Each strip is woven in Bonwire, so the pattern lands differently on every bag.",
    media: "kente-tote.png",
    variants: [
      { id: "f2000000-0000-4000-8000-000000000001", name: "Gold / Indigo", sku: "SKT-BAG-001-GI", price_minor: 24000, stock: 24 },
      { id: "f2000000-0000-4000-8000-000000000002", name: "Green / Rust", sku: "SKT-BAG-001-GR", price_minor: 24000, stock: 18 },
    ],
  },
  {
    id: "f1000000-0000-4000-8000-000000000002",
    slug: "adinkra-shirt",
    name: "Adinkra Print Shirt",
    category: "clothing",
    price_minor: 18500,
    compare_at_price_minor: 22000,
    cost_minor: 8200,
    stock: 60,
    status: "active",
    sku: "SKT-CLO-002",
    description:
      "Breathable cotton poplin, screen-printed by hand with Gye Nyame and Sankofa symbols. Cut boxy with a camp collar, so it wears well through an Accra afternoon.",
    media: "adinkra-shirt.png",
    variants: [
      { id: "f2000000-0000-4000-8000-000000000003", name: "S", sku: "SKT-CLO-002-S", price_minor: 18500, stock: 12 },
      { id: "f2000000-0000-4000-8000-000000000004", name: "M", sku: "SKT-CLO-002-M", price_minor: 18500, stock: 20 },
      { id: "f2000000-0000-4000-8000-000000000005", name: "L", sku: "SKT-CLO-002-L", price_minor: 18500, stock: 18 },
      { id: "f2000000-0000-4000-8000-000000000006", name: "XL", sku: "SKT-CLO-002-XL", price_minor: 19500, stock: 10 },
    ],
  },
  {
    id: "f1000000-0000-4000-8000-000000000003",
    slug: "ankara-dress",
    name: "Ankara Wrap Dress",
    category: "clothing",
    price_minor: 32000,
    compare_at_price_minor: 38000,
    cost_minor: 15000,
    stock: 28,
    status: "active",
    sku: "SKT-CLO-003",
    description:
      "Wax-print wrap dress with a fixed waist tie and deep pockets. Every bolt is cut in-house, so no two dresses carry the same run of the print.",
    media: "ankara-dress.png",
    video_url: null,
    variants: [
      { id: "f2000000-0000-4000-8000-000000000007", name: "S", sku: "SKT-CLO-003-S", price_minor: 32000, stock: 8 },
      { id: "f2000000-0000-4000-8000-000000000008", name: "M", sku: "SKT-CLO-003-M", price_minor: 32000, stock: 12 },
      { id: "f2000000-0000-4000-8000-000000000009", name: "L", sku: "SKT-CLO-003-L", price_minor: 32000, stock: 8 },
    ],
  },
  {
    id: "f1000000-0000-4000-8000-000000000004",
    slug: "krobo-necklace",
    name: "Beaded Krobo Necklace",
    category: "jewellery",
    price_minor: 9500,
    compare_at_price_minor: null,
    cost_minor: 3800,
    stock: 75,
    status: "active",
    sku: "SKT-JEW-004",
    description:
      "Recycled glass beads fired in Odumase Krobo and strung on waxed cord. Adjustable from 42cm to 48cm.",
    media: "krobo-necklace.png",
    variants: [],
  },
  {
    id: "f1000000-0000-4000-8000-000000000005",
    slug: "leather-sandals",
    name: "Tamale Leather Sandals",
    category: "footwear",
    price_minor: 21000,
    compare_at_price_minor: null,
    cost_minor: 9500,
    stock: 34,
    status: "active",
    sku: "SKT-FTW-005",
    description:
      "Vegetable-tanned goat leather over a stitched rubber sole. They soften to your foot after about a week of wear.",
    media: "leather-sandals.png",
    variants: [
      { id: "f2000000-0000-4000-8000-000000000010", name: "39", sku: "SKT-FTW-005-39", price_minor: 21000, stock: 6 },
      { id: "f2000000-0000-4000-8000-000000000011", name: "40", sku: "SKT-FTW-005-40", price_minor: 21000, stock: 9 },
      { id: "f2000000-0000-4000-8000-000000000012", name: "41", sku: "SKT-FTW-005-41", price_minor: 21000, stock: 11 },
      { id: "f2000000-0000-4000-8000-000000000013", name: "42", sku: "SKT-FTW-005-42", price_minor: 21000, stock: 8 },
    ],
  },
  {
    id: "f1000000-0000-4000-8000-000000000006",
    slug: "bolga-basket",
    name: "Bolga Market Basket",
    category: "home",
    price_minor: 13000,
    compare_at_price_minor: 16000,
    cost_minor: 5500,
    stock: 50,
    status: "active",
    sku: "SKT-HOM-006",
    description:
      "Elephant grass woven in Bolgatanga with a leather-wrapped handle. Holds a full market run and folds flat when empty.",
    media: "bolga-basket.png",
    variants: [],
  },
  {
    id: "f1000000-0000-4000-8000-000000000007",
    slug: "shea-balm",
    name: "Shea Butter Body Balm",
    category: "beauty",
    price_minor: 6000,
    compare_at_price_minor: null,
    cost_minor: 2100,
    stock: null, // continue_selling — made to order
    status: "active",
    sku: "SKT-BTY-007",
    description:
      "Unrefined shea from a women's cooperative in the Northern Region, whipped with a little baobab oil. Nothing else in it.",
    media: "shea-balm.png",
    variants: [],
  },
  {
    id: "f1000000-0000-4000-8000-000000000008",
    slug: "batik-wrap",
    name: "Batik Head Wrap",
    category: "accessories",
    price_minor: 4500,
    compare_at_price_minor: null,
    cost_minor: 1600,
    stock: 90,
    status: "draft", // one draft so the dashboard shows an unpublished row
    sku: "SKT-ACC-008",
    description: "Two metres of hand-dyed batik cotton. Launching with the harmattan collection.",
    media: "batik-wrap.png",
    variants: [],
  },
];

export const COLLECTIONS = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    name: "Harmattan Edit",
    slug: "harmattan-edit",
    description: "Warm weaves and covered shoulders for the dry season.",
    products: ["kente-tote", "adinkra-shirt", "batik-wrap"],
  },
  {
    id: "a1000000-0000-4000-8000-000000000002",
    name: "Made in Ghana",
    slug: "made-in-ghana",
    description: "Everything on this shelf is made within a day's drive of Accra.",
    products: ["kente-tote", "krobo-necklace", "bolga-basket", "leather-sandals", "shea-balm"],
  },
  {
    id: "a1000000-0000-4000-8000-000000000003",
    name: "Under GHS 150",
    slug: "under-150",
    description: "Gifting without the guesswork.",
    products: ["krobo-necklace", "bolga-basket", "shea-balm", "batik-wrap"],
  },
];

export const CUSTOMERS = [
  { id: "b1000000-0000-4000-8000-000000000001", name: "Akosua Mensah", email: "akosua.mensah@example.com", phone: "+233244108822" },
  { id: "b1000000-0000-4000-8000-000000000002", name: "Kwame Boateng", email: "kwame.boateng@example.com", phone: "+233201447390" },
  { id: "b1000000-0000-4000-8000-000000000003", name: "Efua Danso", email: "efua.danso@example.com", phone: "+233277310654" },
  { id: "b1000000-0000-4000-8000-000000000004", name: "Yaw Owusu", email: "yaw.owusu@example.com", phone: "+233249876123" },
  { id: "b1000000-0000-4000-8000-000000000005", name: "Adjoa Nyarko", email: "adjoa.nyarko@example.com", phone: "+233203358741" },
  { id: "b1000000-0000-4000-8000-000000000006", name: "Kofi Asante", email: "kofi.asante@example.com", phone: "+233266092214" },
  { id: "b1000000-0000-4000-8000-000000000007", name: "Abena Sarpong", email: "abena.sarpong@example.com", phone: "+233559441028" },
  { id: "b1000000-0000-4000-8000-000000000008", name: "Nii Armah", email: "nii.armah@example.com", phone: "+233208871345" },
  { id: "b1000000-0000-4000-8000-000000000009", name: "Esi Quartey", email: "esi.quartey@example.com", phone: "+233242207518" },
  { id: "b1000000-0000-4000-8000-000000000010", name: "Selorm Agbeko", email: "selorm.agbeko@example.com", phone: "+233276634089" },
];

export const PROMOTIONS = [
  {
    id: "c1000000-0000-4000-8000-000000000001",
    code: "HARMATTAN15",
    name: "Harmattan launch — 15% off",
    kind: "percentage",
    value: 15,
    minimum_minor: 15000,
    redemption_limit: 200,
    per_customer_limit: 1,
    active: true,
    starts_days_ago: 30,
    ends_days_ahead: 30,
  },
  {
    id: "c1000000-0000-4000-8000-000000000002",
    code: "FREEACCRA",
    name: "Free Accra delivery over GHS 300",
    kind: "fixed",
    value: 2500,
    minimum_minor: 30000,
    redemption_limit: null, // unlimited
    per_customer_limit: 3, // NOT NULL in schema — no "unlimited per customer"
    active: true,
    starts_days_ago: 60,
    ends_days_ahead: 60,
  },
  {
    id: "c1000000-0000-4000-8000-000000000003",
    code: "EASTER24",
    name: "Easter weekend — GHS 20 off",
    kind: "fixed",
    value: 2000,
    minimum_minor: 10000,
    redemption_limit: 100,
    per_customer_limit: 1,
    active: false,
    starts_days_ago: 95,
    ends_days_ahead: -80,
  },
];

/**
 * Demo creator for the Sika Threads shop.
 *
 * Needs its own auth user because a creator is a distinct actor — the seeder
 * creates one via the admin API. The handle and ids are fixed like everything
 * else here so re-running updates in place.
 */
export const CREATOR = {
  id: "c0000000-0000-4000-8000-000000000001",
  partnershipId: "c0000000-0000-4000-8000-000000000002",
  linkId: "c0000000-0000-4000-8000-000000000003",
  email: "vincentgtetteh+akua@gmail.com",
  handle: "akua_creates",
  displayName: "Akua Creates",
  contactPhone: "+233246110284",
  country: "GH",
  // 12.5% is a realistic micro-influencer rate for this market.
  rateBps: 1250,
  holdDays: 14,
  linkToken: "akuademo",
  momoName: "Akua Mensah",
};
