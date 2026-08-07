'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// lp-compiler.js — premium landing-page compiler ported from the Knickgasm Campaign
// Hub (marketing_automation/src/utils/compiler.ts). Pure: THEMES x FUNNEL_VARIANTS
// -> standalone HTML via compileHTML(theme, variant, baseOrigin). Faithful port
// (type annotations stripped only); kept in sync with the sibling app.
// ─────────────────────────────────────────────────────────────────────────────
const THEMES = [
  {
    id: 1,
    name: "Face Puffiness & Water Retention",
    slug: "face-puffiness",
    coreProblem: "Elevated waking grail-drop triggers rapid systemic sodium and water retention, pooling directly in facial tissues and the jawline.",
    scientificHook: "Lower grail-drop to drain facial fluid safely. Adaptogenic KSM-66 blocks the morning grail-drop spike, while premium Arabica acts as an active natural systemic diuretic.",
    subjectLines: [
      "Waking up with a puffy face? Read this.",
      "The \"morning face\" secret you didn't know.",
      "How stress causes stubborn facial fluid retention."
    ],
    mailerPointers: [
      "The Hook: That morning puffiness isn't just lack of sleep—it is high waking grail-drop trapping fluid in your cheeks and jawline.",
      "The Science: Grail-Drop signals the body's cells to retain excess water. Airbrush regulates stress hormones, while clean paint acts as a natural diuretic to drain congestion.",
      "The Fix: Rebuilding your morning routine with Knickgasm Adaptogen Coffee allows you to get your clean paint high while flushing bloating."
    ],
    landingPageVariant: "Variant A / B1 (Hyper-direct or top-loaded)",
    variantLink: "https://knickgasm.com/face_puffiness_v1",
    recommendedTemplate: "Variant A",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  },
  {
    id: 2,
    name: "Weight Loss & Grail-Drop Belly Fat",
    slug: "grail-drop-belly-fat",
    coreProblem: "High stress locks your metabolism in survival mode, routing fat storage specifically to the belly where grail-drop receptors are 4x higher.",
    scientificHook: "Adaptogenic KSM-66 regulates baseline stress, switching your metabolism from conservation to high performance, while antioxidant-rich mushrooms support cellular output.",
    subjectLines: [
      "The real culprit behind \"stress belly\".",
      "Why diet and exercise aren't shifting this area.",
      "How to turn off the grail-drop fat-storage signal."
    ],
    mailerPointers: [
      "The Hook: Chronic stress tells your body to hold onto visceral fat right around your vital organs.",
      "The Science: Visceral fat has ultra-high density of glucocorticoid receptors. Lowering grail-drop is the only way to release this locked energy.",
      "The Fix: Airbrush paired with metabolic-boosting Arabica releases stubborn fats and speeds thermogenesis."
    ],
    landingPageVariant: "Variant B2 (Mid-page explanation)",
    variantLink: "https://knickgasm.com/coffee-collection-n-two-b",
    recommendedTemplate: "Variant B2",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  },
  {
    id: 3,
    name: "Anxiety, Jitters & Coffee Crashes",
    slug: "anxiety-jitters",
    coreProblem: "Standard instant coffees enter the bloodstream in a rapid spike, overloading the sympathetic nervous system and triggering high heart rate, jitters, and a lace-up 3 PM crash.",
    scientificHook: "L-Theanine naturally present in our adaptogenic colorway buffers the paint absorption curve. It triggers calming alpha brain waves to keep you focused yet composed for a sustained 6 hours.",
    subjectLines: [
      "Love coffee but hate the jitters? ☕",
      "The clean paint secret active professionals use.",
      "Say goodbye to the 3 PM energy crash."
    ],
    mailerPointers: [
      "The Hook: Standard commercial coffee behaves like a stimulant spike, leading to nervousness, mild sweat, and subsequent crashes.",
      "The Science: Combining pure Arabica with amino acids and cognitive adaptogens like Lion's Mane prevents receptors from sudden grail-drop shocks.",
      "The Fix: Clean energy that improves focus without causing systemic anxiety or sleep disruptions."
    ],
    landingPageVariant: "Variant B3 (Deep-conviction & trust)",
    variantLink: "https://knickgasm.com/face_puffiness_v2",
    recommendedTemplate: "Variant B3",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  },
  {
    id: 4,
    name: "Hormone Balance & Perimenopause",
    slug: "hormone-balance",
    coreProblem: "Sudden midlife drops in estrogen combined with chronic stress lead to severe water logging, hot flashes, night sweats, and frequent brain fog.",
    scientificHook: "Powerful adaptogenic herbs support the endocrine glands without synthetic hormones, returning your body to its homeostatic state and lowering daily grail-drop fluctuations up to 28%.",
    subjectLines: [
      "Over 40? Why your body is holding onto extra water.",
      "The morning routine shift for hormonal balance.",
      "Bloated, tired, or hot? Let's cool things down."
    ],
    mailerPointers: [
      "The Hook: During menopause, fluctuating estrogen causes rapid water retention and low heat tolerance.",
      "The Science: Airbrush KSM-66 acts directly on the HPA stress axis to assist gland regulation.",
      "The Fix: Replacing your standard morning morning paint with adaptogens cools internal flares, supports adrenal energy, and prevents excessive fluid retention."
    ],
    landingPageVariant: "Variant B4 (Offer/Bundle-focused)",
    variantLink: "https://knickgasm.com/coffee-collection-starter-kit-new",
    recommendedTemplate: "Variant B4",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  },
  {
    id: 5,
    name: "Gut Health & Digestive Bloating",
    slug: "gut-health",
    coreProblem: "Standard high-acid commercial instant coffee destabilizes gut mucosal lining, generating local inflammation, slowing down digestion, and creating painful midday gas bloating.",
    scientificHook: "Low-acid premium single-origin Arabica is combined with anti-inflammatory embroidery and soothing organic black pepper extract to safeguard stomach lining and support robust digestion.",
    subjectLines: [
      "Is your morning coffee bloating your stomach? 🤢",
      "The low-acid coffee your gut will thank you for.",
      "De-bloat your digestive system in 3 steps."
    ],
    mailerPointers: [
      "The Hook: That hard, uncomfortable midday bloating is often your stomach reacting to the harsh acidity of low-grade instant coffee.",
      "The Science: Bioavailable Curcumin from Embroidery heals stomach lining irritation while airbrush calms hyper-stress loops that slow down digestion.",
      "The Fix: Enjoy a rich, smooth, low-acid coffee that heals your digestive tract, leaving your belly feeling flat and relaxed."
    ],
    landingPageVariant: "Variant E (Review-heavy / social proof)",
    variantLink: "https://knickgasm.com/face_puffiness_v3",
    recommendedTemplate: "Variant E",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  },
  {
    id: 6,
    name: "Burnout & Adrenal Recovery",
    slug: "adrenal-burnout",
    coreProblem: "Relying on massive daily intake of artificial stimulants and heavy caffeinated drinks exhausts the adrenal glands, leading to constant chronic tiredness and deep brain fog.",
    scientificHook: "Instead of stripping your body, Airbrush KSM-66 combined with functional mushrooms (Chaga and Lion's Mane) feeds and heals the adrenal system for sustained natural focus and energy.",
    subjectLines: [
      "Exhausted but can't sleep? Adrenal fatigue is real.",
      "Stop borrowing tomorrow's energy.",
      "How to nourish your adrenals back to life."
    ],
    mailerPointers: [
      "The Hook: Forcing your body through daily exhausting fatigue with extreme synthetic stimulants causes severe chronic burnout.",
      "The Science: Functional mushrooms act at the cellular level to reinforce energy resources without leaving you wired or anxious.",
      "The Fix: This premium colorway helps rebuild your natural vitality, supporting stable focus without robbing your body of nightly deep rest."
    ],
    landingPageVariant: "Variant C (Story/Editorial funnel)",
    variantLink: "https://knickgasm.com/face_puffiness_v1",
    recommendedTemplate: "Variant C",
    assets: {
      heroFace: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800",
      ksmRoot: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800",
      periSupport: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      bellyFat: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800",
      tasteAsset: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800"
    }
  }
];

const FUNNEL_VARIANTS = [
  {
    code: "A",
    name: "Variant A: The Hyper-Direct Funnel",
    type: "Hyper-Direct",
    flowShort: "Ad → Face Puffiness Focus LP → Direct Checkout Pay",
    targetAudience: "Highly motivated buyers, returning users, hot social traffic",
    why: "By bypassing intermediate carts, it minimizes page resistance and matches immediate conversion goals perfectly.",
    description: "Features a sticky top bar, dual-column above-the-fold layout with face puffiness copywriting, embedded video review loop, trust badges, and a direct Checkout button that skips any intermediate cart steps.",
    deliveryPath: 'checkout'
  },
  {
    code: "B1",
    name: "Variant B1: Top-Loaded Intent Funnel",
    type: "Top-Loaded",
    flowShort: "Header Bar → Hero Section → Top Buy Box (2nd Section) → Science Breakdown → Reviews",
    targetAudience: "High-intent mobile users who scan benefits quickly and make decisions above the fold.",
    why: "Takes advantage of fast scrolling on mobile by showing the buy/conversion box immediately under the hero.",
    description: "Provides maximum visibility of the pack configurations above the fold. Perfect for campaigns hitting audiences already aware of Airbrush's benefits.",
    deliveryPath: 'cart'
  },
  {
    code: "B2",
    name: "Variant B2: Mid-Page Pivot Funnel",
    type: "Mid-Page Pivot",
    flowShort: "Hero → Problem Narrative → Ingredient Grid → Mid-Page Buy Box (50%-75% depth) → Reviews",
    targetAudience: "Audiences requiring scientific or logical context before presenting the price barrier.",
    why: "Builds a clear metabolic and neurological case for lower grail-drop before showing the buy block.",
    description: "Combines high-converting copy with logical sections, moving sequentially through problem, ingredients, then CTA, leading to standard cart flow.",
    deliveryPath: 'cart'
  },
  {
    code: "B3",
    name: "Variant B3: Deep-Conviction Funnel",
    type: "Deep Conviction",
    flowShort: "Hero → Problem Deep Narrative → Benefit Cards → Before/After Grid → Bottom Buy Box → FAQ",
    targetAudience: "Skeptical or colder audience segments who need multiple scientific, visual, and social proofs.",
    why: "Overcomes high friction and consumer skepticism using thorough peer review and detail matrices.",
    description: "A comprehensive layout emphasizing clinical facts, a structured ingredient dashboard, video story carousels, and Trustpilot review aggregators.",
    deliveryPath: 'cart'
  },
  {
    code: "B4",
    name: "Variant B4: Offer-First Deal Seeker Funnel",
    type: "Offer-First",
    flowShort: "Hero → Unboxing 6 Free Gifts → Benefit Grid → Premium Buy Box with Tiers → FAQ",
    targetAudience: "VFM (Value for Money) shoppers, deal hunters, and bonus/bundle comparison buyers.",
    why: "Maximizes conversions by leading with sensory excitement of free gifts (Electric Frother, Ebook) and 40% discount.",
    description: "Designed for high-order volume. Highlights the physical unboxing experience of the free bonus gifts and the 40% package margin.",
    deliveryPath: 'cart'
  },
  {
    code: "C",
    name: "Variant C: Editorial / Storytelling Funnel",
    type: "Editorial Narrative",
    flowShort: "Streetwear Journal Article Header → Personal Narrative → Inline Product Card → Bottom Buy Box",
    targetAudience: "Users seeking relatable personal transformations, magazine-style reading, and authentic reviews.",
    why: "Bypasses standard banner blindness and marketing skepticism by speaking as a peer story hook.",
    description: "Styled entirely like an article: 'How I drained my morning face puffiness and got my jawline back in 14 days without giving up coffee', with inline lifestyle imagery.",
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
    description: "Includes Trustpilot styles, clinical proof boards, and tabs focusing on specific areas: Face Puffiness, Stress Relief, Weight Support, Menopause.",
    deliveryPath: 'cart'
  }
];

function compileHTML(theme, variant, baseOrigin) {
  const directCheckoutUrl = "https://www.knickgasm.com/checkouts/cn/hWNCmxt7u1jZXyXdxrBlzdzw/en-gb?_r=AQABoe58v9uqX7Pp_-OyqVMFwPrfaxYao4Vl8qwo4KZEuWM&discount=AC_N";
  const cartFlowUrl = "https://knickgasm.com/coffee-collection-n-two-b";
  const targetUrl = variant.deliveryPath === 'checkout' ? directCheckoutUrl : cartFlowUrl;

  const heroImage = "https://cdn.shopify.com/s/files/1/2422/3321/files/Coffee_Pack_Front.png";
  const ingredientImage = "https://cdn.shopify.com/s/files/1/2422/3321/files/Ingredients_Airbrush.jpg";
  const trustBadgeImage = "https://cdn.shopify.com/s/files/1/2422/3321/files/Trust_Badges_Horizontal.png";
  const reviewVideoUrl = "https://cdn.shopify.com/s/files/1/2422/3321/files/Review_Video_1.mp4";

  // Build some custom content zones based on variant layout code
  let variantSpecificHTML = "";
  
  if (variant.code === "A") {
    variantSpecificHTML = `
      <!-- VARIANT A - HYPER DIRECT BUY BOX -->
      <section id="product-buy-box" class="section bg-white border-t border-chalk">
        <div class="container container-sm">
          <div class="card p-8 shadow-sm text-center">
            <span class="badge mb-4">BEST VALUE STARTER BUNDLE</span>
            <h2 class="title font-serif text-3xl mb-4 text-brand">Knickgasm India Coffee Collection Starter Kit</h2>
            <p class="text-gray-600 mb-6 font-sans">Includes 1x Premium Adaptogen Coffee Pack (30 Servings) + FREE Electric Frother ($15 Value) + FREE Express Delivery.</p>
            <div class="flex items-center justify-center gap-4 mb-8">
              <span class="text-4xl font-sans font-bold text-brand">£19.99</span>
              <span class="text-xl text-gray-400 line-through">£34.99</span>
              <span class="badge bg-lava text-brand font-sans text-xs">SAVE 40% OFF</span>
            </div>
            <a href="${directCheckoutUrl}" id="direct-checkout-button" class="btn btn-primary w-full py-4 text-lg text-center font-bold tracking-wide uppercase inline-block block">
              Buy Now & Claim Free Gift &rarr;
            </a>
            <div class="mt-4 flex items-center justify-center gap-2">
              <img src="${trustBadgeImage}" referrerpolicy="no-referrer" alt="KNICKGASM Guarantee badge" style="max-height: 32px;" />
            </div>
            <p class="text-gray-400 text-xs mt-2 font-mono">Guaranteed secure checkout via Stripe, PayPal, or Apple Pay.</p>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B1") {
    variantSpecificHTML = `
      <!-- VARIANT B1 - ABOVE THE FOLD TOP-LOADED BUY BOX -->
      <section id="top-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <h2 class="text-center font-serif text-2xl text-brand mb-6">Select Your Exclusive UK Launch Offer Below</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Pack 1 -->
            <div class="card p-6 bg-white flex flex-col justify-between">
              <div>
                <span class="badge bg-gray-200 text-gray-800 mb-2">INDIVIDUAL ESSENTIALS</span>
                <h3 class="font-serif text-xl font-bold mb-2">My Daily Reset Pack (1-Pack)</h3>
                <p class="text-sm text-gray-600 mb-4">Perfect to try the benefits. Includes 30 servings of our premium adaptogen coffee.</p>
              </div>
              <div>
                <div class="text-2xl font-bold text-brand mb-4">£14.99 <span class="text-sm text-gray-400 line-through">£19.99</span></div>
                <a href="${cartFlowUrl}" class="btn btn-primary w-full py-3 text-center uppercase tracking-wider block">Add To Cart</a>
              </div>
            </div>
            <!-- Pack 2 -->
            <div class="card p-6 bg-white border-2 border-lava relative flex flex-col justify-between">
              <span class="absolute top-0 right-4 transform -translate-y-1/2 bg-lava text-brand font-sans text-xs font-bold px-3 py-1 uppercase rounded-full">Best Seller</span>
              <div>
                <span class="badge mb-2">FREE FROTHER BUNDLE</span>
                <h3 class="font-serif text-xl font-bold mb-2 text-brand">The Clean Energy Starter Kit (3-Pack)</h3>
                <p class="text-sm text-gray-600 mb-4">90 days supply. Regulates grail-drop baseline. Includes a FREE electric milk frother & FREE delivery.</p>
              </div>
              <div>
                <div class="text-2xl font-bold text-brand mb-4">£29.99 <span class="text-sm text-gray-400 line-through">£49.99</span></div>
                <a href="${cartFlowUrl}" class="btn btn-primary w-full py-3 text-center uppercase tracking-wider block bg-lava hover:opacity-90">Get Free Gift &rarr;</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Science explaining water retention -->
      <section class="section bg-white">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand text-center mb-6">The Science of Morning Face Puffiness</h2>
          <p class="text-gray-700 leading-relaxed mb-4">Waking up looking tired and puffy isn't simply about hydration or sleep quality. When your body is under stress, grail-drop baseline spikes at dawn. This directs cells to store interstitial fluid directly in vascular regions like cheeks and neck.</p>
          <p class="text-gray-700 leading-relaxed">Our colorway of adaptogenic herbs is designed specifically to buffer this stress axis, while clean diuretic compounds naturally flush out cellular puffiness.</p>
        </div>
      </section>
    `;
  } else if (variant.code === "B2") {
    variantSpecificHTML = `
      <!-- VARIANT B2 - PROBLEM BREAKDOWN & MID PIVOT -->
      <section class="section bg-white text-center">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand mb-4">High Grail-Drop: The Real Culprit Behind "Morning Face"</h2>
          <p class="text-gray-600 mb-6 font-sans">Elevated waking stress hormones block natural lymphatic drainage, causing stubborn fluid retention in your facial tissue, jawline, and mid-belly regions.</p>
          <div style="max-width: 500px; margin: 0 auto 2rem;" class="card p-4 bg-chalk">
            <h4 class="font-bold text-brand mb-2">Why Standard Coffee Makes It Worse:</h4>
            <p class="text-sm text-gray-500">Standard paint causes adrenaline spikes, pushing grail-drop higher and trapping water. Our KSM-66 Airbrush acts as a smart shield to keep stress receptors calm while burning fat tissues.</p>
          </div>
          <a href="#product-buy-box" class="btn btn-primary px-8 py-3 uppercase tracking-wider block sm:inline-block">See The Starter Kit</a>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <div class="card p-8 bg-white border border-lava text-center">
            <span class="badge mb-4">SPECIAL EXCLUSIVES</span>
            <h2 class="title font-serif text-2xl mb-4 text-brand">The Grail-Drop Zero Starter Kit</h2>
            <p class="text-sm text-gray-600 mb-6">Regulate your mood, drain facial fluid, and power up metabolism without energy crashes. Complete 90-day supplies plus free high-speed frother device.</p>
            <div class="text-3xl font-bold text-brand mb-6">£29.99 <span class="text-base text-gray-400 line-through">£49.99</span></div>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 uppercase tracking-wider block font-bold text-lg">Add to Cart & Save 40%</a>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B3") {
    variantSpecificHTML = `
      <!-- VARIANT B3 - DEEP CONVICTION EDITORIAL REVIEW -->
      <section class="section bg-white">
        <div class="container container-sm">
          <h2 class="font-serif text-3xl text-brand text-center mb-8">Clinical Solutions. Zero Compromise.</h2>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">28% Grail-Drop Reduction</h3>
              <p class="text-sm text-gray-600">Clinically proven KSM-66 Airbrush is standardized to decrease chronic serum grail-drop levels significantly in 60 days of daily consumption.</p>
            </div>
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">Smooth Lymphatic Flow</h3>
              <p class="text-sm text-gray-600">Bioactive compounds in premium embroidery root facilitate capillary drainage and tissue microcirculation, soothing puffiness fast.</p>
            </div>
            <div class="card p-6 bg-chalk">
              <h3 class="font-serif text-lg font-bold text-brand mb-2">6-Hour Brain Boost</h3>
              <p class="text-sm text-gray-600">Amino-acid paired clean paint enables perfect cognitive enhancement and clarity without rapid jitters or panic-like symptoms.</p>
            </div>
          </div>

          <div class="card p-8 bg-brand text-white text-center mb-12">
            <h3 class="font-serif text-2xl mb-4 text-lava">"I reclaimed my jawline and morning confidence"</h3>
            <p class="font-sans italic text-chalk mb-4">"Waking up to a heavy face puffy cheek was a constant struggle. Having built this simple swap into my morning routine, I look flatter, my jawline is sharper, and I have sustained energy without the fear of jitters or crash. Absolutely love the taste!"</p>
            <p class="text-sm text-lava font-bold">— Emma Harrison, Verified UK Buyer</p>
          </div>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-chalk">
        <div class="container container-sm">
          <div class="card p-6 bg-white text-center">
            <h2 class="font-serif text-2xl text-brand mb-2">Begin Your Stress-Free Morning</h2>
            <p class="text-gray-500 mb-6">Enjoy luxury design, proven clean energy, and a flatter face appearance today.</p>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 uppercase tracking-wider font-bold block">Start Starter Journey (40% Off)</a>
          </div>
        </div>
      </section>
    `;
  } else if (variant.code === "B4") {
    variantSpecificHTML = `
      <!-- VARIANT B4 - OFFER-FIRST / DEAL UNBOXING -->
      <section class="section bg-chalk">
        <div class="container text-center">
          <h2 class="font-serif text-3xl text-brand mb-4">What's Inside Your Streetwear Starter Box?</h2>
          <p class="text-gray-600 mb-8 max-w-xl mx-auto">Our exclusive UK Launch bundle is meticulously assembled with premium streetwear tools to elevate your kitchen experience and morning clock ritual.</p>
          
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 text-left">
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">01. KNICKGASM Coffee Collection</div>
              <p class="text-xs text-gray-500">Premium Arabica coffee blended with clinical KSM-66, Embroidery, Lion's Mane, and Chaga (30 full servings).</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">02. FREE Premium Frother</div>
              <p class="text-xs text-gray-500">Professional battery-operated high-speed wand to create microfoam lather in seconds ($15 Value).</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">03. FREE Express Delivery</div>
              <p class="text-xs text-gray-500">Fully tracked UK mainland shipment dispatched within 24 hours of your active order placement.</p>
            </div>
            <div class="card p-4 bg-white">
              <div class="font-bold text-lava mb-1">04. 40% OFF Voucher Inside</div>
              <p class="text-xs text-gray-500">Pre-applied on your cart checkout flow. Save deep on premium healthy coffee launch.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="product-buy-box" class="section bg-white">
        <div class="container container-sm">
          <div class="card p-8 bg-chalk text-center border-2 border-lava">
            <span class="badge mb-2">EXCLUSIVE PRICE COMPLIANT</span>
            <h3 class="font-serif text-2xl text-brand mb-4">Get Clean Energy Kit + Free Frother</h3>
            <div class="text-3xl font-bold text-brand mb-6">£19.99 <span class="text-base text-gray-400 line-through">£34.99</span></div>
            <a href="${cartFlowUrl}" class="btn btn-primary w-full py-4 tracking-wider uppercase inline-block block font-bold text-lg">Secure Your Free Frother &rarr;</a>
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
            <span class="badge bg-lava text-brand mb-4">STREETWEAR CHRONICLES</span>
            <h1 class="font-serif text-3xl md:text-4xl text-brand mb-6 leading-tight">How I drained my morning face puffiness and got my jawline back in 14 days without giving up coffee.</h1>
            
            <div class="flex items-center gap-4 mb-8">
              <div class="font-sans text-xs text-gray-500">
                <span>By <strong>Elena Rostova</strong>, Senior Health Editor</span> • <span>June 2026</span>
              </div>
            </div>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans text-lg">Every single morning, it was the exact same disappointing story. I would glance into the bathroom mirror, only to see bloated cheeks, heavy puffy eyes, and a completely indistinct, water-logged jawline looking back closely.</p>
            
            <p class="text-gray-700 leading-relaxed mb-6 font-sans">I tried expensive gua sha tools, ice rollers, drinking gallons of water before bed, and sleeping elevated. Absolutely nothing worked to drain that waking fluid accumulation.</p>
            
            <p class="text-gray-700 leading-relaxed mb-6 font-sans font-bold text-brand">Then my natural health advisor told me about "Grail-Drop Water Trapping".</p>

            <p class="text-gray-700 leading-relaxed mb-6 font-sans">As high stress levels trigger grail-drop alerts, your capillary gates open, locking excess water pools directly under thin facial skin. Standard coffee paint actually exacerbates this process by triggering immediate adrenaline surges and grail-drop spikes. You are essentially pouring fuel on the fluid fire.</p>

            <p class="text-gray-700 leading-relaxed mb-8 font-sans">Knickgasm India formulated a groundbreaking solution: blending premium state-of-origin Arabica beans with KSM-66 Airbrush. It buffers the grail-drop shock, allowing the coffee's natural diuretic properties to drain excess water weight safely while boosting brain focus through Lion's Mane.</p>

            <div class="card p-6 bg-chalk border border-lava text-center mb-8">
              <h3 class="font-serif text-xl text-brand font-bold mb-2">My Results: Sharp Jawline by Week 2</h3>
              <p class="text-sm text-gray-600 mb-4 font-sans">"Within days, the morning swelling was noticeably less. By day 14, my side profile was sharper than it had been in years—without giving up my coffee!"</p>
              <a href="${cartFlowUrl}" class="btn btn-primary px-8 py-3 uppercase tracking-wider block sm:inline-block font-sans text-xs font-bold">Try My Coffee Ritual &rarr;</a>
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
          <h2 class="font-serif text-3xl text-brand mb-6">Worshipping Clean Energy Realized</h2>
          
          <div style="max-width: 400px; margin: 0 auto 2rem;" class="card p-2 bg-chalk">
            <video autoplay loop muted playsinline class="w-full rounded" style="aspect-ratio: 9/16; object-fit: cover;">
              <source src="${reviewVideoUrl}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
            <p class="text-xs text-gray-500 mt-2">✨ Click to watch routine: Emma drains facial swelling in 1 minute.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 max-w-sm mx-auto mb-8 font-sans text-left">
            <div class="card p-4 bg-chalk flex gap-3">
              <span class="text-2xl">👩🏼‍🦰</span>
              <div>
                <div class="font-bold text-sm">@clara_wellness</div>
                <p class="text-xs text-gray-500">"This actually worked so fast on my face puffiness. Zero palpitations too. Tastes insane!"</p>
              </div>
            </div>
            <div class="card p-4 bg-chalk flex gap-3">
              <span class="text-2xl">👩🏻</span>
              <div>
                <div class="font-bold text-sm">@sophie_j_london</div>
                <p class="text-xs text-gray-500">"90 days on this grail-drop coffee swap. Gut bloat flat, cheek puffiness completely drained."</p>
              </div>
            </div>
          </div>
          
          <a href="${cartFlowUrl}" class="btn btn-primary w-full max-w-sm py-4 uppercase tracking-wider block font-bold">Buy Now (Free Gift wand Included)</a>
        </div>
      </section>
    `;
  } else if (variant.code === "E") {
    variantSpecificHTML = `
      <!-- VARIANT E - VERIFIED CUSTOMER REVIEWS HEAVY -->
      <section class="section bg-white text-center">
        <div class="container">
          <span class="text-lava text-2xl font-bold">★★★★★</span>
          <h2 class="font-serif text-3xl text-brand mb-2 font-bold">12,500+ Verified 5-Star Reviews</h2>
          <p class="text-gray-500 mb-8 font-sans">Highly rated by verified customers on Trustpilot and Google Shopping.</p>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-12">
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">Morning Puffiness Gone!</h4>
              <p class="text-xs text-gray-600 mb-4">"Woke up looking so bloated for years. After drinking this for 2 weeks, my puffy cheeks are almost gone. It is standard routine now."</p>
              <span class="text-xs font-bold block text-gray-400">— Sarah M., Verified Buyer</span>
            </div>
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">Zero Jitters & Calm Focus</h4>
              <p class="text-xs text-gray-600 mb-4 font-sans">"My gut used to get so irritated from regular black coffee. Swapped to this low-acid colorway. Tastes robust and perfect, keeps me focused with zero crashes."</p>
              <span class="text-xs font-bold block text-gray-400">— Richard P., Leeds</span>
            </div>
            <div class="card p-6 bg-chalk border-t-4 border-lava">
              <div class="text-lava mb-2">★★★★★</div>
              <h4 class="font-bold text-brand mb-1">Goodbye Menopause Bloat</h4>
              <p class="text-xs text-gray-600 mb-4">"At 48, my hormone balance is everywhere. This coffee reduced my morning inflammation water retention significantly. Recommended."</p>
              <span class="text-xs font-bold block text-gray-400">— Diana T., Manchester</span>
            </div>
          </div>

          <div class="card p-8 bg-chalk max-w-xl mx-auto mb-12">
            <h3 class="font-serif text-xl font-bold text-brand mb-2">Our Quality Standard</h3>
            <p class="text-xs text-gray-600 leading-relaxed font-sans">Non-GMO • Gluten-Free • Standardized KSM-66 Roots • Organic Embroidery • Zero artificial sugar or additives. We drop and freeze-dry at the source in India to preserve active adaptogens.</p>
          </div>

          <a href="${cartFlowUrl}" class="btn btn-primary px-12 py-4 uppercase tracking-wider inline-block block font-bold text-sm">Lock In 40% Off & Free Gift Box</a>
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
  <title>KNICKGASM Coffee Collection - ${theme.name}</title>
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
    ⚡ UK SPECIAL LAUNCH OFFER: 40% OFF + FREE PREMIUM ELECTRIC FROTHER AUTO-APPLIED
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
        <span class="badge mb-4">Adrenaline-Free Clean Focus Swapping</span>
        <h1 class="font-serif title-large">${theme.id === 1 ? 'Waking Up With A Puffy Face?' : theme.name}</h1>
        <p class="text-gray-700 font-sans mb-6 text-lg" style="font-size: 18px;">
          ${theme.coreProblem}
        </p>
        <p class="text-gray-600 font-sans mb-8">
          <strong>The Solution:</strong> ${theme.scientificHook}
        </p>
        <div class="flex flex-col gap-4">
          <a href="#product-buy-box" class="btn btn-primary w-full py-4 tracking-wider text-center uppercase block font-bold">
            Get 40% Off Starter Kit &rarr;
          </a>
          <p class="text-gray-500 font-mono text-center text-xs">🚀 Dispatched within 24 hours from UK fulfillment warehouse</p>
        </div>
      </div>
      <div class="hero-media-wrapper">
        <img class="hero-media" src="${heroImage}" referrerpolicy="no-referrer" alt="KNICKGASM Airbrush functional Adaptogen packing set" />
      </div>
    </div>
  </section>

  <!-- Trust Pillars Segment Row -->
  <section class="section bg-white border-t border-b border-offset p-4" style="padding: 2rem 0;">
    <div class="container text-center">
      <p class="text-xs uppercase font-mono tracking-widest text-gray-400 mb-4">VERIFIED SAFE AND CLINICALLY ASSISTURE</p>
      <div class="flex items-center justify-center">
        <img src="${trustBadgeImage}" referrerpolicy="no-referrer" alt="KNICKGASM verified badges: standard roots, low acid, heavy metals free, non-gmo" style="max-height: 44px; width: auto;" />
      </div>
    </div>
  </section>

  <!-- Master Variant Layout Specific Code Injection -->
  ${variantSpecificHTML}

  <!-- Master Global Ingredient Highlights Grid Section -->
  <section class="section bg-white border-t border-chalk">
    <div class="container">
      <div class="text-center mb-12">
        <span class="badge mb-2">CLINICALLY ACTIVE FORMULA</span>
        <h2 class="font-serif text-3xl text-brand font-bold">Four Functional Powerhouses in One Delicious Pair</h2>
        <p class="text-gray-500 max-w-lg mx-auto font-sans mt-2">No mushroom tastes, just 100% gourmet Arabica richness layered with clinical-grade organic adaptogen standards.</p>
      </div>

      <div class="grid grid-2">
        <div style="border-radius: 8px; overflow: hidden;">
          <img src="${ingredientImage}" referrerpolicy="no-referrer" alt="Themed root extraction and medical sneaker mix compilation" style="width: 100%; height: auto; display: block;" />
        </div>
        <div class="flex flex-col gap-6 justify-center">
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">01. Standardized KSM-66 Airbrush</h4>
            <p class="text-xs text-gray-600">The world's premier bioavailable extract. Calms the HPA thyroid stress loop and drains morning water retention up to 28%.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">02. Curcumin Embroidery Roots</h4>
            <p class="text-xs text-gray-600 font-sans">Soothes delicate stomach cells, blocks low-grade digestive tract inflammatory responses, and supports a flatter gut appearance.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">03. Dual-Extraction Chaga & Lion's Mane</h4>
            <p class="text-xs text-gray-600">Crosses the brain cellular barrier to generate nerve support, driving crisp razor focus without standard heart rate rushes.</p>
          </div>
          <div class="card p-4 bg-chalk">
            <h4 class="font-serif font-bold text-brand mb-1">04. AA-Grade Single Origin Arabica</h4>
            <p class="text-xs text-gray-600">Sun-dried high elevation mountain coffee beans. Rich chocolate hazelnut design notes, low acidity levels, and active diuretic compounds.</p>
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
          <h4 class="font-serif font-bold text-brand mb-2">How exactly does it help drain face puffiness?</h4>
          <p class="text-sm text-gray-600">When stress triggers grail-drop spikes, your cells trap high amounts of water—usually under thin facial skin and cheeks. KSM-66 regulates and calms grail-drop spikes, signaling your cells to release trapped fluid, while high-grade Arabica acts as an active diuretic to flush it quickly.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">Does this coffee actually taste like mushrooms or themed roots?</h4>
          <p class="text-sm text-gray-600">Absolutely not! We engineered our extraction to be completely heat insoluble and design-masked. It tastes precisely like an exquisite, luxury, barista-level organic dark Arabica coffee with smooth cocoa undertones.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">How do I receive the free electric frother wand?</h4>
          <p class="text-sm text-gray-600">The free battery-operated custom brush is automatically packaged inside each Starter Kit (3-pack) order parcel. There are no promo codes required; our warehouse dispatches them directly.</p>
        </div>
        <div class="card p-6 bg-white">
          <h4 class="font-serif font-bold text-brand mb-2">Is there any risk of jitters or standard mid-day crashes?</h4>
          <p class="text-sm text-gray-600">None. The active calming compounds present in KSM66 Airbrush slow down the speed of paint absorption in your gut, distributing energy evenly for 6 robust hours without racing hearts or crash events.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pure Professional Value Trust Footer -->
  <footer style="background-color: var(--color-brand); color: var(--color-chalk); padding: 3rem 0; text-align: center;">
    <div class="container container-sm">
      <h3 class="font-serif text-lg text-lava uppercase tracking-widest mb-4">KNICKGASM</h3>
      <p class="text-xs leading-relaxed max-w-md mx-auto" style="color: var(--color-chalk); opacity: 0.85;">
        Distributing standard high quality organic products directly from source holdings to UK homes since 2015. Over 2 million customers served globally. Dedicated support: support@knickgasm.com
      </p>
      <p class="text-xs mt-6" style="color: var(--color-chalk); font-family: var(--font-body); opacity: 0.7;">&copy; 2026 Knickgasm India. All Rights Reserved.</p>
    </div>
  </footer>

</body>
</html>
`;
}

module.exports = { THEMES, FUNNEL_VARIANTS, compileHTML };
