# Master Website Development & 3D Prompt Pack

Adapted from Brand Motion Studios: *Futuristic Web Design Using AI* & *The 3D Prompt Pack: 15 Prompts for Real-Time 3D Websites*.

How to use this pack:
Find the drawer for your current development phase, copy the prompt, replace every `[bracket]` with your project's specific details, and send it. A prompt with empty brackets is a vague prompt.

---

## 1. Start Drawer

### The Brief (Write before opening any tool)
```markdown
[Business name] sells [what] to [who]. The site's one goal is to get visitors to [the one primary action]. It should feel [three mood words], like [a reference or comparison].
```

### List the Sections (Website Anatomy)
```markdown
List the sections a homepage for [business name] should have, in order, following the canonical 10-part website anatomy:
1. Nav (Logo, minimal nav links, primary CTA, mobile hamburger)
2. Hero (Outcome-led headline, subhead, primary CTA, proof signal, visual/video/3D)
3. Social Proof (Verified logos, customer ratings, key metrics)
4. Products or Offerings (Bento grid or split layout with benefit-led copy)
5. Story or "How it works" (3 clear steps or pinned scroll story)
6. Testimonials (Authentic quotes with customer context)
7. Pricing or Offer Matrix (Clear tiers or product comparison)
8. FAQ (6-12 objections answered from verified facts)
9. Final Call to Action (Risk reversal, identical primary CTA to top)
10. Footer (Legal, sitemap links, copyright)
Provide one line on the job of each section. Don't build anything yet.
```

### The Plan (In Plan Mode)
```markdown
Here is the brief: [your brief]
Plan a website for this. Follow CLAUDE.md for the stack and design system. Use the assets in public/images. List the sections in order, what each contains, and which asset it uses. Don't build yet.
```

### Three Design Directions
```markdown
Suggest three design directions for [business name]. For each provide:
- A display font and a body font from Google Fonts.
- Five colours with hex codes:
  * Background (page background)
  * Text (headings and body text)
  * Primary (brand identity)
  * Accent (reserved for buttons and key highlights ONLY)
  * Muted (secondary text and subtle borders)
- A one-line description of the mood.
Show them as a simple preview page.
```

### Lock the Design System
```markdown
Use direction [number]. Set it up as the design system for the whole project, and add a Design section to CLAUDE.md with the fonts, colours, and these rules:
- Only use colours from the 5-colour palette.
- Spacing between sections is consistent across the site.
- Rounded corners are small and uniform everywhere.
- One accent colour, used only for buttons and key highlights.
```

---

## 2. Build Drawer

### New Section (The 5-Part Prompt Structure)
```markdown
Context: [who this is for and what it is]
Task: Build the [section name] section.
Details: [what it must include]. [what it must avoid].
Reference: [a screenshot, or "none"]
Done when: [how you will judge it]
```

### New Section Short Form (When `new-section` skill is active)
```markdown
Add the [section name] section: [the content, in one or two sentences].
```

### From Design Words
```markdown
Restyle the [section].
Layout: [split layout | centred | full-bleed | bento grid | asymmetric]
Type: [serif display | sans-serif | tight tracking | large scale]
Space: [whitespace | breathing room | balanced padding]
Surface: [flat | soft shadow | grain | frosted glass | subtle border]
Motion: [fade in | slide up | stagger | hover lift]
```

### From a Reference Screenshot
```markdown
Use this screenshot as a reference for layout, spacing, and proportions only. Keep our own content, colours, and fonts. Rebuild the [section] in this structure.
```

### Options & Route Previews
```markdown
Give me three versions of [section / component], each on its own preview route. Describe each in one line.
```

### Pick One
```markdown
Use version [number]. [One or two small adjustments]. Keep everything else the same.
```

### Cinematic Move: Pinned Scroll Story
```markdown
Add a new section called "[name]", directly after "[section before it]". It is a pinned scroll story with three steps: [step 1], [step 2], [step 3].
How it should behave:
- When the section reaches the top of the screen, it holds still while the visitor keeps scrolling.
- Each step replaces the one before it, in step with the scroll. A step is a large number, a short heading, and one sentence of real copy.
- After the third step, the section releases and the page scrolls on as normal.
How to build it:
- Use GSAP ScrollTrigger for pinning and scroll-linked changes.
- It must work smoothly on mobile touch scrolling, with zero jumping and no sideways scroll.
- If the visitor has prefers-reduced-motion active, do NOT pin anything. Show the three steps as a clean, stacked layout instead.
- Follow the Design section of CLAUDE.md.
```

### Cinematic Move: One 3D Moment
```markdown
In the "[section]" section, add one 3D moment: a single [object] that turns slowly, placed beside the text.
How to build it:
- Build the [object] in code with Three.js (r169 via CDN import map). Do NOT download heavy 3D models.
- It turns slowly by itself and tilts slightly as the visitor scrolls. Gentle, never jarring.
- Its colours and lighting strictly follow the Design section of CLAUDE.md.
- Keep the existing product photography where it is. The 3D object is an interactive accent, not a replacement for real photos.
Fast and accessible:
- Lazy load the 3D canvas via IntersectionObserver only when the section is near the viewport.
- On mobile (<768px) and when prefers-reduced-motion is active, do NOT load the WebGL scene. Render a crisp still image (WebP) instead.
- If WebGL is unsupported or fails, gracefully display the still image without breaking the page.
```

### Cinematic Moves Selector
```markdown
Here are the five cinematic moves:
1. Slow video hero
2. Scroll-linked motion
3. Pinned section
4. Depth (parallax)
5. 3D object drawn live in browser
Rule: A slow video hero plus max 1 or 2 cinematic moves, placed where the story needs them. Never all five.
Which two moves suit [business name] best, and why? Where will each go, what does it add, and what does it cost in performance?
```

### Working Contact Form (With Lead Capture)
```markdown
Add a contact section with a form: name, email, and message. On submit, save the entry to the leads table in Supabase. Store keys securely in .env.local. Validate that the email is well-formed and fields are non-empty. Show clear inline success and error messages. Include anti-spam honeypot bot protection.
```

---

## 3. Fix Drawer

### From a Screenshot
```markdown
In this screenshot, [what is wrong] in [where]. Fix it. Keep everything else the same.
```

### One Change
```markdown
[What is wrong, in plain words]. [The one limit or constraint]. Keep everything else the same.
```

### Error Resolution
```markdown
I am getting this error:
[paste complete error message]
Fix it and explain in one line what caused it.
```

### Project Orientation
```markdown
What files are in this project and what does each one do?
```

---

## 4. Assets Drawer (AI Generation & Flow Formulas)

### The 6-Part Image Formula
```markdown
[Subject]. [Setting]. [Lighting]. [Camera]. [Mood and palette]. [Format].
```
*Example:*
"A frosted matte cosmetic bottle standing on a smooth limestone plinth. Soft diffused morning window light from the left, subtle ambient fill. Shot at eye level with an 85mm lens, f/2.8 shallow depth of field. Warm, minimal, serene. Slate grey and stone white palette with a muted emerald accent. No text on bottle. 4:5 vertical."

### Style Line Template
```markdown
[Lighting]. [Camera]. [Mood and palette].
```

### Hero Video from Text
```markdown
Slow motion close-up of [subject and one subtle movement]. Camera locked off on a tripod, zero camera shake. [Lighting]. [Palette]. Calm, luxurious, and minimal. No text, no human faces. 16:9 widescreen.
```

### Web Asset Preparation
```markdown
Prepare the files in public/images for production:
- Convert images to WebP: hero images up to 1920px wide, product shots up to 1000px wide.
- Compress hero.mp4: 1080p maximum, audio track stripped, file size strictly under 4 MB.
- Extract first frame as hero-poster.webp.
- Confirm lazy loading (<img loading="lazy">) on all below-the-fold assets.
```

---

## 5. Finish Drawer

### Launch Checklist & Verification
```markdown
Check every asset and interaction against the launch checklist:
1. Sections: Every section has a 1-line purpose. Real copy only, no placeholder text.
2. Design: 5-colour palette strictly respected. Exactly 1 accent colour for buttons and highlights. Small uniform corner radii.
3. Typography: Display font for headings, body font for prose. Four snapped sizes.
4. Mobile (390px): Zero horizontal scroll. Touch targets >= 44px. Working hamburger drawer menu.
5. Motion: Max 1 video hero + 1-2 cinematic moves. prefers-reduced-motion respected everywhere. Still image fallback on mobile/low-motion.
6. Form: Validated email (@ check), honeypot anti-spam, inline success/error UI, data saved to leads table.
7. SEO & Social: Title < 60 chars, description < 155 chars, Open Graph image 1200x630, favicon.ico/svg, robots.txt, sitemap.xml.
8. Security: No API keys exposed in client bundles or git commits. .env.local in .gitignore.
```

---

## 6. Going Further: 15 Real-Time 3D Master Prompts

### 01. Moss Perfume (3D Fragrance Landing Page)
- **Best for:** Luxury fragrance, botanical beauty, organic cosmetics.
- **Built with:** Three.js r169, procedural geometries, studio reflections, instanced flowers.
- **Key Features:** 8-sided faceted bottle with clear-coat glass shader, procedural moss mound, instanced daisy field, 4 scent presets (Moss, Rose, Amber, Citrus), Cormorant Garamond display typography.

### 02. Ring Atelier (3D Jewellery Store)
- **Best for:** Fine jewellery, watchmakers, luxury craft.
- **Built with:** Three.js, physical metal shaders, procedural gemstone refraction.
- **Key Features:** 3 interlocking precious metal rings (Gold, Platinum, Rose Gold) floating in hero, separating into interactive product cards on scroll, 4 material presets.

### 03. Lattice Cube (3D AI Product Landing Page)
- **Best for:** AI platforms, developer infrastructure, data analytics.
- **Built with:** Three.js, volumetric particle shader, glowing data nodes, signal trails.
- **Key Features:** Frosted glass cube encasing a living data core, interactive signal pulse bursts on scroll, 4 colorway presets (Cyber, Nebula, Matrix, Solar), Space Grotesk typography.

### 04. Terra Nav (3D Travel Landing Page)
- **Best for:** Travel, hospitality, outdoor exploration, expeditions.
- **Built with:** Three.js procedural vertex-displaced terrain shader, multi-biome procedural texturing.
- **Key Features:** Dynamic flyover camera following scroll progress, 4 biomes (Alpine Snow, Desert Dunes, Volcanic Basalt, Nordic Fjord), floating frosted glass mega-menu.

### 05. Toon Portfolio (3D Character Personal Portfolio)
- **Best for:** Creative directors, frontend developers, 3D artists.
- **Built with:** Three.js procedural toon-shaded geometries, spring physics.
- **Key Features:** Expressive stylized 3D character head tracking cursor position, blinking eyes, expressive reactions on hover/click, 4 aesthetic presets.

### 06. Runway Muse (3D Fashion Landing Page)
- **Best for:** Haute couture, designer apparel, runway releases.
- **Built with:** Three.js procedural skeletal rig, vertex displacement cloth physics.
- **Key Features:** Elegant mannequin pose blending on scroll, flowing animated shader skirt folds, dynamic studio spotlighting, editorial serif typography.

### 07. Curved Gallery (3D Architecture Studio)
- **Best for:** Architecture firms, interior design, exhibition spaces.
- **Built with:** Three.js offscreen render targets, parametric curved cylinder carousel.
- **Key Features:** 7 procedural architectural spaces rendered dynamically to textures, curved cylindrical gallery with momentum/inertia dragging and auto-centering.

### 08. Sport Shades (3D Eyewear Landing Page)
- **Best for:** Performance sunglasses, optics, athletic wearables.
- **Built with:** Three.js PBR materials, gradient iridescent mirror coating shader.
- **Key Features:** Aerodynamic wraparound frame with iridescent shield lens, exploded view separating temples, frame, and lens on scroll, 4 colorways.

### 09. Terrain Card (3D Fintech Landing Page)
- **Best for:** Neobanks, premium credit cards, investment apps.
- **Built with:** Three.js frosted glass shader, procedural canvas-drawn card details.
- **Key Features:** Holographic payment card floating in space, living 3D miniature topographic landscape growing out of the card surface, scroll tilt, 4 card tiers.

### 10. Robot Head (3D Robotics Landing Page)
- **Best for:** Robotics hardware, humanoid AI, advanced computing.
- **Built with:** Three.js procedural mechanical assemblies, emissive eye rings.
- **Key Features:** Articulated robotic head with dilating iris rings, responsive eye contact tracking cursor, modular faceplate separation on scroll.

### 11. Liquid Chrome (Metaballs Raymarching Shader)
- **Best for:** Hero backdrops, avant-garde music, luxury tech.
- **Built with:** Pure WebGL2 fragment shader, raymarching SDF with polynomial smooth-min ($k \approx 0.75$).
- **Key Features:** 7 floating Lissajous metaballs + 1 interactive cursor sphere, click/hold magnetize interaction, 4 presets (Holo, Molten, Mint, Pearl), zero external dependencies.

### 12. Particle Type (Interactive Particle Typography)
- **Best for:** Creative agency hero sections, interactive typography.
- **Built with:** Three.js / HTML5 Canvas 2D rasterizer, 16,000 instanced particles.
- **Key Features:** Real-time text-to-particle rasterization, CPU spring dynamics, cursor blast wave, scroll scatter and morph between custom words.

### 13. Gradient Ribbons (SaaS Twisting 3D Ribbons)
- **Best for:** Modern SaaS, cloud software, digital services.
- **Built with:** Three.js PlaneGeometry ribbon strips, custom wavy vertex shader.
- **Key Features:** 7 layered sine-wave ribbons with 4-stop cyclic gradient, interactive cursor push bulge, click ripple wave propagation.

### 14. Data Globe (Dotted Globe with Live Arcs)
- **Best for:** Fintech, global logistics, telemetry, network infrastructure.
- **Built with:** Three.js Fibonacci-sphere dot-matrix (22,000 points), Great Circle Bézier arcs.
- **Key Features:** Polygon point-in-continent test, animated pulsing telemetry arcs connecting major global financial hubs, real-time counters, 4 theme presets.

### 15. App Showcase (3D Phone with Live Interactive Canvas UI)
- **Best for:** Mobile app launches, consumer tech, iOS/Android products.
- **Built with:** Three.js extruded phone body with physical glass screen, dynamic 2D canvas texture.
- **Key Features:** Fully functional live canvas app UI rendered to 3D phone screen at 30fps, 3 floating parallax UI cards, drag inertia rotation with spring snap-back.
