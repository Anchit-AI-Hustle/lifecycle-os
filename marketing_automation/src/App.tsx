import React, { useState, useEffect } from 'react';
import {
  THEMES,
  FUNNEL_VARIANTS,
  compileHTML,
  AD_CAMPAIGN_TEMPLATES,
  AD_TARGETING_GAP,
  VERIFIABLE_CLAIMS,
} from './utils/compiler';
import { ThemeContent, FunnelVariant } from './types';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Sparkles,
  BookOpen,
  Download,
  FileCode,
  ChevronRight,
  Mail,
  Layers,
  Smartphone,
  Monitor,
  Zap,
  Flame,
  Award,
  Megaphone,
  Globe,
  Check
} from 'lucide-react';

/*
 * Campaign Hub — the local React workspace over the landing-page compiler.
 *
 * Every campaign fact rendered on this page comes from utils/compiler.ts, which
 * is the same record set api/_shared/lp-compiler.js serves at /lp/:id. This file
 * holds NO campaign data of its own: it is a viewer. Anything it cannot source
 * from a theme record or from the brand's approved claims is shown as a
 * [DATA REQUIRED BEFORE LAUNCH: ...] marker instead of a plausible-looking
 * placeholder, per docs/campaign-orchestration-master-spec.md.
 */

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
    <div className="min-h-screen bg-[#FFFFFF] text-[#111111] flex flex-col font-sans">

      {/* Dynamic Navigation Header */}
      <header className="bg-[#D0473E] text-white border-b border-[#6A33D8] py-4 px-6 sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-3">
              <span className="p-2 bg-[#6A33D8] rounded-lg text-[#111111] font-bold shadow-inner animate-pulse">
                <Sparkles className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight uppercase font-serif">KNICKGASM</h1>
                <p className="text-xs text-[#FFFFFF] font-mono tracking-wider">LIFECYCLE OS &bull; Campaign Suite</p>
              </div>
            </div>

            {/* Core back-link on mobile preview */}
            <a
              href="https://knickgasm.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="md:hidden flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[#6A33D8] text-[#FFFFFF] hover:text-white hover:border-white font-mono transition-all bg-[#D0473E]"
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
                  ? 'bg-[#6A33D8] text-[#111111] shadow-sm font-medium'
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
                  ? 'bg-[#6A33D8] text-[#111111] shadow-sm font-medium'
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
                  ? 'bg-[#6A33D8] text-[#111111] shadow-sm font-medium'
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
                  ? 'bg-[#6A33D8] text-[#111111] shadow-sm'
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
                  ? 'bg-[#6A33D8] text-[#111111] shadow-sm'
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
              className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#6A33D8] hover:border-white text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] hover:text-white hover:bg-white/10 transition-all ml-2"
              id="back-to-vercel-desktop"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Core OS Dashboard</span>
            </a>
          </div>
        </div>
      </header>

      {/* Control Panel Area */}
      <section className="bg-[#D0473E] text-[#FFFFFF] py-6 px-6 shadow-md border-b border-[#6A33D8]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-xs font-mono text-[#FFFFFF] uppercase tracking-widest mb-2 font-bold">1. Select Target Campaign Angle</label>
            <div className="relative">
              <select
                value={selectedTheme.id}
                onChange={(e) => {
                  const t = THEMES.find(item => item.id === parseInt(e.target.value));
                  if (t) setSelectedTheme(t);
                }}
                className="w-full bg-[#D0473E] text-white border border-[#6A33D8] px-4 py-3 rounded-md font-serif text-lg focus:border-white cursor-pointer"
              >
                {THEMES.map(theme => (
                  <option key={theme.id} value={theme.id}>
                    Theme {theme.id}: {theme.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-sm text-[#FFFFFF] italic font-sans leading-relaxed">
              <strong>Buyer Tension:</strong> {selectedTheme.coreProblem}
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono text-[#FFFFFF] uppercase tracking-widest mb-2 font-bold">2. Select Funnel Conversion Architecture Type</label>
            <select
              value={selectedVariant.code}
              onChange={(e) => {
                const v = FUNNEL_VARIANTS.find(item => item.code === e.target.value);
                if (v) setSelectedVariant(v);
              }}
              className="w-full bg-[#D0473E] text-white border border-[#6A33D8] px-4 py-3 rounded-md font-sans text-sm md:text-base focus:border-white cursor-pointer"
            >
              {FUNNEL_VARIANTS.map(variant => (
                <option key={variant.code} value={variant.code}>
                  {variant.name} ({variant.type})
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-[#FFFFFF] italic font-sans leading-relaxed">
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
              <div className="card border border-[#6A33D8]/15 transform transition-all p-6">
                <span className="badge mb-3">VARIANT CONFIG</span>
                <h3 className="text-xl font-serif text-[#D0473E] font-bold mb-2">{selectedVariant.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{selectedVariant.description}</p>

                <div className="space-y-3 font-sans text-xs border-t border-gray-100 pt-4">
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600 font-mono">Journey Flow:</span>
                    <span className="font-bold text-[#D0473E] text-right">{selectedVariant.flowShort}</span>
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

              <div className="card bg-[#D0473E] text-white p-6">
                <h4 className="font-serif text-lg text-[#FFFFFF] mb-3">Live Compilation Actions</h4>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleCopyCode}
                    className="w-full bg-[#6A33D8] text-[#111111] hover:bg-[#6A33D8] py-3 rounded font-bold uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition-all min-h-[48px]"
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
                  <p className="text-sm text-[#FFFFFF] font-mono leading-relaxed">
                    💡 <strong>Pro Tip:</strong> The same compiler runs server-side at <code>/lp/:id</code>, so a page
                    downloaded here is byte-identical to the one the app serves.
                  </p>
                </div>
              </div>

              {/* What this brand is allowed to assert */}
              <div className="card p-6 border border-gray-150">
                <h4 className="font-serif text-[#D0473E] font-bold mb-3 flex items-center gap-2">
                  <Award className="w-5 h-5 text-[#6A33D8]" />
                  <span>Approved Claims</span>
                </h4>
                <ul className="list-disc list-inside space-y-1.5 text-xs text-gray-600 font-sans">
                  {VERIFIABLE_CLAIMS.map((claim, idx) => (
                    <li key={idx}>{claim}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-gray-500 mt-3 leading-relaxed font-sans">
                  The only statements this workspace may assert as fact, quoted from
                  <code className="mx-1">data/brands/_default.json</code>. Ratings, review counts and
                  testimonials are not among them and are never generated here.
                </p>
                <p className="text-[11px] text-gray-500 mt-2 font-mono leading-relaxed">
                  [DATA REQUIRED BEFORE LAUNCH: approved review library and average rating, per region]
                </p>
              </div>
            </div>

            {/* Right Hand: Visual Live Compilation & Code Preview Container */}
            <div className="lg:col-span-8 flex flex-col gap-4">

              <div className="bg-white border border-[#6A33D8]/15 rounded-lg overflow-hidden flex flex-col shadow-sm">

                {/* Header controls inside canvas */}
                <div className="bg-[#FFFFFF] border-b border-gray-100 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
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
                        previewMode === 'desktop' ? 'bg-[#D0473E] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Desktop View</span>
                    </button>
                    <button
                      onClick={() => setPreviewMode('mobile')}
                      className={`px-3 py-1.5 rounded text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                        previewMode === 'mobile' ? 'bg-[#D0473E] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
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
            <div className="card p-6 border border-[#6A33D8]/20 bg-[#D0473E] text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="text-xs font-mono text-[#FFFFFF] tracking-widest uppercase font-bold">CROSS-CHANNEL ACQUISITION ENGINE</span>
                <h3 className="font-serif text-3xl font-bold mt-1 text-white">Interactive Ad Campaign Studio</h3>
                <p className="text-sm text-[#FFFFFF] mt-1 max-w-2xl leading-relaxed">
                  Meta and Google collateral for each of the {AD_CAMPAIGN_TEMPLATES.length} campaign angles,
                  rendered from the same theme records the landing pages compile from. Change a theme and
                  the ad, the mailer and the page move together.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-[#D0473E] p-2.5 rounded border border-[#6A33D8]/30 text-xs font-mono">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                <span>DERIVED FROM THEMES &bull; NO SECOND SOURCE</span>
              </div>
            </div>

            {/* Selector Pills across every angle */}
            <div className="space-y-2">
              <label className="block text-xs font-mono text-[#D0473E] uppercase tracking-widest font-bold">
                1. Switch Campaign Angle ({AD_CAMPAIGN_TEMPLATES.length} angles)
              </label>
              <div className="flex flex-wrap gap-2">
                {AD_CAMPAIGN_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.themeId}
                    onClick={() => setSelectedAdThemeId(tpl.themeId)}
                    className={`px-4 py-2 text-xs font-semibold rounded-full border transition-all ${
                      selectedAdThemeId === tpl.themeId
                        ? 'bg-[#D0473E] text-white border-[#D0473E] shadow-sm'
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
                        <span className="badge mb-2 bg-[#FFFFFF] text-[#D0473E]">BUYER PARAMETERS Matrix</span>
                        <h4 className="text-lg font-serif font-bold text-[#D0473E]">{currentTpl.angleName}</h4>
                        <p className="text-xs text-gray-700 mt-1 italic">
                          <strong>Active Strategy Path:</strong> {correspondingThemeObj?.landingPageVariant || "No associated Variant Path"}
                        </p>
                      </div>

                      <div className="border-t border-gray-100 pt-3 space-y-2.5">
                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">Buyer Tension:</span>
                          <span className="text-gray-700 leading-relaxed font-sans">{correspondingThemeObj?.coreProblem}</span>
                        </div>

                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">Interest Targeting (Meta / Google):</span>
                          {currentTpl.targetInterests.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {currentTpl.targetInterests.map((interest, idx) => (
                                <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono border border-gray-150">
                                  {interest}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-gray-600 font-mono text-[11px] leading-relaxed">
                              {AD_TARGETING_GAP}
                              <br />
                              Targeting lives in the ad account, not in this repo. Pull the live interest
                              sets from Ads Manager before this angle goes to a buyer.
                            </p>
                          )}
                        </div>

                        <div className="text-xs">
                          <span className="font-mono text-gray-600 block uppercase font-semibold">PMax Callouts (approved claims only):</span>
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
                          className="flex-1 px-4 py-2 bg-[#6A33D8] text-[#111111] text-xs font-bold rounded hover:bg-[#6A33D8] transition-colors flex items-center justify-center gap-1.5"
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

                    <div className="card p-5 bg-[#FFFFFF] border border-[#6A33D8]/30 rounded text-xs space-y-2.5">
                      <h5 className="font-serif font-bold text-[#D0473E] flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#6A33D8]" />
                        <span>Creative Alignment Guidelines</span>
                      </h5>
                      <p className="text-gray-600 leading-relaxed font-sans">
                        Pair these hooks with the pair itself: macro on the hand-painted linework, the
                        artist at the bench, or the finished silhouette on foot. Show a real catalog
                        design, never a mocked-up one, and never imply the base is anything other than a
                        100% original sneaker.
                      </p>
                      <p className="text-gray-600 leading-relaxed font-mono text-[11px]">
                        No discount code, gift or offer is generated here. If a promotion is running, it
                        comes from the approved offer record, not from this tool.
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Visual Campaign Mockups */}
                  <div className="lg:col-span-7 flex flex-col gap-4">
                    {/* Mockup tabs trigger */}
                    <div className="bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between shadow-sm">
                      <span className="text-xs font-mono font-bold text-[#D0473E] uppercase">2. Select Screen Mockup Channel:</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActiveAdNetwork('meta')}
                          className={`px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded transition-all ${
                            activeAdNetwork === 'meta'
                              ? 'bg-[#D0473E] text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          Meta Feed Mockup (FB/IG)
                        </button>
                        <button
                          onClick={() => setActiveAdNetwork('google')}
                          className={`px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded transition-all ${
                            activeAdNetwork === 'google'
                              ? 'bg-[#D0473E] text-white'
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
                              <div className="w-9 h-9 rounded-full bg-[#D0473E] text-white flex items-center justify-center font-serif font-extrabold text-sm border-2 border-[#6A33D8]">
                                K
                              </div>
                              <div>
                                <div className="font-bold flex items-center gap-1 text-[13px] text-gray-900">
                                  <span>KNICKGASM</span>
                                  <span className="bg-blue-500 text-white rounded-full p-0.5 text-xs flex items-center justify-center" style={{ width: '12px', height: '12px' }}>✓</span>
                                </div>
                                <span className="text-xs text-gray-700 font-mono">Sponsored &bull; Mockup preview</span>
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
                              src={correspondingThemeObj?.assets.heroFace}
                              referrerPolicy="no-referrer"
                              alt="KNICKGASM hand-painted custom sneaker"
                              className="w-full h-64 object-cover"
                            />
                            {/* CTA Banner overlay */}
                            <div className="bg-white border-t border-gray-100 p-3 flex items-center justify-between">
                              <div className="space-y-0.5 pr-2">
                                <span className="text-xs tracking-wider text-gray-600 font-mono uppercase block">KNICKGASM.COM</span>
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

                          {/* Engagement counters are real platform data, never invented for a mockup. */}
                          <div className="px-4 py-2.5 bg-white text-gray-700 text-[11px] font-mono border-b border-gray-100">
                            [DATA REQUIRED BEFORE LAUNCH: live engagement counts, per creative, from Ads Manager]
                          </div>
                        </div>
                      ) : (
                        /* Google Mockup */
                        <div className="w-full max-w-xl bg-white border border-gray-200 rounded-lg p-5 shadow-md font-sans text-xs">
                          <div className="flex items-center gap-1 text-gray-700 mb-1">
                            <span className="p-1 px-1.5 bg-gray-100 text-xs font-bold rounded uppercase tracking-wider text-gray-600 mr-1.5">Ad</span>
                            <span className="text-xs">{correspondingThemeObj?.variantLink}</span>
                          </div>

                          {/* Clickable Blue headlines */}
                          <h4 className="text-lg text-[#1a0dab] hover:underline cursor-pointer font-medium leading-snug">
                            {currentTpl.googleHeadline1} | {currentTpl.googleHeadline2}
                          </h4>

                          {/* Description info */}
                          <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">
                            {currentTpl.googleDescription1} {currentTpl.googleDescription2}
                          </p>

                          {/* Site extensions built from approved claims */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 pt-3 border-t border-gray-100 text-[#1a0dab]">
                            {currentTpl.pMaxCallouts.map((callout, idx) => (
                              <div key={idx}>
                                <span className="hover:underline cursor-pointer block font-semibold text-[13px]">{callout}</span>
                              </div>
                            ))}
                          </div>

                          <p className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500 font-mono leading-relaxed">
                            Headlines are the theme's own subject lines
                            ({currentTpl.googleHeadline1.length}/{currentTpl.googleHeadline2.length}/{currentTpl.googleHeadline3.length} chars).
                            Google caps a headline at 30 characters: trim deliberately before upload rather
                            than letting a claim get cut mid-sentence.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Campaign Summary Deck footer */}
            <div className="card p-6 border border-gray-200 bg-white shadow-sm space-y-4">
              <h4 className="font-serif text-xl text-[#D0473E] font-bold">Cross-Channel Deployment Matrix Overview</h4>
              <p className="text-xs text-gray-700 leading-relaxed">
                Every angle below and the landing page it points at are the same record. Editing a theme in
                <code className="mx-1">src/utils/compiler.ts</code> updates all three surfaces at once.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-sans">
                {AD_CAMPAIGN_TEMPLATES.map(tpl => (
                  <div key={tpl.themeId} className="p-4 bg-gray-50 border border-gray-150 rounded flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[#D0473E] uppercase font-bold text-xs">Variant {tpl.themeId} Angle</span>
                      <h5 className="font-bold text-[#D0473E] mt-0.5 mb-1.5">{tpl.angleName}</h5>
                      <p className="text-gray-600 line-clamp-2 text-xs leading-relaxed mb-3">{tpl.metaHook}</p>
                    </div>
                    <button
                      onClick={() => setSelectedAdThemeId(tpl.themeId)}
                      className="w-full py-1 border border-[#D0473E]/20 hover:border-[#D0473E] text-center font-bold font-mono text-xs uppercase tracking-wider text-[#D0473E] rounded mt-2 bg-white transition-all"
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
            <div className="card p-6 border border-[#6A33D8]/20 bg-white">
              <h3 className="font-serif text-2xl text-[#D0473E] font-bold mb-2">Campaign Content &amp; Klaviyo Mailer Blueprints</h3>
              <p className="text-sm text-gray-600">The subject lines and body pointers each angle ships with, ready to lift into a Klaviyo flow.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {THEMES.map(theme => (
                <div key={theme.id} className="card p-6 border border-gray-100 bg-white relative flex flex-col justify-between hover:shadow-md transition-all">
                  <div>
                    <span className="badge bg-[#FFFFFF] text-[#D0473E] mb-3">Theme {theme.id}</span>
                    <h4 className="font-serif text-lg font-bold text-[#D0473E] mb-2">{theme.name}</h4>

                    <div className="bg-[#FFFFFF] p-3 rounded border border-gray-150 mb-4 text-xs font-sans">
                      <p className="font-bold text-gray-600 font-mono text-xs uppercase mb-1">Buyer Tension</p>
                      <p className="text-gray-600 leading-relaxed">{theme.coreProblem}</p>
                    </div>

                    <div className="space-y-3 mb-6">
                      <div>
                        <span className="text-xs font-mono font-bold text-lava uppercase block">Recommended Subject Line:</span>
                        <p className="text-xs font-sans font-medium italic text-[#D0473E]">{theme.subjectLines[0]}</p>
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
                      className="w-full bg-[#D0473E] text-white py-2.5 rounded font-sans uppercase font-bold text-xs tracking-wider flex items-center justify-center gap-1 hover:bg-[#D0473E]"
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
              <span className="text-xs font-mono text-[#D0473E] tracking-widest uppercase font-bold">SYSTEM OPERATIONS CONFIG</span>
              <h2 className="font-serif text-3xl text-[#D0473E] font-bold mt-1">Growth Automation &amp; Engineering PRD</h2>
              <p className="text-sm text-gray-700 mt-2">HOW THIS COMPILER WORKS &bull; AND WHAT IT DELIBERATELY DOES NOT DO</p>
            </div>

            {/* Architecture Overview */}
            <div>
              <h3 className="font-serif text-xl text-[#D0473E] font-bold mb-3 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#6A33D8]" />
                <span>1. Technical Core Architecture</span>
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                A theme record plus a funnel variant compiles to one self-contained HTML file: inline
                critical CSS, no external stylesheet, no build step at serve time. The same function runs
                in this workspace and in <code>api/_shared/lp-compiler.js</code> behind
                <code className="mx-1">/lp/:id</code>, so what you preview is what ships.
              </p>
              <p className="text-xs text-gray-700 font-mono leading-relaxed">
                [DATA REQUIRED BEFORE LAUNCH: page-speed, bounce-rate and response-time benchmarks, per
                template] &mdash; no performance figure is quoted here until it has been measured on this
                brand's own pages.
              </p>
            </div>

            {/* DB Schema */}
            <div>
              <h3 className="font-serif text-xl text-[#D0473E] font-bold mb-3 flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#6A33D8]" />
                <span>2. Relational Postgres Database Schemas</span>
              </h3>
              <div className="bg-[#D0473E] text-[#FFFFFF] p-5 rounded font-mono text-xs overflow-x-auto shadow-inner border border-[#6A33D8]/30">
                <pre>{`-- Core Product Registry Table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    base_sku VARCHAR(100) UNIQUE NOT NULL,
    base_model VARCHAR(100) NOT NULL,       -- the original silhouette painted on
    base_price DECIMAL(10,2) NOT NULL,
    compare_at_price DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign angles (one row per landing/ad/mailer theme)
CREATE TABLE marketing_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_slug VARCHAR(100) UNIQUE NOT NULL, -- e.g. 'one-of-one', 'anime-fandom'
    display_title VARCHAR(255) NOT NULL,
    buyer_tension TEXT NOT NULL,
    craft_proof TEXT NOT NULL,
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
              <h3 className="font-serif text-xl text-[#D0473E] font-bold mb-3 flex items-center gap-2">
                <Flame className="w-5 h-5 text-[#6A33D8]" />
                <span>3. Measurement Loop</span>
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                Compiled pages carry UTM parameters back to the analytics layer, so each theme and variant
                is judged on its own traffic rather than on a blended average. The scoring formula is:
              </p>
              <div className="bg-[#FFFFFF] p-4 text-center rounded border border-[#6A33D8]/40">
                <span className="font-serif text-lg font-bold text-[#D0473E]">
                  Performance Evaluation Weight Metric = (Total Conversions / Total Page Views) × Average Order Value (AOV)
                </span>
              </div>
              <p className="text-xs text-gray-700 mt-2">
                The loop is read-only in this workspace: nothing here edits a budget, pauses a campaign or
                writes back to an ad platform.
              </p>
            </div>
          </div>
        )}

        {/* MASTER PROMPTS TAB */}
        {activeTab === 'prompt' && (
          <div className="space-y-8 max-w-4xl mx-auto">
            <div className="card p-6 bg-white border border-gray-200">
              <h3 className="font-serif text-2xl text-[#D0473E] font-bold mb-2">Master Code Prompts for Claude &amp; Gemini</h3>
              <p className="text-sm text-gray-600">
                Operational prompts for generating another page in this system. Both deliberately refuse to
                invent product facts: a prompt that lets a model make up a price or a review is how a
                fabricated claim reaches a customer.
              </p>
            </div>

            <div className="card p-6 bg-white border border-gray-100 flex flex-col gap-4">
              <div>
                <span className="badge bg-[#D0473E] text-white mb-2">1. Claude Code Optimization Prompt</span>
                <p className="text-xs text-gray-700 mb-3">Compiles a clean single-file HTML page in this design system.</p>
              </div>
              <div className="bg-gray-100 p-4 rounded text-xs font-mono overflow-y-auto max-h-60 border border-gray-200">
                <pre>{`You are a Staff Growth Engineer and Conversion Rate Optimization (CRO) expert.
Generate a production-ready, ultra-fast vanilla HTML/CSS landing page for KNICKGASM,
India's largest sneaker customiser: hand-painted one-of-one customs on 100% original
Nike, Jordan, Converse and Adidas sneakers.

[CRITICAL ARCHITECTURAL COMMANDS]
1. DO NOT use placeholder text (no "Lorem Ipsum", no "[Insert Image Here]"). Every line
   of copy and every asset link must be written out fully.
2. Mobile-first and ultra-responsive: single-column on small screens, no sideways
   overflow, minimum 16px body copy, minimum 48px tappable targets.
3. All styling inside one <style> block in the <head>. No remote CSS/JS frameworks.
4. Follow the structure of the selected funnel variant.

[ZERO FABRICATION - THIS OVERRIDES EVERY OTHER INSTRUCTION]
- Every product name, price, compare-at price, image URL and product URL must be copied
  from data/catalog/products_{region}.json. Never invent one, never adapt one from
  another region, never round a price.
- The only claims you may assert are the brand's approved claims: India's largest
  sneaker customisers; Made on 100% original brand sneakers; Hand-painted by India's
  best artists; Water and scratch resistant designs; Express shipping worldwide to 60+
  countries; Free shipping in India and worldwide.
- Never invent a review, a reviewer, a star rating, a rating count, a discount code, a
  countdown or a stock level. If the page design needs one and no approved value exists,
  emit [DATA REQUIRED BEFORE LAUNCH: field, product, region] in its place.
- Never imply the pairs are replicas. They are hand-painted ON original sneakers.
- Banned phrasing: wellness journey, transform, liquid gold, game-changer, LIMITED TIME,
  hurry, don't miss out, last chance, while supplies last, replica, knock-off, first
  copy, fake pair. No em or en dashes anywhere in output copy.

[DESIGN CONSTANTS]
- Palette, and only this palette: #D0473E primary accent, #6A33D8 secondary,
  #111111 ink (text only, never a section background), #FFFFFF background.
- Headings Montserrat, body Instrument Sans.
- Never a dark-neutral section background; WCAG-AA contrast throughout.`}</pre>
              </div>
            </div>

            <div className="card p-6 bg-white border border-gray-100 flex flex-col gap-4">
              <div>
                <span className="badge bg-[#6A33D8] text-[#111111] mb-2">2. Gemini Campaign &amp; Copywriting Prompt</span>
                <p className="text-xs text-gray-700 mb-3">For layout, audience framing and benefit copy on a new angle.</p>
              </div>
              <div className="bg-gray-100 p-4 rounded text-xs font-mono overflow-y-auto max-h-60 border border-gray-200">
                <pre>{`You are a Lead Conversion Architect and Frontend Engineer. Output a complete,
responsive, semantic vanilla HTML/CSS landing page for a KNICKGASM campaign angle.
KNICKGASM hand-paints one-of-one custom artwork onto 100% original branded sneakers in
Mumbai, made to order in 10 to 15 days and shipped express to 60+ countries.

[ANGLE]
Use the selected theme's buyer tension and craft proof verbatim as the argument of the
page. Do not introduce a new benefit, a health claim or an outcome promise of any kind:
this is a product people wear, not a product that does something to them.

[DESIGN SPECIFICATIONS]
- Colors: #D0473E primary accent, #6A33D8 secondary, #FFFFFF background, #111111 for
  text. Never a dark-neutral section, card, hero or footer background.
- Typography: Montserrat for headings, Instrument Sans for body.
- Mobile-first flexbox/grid; single column under 1024px, minimum 16px body text.

[SOURCING]
Prices, product names, handles and images come from the live catalog only. Reviews and
ratings come from the approved review library only; if it is empty, render
[DATA REQUIRED BEFORE LAUNCH: approved reviews, product, region] rather than writing a
testimonial. Assume nothing about stock, delivery dates or discounts.`}</pre>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* Corporate Professional Footer */}
      <footer className="bg-[#D0473E] border-t border-[#6A33D8]/20 text-[#FFFFFF] py-8 mt-auto px-6 font-sans">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left text-xs space-y-1">
            <p className="font-serif text-sm font-semibold tracking-wide text-[#FFFFFF]">Lifecycle OS &bull; Campaign Expansion Engine</p>
            <p className="text-[#FFFFFF]">Local workspace over the same landing-page compiler the app serves at /lp/:id.</p>
          </div>
          <div className="text-xs text-[#FFFFFF] font-mono text-center sm:text-right">
            <span>Lifecycle OS Node Active • Live Session 2026</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
