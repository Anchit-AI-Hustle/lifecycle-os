'use strict';
/**
 * asset-auditor.js — Pre-flight Revenue Quality & Compliance Grader
 * ---------------------------------------------------------------------------
 * Evaluates generated or operator-provided marketing assets (mailers, ads,
 * landing pages) against empirical benchmarks, conversion architecture,
 * and regulatory compliance standards across all commercial business models.
 *
 * Provides a 0-100 score, letter grade (A+ through F), category breakdown,
 * and actionable fix recommendations.
 */

const assetPlaybooks = require('./asset-playbooks.js');

const AUDIT_WEIGHTS = {
  compliance: 25,
  visualIntegrity: 25,
  conversionArchitecture: 30,
  brandAlignment: 20,
};

const BANNED_FINANCIAL_PATTERNS = [
  /\bguaranteed\s+(?:profit|profits|return|returns|gains?|10x|100x)\b/i,
  /\b(?:100%|zero)\s+risk\b/i,
  /\bget\s+rich\s+quick\b/i,
  /\b(?:surefire|fail-?safe)\s+(?:profit|return|trade|strategy)\b/i,
  /\bdouble\s+your\s+money\s+(?:in|overnight|guaranteed)\b/i,
  /\binsider\s+(?:tip|tips|information|trade)\b/i,
];

const BANNED_MEDICAL_PATTERNS = [
  /\bcures?\s+(?:cancer|diabetes|illness|disease)\b/i,
  /\bguaranteed\s+weight\s+loss\b/i,
  /\bmiracle\s+(?:cure|treatment|healing)\b/i,
];

const SYNTHETIC_CHART_PATTERNS = [
  /\b(?:ai-?generated|synthetic|invented|fake)\s+(?:candlestick|chart|ticker|stock\s*price)\b/i,
  /\bhallucinat(?:ed?|ing)\s+(?:chart|ticker|data)\b/i,
  /\bfictional\s+(?:ticker|stock\s*symbol|percentage\s*gain)\b/i,
];

/**
 * Audit an asset for revenue conversion readiness, structural excellence,
 * and regulatory compliance.
 *
 * @param {object} params
 * @param {string} params.content      - Asset text / HTML / prompt string
 * @param {string} params.assetType    - 'mailer' | 'ad' | 'landing_page'
 * @param {object} [params.brand]      - The active brand record
 * @param {string} [params.market]     - Target market ('IN'|'US'|'UK'|'Global')
 * @returns {object} Audit report with score, grade, breakdown and issues
 */
function auditAsset({ content = '', assetType = 'mailer', brand = null, market = 'Global' } = {}) {
  const text = String(content || '');
  const model = brand ? assetPlaybooks.businessModel(brand) : 'commerce';
  const type = String(assetType || 'mailer').toLowerCase();
  const brandName = brand && brand.name ? brand.name : 'the brand';

  const issues = [];
  let complianceScore = AUDIT_WEIGHTS.compliance;
  let visualScore = AUDIT_WEIGHTS.visualIntegrity;
  let conversionScore = AUDIT_WEIGHTS.conversionArchitecture;
  let brandScore = AUDIT_WEIGHTS.brandAlignment;

  // ── 1. Regulatory & Commercial Compliance (25 pts) ─────────────────────────
  if (model === 'market_data') {
    // Check for required disclaimer
    const hasDisclaimer = /\b(?:not\s+an?\s+(?:investment|financial)\s+advis|educational\s+purposes?|research\s+analyst|securities|past\s+performance|investments\s+are\s+subject\s+to\s+market\s+risks?|sebi|finra|sec|fca)\b/i.test(text);
    if (!hasDisclaimer) {
      complianceScore -= 18;
      issues.push({
        category: 'compliance',
        severity: 'critical',
        rule: 'missing_financial_disclaimer',
        message: `Market data asset is missing mandatory regulatory disclaimer for ${market} market.`,
        fix: `Include the standard non-advice educational disclaimer: "${assetPlaybooks.financialDisclaimer(market, brand)}"`,
      });
    }

    // Check for banned guaranteed profit terms
    for (const pat of BANNED_FINANCIAL_PATTERNS) {
      if (pat.test(text)) {
        complianceScore = 0;
        issues.push({
          category: 'compliance',
          severity: 'critical',
          rule: 'prohibited_guarantee_claim',
          message: `Asset contains illegal guaranteed financial return claim matching ${pat}.`,
          fix: 'Remove all claims of guaranteed profits, risk-free returns, or overnight wealth.',
        });
        break;
      }
    }
  } else {
    // General health/cure checks
    for (const pat of BANNED_MEDICAL_PATTERNS) {
      if (pat.test(text)) {
        complianceScore -= 15;
        issues.push({
          category: 'compliance',
          severity: 'critical',
          rule: 'prohibited_health_claim',
          message: `Asset contains unsupported health or cure claim matching ${pat}.`,
          fix: 'Remove medical and miracle health claims; rely strictly on verifiable brand claims.',
        });
        break;
      }
    }
  }

  // ── 2. Visual & Image Data Integrity (25 pts) ──────────────────────────────
  if (model === 'market_data') {
    for (const pat of SYNTHETIC_CHART_PATTERNS) {
      if (pat.test(text)) {
        visualScore -= 15;
        issues.push({
          category: 'visualIntegrity',
          severity: 'critical',
          rule: 'synthetic_chart_hallucination',
          message: 'Visual brief references AI-generated/synthetic financial charts or fictional tickers.',
          fix: 'Use authentic editorial photography, trading desk mood stills with blurred screens, or verified data tables only.',
        });
        break;
      }
    }
  }

  // Check for base64 payload leak
  if (/data:image\/[a-zA-Z]+;base64,/i.test(text)) {
    visualScore -= 10;
    issues.push({
      category: 'visualIntegrity',
      severity: 'warning',
      rule: 'base64_image_leak',
      message: 'Asset embeds base64 image data directly instead of hosted media URLs, risking delivery clipping.',
      fix: 'Use hosted HTTPS URLs for all image references.',
    });
  }

  // ── 3. Conversion Architecture & Revenue Levers (30 pts) ───────────────────
  if (type === 'mailer') {
    const isHtml = /<table|<div|<body|<html/i.test(text);

    // Subject line presence
    const hasSubject = /\bsubject(?:\s*line)?\s*[:\-]/i.test(text) || /<title>/i.test(text);
    if (!hasSubject && !isHtml) {
      conversionScore -= 5;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'warning',
        rule: 'missing_subject_lines',
        message: 'Mailer lacks explicit high-converting subject line options.',
        fix: 'Provide at least 3 subject line options (under 50 chars) and 1 preheader.',
      });
    }

    // Call to Action check
    const hasCTA = /\b(?:cta|button|href=|read\s+full|subscribe|join|start|claim|explore|view)\b/i.test(text);
    if (!hasCTA) {
      conversionScore -= 10;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'critical',
        rule: 'missing_primary_cta',
        message: 'Mailer lacks a clear primary conversion CTA.',
        fix: 'Add a high-contrast primary call-to-action button driving to the primary conversion destination.',
      });
    }

    // Outlook email compatibility
    if (isHtml && !/bgcolor=/i.test(text)) {
      conversionScore -= 4;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'info',
        rule: 'email_client_outlook_compat',
        message: 'Mailer HTML does not specify bgcolor attributes on colored cells for Outlook rendering safety.',
        fix: 'Add bgcolor="..." to all colored table cells alongside CSS background-color.',
      });
    }

    // Reading time / Dateline for information brands
    if ((model === 'market_data' || model === 'news_media') && !/\b(?:min\s*read|edition|read\s*time|dateline)\b/i.test(text)) {
      conversionScore -= 4;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'info',
        rule: 'missing_reading_time_dateline',
        message: 'Information briefing lacks session dateline or estimated reading time.',
        fix: 'Add an executive dateline header (e.g. "Pre-Market Intelligence · 4 min read").',
      });
    }
  } else if (type === 'ad') {
    // 1-second scroll-stopping hook check
    const hasHook = /\b(?:hook|scroll-?stop|headline|overlay)\b/i.test(text);
    if (!hasHook) {
      conversionScore -= 8;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'warning',
        rule: 'missing_scroll_stop_hook',
        message: 'Ad creative lacks an explicit 1-second scroll-stopping hook specification.',
        fix: 'Define the 0-1s visual hook and baked-in headline overlay.',
      });
    }

    // Safe zone guidance
    if (!/\bsafe\s*zones?\b/i.test(text) && /\b9:16\b/i.test(text)) {
      conversionScore -= 4;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'info',
        rule: 'missing_safe_zone_rules',
        message: 'Vertical 9:16 ad does not specify safe-zone padding to avoid platform UI clipping.',
        fix: 'Keep all text overlay clear of the bottom 20% platform UI area.',
      });
    }
  } else if (type === 'landing_page' || type === 'lp') {
    // Social proof check
    const hasProof = /\b(?:reviews?|testimonials?|subscribers?|rating|trusted\s+by|backed\s+by)\b/i.test(text);
    if (!hasProof) {
      conversionScore -= 6;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'warning',
        rule: 'missing_social_proof',
        message: 'Landing page lacks social proof, testimonials, or subscriber count credibility indicators.',
        fix: 'Add a verified social proof bar or subscriber counter above the fold.',
      });
    }

    // FAQ / Objection handling
    const hasFAQ = /\b(?:faq|frequently\s+asked|questions?|cancel\s+anytime|guarantee)\b/i.test(text);
    if (!hasFAQ) {
      conversionScore -= 5;
      issues.push({
        category: 'conversionArchitecture',
        severity: 'info',
        rule: 'missing_risk_reversal_or_faq',
        message: 'Landing page lacks an FAQ or risk-reversal guarantee section.',
        fix: 'Include a 3-5 item FAQ or risk-free guarantee to overcome buyer hesitation.',
      });
    }
  }

  // ── 4. Brand Alignment & Identity (20 pts) ─────────────────────────────────
  // Foreign brand tenant leak check
  if (brand && brand.id && brand.id !== 'knickgasm' && brand.name && !/knickgasm/i.test(brand.name)) {
    if (/\bknickgasm\b/i.test(text)) {
      brandScore = 0;
      issues.push({
        category: 'brandAlignment',
        severity: 'critical',
        rule: 'foreign_brand_tenant_leak',
        message: 'Asset mentions "Knickgasm" inside a foreign brand workspace.',
        fix: `Replace any foreign brand references with active brand name: "${brand.name}".`,
      });
    }
  }

  // Ensure active brand name or identity is present
  if (brand && brand.name && !new RegExp(`\\b${brand.name}\\b`, 'i').test(text)) {
    brandScore -= 6;
    issues.push({
      category: 'brandAlignment',
      severity: 'info',
      rule: 'brand_name_missing',
      message: `Active brand name "${brand.name}" does not appear explicitly in the asset content.`,
      fix: `Weave "${brand.name}" naturally into the masthead, offer, or legal footer.`,
    });
  }

  // Normalize scores
  complianceScore = Math.max(0, Math.min(AUDIT_WEIGHTS.compliance, complianceScore));
  visualScore = Math.max(0, Math.min(AUDIT_WEIGHTS.visualIntegrity, visualScore));
  conversionScore = Math.max(0, Math.min(AUDIT_WEIGHTS.conversionArchitecture, conversionScore));
  brandScore = Math.max(0, Math.min(AUDIT_WEIGHTS.brandAlignment, brandScore));

  const totalScore = Math.round(complianceScore + visualScore + conversionScore + brandScore);

  let grade = 'F';
  if (totalScore >= 93) grade = 'A+';
  else if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 75) grade = 'B';
  else if (totalScore >= 65) grade = 'C';
  else grade = 'F';

  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const passed = totalScore >= 75 && criticalIssues.length === 0;

  const summary = passed
    ? `Asset is revenue-ready (${totalScore}/100, Grade ${grade}). All core conversion and compliance gates passed.`
    : `Asset requires attention (${totalScore}/100, Grade ${grade}): ${criticalIssues.length ? `${criticalIssues.length} critical compliance/integrity issue(s)` : 'structural revenue improvements needed'}.`;

  return {
    score: totalScore,
    grade,
    passed,
    businessModel: model,
    assetType: type,
    market,
    breakdown: {
      compliance: { score: complianceScore, max: AUDIT_WEIGHTS.compliance, passed: complianceScore >= 20 },
      visualIntegrity: { score: visualScore, max: AUDIT_WEIGHTS.visualIntegrity, passed: visualScore >= 20 },
      conversionArchitecture: { score: conversionScore, max: AUDIT_WEIGHTS.conversionArchitecture, passed: conversionScore >= 22 },
      brandAlignment: { score: brandScore, max: AUDIT_WEIGHTS.brandAlignment, passed: brandScore >= 14 },
    },
    issues,
    summary,
  };
}

module.exports = {
  auditAsset,
  AUDIT_WEIGHTS,
  BANNED_FINANCIAL_PATTERNS,
  BANNED_MEDICAL_PATTERNS,
};
