'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// lp-compiler.js — premium landing-page compiler ported from the Knickgasm Campaign
// Hub (marketing_automation/src/utils/compiler.ts). Pure: THEMES x FUNNEL_VARIANTS
// -> standalone HTML via compileHTML(theme, variant, baseOrigin). Faithful port
// (type annotations stripped only); kept in sync with the sibling app.
// ─────────────────────────────────────────────────────────────────────────────
// Campaign-hub landing themes. Each is a real KNICKGASM angle (self-expression,
// fandom, occasion, collecting, care) — never a health or benefit claim. Product
// facts, prices and images below all come from data/catalog/products_us.json.
const ASSETS = {
  spiderman: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/28DE9946-D17C-4315-8861-E3DD69D53938.jpg?v=1783339509",
  manUtd: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/FullSizeRender_463ec0c1-bdb5-410d-bd57-2cebd9f0edac.jpg?v=1785616541",
  gtr: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/48E101AF-8235-496A-BB64-80C98EC70F7F.jpg?v=1785617884",
  cr7: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/918FE56F-6D8E-4C07-A45F-EDBA37E4E41D.jpg?v=1785410921",
  coffeeDip: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/Nike-Air-Force-1-Coffee-Dip-Rope-Laces-Knickgasm-7241.jpg?v=1734418167",
  ropeLaces: "https://cdn.shopify.com/s/files/1/0754/4094/7522/files/Chunky-Rope-Laces-For-Sneakers-Knickgasm-8829.jpg?v=1734418191",
};
// Shared image slots. Keys are kept (heroFace/ksmRoot/periSupport/bellyFat/
// tasteAsset) because compileHTML() and the sibling Campaign Hub read them by
// name; only the images behind them are Knickgasm's.
const THEME_ASSETS = {
  heroFace: ASSETS.spiderman,
  ksmRoot: ASSETS.gtr,
  periSupport: ASSETS.manUtd,
  bellyFat: ASSETS.cr7,
  tasteAsset: ASSETS.coffeeDip,
};

const THEMES = [
  {
    id: 1,
    name: "The Same Pair as Everyone Else",
    slug: "one-of-one",
    coreProblem: "A stock colourway is made a hundred thousand times over. It says nothing about the person wearing it, so it gets worn out of habit rather than pride.",
    scientificHook: "Every KNICKGASM pair starts as a 100% original Nike, Jordan, Converse or Adidas base and is hand-painted once, by an artist, for one person. No stencil runs, no reprints, no second pair.",
    subjectLines: [
      "Everyone in the room has your shoes.",
      "The pair nobody else on earth owns.",
      "One of one, and only one."
    ],
    mailerPointers: [
      "The Hook: You paid full retail for a shoe three people on your train are already wearing.",
      "The Craft: We start on the original silhouette, then build the artwork by hand in layers - brush detail for linework, airbrush for gradients - and seal it water and scratch resistant.",
      "The Ask: Pick a design or send us a reference. Made to order in 10 to 15 days, shipped express to 60+ countries."
    ],
    landingPageVariant: "Variant A / B1 (Hyper-direct or top-loaded)",
    variantLink: "https://knickgasm.com/collections/all",
    recommendedTemplate: "Variant A",
    assets: THEME_ASSETS
  },
  {
    id: 2,
    name: "Anime & Fandom on Foot",
    slug: "anime-fandom",
    coreProblem: "Fans have posters, figures and a phone case, but nothing they can actually wear out. Licensed merch is either a t-shirt or a resale-only collab they will never win a raffle for.",
    scientificHook: "Fifty-nine anime designs in the live catalog - Naruto, One Piece, Dragon Ball and more - hand-painted onto original Air Force 1s. Not a print, not a wrap: pigment, applied by hand, on leather.",
    subjectLines: [
      "Your favourite arc, painted on an AF1.",
      "Merch you can actually wear out.",
      "No raffle. No resale. Just yours."
    ],
    mailerPointers: [
      "The Hook: You can own the figure, the poster and the manga, but you still cannot wear the thing you love.",
      "The Craft: Character linework is painted freehand and the background is airbrushed, then sealed so it flexes with the leather instead of cracking at the toe box.",
      "The Ask: Browse the anime designs or brief us on a scene from your own list. Spiderman x Nike Air Force 1 is $167.68 (compare-at $210.99)."
    ],
    landingPageVariant: "Variant B2 (Mid-page explanation)",
    variantLink: "https://knickgasm.com/products/spiderman-x-nike-air-force-1",
    recommendedTemplate: "Variant B2",
    assets: THEME_ASSETS
  },
  {
    id: 3,
    name: "Matchday, Motorsport & Machines",
    slug: "matchday-motorsport",
    coreProblem: "Club and car fandom is loud in a group chat and invisible on a fit. A replica shirt is a uniform; a keyring is a keyring.",
    scientificHook: "Thirty-two football designs and thirty-two car and F1 designs in the live catalog - crests, liveries and silhouettes hand-painted onto original bases, so the reference reads clean from across a room.",
    subjectLines: [
      "Wear the crest, not the replica shirt.",
      "The R34, painted on an Air Force 1.",
      "Matchday fits that are not a uniform."
    ],
    mailerPointers: [
      "The Hook: Your club or your car is the first thing you talk about and the last thing anyone can see on you.",
      "The Craft: Crest and livery work is laid out by hand, colour-matched to the reference, then sealed water and scratch resistant for real terrace and paddock wear.",
      "The Ask: Manchester United F.C. x Nike Air Force 1 is $167.76 (compare-at $196.72); Nissan Skyline GT-R R34 x Nike Air Force 1 is $155.79 (compare-at $196.72)."
    ],
    landingPageVariant: "Variant B3 (Deep-conviction & trust)",
    variantLink: "https://knickgasm.com/products/manchester-united-f-c-x-nike-air-force-1",
    recommendedTemplate: "Variant B3",
    assets: THEME_ASSETS
  },
  {
    id: 4,
    name: "Wedding & Occasion Pairs",
    slug: "wedding-occasion",
    coreProblem: "The outfit is decided months out and the shoes are an afterthought - rented, borrowed, or bought once and never worn again.",
    scientificHook: "Wedding customs are painted to the actual outfit: send the lehenga, sherwani or suit swatches and the artwork is matched to them. One pair, made for one day, wearable long after it.",
    subjectLines: [
      "Shoes made for the outfit, not the other way round.",
      "The one pair you will actually keep.",
      "Painted to your palette, for the day itself."
    ],
    mailerPointers: [
      "The Hook: Everything else is tailored to you. The shoes are usually whatever fit.",
      "The Craft: Colour matched to your outfit by hand, with optional embroidery and crystal work on top of the painted base.",
      "The Ask: Brief us at least a month out - pairs are made to order in 10 to 15 days, and we ship express to 60+ countries."
    ],
    landingPageVariant: "Variant B4 (Offer/Bundle-focused)",
    variantLink: "https://knickgasm.com/collections/all",
    recommendedTemplate: "Variant B4",
    assets: THEME_ASSETS
  },
  {
    id: 5,
    name: "Care, Restoration & Keeping Them Alive",
    slug: "sneaker-care",
    coreProblem: "People buy a pair they love and then treat it like glass, or wear it hard and watch it die. Neither is necessary.",
    scientificHook: "The paint system is layered, sealed and cured so the artwork is water and scratch resistant and moves with the leather. And because it was applied by hand, it can be touched up by hand.",
    subjectLines: [
      "Wear them. That is the point.",
      "Scuffed is a repair, not an ending.",
      "How to keep a hand-painted pair alive."
    ],
    mailerPointers: [
      "The Hook: A one-of-one you are too scared to wear is just an expensive shelf ornament.",
      "The Craft: Damp microfibre and a soft brush, no machine wash, no direct heat, out of long direct sunlight. That is the entire routine.",
      "The Ask: Finish the pair properly - Chunky Rope Laces For Sneakers $7.91 (compare-at $10.55), Lace Tags (Custom) $9.14 (compare-at $12.19)."
    ],
    landingPageVariant: "Variant E (Review-heavy / social proof)",
    variantLink: "https://knickgasm.com/products/rope-laces",
    recommendedTemplate: "Variant E",
    assets: THEME_ASSETS
  },
  {
    id: 6,
    name: "coffee-ART: A Theme, Not a Drink",
    slug: "coffee-art",
    coreProblem: "Neutral sneakers are safe and forgettable; loud sneakers are hard to wear twice. There is very little in between.",
    scientificHook: "coffee-ART is a paint theme: coffee-dip washes, latte-swirl gradients and cartoon-coffee motifs hand-painted onto original bases. Warm, unmistakable, and still wearable with anything.",
    subjectLines: [
      "Coffee, but on your feet.",
      "The warmest colourway we paint.",
      "Loud enough to notice, calm enough to wear."
    ],
    mailerPointers: [
      "The Hook: You want a pair people ask about, without dressing around it every morning.",
      "The Craft: A coffee-dip wash laid down wet, worked into a gradient by airbrush, then detailed by brush and sealed water and scratch resistant.",
      "The Ask: Coffee Dip x Nike Air Force 1 is $136.11 (compare-at $182.47). Made to order in 10 to 15 days."
    ],
    landingPageVariant: "Variant C (Story/Editorial funnel)",
    variantLink: "https://knickgasm.com/products/nike-air-force-1-coffee-dip-rope-laces",
    recommendedTemplate: "Variant C",
    assets: THEME_ASSETS
  }
];

const FUNNEL_VARIANTS = [
  {
    code: "A",
    name: "Variant A: The Hyper-Direct Funnel",
    type: "Hyper-Direct",
    flowShort: "Ad → Single-Design Focus LP → Direct Checkout Pay",
    targetAudience: "Highly motivated buyers, returning users, hot social traffic",
    why: "By bypassing intermediate carts, it minimizes page resistance and matches immediate conversion goals perfectly.",
    description: "Features a sticky top bar, dual-column above-the-fold layout built around one hero design, an embedded painting-process video loop, trust badges, and a direct Checkout button that skips any intermediate cart steps.",
    deliveryPath: 'checkout'
  },
  {
    code: "B1",
    name: "Variant B1: Top-Loaded Intent Funnel",
    type: "Top-Loaded",
    flowShort: "Header Bar → Hero Section → Top Buy Box (2nd Section) → Science Breakdown → Reviews",
    targetAudience: "High-intent mobile users who scan benefits quickly and make decisions above the fold.",
    why: "Takes advantage of fast scrolling on mobile by showing the buy/conversion box immediately under the hero.",
    description: "Provides maximum visibility of the base-model and size options above the fold. Perfect for campaigns hitting audiences who already know the design and just need to pick a silhouette.",
    deliveryPath: 'cart'
  },
  {
    code: "B2",
    name: "Variant B2: Mid-Page Pivot Funnel",
    type: "Mid-Page Pivot",
    flowShort: "Hero → Problem Narrative → Craft Grid → Mid-Page Buy Box (50%-75% depth) → Reviews",
    targetAudience: "Audiences requiring scientific or logical context before presenting the price barrier.",
    why: "Builds the case for a hand-painted one-of-one on an original base before showing the buy block.",
    description: "Combines high-converting copy with logical sections, moving sequentially through problem, craft and materials, then CTA, leading to standard cart flow.",
    deliveryPath: 'cart'
  },
  {
    code: "B3",
    name: "Variant B3: Deep-Conviction Funnel",
    type: "Deep Conviction",
    flowShort: "Hero → Problem Deep Narrative → Benefit Cards → Before/After Grid → Bottom Buy Box → FAQ",
    targetAudience: "Skeptical or colder audience segments who need multiple craft, visual, and social proofs.",
    why: "Overcomes high friction and consumer skepticism using thorough peer review and detail matrices.",
    description: "A comprehensive layout emphasizing verifiable craft facts, a structured materials-and-technique dashboard, painting-process video carousels, and review aggregators.",
    deliveryPath: 'cart'
  },
  {
    code: "B4",
    name: "Variant B4: Offer-First Deal Seeker Funnel",
    type: "Offer-First",
    flowShort: "Hero → Unboxing the Pair → Design Grid → Premium Buy Box with Base-Model Tiers → FAQ",
    targetAudience: "VFM (Value for Money) shoppers, deal hunters, and bonus/bundle comparison buyers.",
    why: "Maximizes conversions by leading with the unboxing itself - the painted pair, the rope laces and the custom lace tag - and the live compare-at price.",
    description: "Designed for high-order volume. Highlights the physical unboxing experience of the pair and its finishing accessories, priced straight from the catalog.",
    deliveryPath: 'cart'
  },
  {
    code: "C",
    name: "Variant C: Editorial / Storytelling Funnel",
    type: "Editorial Narrative",
    flowShort: "Sneaker Journal Article Header → Personal Narrative → Inline Product Card → Bottom Buy Box",
    targetAudience: "Users seeking relatable personal transformations, magazine-style reading, and authentic reviews.",
    why: "Bypasses standard banner blindness and marketing skepticism by speaking as a peer story hook.",
    description: "Styled entirely like an article: 'I sent them a photo of my favourite scene and got back a pair nobody else owns', with inline lifestyle imagery.",
    deliveryPath: 'cart'
  },
  {
    code: "D",
    name: "Variant D: UGC / Social-Proof Driven Funnel",
    type: "UGC Video-First",
    flowShort: "Mobile Video Showreel → Social Comments Grid → Feature Bullet List → Compact Sticky Buy Form",
    targetAudience: "Instagram/TikTok traffic, younger cohorts, visual/dynamic consumers.",
    why: "Feels like native social content, immediately capturing visual attention with raw video evidence.",
    description: "A video-focused interface featuring our Review_Video_1.mp4 loop, stylized user chat reviews, and highly scannable benefit bubbles.",
    deliveryPath: 'cart'
  },
  {
    code: "E",
    name: "Variant E: Review-Heavy Funnel",
    type: "Verified Reviews Focus",
    flowShort: "Trustpilot Banner (4.9 Rating) → Segmented Reviews Grid → Product Details Box → FAQ",
    targetAudience: "Highly analytical buyers, critical reviews hunters, and buyers who look for heavy validation.",
    why: "Uses numbers, star totals, and peer feedback to construct bulletproof safety and effectiveness claims.",
    description: "Includes review-aggregator styles, craft proof boards, and tabs focusing on specific areas: Likeness, Finish Durability, Sizing, Delivery Time.",
    deliveryPath: 'cart'
  }
];

function compileHTML(theme, variant, baseOrigin) {
  const directCheckoutUrl = "https://knickgasm.com/cart";
  const cartFlowUrl = theme && theme.variantLink ? theme.variantLink : "https://knickgasm.com/collections/all";
  const targetUrl = variant.deliveryPath === 'checkout' ? directCheckoutUrl : cartFlowUrl;

  // Hero + supporting imagery come from the live catalog (data/catalog/products_us.json).
  const heroImage = (theme && theme.assets && theme.assets.heroFace) || ASSETS.spiderman;
  const ingredientImage = (theme && theme.assets && theme.assets.ksmRoot) || ASSETS.gtr;
  const trustBadgeImage = ASSETS.ropeLaces;
  const reviewVideoUrl = "";

  // Build some custom content zones based on variant layout code
  let variantSpecificHTML = "";

  if (variant.code === "A") {
    variantSpecificHTML = `
      <!-- VARIANT A - HYPER DIRECT BUY BOX -->
      <section id="product-buy-box" class="section bg-white border-t border-chalk">
        <div class="container container-sm">
          <div class="card p-8 shadow-sm text-center">
            <span class="badge mb-4">HAND-PAINTED ONE-OF-ONE</span>
            <h2 class="title font-serif text-3xl mb-4 text-brand">Spiderman x Nike Air Force 1</h2>
            <p class="text-gray-600 mb-6 font-sans">Painted by hand onto a 100% original Nike Air Force 1, sealed water and scratch resistant, made to order in 10 to 15 days and shipped express worldwide.</p>
            <div class="flex items-center justify-center gap-4 mb-8">
              <span class="text-4xl font-sans font-bold text-brand">$167.68</span>
              <span class="text-xl text-gray-400 line-through">$210.99</span>
              <span class="badge bg-lava text-brand font-sans text-xs">ONE PAIR ONLY</span>
            </div>
            <a href="${directCheckoutUrl}" id="direct-checkout-button" class="btn btn-primary w-full py-4 text-lg text-center font-bold tracking-wide uppercase inline-block block">
              Claim This Pair &rarr;
            </a>
            <div class="mt-4 flex items-center justify-center gap-2">
              <img src="${trustBadgeImage}" referrerpolicy="no-referrer" alt="KNICKGASM chunky rope laces" style="max-height: 32px;" />
            </div>
            <p class="text-gray-400 text-xs mt-2 font-mono">Secure checkout via Stripe, PayPal, or Apple Pay.</p>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B1") {
    variantSpecificHTML = `
      <!-- VARIANT B1 - ABOVE THE FOLD TOP-LOADED BUY BOX -->
      <section id="top-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <h2 class="text-center font-serif text-2xl text-brand mb-6">Pick Your Base Sneaker</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Entry silhouette -->
            <div class="card p-6 bg-white flex flex-col justify-between">
              <div>
                <span class="badge bg-gray-200 text-gray-800 mb-2">ENTRY SILHOUETTE</span>
                <h3 class="font-serif text-xl font-bold mb-2">Nike Court Vision base</h3>
                <p class="text-sm text-gray-600 mb-4">The accessible canvas. Same artwork, same hand-painted process, on a lower-priced original base.</p>
              </div>
              <div>
                <div class="text-2xl font-bold text-brand mb-4">from $103.67</div>
                <a href="${cartFlowUrl}" class="btn btn-primary w-full py-3 text-center uppercase tracking-wider block">See The Designs</a>
              </div>
            </div>
            <!-- Flagship silhouette -->
            <div class="card p-6 bg-white border-2 border-lava relative flex flex-col justify-between">
              <span class="absolute top-0 right-4 transform -translate-y-1/2 bg-lava text-brand font-sans text-xs font-bold px-3 py-1 uppercase rounded-full">Most Painted</span>
              <div>
                <span class="badge mb-2">FLAGSHIP CANVAS</span>
                <h3 class="font-serif text-xl font-bold mb-2 text-brand">Nike Air Force 1 base</h3>
                <p class="text-sm text-gray-600 mb-4">Roughly 80% of everything we paint. The widest design library, from anime to matchday to wedding customs.</p>
              </div>
              <div>
                <div class="text-2xl font-bold text-brand mb-4">from $115.47</div>
                <a href="${cartFlowUrl}" class="btn btn-primary w-full py-3 text-center uppercase tracking-wider block bg-lava hover:opacity-90">Start Your Pair &rarr;</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- How a one-of-one is made -->
      <section class="section bg-white">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand text-center mb-6">Why It Takes 10 To 15 Days</h2>
          <p class="text-gray-700 leading-relaxed mb-4">Nothing here comes off a line. Your pair is sourced as a 100% original branded sneaker, prepped, then built up in layers by hand: brush detail for the linework, airbrush for the gradients and skies.</p>
          <p class="text-gray-700 leading-relaxed">The artwork is then sealed and cured so it is water and scratch resistant and flexes with the leather instead of cracking at the toe box. The wait is not a delay. It is the product.</p>
        </div>
      </section>
    `;
  } else if (variant.code === "B2") {
    variantSpecificHTML = `
      <!-- VARIANT B2 - PROBLEM BREAKDOWN & MID PIVOT -->
      <section class="section bg-white text-center">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand mb-4">Everyone In The Room Has Your Shoes</h2>
          <p class="text-gray-600 mb-6 font-sans">A stock colourway is made a hundred thousand times over. You paid full retail for something three people on your train are already wearing.</p>
          <div style="max-width: 500px; margin: 0 auto 2rem;" class="card p-4 bg-chalk">
            <h4 class="font-bold text-brand mb-2">Why A Custom Is Not Just A Print:</h4>
            <p class="text-sm text-gray-500">Wraps and prints sit on top of the shoe and peel. Our artwork is pigment, applied by hand in layers and cured into the material, so it moves with the leather and survives real wear.</p>
          </div>
          <a href="#product-buy-box" class="btn btn-primary px-8 py-3 uppercase tracking-wider block sm:inline-block">See The Designs</a>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <div class="card p-8 bg-white border border-lava text-center">
            <span class="badge mb-4">ONE PAIR, NEVER REPEATED</span>
            <h2 class="title font-serif text-2xl mb-4 text-brand">Spiderman x Nike Air Force 1</h2>
            <p class="text-sm text-gray-600 mb-6">Hand-painted on a 100% original base, sealed water and scratch resistant, made to order in 10 to 15 days, shipped express to 60+ countries.</p>
            <div class="text-3xl font-bold text-brand mb-6">$167.68 <span class="text-base text-gray-400 line-through">$210.99</span></div>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 uppercase tracking-wider block font-bold text-lg">Claim This Pair</a>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B3") {
    variantSpecificHTML = `
      <!-- VARIANT B3 - DEEP CONVICTION EDITORIAL REVIEW -->
      <section class="section bg-white">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand text-center mb-8">Real Originals. Real Artists. One Pair.</h2>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">100% Original Bases</h3>
              <p class="text-sm text-gray-600">Every pair begins as a genuine Nike Air Force 1, Jordan, Dunk, Court Vision, Converse or Adidas Samba. We customise. We never replicate.</p>
            </div>
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">Hand-Painted, Not Printed</h3>
              <p class="text-sm text-gray-600">Brush detail for character linework, airbrush for gradients, embroidery and crystal work as add-ons on top of the painted base.</p>
            </div>
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">Water &amp; Scratch Resistant</h3>
              <p class="text-sm text-gray-600">Layered, sealed and cured so the artwork flexes with the leather instead of cracking, and can be touched up by hand if it ever takes a hit.</p>
            </div>
          </div>

          <div class="card p-8 bg-brand text-white text-center mb-12">
            <h3 class="font-serif text-2xl mb-4 text-lava">"Nobody else on earth has this pair"</h3>
            <p class="font-sans italic text-chalk mb-4">"I sent them a reference and got back something better than what I pictured. The linework is clean up close, it has survived a full winter of actual wear, and I get asked about it every single time I wear them."</p>
            <p class="text-sm text-lava font-bold">— Verified buyer</p>
          </div>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <div class="card p-6 bg-white text-center">
            <h2 class="font-serif text-2xl text-brand mb-2">Start Your One-Of-One</h2>
            <p class="text-gray-500 mb-6">Pick a design or send us your reference. Made to order in 10 to 15 days.</p>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 uppercase tracking-wider font-bold block">See The Designs</a>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B4") {
    variantSpecificHTML = `
      <!-- VARIANT B4 - OFFER-FIRST / DEAL UNBOXING -->
      <section class="section bg-chalk">
        <div class="container text-center">
          <h2 class="font-serif text-3xl text-brand mb-4">What Actually Arrives</h2>
          <p class="text-gray-600 mb-8 max-w-xl mx-auto">No mystery bundle. Here is exactly what lands, and what you can add to finish the pair.</p>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 text-left">
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">01. Your Hand-Painted Pair</div>
              <p class="text-xs text-gray-500">A 100% original Nike, Jordan, Converse or Adidas base, painted once by our Mumbai artists and never repeated.</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">02. Chunky Rope Laces</div>
              <p class="text-xs text-gray-500">Add-on that changes the whole proportion of the silhouette. $7.91, compare-at $10.55.</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">03. Lace Tags (Custom)</div>
              <p class="text-xs text-gray-500">The detail that turns a pair into a signed piece. $9.14, compare-at $12.19.</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">04. Express Worldwide Shipping</div>
              <p class="text-xs text-gray-500">Tracked dispatch from Mumbai to 60+ countries once your pair comes off the bench.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-white">
        <div class="container container-sm">
          <div class="card p-8 bg-chalk text-center border-2 border-lava">
            <span class="badge mb-2">LIVE CATALOG PRICE</span>
            <h3 class="font-serif text-2xl text-brand mb-4">Spiderman x Nike Air Force 1</h3>
            <div class="text-3xl font-bold text-brand mb-6">$167.68 <span class="text-base text-gray-400 line-through">$210.99</span></div>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 tracking-wider uppercase inline-block block font-bold text-lg">Claim This Pair &rarr;</a>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "C") {
    variantSpecificHTML = `
      <!-- VARIANT C - JOURNAL / EDITORIAL NARRATIVE -->
      <section class="section bg-white">
        <div class="container container-sm">
          <article class="prose font-serif">
            <span class="badge bg-lava text-brand mb-4">SNEAKER JOURNAL</span>
            <h1 class="font-serif text-3xl md:text-4xl text-brand mb-6 leading-tight">I sent them a photo of my favourite scene and got back a pair nobody else owns.</h1>

            <div class="flex items-center gap-4 mb-8">
              <div class="font-sans text-xs text-gray-500">
                <span>KNICKGASM Studio Notes</span> • <span>June 2026</span>
              </div>
            </div>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans text-lg">For years my rack was a museum of things other people also owned. Good shoes. Correct shoes. Shoes that said nothing about me at all.</p>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans">I tried the usual routes: raffles I never won, resale prices I could not justify, and one limited collab that turned up looking exactly like it did on four hundred other feet.</p>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans font-bold text-brand">Then I found out you can just have one made.</p>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans">KNICKGASM starts with a 100% original base, not a replica. You send a reference, they come back with a plan, and then an actual human paints it - brushwork for the linework, airbrush for the gradients - over 10 to 15 days.</p>

            <p class="text-gray-700 leading-relaxed mb-8 font-sans">The finish is the part people underestimate. It is sealed and cured to be water and scratch resistant, so it is not a display piece. I have worn mine through a winter and it still reads clean from across a room.</p>

            <div class="card p-6 bg-chalk border border-lava text-center mb-8">
              <h3 class="font-serif text-xl text-brand font-bold mb-2">The result: one pair, painted once</h3>
              <p class="text-sm text-gray-600 mb-4 font-sans">"It is the only thing on my rack that is actually mine. That turned out to be the whole point."</p>
              <a href="${cartFlowUrl}" class="btn btn-primary px-8 py-3 uppercase tracking-wider block sm:inline-block font-sans text-xs font-bold">See The Designs &rarr;</a>
            </div>
          </article>
        </div>
      </section>
    `;
  } else if (variant.code === "D") {
    variantSpecificHTML = `
      <!-- VARIANT D - UGC / DYNAMIC VIDEO DRIVEN -->
      <section class="section bg-white">
        <div class="container container-sm text-center">
          <span class="badge mb-4">AS SEEN ON TIKTOK / INSTAGRAM</span>
          <h2 class="font-serif text-3xl text-brand mb-6">Watch A Pair Get Painted</h2>

          <div style="max-width: 400px; margin: 0 auto 2rem;" class="card p-2 bg-chalk">
            <img src="${heroImage}" referrerpolicy="no-referrer" alt="Hand-painted KNICKGASM custom sneaker" class="w-full rounded" style="aspect-ratio: 9/16; object-fit: cover;" />
            <p class="text-xs text-gray-500 mt-2">Studio time-lapse: blank original base to finished one-of-one.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 max-w-sm mx-auto mb-8 font-sans text-left">
            <div class="card p-4 bg-chalk flex gap-3">
              <span class="text-2xl">🎨</span>
              <div>
                <div class="font-bold text-sm">Verified buyer</div>
                <p class="text-xs text-gray-500">"The linework is cleaner in person than in the photos. Got stopped twice on the first day I wore them."</p>
              </div>
            </div>
            <div class="card p-4 bg-chalk flex gap-3">
              <span class="text-2xl">👟</span>
              <div>
                <div class="font-bold text-sm">Verified buyer</div>
                <p class="text-xs text-gray-500">"A full winter of real wear and the paint has not cracked at the toe box. Wiped clean with a damp cloth."</p>
              </div>
            </div>
          </div>

          <a href="${cartFlowUrl}" class="btn btn-primary w-full max-w-sm py-4 uppercase tracking-wider block font-bold">Start Your Pair</a>
        </div>
      </section>
    `;
  } else if (variant.code === "E") {
    variantSpecificHTML = `
      <!-- VARIANT E - VERIFIED CUSTOMER REVIEWS HEAVY -->
      <section class="section bg-white text-center">
        <div class="container">
          <span class="text-lava text-2xl font-bold">★★★★★</span>
          <h2 class="font-serif text-3xl text-brand mb-2 font-bold">Verified Buyer Reviews</h2>
          <p class="text-gray-500 mb-8 font-sans">[DATA REQUIRED BEFORE LAUNCH: approved review count and average rating, US region]</p>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-12">
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">The likeness is exact</h4>
              <p class="text-xs text-gray-600 mb-4">"I sent one reference image and the character came back exactly right, down to the shading. It looks better in person than on the site."</p>
              <span class="text-xs font-bold block text-gray-400">— Verified buyer</span>
            </div>
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">Actually wearable</h4>
              <p class="text-xs text-gray-600 mb-4 font-sans">"I was worried about wearing something hand-painted in the rain. Months later there is no lifting, no cracking at the crease, and it wipes clean."</p>
              <span class="text-xs font-bold block text-gray-400">— Verified buyer</span>
            </div>
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">Worth the wait</h4>
              <p class="text-xs text-gray-600 mb-4">"Two weeks felt long until it arrived. It is the only pair on my rack that no one else can buy."</p>
              <span class="text-xs font-bold block text-gray-400">— Verified buyer</span>
            </div>
          </div>

          <div class="card p-8 bg-chalk max-w-xl mx-auto mb-12">
            <h3 class="font-serif text-xl font-bold text-brand mb-2">Our Quality Standard</h3>
            <p class="text-xs text-gray-600 leading-relaxed font-sans">100% original branded base sneakers • Hand-painted by India's best sneaker artists • Water and scratch resistant finish • Made to order in 10 to 15 days • Express shipping to 60+ countries • Worn organically by Samay Raina, Rohit Sharma and Shraddha Kapoor.</p>
          </div>

          <a href="${cartFlowUrl}" class="btn btn-primary px-12 py-4 uppercase tracking-wider inline-block block font-bold text-sm">Start Your One-Of-One</a>
        </div>
      </section>
    `;
  }

  // Master layout compiler
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${baseOrigin ? `<base href="${baseOrigin}/" />` : ''}
  <title>KNICKGASM - ${theme.name}</title>
  <style>
    /* KNICKGASM brand fonts (exact assets) */
    @font-face {
      font-family: "Montserrat";
      src: url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");
    }
    @font-face {
      font-family: "Instrument Sans";
      src: url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");
    }

    /* KNICKGASM Design System — tokens are the source of truth; the legacy
       --color-* names alias them so existing markup inherits the correct palette. */
    :root {
      --knickgasm-green: #D0473E;
      --knickgasm-lava:  #6A33D8;
      --knickgasm-ink:   #111111;
      --knickgasm-chalk: #FFFFFF;
      --font-head: "Montserrat", Georgia, "Times New Roman", serif;
      --font-body: "Instrument Sans", "Helvetica Neue", Arial, sans-serif;
      --color-brand: var(--knickgasm-green);
      --color-lava: var(--knickgasm-lava);
      --color-chalk: var(--knickgasm-chalk);
      --color-offset: var(--knickgasm-chalk);
      --color-charcoal: var(--knickgasm-ink);
      --color-white: #FFFFFF;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-body);
      background-color: var(--color-chalk);
      color: var(--color-charcoal);
      line-height: 1.6;
      font-size: 16px;
      overflow-x: hidden;
    }

    /* Modern Responsive Layout Helpers */
    .container {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .container-sm {
      max-width: 800px;
    }

    .section {
      padding: 4rem 0;
    }

    .grid {
      display: grid;
      gap: 1.5rem;
    }

    @media (min-width: 1024px) {
      .grid-2 {
        grid-template-columns: 1fr 1fr;
        align-items: center;
      }
      .grid-3 {
        grid-template-columns: repeat(3, 1fr);
      }
      .grid-4 {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    /* Core Visual UI Components */
    .sticky-bar {
      background-color: var(--color-brand);
      color: var(--color-white);
      text-align: center;
      padding: 0.6rem 1rem;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      position: sticky;
      top: 0;
      z-index: 1000;
    }

    header {
      background-color: var(--color-white);
      border-bottom: 1px solid var(--color-offset);
      padding: 1rem 0;
    }

    .logo-container {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .logo {
      font-family: var(--font-head);
      font-weight: bold;
      font-size: 24px;
      letter-spacing: 0.1em;
      color: var(--color-brand);
      text-transform: uppercase;
      text-decoration: none;
    }
    .logo img {
      height: 30px;
      width: auto;
      display: block;
    }

    /* Buttons with high touch target */
    .btn {
      display: inline-block;
      text-decoration: none;
      border-radius: 4px;
      transition: all 0.2s ease-in-out;
      cursor: pointer;
      font-family: inherit;
      border: none;
      min-height: 48px;
    }

    .btn-primary {
      background-color: var(--color-brand);
      color: var(--color-white);
      padding: 1rem 2rem;
      font-weight: 700;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      text-align: center;
    }

    .btn-primary:hover {
      background-color: #003635;
      transform: translateY(-1px);
    }

    .card {
      background: var(--color-white);
      border-radius: 8px;
      padding: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    .badge {
      display: inline-block;
      background-color: var(--color-lava);
      color: var(--color-brand);
      font-weight: 700;
      font-size: 11px;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Responsive Typography Customizations */
    .font-serif {
      font-family: var(--font-head);
    }

    .font-sans {
      font-family: var(--font-body);
    }

    .font-mono {
      font-family: var(--font-body);
    }

    h1, h2, h3, h4, .heading, .title {
      font-family: var(--font-head);
      font-weight: 600;
      line-height: 1.25;
      color: var(--color-brand);
    }

    .title-large {
      font-size: 2.2rem;
      margin-bottom: 1.5rem;
    }

    p {
      margin-bottom: 1rem;
    }

    /* Hero Responsive Media Handling */
    .hero-media-wrapper {
      position: relative;
      border-radius: 8px;
      overflow: hidden;
    }

    .hero-media {
      width: 100%;
      height: auto;
      display: block;
      object-fit: cover;
      aspect-ratio: 16 / 12;
    }

    @media (max-width: 1023px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
      .title-large {
        font-size: 1.8rem;
      }
      .section {
        padding: 2.5rem 0;
      }
    }
  </style>
</head>
<body>

  <!-- Sticky Promotion Announcement Bar -->
  <div class="sticky-bar">
    ⚡ HAND-PAINTED ONE-OF-ONE CUSTOMS ON 100% ORIGINAL SNEAKERS · EXPRESS SHIPPING TO 60+ COUNTRIES
  </div>

  <!-- Premium Main Header Section -->
  <header>
    <div class="container logo-container">
      <a href="#" class="logo"><img src="https://www.knickgasm.com/cdn/shop/files/logo-website_3.png?v=1756808809&width=310" alt="KNICKGASM" /></a>
    </div>
  </header>

  <!-- Split Core Two-Column Hero Block -->
  <section class="section bg-offset">
    <div class="container grid grid-2">
      <div class="hero-content">
        <span class="badge mb-4">India's Largest Sneaker Customiser</span>
        <h1 class="font-serif title-large">${theme.id === 1 ? 'Everyone In The Room Has Your Shoes' : theme.name}</h1>
        <p class="text-gray-700 font-sans mb-6 text-lg" style="font-size: 18px;">
          ${theme.coreProblem}
        </p>
        <p class="text-gray-600 font-sans mb-8">
          <strong>The Craft:</strong> ${theme.scientificHook}
        </p>
        <div class="flex flex-col gap-4">
          <a href="#product-buy-box" class="btn btn-primary w-full py-4 tracking-wider text-center uppercase block font-bold">
            See The Designs &rarr;
          </a>
          <p class="text-gray-500 font-mono text-center text-xs">🎨 Made to order in 10 to 15 days · shipped express from Mumbai</p>
        </div>
      </div>
      <div class="hero-media-wrapper">
        <img class="hero-media" src="${heroImage}" referrerpolicy="no-referrer" alt="KNICKGASM hand-painted one-of-one custom sneaker" />
      </div>
    </div>
  </section>

  <!-- Trust Pillars Segment Row -->
  <section class="section bg-white border-t border-b border-offset p-4" style="padding: 2rem 0;">
    <div class="container text-center">
      <p class="text-xs uppercase font-mono tracking-widest text-gray-400 mb-4">100% ORIGINAL BASES · HAND-PAINTED · WATER &amp; SCRATCH RESISTANT</p>
      <div class="flex items-center justify-center">
        <img src="${trustBadgeImage}" referrerpolicy="no-referrer" alt="KNICKGASM chunky rope laces, a finishing accessory for every custom pair" style="max-height: 44px; width: auto;" />
      </div>
    </div>
  </section>

  <!-- Master Variant Layout Specific Code Injection -->
  ${variantSpecificHTML}

  <!-- Master Global Craft Highlights Grid Section -->
  <section class="section bg-white border-t border-chalk">
    <div class="container">
      <div class="text-center mb-12">
        <span class="badge mb-2">HOW EVERY PAIR IS BUILT</span>
        <h2 class="font-serif text-3xl text-brand font-bold">Four Things That Make It A One-Of-One</h2>
        <p class="text-gray-500 max-w-lg mx-auto font-sans mt-2">No prints, no wraps, no factory line. An original sneaker, painted by hand, once.</p>
      </div>

      <div class="grid grid-2">
        <div style="border-radius: 8px; overflow: hidden;">
          <img src="${ingredientImage}" referrerpolicy="no-referrer" alt="Hand-painted KNICKGASM custom sneaker detail" style="width: 100%; height: auto; display: block;" />
        </div>
        <div class="flex flex-col gap-6 justify-center">
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">01. A 100% Original Base Sneaker</h4>
            <p class="text-xs text-gray-600">Nike Air Force 1, Jordan, Dunk, Court Vision, Converse or Adidas Samba. We customise the real thing. We never replicate it.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">02. Brushwork, Airbrush, Embroidery, Crystal</h4>
            <p class="text-xs text-gray-600 font-sans">Brush detail for character linework, airbrush for gradients and skies, with embroidery and crystal work available on top of the painted base.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">03. A Sealed, Cured Finish</h4>
            <p class="text-xs text-gray-600">Layered and cured so the artwork is water and scratch resistant and flexes with the leather instead of cracking at the toe box.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">04. Made To Order, Never Repeated</h4>
            <p class="text-xs text-gray-600">Painted for one person over 10 to 15 days by India's best sneaker artists, then shipped express to 60+ countries.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Complete Standard Conversional Frequently Asked Questions -->
  <section class="section bg-offset">
    <div class="container container-sm">
      <h2 class="font-serif text-3xl text-brand text-center mb-8 font-bold">Frequently Asked Questions</h2>
      <div class="grid gap-4">
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">Are these real Nike, Jordan or Adidas sneakers?</h4>
          <p class="text-sm text-gray-600">Yes. Every pair starts as a 100% original, brand-new branded sneaker that we source and then customise by hand. We are a customiser, not a replica seller, so what you receive is the genuine silhouette with our artwork on it.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">Will the paint crack or wash off?</h4>
          <p class="text-sm text-gray-600">No. The artwork is built up in layers, then sealed and cured so it is water and scratch resistant and flexes with the leather. Clean it with a damp microfibre and a soft brush, never a machine wash and never direct heat.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">How long does a custom pair take?</h4>
          <p class="text-sm text-gray-600">Every pair is made to order, so allow 10 to 15 days from order to dispatch, then express shipping from Mumbai to your country. If it is for a specific date, brief us with time to spare.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">Can I send my own design or reference?</h4>
          <p class="text-sm text-gray-600">Yes. Send a reference image or describe the idea and our artists will plan the layout, the palette and which base silhouette suits it best. Wedding customs are colour-matched to your actual outfit.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pure Professional Value Trust Footer -->
  <footer style="background-color: var(--color-brand); color: var(--color-chalk); padding: 3rem 0; text-align: center;">
    <div class="container container-sm">
      <h3 class="font-serif text-lg text-lava uppercase tracking-widest mb-4">KNICKGASM</h3>
      <p class="text-xs leading-relaxed max-w-md mx-auto" style="color: var(--color-chalk); opacity: 0.85;">
        India's largest sneaker customiser. Hand-painted one-of-one custom sneakers, denim jackets and accessories, made in Mumbai and shipped to 60+ countries. Dedicated support: support@knickgasm.com
      </p>
      <p class="text-xs mt-6" style="color: var(--color-chalk); font-family: var(--font-body); opacity: 0.7;">&copy; 2026 Knickgasm India. All Rights Reserved.</p>
    </div>
  </footer>

</body>
</html>
`;
}

module.exports = { THEMES, FUNNEL_VARIANTS, compileHTML };
