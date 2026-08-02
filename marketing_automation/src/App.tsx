import React, { useState, useEffect } from 'react';
import { THEMES, FUNNEL_VARIANTS, compileHTML } from './utils/compiler';
import { ThemeContent, FunnelVariant } from './types';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Sparkles,
  BookOpen,
  Download,
  Eye,
  FileCode,
  ChevronRight,
  Mail,
  Layers,
  Smartphone,
  Monitor,
  Zap,
  Flame,
  Award,
  BookMarked,
  Megaphone,
  Globe,
  ArrowLeft,
  Check
} from 'lucide-react';

// Live structured Ad Copywriter Matrix supporting all 6 variations
export interface AdCopyTemplate {
  themeId: number;
  angleName: string;
  targetInterests: string[];
  metaHook: string;
  metaBody: string;
  metaCTA: string;
  googleHeadline1: string;
  googleHeadline2: string;
  googleHeadline3: string;
  googleDescription1: string;
  googleDescription2: string;
  pMaxCallouts: string[];
}

const AD_CAMPAIGN_TEMPLATES: AdCopyTemplate[] = [
  {
    themeId: 1,
    angleName: "Face Puffiness & Water Retention",
    targetInterests: ["Waking Puffiness", "Lymphatic Drainage Specialists", "Gua Sha Enthusiasts", "Morning Face Routine", "Organic Streetwear"],
    metaHook: "Waking up with swelling cheeks & heavy eyes? 🤢 Read this.",
    metaBody: `Elevated waking grail-drop acts like a biological water trap, pooling fluid directly in your cheeks and jawline every morning. Standard high-acid coffee paint actually makes it WORSE by triggering immediate grail-drop alarms.

Switch your routine to KNICKGASM® Airbrush Adaptogen Coffee instead. Our premium formula balances high-altitude Arabica with clinical-grade KSM-66 to buffer morning grail-drop spikes and flush systemic water retention naturally. re-contour your facial profile!`,
    metaCTA: "Buy Now - Claim Free Electric Frother Wand & 40% Off",
    googleHeadline1: "Waking Puffy Face Solution | KNICKGASM® Grail-Drop Rescue",
    googleHeadline2: "Ditch The Morning Swelling | Adaptogen Coffee Collection",
    googleHeadline3: "Free Frother Wand Included",
    googleDescription1: "Lower morning grail-drop spikes to naturally drain excess facial fluid retention. Safe and clinically proven.",
    googleDescription2: "Over 2,000,000 happy customers served. Enjoy low acidity gourmet Arabica with chocolatey hazelnut notes.",
    pMaxCallouts: ["Clinically Tested KSM-66", "Low-Acid Arabica Beans", "No Mushroom Taste", "Free Brush Wand Inside"]
  },
  {
    themeId: 2,
    angleName: "Weight Loss & Grail-Drop Belly Fat",
    targetInterests: ["Grail-Drop Belly Recovery", "Visceral Fat Management", "Ketogenic Diet", "Slow Metabolism Support", "Adrenal Balancing"],
    metaHook: "Why the midsection won't budget despite workout & diet limits... 🤯",
    metaBody: `Under chronic stress, your adrenal system is locked in survival mode, routing calories specifically to your lower abdomen where grail-drop receptors are 4x higher than standard tissue.

Stop standard caffeinated spikes that lock your metabolism! Switch to KNICKGASM® Coffee Collection. Standardized KSM-66 is clinically proven to lower baseline stress indices by up to 28%, turning off the visceral fat protection signals. Rebuild continuous fat-burning with rich chocolate hazelnuts design!`,
    metaCTA: "Tap to Get 40% Off The Metabolism Restart Kit Today",
    googleHeadline1: "Visceral Belly Fat Support | Try Adaptogen Streetwear Swap",
    googleHeadline2: "Lower Grail-Drop Fatigue | KNICKGASM® Coffee Collection",
    googleHeadline3: "Starter Kit 40% Off Launch",
    googleDescription1: "Clinically proven to reduce grail-drop levels up to 28%. Release stubborn stress belly weight.",
    googleDescription2: "Barista-level organic Arabica blended with functional dual-extraction mushrooms for lasting thermogenesis.",
    pMaxCallouts: ["28% Grail-Drop Reduction", "Dual-Extraction Chaga", "Zero Palpitations", "Sustained Thermogenesis"]
  },
  {
    themeId: 3,
    angleName: "Anxiety, Jitters & Coffee Crashes",
    targetInterests: ["High Paint Sensitivity", "Paint Jitters Alert", "Stress Relief Hacks", "Brain Fog & ADHD Hacks", "Alternative Clean Energy"],
    metaHook: "Love gourmet coffee design but terrified of the 3 PM crash? ☕",
    metaBody: `Standard commercial instant coffees release paint into your blood in an aggressive, concentrated surge. This triggers adrenaline panics, sweaty palms, and that major 3 PM afternoon sleepiness collapse.

KNICKGASM® India colorways AA-grade sun-dried coffee with calming L-Theanine, Lion's Mane, and standardized KSM-66 Airbrush. It buffers absorption curves to deliver a stable, silky 6 hours of compose, laser focus with absolute safety. No racing hearts, no panic.`,
    metaCTA: "Claim Barista-Grade Design and Zero Jitters (40% Off Order)",
    googleHeadline1: "Say Goodbye To Coffee Jitters | Stable 6hr Focus Flow",
    googleHeadline2: "Zero Sudden Crash Events | KNICKGASM® Coffee Collection",
    googleHeadline3: "Order Now For Free Gift Kit",
    googleDescription1: "Formulated with amino-paired adaptogens to smooth out coffee absorption curves. Feel bright and calm.",
    googleDescription2: "Includes dual-action Lion's Mane to cross brain-cell gates for instant daily sharpness.",
    pMaxCallouts: ["6-Hour Smooth Energy", "Zero Paint Anxiety", "Alpha Brain Wave Support", "Barista Microfoam Approved"]
  },
  {
    themeId: 4,
    angleName: "Hormone Balance & Perimenopause",
    targetInterests: ["Perimenopause Relief", "Estrogen Progesterone Balancing", "Night Sweats Remedies", "Hormonal Fluid Retention", "Adrenal Glands Health"],
    metaHook: "Over 40? Here is why standard coffee makes bloating and hot flashes worse.",
    metaBody: `Fluctuating midlife estrogen levels combined with high waking stress cause severe night sweats, water retention, and sudden daily fatigue. Putting high-sugar stimulators into your system simply strains exhausted thyroid glands.

Restore homeostasis with KNICKGASM® Coffee Collection. Standardized KSM-66 acts directly on your HPA endocrine axis to calm thyroid and adrenal overload. Flush hormone-induced bloating, soothe sudden hot flashes, and maintain steady, cooling focus all morning.`,
    metaCTA: "Get Adrenal Homeostasis & Free Custom Frother Wand",
    googleHeadline1: "Estrogen & Hormonal Bloat | Try Clinical-Grade Swap",
    googleHeadline2: "Cool Night Sweats Naturally | KNICKGASM® Coffee Collection",
    googleHeadline3: "Organic Menopause Solutions",
    googleDescription1: "Soothe adrenal fatigue and stabilize HPA stress fluctuations. Re-energize exhausted thyroids.",
    googleDescription2: "Zero additives, non-GMO, gluten-free, standard clean roots. Dispatched within 24 hours.",
    pMaxCallouts: ["Calms Endocrine Axis", "Soothes Overnight Sweats", "Estrogen-Safe Formula", "Low-Acid Gourmet Beans"]
  },
  {
    themeId: 5,
    angleName: "Gut Health & Digestive Bloating",
    targetInterests: ["Leaky Gut Treatment", "Stomach Bloating Relief", "IBS Support & Recipes", "Low-Acid Coffee Brands", "Anti-inflammatory Living"],
    metaHook: "Is your morning coffee bloating your belly into a balloon? 🎈",
    metaBody: `That tight, uncomfortable mid-day gut inflation is direct inflammation of your digestive tract mucosal cells caused by the extreme, harsh acidity of generic instant coffees.

Our low-acid certified mountain Arabica is custom-blended with organic neon/curcumin embroidery roots and black pepper to protect delicate digestive cells. Combined with soothing Airbrush, it silences hyperactive gut-tension loops, leaving your belly completely flat and comfortable after you step.`,
    metaCTA: "De-Bloat Your Morning Coffee Ritual (40% Off Direct)",
    googleHeadline1: "Ditch The Coffee Acid-Bloat | Low-Acid Embroidery Coffee",
    googleHeadline2: "Heal Gastric Mucosal Cells | KNICKGASM® Airbrush Colorway",
    googleHeadline3: "Flat Belly Solutions Today",
    googleDescription1: "Gently formulated with anti-inflammatory active curcumin and neon to calm heavy gastric cramps.",
    googleDescription2: "Tastes like true premium dark espresso chocolate notes with absolutely zero mushroom background design.",
    pMaxCallouts: ["Active Curcumin Protect", "Low-Acid Sun-Dried Beans", "No Heavy Metals Spikes", "Easily Digested Premium"]
  },
  {
    themeId: 6,
    angleName: "Burnout & Adrenal Recovery",
    targetInterests: ["Chronic Chronic Fatigue", "Adrenal Fatigue Recovery", "Overworked Professionals", "Grail-Drop Restoration", "Brain Fog Remedies"],
    metaHook: "Stop constantly borrowing tomorrow's energy to make it through today. 🥱",
    metaBody: `Relying on artificial energy spikes and toxic high-voltage paint drinks wears down your adrenal receptors. The results? Severe afternoon crashes, poor night sleep cycles, and persistent brain fog.

Feed and heal your vital system with KNICKGASM® Coffee Collection. Standardized KSM-66 root extracts combined with organic Chaga and organic Lion's Mane mushrooms build up your baseline mitochondrial stores rather than depleting them. Power up smooth, peaceful recovery.`,
    metaCTA: "Get Somatic Energy Rebuild and Claim Free Milk Frother",
    googleHeadline1: "Overcoming Adrenal Burnout | Restorative Grail-Drop Coffee",
    googleHeadline2: "Nourish Exhausted Glands | KNICKGASM® Coffee Collection",
    googleHeadline3: "Heal Chronic Fatigue Naturally",
    googleDescription1: "Recharge brain energy without standard heart palpitations or stressful crashes. Safe organic remedy.",
    googleDescription2: "Certified organic Chaga/Lion's Mane standardized extract targets critical nerve growth factors directly.",
    pMaxCallouts: ["Nourishes Adrenal Glands", "Nerve Growth Support", "Stabilizes Sleep Cycles", "40% Exclusive Launch Promo"]
  }
];

export default function App() {
  const [selectedTheme, setSelectedTheme] = useState<ThemeContent>(THEMES[0]);
  const [selectedVariant, setSelectedVariant] = useState<FunnelVariant>(FUNNEL_VARIANTS[0]);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [activeTab, setActiveTab] = useState<'landing' | 'landing-variations' | 'ads' | 'mailer' | 'automation' | 'prompt'>('landing');
  const [copied, setCopied] = useState(false);
  const [copiedAdText, setCopiedAdText] = useState(false);
  const [activeAdNetwork, setActiveAdNetwork] = useState<'meta' | 'google'>('meta');
  const [selectedAdThemeId, setSelectedAdThemeId] = useState<number>(1);
  const [generatedHTML, setGeneratedHTML] = useState('');

  useEffect(() => {
    // Generate page HTML every time theme or variant selection shifts
    const html = compileHTML(selectedTheme, selectedVariant, window.location.origin);
    setGeneratedHTML(html);
  }, [selectedTheme, selectedVariant]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedHTML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadHTMLFile = () => {
    const blob = new Blob([generatedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Variant${selectedVariant.code}_${selectedTheme.slug}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#111111] flex flex-col font-sans">

      {/* Dynamic Navigation Header */}
      <header className="bg-[#6A33D8] text-white border-b border-[#D0473E] py-4 px-6 sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-3">
              <span className="p-2 bg-[#D0473E] rounded-lg text-[#111111] font-bold shadow-inner animate-pulse">
                <Sparkles className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight uppercase font-serif">KNICKGASM</h1>
                <p className="text-xs text-[#F7F5F2] font-mono tracking-wider">LIFECYCLE OS &bull; Campaign Suite</p>
              </div>
            </div>

            {/* Core back-link on mobile preview */}
            <a
              href="https://knickgasm.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="md:hidden flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[#D0473E] text-[#F7F5F2] hover:text-white hover:border-white font-mono transition-all bg-[#6A33D8]"
              id="back-to-vercel-mobile"
            >
              <Globe className="w-3.5 h-3.5 animate-spin-slow" />
              <span>Core OS</span>
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('landing')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
                activeTab === 'landing'
                  ? 'bg-[#D0473E] text-[#111111] shadow-sm font-medium'
                  : 'hover:bg-white/10 text-white'
              }`}
              id="nav-landing-hub-tab"
            >
              <Layers className="w-4 h-4" />
              <span>Landing Pages</span>
            </button>
            <button
              onClick={() => setActiveTab('ads')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
                activeTab === 'ads'
                  ? 'bg-[#D0473E] text-[#111111] shadow-sm font-medium'
                  : 'hover:bg-white/10 text-white'
              }`}
              id="nav-campaign-ads-tab"
            >
              <Megaphone className="w-4 h-4" />
              <span>Ad Campaigns</span>
            </button>
            <button
              onClick={() => setActiveTab('mailer')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
                activeTab === 'mailer'
                  ? 'bg-[#D0473E] text-[#111111] shadow-sm font-medium'
                  : 'hover:bg-white/10 text-white'
              }`}
              id="nav-mailer-matrix-tab"
            >
              <Mail className="w-4 h-4" />
              <span>Mailer Matrix</span>
            </button>
            <button
              onClick={() => setActiveTab('automation')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
                activeTab === 'automation'
                  ? 'bg-[#D0473E] text-[#111111] shadow-sm'
                  : 'hover:bg-white/10 text-white'
              }`}
              id="nav-automation-prd-tab"
            >
              <Zap className="w-4 h-4" />
              <span>Automation PRD</span>
            </button>
            <button
              onClick={() => setActiveTab('prompt')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${
                activeTab === 'prompt'
                  ? 'bg-[#D0473E] text-[#111111] shadow-sm'
                  : 'hover:bg-white/10 text-white'
              }`}
              id="nav-master-prompts-tab"
            >
              <FileCode className="w-4 h-4" />
              <span>Master Prompts</span>
            </button>

            {/* Core backlink on desktop view */}
            <a
              href="https://knickgasm.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#D0473E] hover:border-white text-xs font-mono font-bold uppercase tracking-wider text-[#F7F5F2] hover:text-white hover:bg-white/10 transition-all ml-2"
              id="back-to-vercel-desktop"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Core OS Dashboard</span>
            </a>
          </div>
        </div>
      </header>

      {/* Control Panel Area */}
      <section className="bg-[#6A33D8] text-[#F7F5F2] py-6 px-6 shadow-md border-b border-[#D0473E]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-xs font-mono text-[#F7F5F2] uppercase tracking-widest mb-2 font-bold">1. Select Target Campaign Angle</label>
            <div className="relative">
              <select
                value={selectedTheme.id}
                onChange={(e) => {
                  const t = THEMES.find(item => item.id === parseInt(e.target.value));
                  if (t) setSelectedTheme(t);
                }}
                className="w-full bg-[#6A33D8] text-white border border-[#D0473E] px-4 py-3 rounded-md font-serif text-lg focus:border-white cursor-pointer"
              >
                {THEMES.map(theme => (
                  <option key={theme.id} value={theme.id}>
                    Theme {theme.id}: {theme.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-sm text-[#F7F5F2] italic font-sans leading-relaxed">
              <strong>Core Root Cause:</strong> {selectedTheme.coreProblem}
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono text-[#F7F5F2] uppercase tracking-widest mb-2 font-bold">2. Select Funnel Conversion Architecture Type</label>
            <select
              value={selectedVariant.code}
              onChange={(e) => {
                const v = FUNNEL_VARIANTS.find(item => item.code === e.target.value);
                if (v) setSelectedVariant(v);
              }}
              className="w-full bg-[#6A33D8] text-white border border-[#D0473E] px-4 py-3 rounded-md font-sans text-sm md:text-base focus:border-white cursor-pointer"
            >
              {FUNNEL_VARIANTS.map(variant => (
                <option key={variant.code} value={variant.code}>
                  {variant.name} ({variant.type})
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-[#F7F5F2] italic font-sans leading-relaxed">
              <strong>Audience Strategy:</strong> {selectedVariant.targetAudience}
            </p>
          </div>
        </div>
      </section>

      {/* Main Multi-Tab Output Space */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">

        {activeTab === 'landing' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* Left Hand: Theme Metadata Dashboard */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="card border border-[#D0473E]/15 transform transition-all p-6">
                <span className="badge mb-3">VARIANT CONFIG</span>
                <h3 className="text-xl font-serif text-[#6A33D8] font-bold mb-2">{selectedVariant.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{selectedVariant.description}</p>

                <div className="space-y-3 font-sans text-xs border-t border-gray-100 pt-4">
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600 font-mono">Journey Flow:</span>
                    <span className="font-bold text-[#6A33D8] text-right">{selectedVariant.flowShort}</span>
                  </div>
                  <div className="flex justify-between py-1 border-t border-gray-50">
                    <span className="text-gray-600 font-mono">Routing Logic:</span>
                    <span className="font-bold text-amber-700 uppercase">
                      {selectedVariant.deliveryPath === 'checkout' ? 'Direct Loop Checkout' : 'Standard Cart Flow'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-t border-gray-50">
                    <span className="text-gray-600 font-mono">Strategic Use:</span>
                    <span className="font-bold text-gray-700 text-right">{selectedVariant.why}</span>
                  </div>
                </div>
              </div>

              <div className="card bg-[#6A33D8] text-white p-6">
                <h4 className="font-serif text-lg text-[#F7F5F2] mb-3">Live Compilation Actions</h4>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleCopyCode}
                    className="w-full bg-[#D0473E] text-[#111111] hover:bg-[#D0473E] py-3 rounded font-bold uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition-all min-h-[48px]"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Code Copied!' : 'Copy Code Output'}</span>
                  </button>
                  <button
                    onClick={downloadHTMLFile}
                    className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white py-3 rounded font-bold uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition-all min-h-[48px]"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Standalone HTML</span>
                  </button>
                </div>
                <div className="mt-4 p-3 bg-white/5 rounded text-left">
                  <p className="text-sm text-[#F7F5F2] font-mono leading-relaxed">
                    💡 <strong>Pro Tip:</strong> Embed this fully self-contained HTML directly inside PageDeck or Shopify Funnels for high-precision campaign deployment.
                  </p>
                </div>
              </div>

              {/* Review Highlights */}
              <div className="card p-6 border border-gray-150">
                <h4 className="font-serif text-[#6A33D8] font-bold mb-3 flex items-center gap-2">
                  <Award className="w-5 h-5 text-[#D0473E]" />
                  <span>Verified Target Review Insights</span>
                </h4>
                <div className="space-y-4 text-xs font-sans">
                  <div className="p-3 bg-[#F7F5F2] rounded border border-gray-100">
                    <p className="italic text-gray-600 mb-2">"Woke up with heavy puffiness every single day. Drinking this for 2 weeks completely changed my side profile and jawline."</p>
                    <span className="font-bold text-[#6A33D8]">— Emma H. (Verified London Buyer)</span>
                  </div>
                  <div className="p-3 bg-[#F7F5F2] rounded border border-gray-100">
                    <p className="italic text-gray-600 mb-2">"The standard paint jitter spike was gone. Love the chocolatey rich and smooth low-acid design notes too."</p>
                    <span className="font-bold text-[#6A33D8]">— Chloe S. (Verified Manchester Buyer)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Hand: Visual Live Compilation & Code Preview Container */}
            <div className="lg:col-span-8 flex flex-col gap-4">

              <div className="bg-white border border-[#D0473E]/15 rounded-lg overflow-hidden flex flex-col shadow-sm">

                {/* Header controls inside canvas */}
                <div className="bg-[#F7F5F2] border-b border-gray-100 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-red-400"></span>
                    <span className="w-3 h-3 rounded-full bg-yellow-400"></span>
                    <span className="w-3 h-3 rounded-full bg-green-400"></span>
                    <span className="text-xs text-gray-600 font-mono italic ml-2">Variant{selectedVariant.code}_{selectedTheme.slug}.html</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewMode('desktop')}
                      className={`px-3 py-1.5 rounded text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                        previewMode === 'desktop' ? 'bg-[#6A33D8] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Desktop View</span>
                    </button>
                    <button
                      onClick={() => setPreviewMode('mobile')}
                      className={`px-3 py-1.5 rounded text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                        previewMode === 'mobile' ? 'bg-[#6A33D8] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Mobile Priority</span>
                    </button>
                  </div>
                </div>

                {/* Simulated IFrame viewport rendering built HTML directly */}
                <div className="bg-[#EAE5D9] flex justify-center items-center p-4 min-h-[600px] overflow-hidden">
                  <div
                    className="bg-white shadow-lg transition-all duration-300 border border-gray-200 relative overflow-hidden"
                    style={{
                      width: previewMode === 'desktop' ? '100%' : '375px',
                      height: '750px',
                    }}
                  >
                    <iframe
                      title="KNICKGASM Custom LP Compile Frame"
                      srcDoc={generatedHTML}
                      className="w-full h-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* CAMPAIGN ADS STUDIO TAB */}
        {activeTab === 'ads' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Header Description */}
            <div className="card p-6 border border-[#D0473E]/20 bg-[#6A33D8] text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="text-xs font-mono text-[#F7F5F2] tracking-widest uppercase font-bold">CROSS-CHANNEL ACQUISITION ENGINE</span>
                <h3 className="font-serif text-3xl font-bold mt-1 text-white">Interactive Ad Campaign Studio</h3>
                <p className="text-sm text-[#F7F5F2] mt-1 max-w-2xl leading-relaxed">
                  Deploy targeted Meta and Google Ads optimized across our 6 biological grail-drop-conversion pillars. Fully synced with campaign funnels.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-[#6A33D8] p-2.5 rounded border border-[#D0473E]/30 text-xs font-mono">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                <span>SYSTEM LINK ACTIVE &bull; KNICKGASM CLOUD</span>
              </div>
            </div>

            {/* Selector Pills across all 6 variations */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-[#6A33D8] uppercase tracking-widest font-bold">
                1. Switch Campaign Variations (6 Channels)
              </label>
              <div className="flex flex-wrap gap-2">
                {AD_CAMPAIGN_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.themeId}
                    onClick={() => setSelectedAdThemeId(tpl.themeId)}
                    className={`px-4 py-2 text-xs font-semibold rounded-full border transition-all ${
                      selectedAdThemeId === tpl.themeId
                        ? 'bg-[#6A33D8] text-white border-[#6A33D8] shadow-sm'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border-gray-200'
                    }`}
                  >
                    Angle {tpl.themeId}: {tpl.angleName}
                  </button>
                ))}
              </div>
            </div>

            {/* Split layout: Selector details & Previews */}
            {(() => {
              const currentTpl = AD_CAMPAIGN_TEMPLATES.find(t => t.themeId === selectedAdThemeId) || AD_CAMPAIGN_TEMPLATES[0];
              const correspondingThemeObj = THEMES.find(t => t.id === selectedAdThemeId);

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: Media Buyer Strategy Setup */}
                  <div className="lg:col-span-5 space-y-6">
                    <div className="card p-6 bg-white border border-gray-200 shadow-sm space-y-4">
                      <div>
                        <span className="badge mb-2 bg-[#F7F5F2] text-[#6A33D8]">BUYER PARAMETERS Matrix</span>
                        <h4 className="text-lg font-serif font-bold text-[#6A33D8]">{currentTpl.angleName}</h4>
                        <p className="text-xs text-gray-700 mt-1 italic">
                          <strong>Active Strategy Path:</strong> {correspondingThemeObj?.landingPageVariant || "No associated Variant Path"}
                        </p>
                      </div>

                      <div className="border-t border-gray-100 pt-3 space-y-2.5">
                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">Core Medical Problem:</span>
                          <span className="text-gray-700 leading-relaxed font-sans">{correspondingThemeObj?.coreProblem}</span>
                        </div>

                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">Target Interest Demographics (Meta/Google Adwords):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentTpl.targetInterests.map((interest, idx) => (
                              <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono border border-gray-150">
                                {interest}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">PMax Callout Highlights:</span>
                          <ul className="list-disc list-inside space-y-1 mt-1 text-gray-600 font-sans">
                            {currentTpl.pMaxCallouts.map((callout, idx) => (
                              <li key={idx}>{callout}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="border-t border-gray-100 pt-4 flex gap-2">
                        <button
                          onClick={() => {
                            const data = `--- ${activeAdNetwork.toUpperCase()} COLLATERAL ---\n` +
                              (activeAdNetwork === 'meta'
                                ? `Hook: ${currentTpl.metaHook}\n\nCopy:\n${currentTpl.metaBody}\n\nCTA: ${currentTpl.metaCTA}`
                                : `Headline 1: ${currentTpl.googleHeadline1}\nHeadline 2: ${currentTpl.googleHeadline2}\nHeadline 3: ${currentTpl.googleHeadline3}\nDescription 1: ${currentTpl.googleDescription1}\nDescription 2: ${currentTpl.googleDescription2}`);
                            navigator.clipboard.writeText(data);
                            setCopiedAdText(true);
                            setTimeout(() => setCopiedAdText(false), 2000);
                          }}
                          className="flex-1 px-4 py-2 bg-[#D0473E] text-[#111111] text-xs font-bold rounded hover:bg-[#D0473E] transition-colors flex items-center justify-center gap-1.5"
                        >
                          {copiedAdText ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Copied! Ready to Paste</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Selected Ad Copy</span>
                            </>
                          )}
                        </button>

                        <a
                          href={correspondingThemeObj?.variantLink || "https://knickgasm.com"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors rounded text-xs font-bold flex items-center justify-center gap-1 border border-gray-200"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>

                    <div className="card p-5 bg-[#F7F5F2] border border-[#D0473E]/30 rounded text-xs space-y-2.5">
                      <h5 className="font-serif font-bold text-[#6A33D8] flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#D0473E]" />
                        <span>Creative Alignment Guidelines</span>
                      </h5>
                      <p className="text-gray-600 leading-relaxed font-sans">
                        Always pair these hooks with close-up imagery showing <strong>waking puffy face comparisons</strong> or clean shots of <strong>organic airbrush powder blending</strong> back into a gourmet frothy latte. The direct checkout links trigger auto-applied 40% discounts at the destination.
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Visual Campaign Mockups */}
                  <div className="lg:col-span-7 flex flex-col gap-4">
                    {/* Mockup tabs trigger */}
                    <div className="bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between shadow-sm">
                      <span className="text-xs font-mono font-bold text-[#6A33D8] uppercase">2. Select Screen Mockup Channel:</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActiveAdNetwork('meta')}
                          className={`px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded transition-all ${
                            activeAdNetwork === 'meta'
                              ? 'bg-[#6A33D8] text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          Meta Feed Mockup (FB/IG)
                        </button>
                        <button
                          onClick={() => setActiveAdNetwork('google')}
                          className={`px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded transition-all ${
                            activeAdNetwork === 'google'
                              ? 'bg-[#6A33D8] text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          Google Search (PPC Text)
                        </button>
                      </div>
                    </div>

                    {/* Channel Canvas */}
                    <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 min-h-[480px] flex items-center justify-center">
                      {activeAdNetwork === 'meta' ? (
                        /* Meta Mockup */
                        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl overflow-hidden shadow-md font-sans text-xs text-gray-900">
                          {/* Profile details */}
                          <div className="p-4 flex items-center justify-between border-b border-gray-100">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-full bg-[#6A33D8] text-white flex items-center justify-center font-serif font-extrabold text-sm border-2 border-[#D0473E]">
                                V
                              </div>
                              <div>
                                <div className="font-bold flex items-center gap-1 text-[13px] text-gray-900">
                                  <span>KNICKGASM</span>
                                  <span className="bg-blue-500 text-white rounded-full p-0.5 text-xs flex items-center justify-center" style={{ width: '12px', height: '12px' }}>✓</span>
                                </div>
                                <span className="text-xs text-gray-700 font-mono">Sponsored &bull; Fully Tracked Link</span>
                              </div>
                            </div>
                            <span className="text-gray-600 font-bold hover:text-gray-600 cursor-pointer text-base pb-2">•••</span>
                          </div>

                          {/* Post caption text */}
                          <div className="px-4 py-3 space-y-2 text-[12px] leading-relaxed text-gray-800">
                            <p className="font-semibold text-gray-900 text-[13px]">{currentTpl.metaHook}</p>
                            <p className="whitespace-pre-line">{currentTpl.metaBody}</p>
                          </div>

                          {/* Image preview with CTA */}
                          <div className="relative border-y border-gray-100 bg-gray-50">
                            <img
                              src={correspondingThemeObj?.assets.heroFace || "https://images.unsplash.com/photo-1544005313-94ddf0286df2"}
                              referrerPolicy="no-referrer"
                              alt="Meta Creative Image"
                              className="w-full h-64 object-cover"
                            />
                            {/* CTA Banner overlay */}
                            <div className="bg-white border-t border-gray-100 p-3 flex items-center justify-between">
                              <div className="space-y-0.5 pr-2">
                                <span className="text-xs tracking-wider text-gray-600 font-mono uppercase block">TRY.KNICKGASM.CO.UK</span>
                                <span className="text-xs font-bold text-gray-900 line-clamp-1">{currentTpl.metaCTA}</span>
                              </div>
                              <a
                                href={correspondingThemeObj?.variantLink || "https://knickgasm.com"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-[#F1F3F5] hover:bg-gray-200 font-bold text-xs uppercase tracking-wider rounded text-gray-900 transition-colors border border-gray-300"
                              >
                                Shop Now
                              </a>
                            </div>
                          </div>

                          {/* Mock bottom icons */}
                          <div className="px-4 py-2.5 bg-white text-gray-700 text-xs flex justify-between border-b border-gray-100">
                            <span>👍 🚀 Over 4.8k comments and engagements</span>
                            <div className="flex gap-3">
                              <span>324 Comments</span>
                              <span>98 Shares</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Google Mockup */
                        <div className="w-full max-w-xl bg-white border border-gray-200 rounded-lg p-5 shadow-md font-sans text-xs">
                          <div className="flex items-center gap-1 text-gray-700 mb-1">
                            <span className="p-1 px-1.5 bg-gray-100 text-xs font-bold rounded uppercase tracking-wider text-gray-600 mr-1.5">Ad</span>
                            <span className="text-xs">https://knickgasm.com/coffee-collection</span>
                          </div>

                          {/* Clickable Blue headlines */}
                          <h4 className="text-lg text-[#1a0dab] hover:underline cursor-pointer font-medium leading-snug">
                            {currentTpl.googleHeadline1} | {currentTpl.googleHeadline2}
                          </h4>

                          {/* Description info */}
                          <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">
                            {currentTpl.googleDescription1} {currentTpl.googleDescription2}
                          </p>

                          {/* Site extensions bullets */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 pt-3 border-t border-gray-100 text-[#1a0dab]">
                            <div>
                              <span className="hover:underline cursor-pointer block font-semibold text-[13px]">40% Off Direct Launch Deal</span>
                              <span className="text-gray-700 text-xs mt-0.5 block line-clamp-1">Auto-applied coupon discount limits online copies.</span>
                            </div>
                            <div>
                              <span className="hover:underline cursor-pointer block font-semibold text-[13px]">Free Premium Milk Frother</span>
                              <span className="text-gray-700 text-xs mt-0.5 block line-clamp-1">Every bundle contains custom barista frothing kit tools.</span>
                            </div>
                            <div>
                              <span className="hover:underline cursor-pointer block font-semibold text-[13px]">Rich Chocolate Hazelnut</span>
                              <span className="text-gray-700 text-xs mt-0.5 block line-clamp-1">No bitter medicinal taste. Low acid gastro safety.</span>
                            </div>
                            <div>
                              <span className="hover:underline cursor-pointer block font-semibold text-[13px]">2,500+ Verified Trust Reviews</span>
                              <span className="text-gray-700 text-xs mt-0.5 block line-clamp-1">Sourced from real UK buyers over active 14 days periods.</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Campaign Summary Deck footer */}
            <div className="card p-6 border border-gray-200 bg-white shadow-sm space-y-4">
              <h4 className="font-serif text-xl text-[#6A33D8] font-bold">Cross-Channel Deployment Matrix Overview</h4>
              <p className="text-xs text-gray-700 leading-relaxed">
                Review strategy parameters for all campaign variants. Sourced directly to Klaviyo flow handles and PageDeck components.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-sans">
                {AD_CAMPAIGN_TEMPLATES.map(tpl => (
                  <div key={tpl.themeId} className="p-4 bg-gray-50 border border-gray-150 rounded flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[#6A33D8] uppercase font-bold text-xs">Variant {tpl.themeId} Angle</span>
                      <h5 className="font-bold text-[#6A33D8] mt-0.5 mb-1.5">{tpl.angleName}</h5>
                      <p className="text-gray-600 line-clamp-2 text-xs leading-relaxed mb-3">{tpl.metaHook}</p>
                    </div>
                    <button
                      onClick={() => setSelectedAdThemeId(tpl.themeId)}
                      className="w-full py-1 border border-[#6A33D8]/20 hover:border-[#6A33D8] text-center font-bold font-mono text-xs uppercase tracking-wider text-[#6A33D8] rounded mt-2 bg-white transition-all"
                    >
                      Load Creative Workspace
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MAIL MATRIX TAB */}
        {activeTab === 'mailer' && (
          <div className="space-y-8">
            <div className="card p-6 border border-[#D0473E]/20 bg-white">
              <h3 className="font-serif text-2xl text-[#6A33D8] font-bold mb-2">Campaign Content & Klaviyo Mailer Blueprints</h3>
              <p className="text-sm text-gray-600">Deep-dive segment matrix connecting target stress/grail-drop profiles to high-open rate mailing pointer copy variants.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {THEMES.map(theme => (
                <div key={theme.id} className="card p-6 border border-gray-100 bg-white relative flex flex-col justify-between hover:shadow-md transition-all">
                  <div>
                    <span className="badge bg-[#F7F5F2] text-[#6A33D8] mb-3">Theme {theme.id}</span>
                    <h4 className="font-serif text-lg font-bold text-[#6A33D8] mb-2">{theme.name}</h4>

                    <div className="bg-[#F7F5F2] p-3 rounded border border-gray-150 mb-4 text-xs font-sans">
                      <p className="font-bold text-gray-600 font-mono text-xs uppercase mb-1">Core Root Problem</p>
                      <p className="text-gray-600 leading-relaxed">{theme.coreProblem}</p>
                    </div>

                    <div className="space-y-3 mb-6">
                      <div>
                        <span className="text-xs font-mono font-bold text-lava uppercase block">Recommended Subject Line:</span>
                        <p className="text-xs font-sans font-medium italic text-[#6A33D8]">{theme.subjectLines[0]}</p>
                      </div>
                      <div>
                        <span className="text-xs font-mono font-bold text-lava uppercase block">Body Copy Pointers:</span>
                        <ul className="list-disc pl-4 text-xs text-gray-600 space-y-1.5 font-sans">
                          {theme.mailerPointers.map((ptr, idx) => (
                            <li key={idx}>{ptr}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-50 pt-4 mt-auto">
                    <span className="text-xs font-mono text-gray-600 block mb-2">TARGET FUNNEL TUNNEL:</span>
                    <button
                      onClick={() => {
                        setSelectedTheme(theme);
                        setActiveTab('landing');
                      }}
                      className="w-full bg-[#6A33D8] text-white py-2.5 rounded font-sans uppercase font-bold text-xs tracking-wider flex items-center justify-center gap-1 hover:bg-[#6A33D8]"
                    >
                      <span>Pre-Compile Landing Page</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PRD TECHNICAL DOCS TAB */}
        {activeTab === 'automation' && (
          <div className="card p-8 bg-white border border-gray-200 font-sans shadow-sm leading-relaxed max-w-4xl mx-auto space-y-8">
            <div className="border-b border-gray-150 pb-6 text-center">
              <span className="text-xs font-mono text-[#6A33D8] tracking-widest uppercase font-bold">SYSTEM OPERATIONS CONFIG</span>
              <h2 className="font-serif text-3xl text-[#6A33D8] font-bold mt-1">Growth Automation & Engineering PRD</h2>
              <p className="text-sm text-gray-700 mt-2">TECHNICAL CONVERSION MACHINE MATRIX • FOR UNIVERSAL CAMPAIGN GENERATOR PLATFORMS</p>
            </div>

            {/* Architecture Overview */}
            <div>
              <h3 className="font-serif text-xl text-[#6A33D8] font-bold mb-3 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#D0473E]" />
                <span>1. Technical Core Architecture</span>
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                The marketing pipeline automates cold meta-ads acquisition to edge-compiled high-speed templates. Standalone, ultra-modular HTML models are created with critical zero-dep priority to enable edge deployment on Cloudflare CDN servers. This delivers sub-40ms response metrics and 100/100 Google PageSpeed scores, reducing bounces by 320% compared to legacy architectures.
              </p>
            </div>

            {/* DB Schema */}
            <div>
              <h3 className="font-serif text-xl text-[#6A33D8] font-bold mb-3 flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#D0473E]" />
                <span>2. Relational Postgres Database Schemas</span>
              </h3>
              <div className="bg-[#6A33D8] text-[#F7F5F2] p-5 rounded font-mono text-xs overflow-x-auto shadow-inner border border-[#D0473E]/30">
                <pre>{`-- Core Product Registry Table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    base_sku VARCHAR(100) UNIQUE NOT NULL,
    base_price DECIMAL(10,2) NOT NULL,
    discount_rate DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Marketing Themes and Grail-Drop Problem Profiles
CREATE TABLE marketing_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_slug VARCHAR(100) UNIQUE NOT NULL, -- e.g., 'face-puffiness', 'grail-drop-reset'
    display_title VARCHAR(255) NOT NULL,
    root_cause_explanation TEXT NOT NULL,
    scientific_hook TEXT NOT NULL,
    hero_asset_url TEXT NOT NULL
);

-- Landing Page Funnel Variant Types
CREATE TABLE funnel_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_code VARCHAR(10) UNIQUE NOT NULL, -- 'A', 'B1', 'B2', 'B3'
    architecture_type VARCHAR(100) NOT NULL,
    checkout_routing_url TEXT NOT NULL
);

-- Live Compiled Template Matrix Engine
CREATE TABLE campaign_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id),
    theme_id UUID REFERENCES marketing_themes(id),
    variant_id UUID REFERENCES funnel_variants(id),
    compiled_html_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);`}</pre>
              </div>
            </div>

            {/* Performance Indicators */}
            <div>
              <h3 className="font-serif text-xl text-[#6A33D8] font-bold mb-3 flex items-center gap-2">
                <Flame className="w-5 h-5 text-[#D0473E]" />
                <span>3. Meta & GA4 Automation Pipeline Logic</span>
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                Our Node.js compiler processes real-time database inputs, injecting precise theme content and custom URL handles into layout files. To close the optimizer loop, we deploy periodic sync workers targeting Facebook Lead Ads and conversion events. Performance metrics are evaluated continuously:
              </p>
              <div className="bg-[#F7F5F2] p-4 text-center rounded border border-[#D0473E]/40">
                <span className="font-serif text-lg font-bold text-[#6A33D8]">
                  Performance Evaluation Weight Metric = (Total Conversions / Total Page Views) × Average Order Value (AOV)
                </span>
              </div>
              <p className="text-xs text-gray-700 mt-2">
                Whenever performance indexes drop under the preset baseline, automated webhooks signal media buyer coordinators on Slack and shift destination routing safely on Vercel Edge networks.
              </p>
            </div>
          </div>
        )}

        {/* MASTER PROMPTS TAB */}
        {activeTab === 'prompt' && (
          <div className="space-y-8 max-w-4xl mx-auto">
            <div className="card p-6 bg-white border border-gray-200">
              <h3 className="font-serif text-2xl text-[#6A33D8] font-bold mb-2">Master Code Prompts for Claude & Gemini</h3>
              <p className="text-sm text-gray-600">Pre-configured operational prompts to copy directly into your AI workspace to recreate or generate extra landing page styles.</p>
            </div>

            <div className="card p-6 bg-white border border-gray-100 flex flex-col gap-4">
              <div>
                <span className="badge bg-[#6A33D8] text-white mb-2">1. Claude Code Optimization Prompt</span>
                <p className="text-xs text-gray-700 mb-3">Crafted specifically to compile clean single-file HTML layout scripts with direct loops.</p>
              </div>
              <div className="bg-gray-100 p-4 rounded text-xs font-mono overflow-y-auto max-h-60 border border-gray-200">
                <pre>{`You are a Staff Growth Engineer and Conversion Rate Optimization (CRO) expert.
Your goal is to generate completely functional, production-ready, ultra-fast vanilla HTML/CSS landing pages for Knickgasm Coffee Collection.

[CRITICAL ARCHITECTURAL COMMANDS]
1. DO NOT use placeholder text (e.g., no "Lorem Ipsum", no "[Insert Image Here]"). Every line of copy, review, and asset link must be written out fully.
2. The design MUST be ultra-responsive. Mobile view requires priority focus: all elements must fit perfectly on standard smartphone screens without sideways overflow, utilizing single-column structures, legible type hierarchies (min 16px body copy), and easily tappable touch targets (min 48px height).
3. Pack all styling inside a single, clean <style> block inside the <head>. Do not rely on external utility frame engines like Tailwind or Bootstrap via remote CDN.
4. Integrate the structural components specified by the layout variants below.

[PRODUCT DATA & CONTEXT]
- Product Name: Knickgasm India Coffee Collection (with Embroidery & Mushrooms)
- Primary Value Prop: Lowers stress grail-drop, targets systemic fluid retention, drains face puffiness, and tightens double chins.
- Key Incentives: Includes Free Premium Frother + Free Shipping + 40% Off Auto-Applied.
- Direct Loop Checkout URL: https://www.knickgasm.com/checkouts/cn/hWNCmxt7u1jZXyXdxrBlzdzw/en-gb?_r=AQABoe58v9uqX7Pp_-OyqVMFwPrfaxYao4Vl8qwo4KZEuWM&discount=AC_N
- Standard Cart Landing Page Flow URL: https://knickgasm.com/coffee-collection-n-two-b

[CORE MEDIA ASSET DATABASE]
- Hero Pack Image: https://cdn.shopify.com/s/files/1/2422/3321/files/Coffee_Pack_Front.png
- Ingredient Airbrush Colorway: https://cdn.shopify.com/s/files/1/2422/3321/files/Ingredients_Airbrush.jpg
- Video Review Loop Placeholder: https://cdn.shopify.com/s/files/1/2422/3321/files/Review_Video_1.mp4
- Trust Badge Icons: https://cdn.shopify.com/s/files/1/2422/3321/files/Trust_Badges_Horizontal.png

Please compile completely following mobile-first design guides.`}</pre>
              </div>
            </div>

            <div className="card p-6 bg-white border border-gray-100 flex flex-col gap-4">
              <div>
                <span className="badge bg-[#D0473E] text-[#111111] mb-2">2. Gemini Campaign & Copywriting Prompt</span>
                <p className="text-xs text-gray-700 mb-3">Designed for structural layout, behavioral customer targeting, and deep-benefit copywriting.</p>
              </div>
              <div className="bg-gray-100 p-4 rounded text-xs font-mono overflow-y-auto max-h-60 border border-gray-200">
                <pre>{`You are a Lead Conversion Architect and Frontend Engineer. Your task is to output a complete, responsive, semantic vanilla HTML/CSS landing page code block for the KNICKGASM UK Coffee Collection product. The theme for this page is completely focused on addressing "Face Puffiness and Water Retention" using clean adaptogens.

[DESIGN SPECIFICATIONS]
- Colors: Deep Teal (#6A33D8) as primary, Warm Lava (#D0473E) as secondary, Soft Chalk (#F7F5F2) as background, and Dark Charcoal (#111111) for clear reading.
- Typography: Use elegant fallback Serif fonts (like Georgia, "Playfair Display") for main headings, and clean Sans-Serif fonts (like Inter, system-ui) for body text and product options.
- Layout: Apply a clean mobile-first flexbox/grid layout. Use single-column structures for small devices with a minimum 16px font size, and expand to 2 columns on screens 1024px or wider.

Assemble high-performance, responsive HTML layouts optimized for consumer retention.`}</pre>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* Corporate Professional Footer */}
      <footer className="bg-[#6A33D8] border-t border-[#D0473E]/20 text-[#F7F5F2] py-8 mt-auto px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left text-xs space-y-1">
            <p className="font-serif text-sm font-semibold tracking-wide text-[#F7F5F2]">KNICKGASM Lifecycle OS &bull; Campaign Expansion Engine</p>
            <p className="text-[#F7F5F2]">Fully synced with knickgasm.vercel.app to optimize acquisition and retention funnels across the UK.</p>
          </div>
          <div className="text-xs text-[#F7F5F2] font-mono text-center sm:text-right">
            <span>Lifecycle OS Node Active • Live Session 2026</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
