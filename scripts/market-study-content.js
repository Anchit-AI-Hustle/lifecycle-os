"use strict";
/**
 * Market Study content — BRAND-SCOPED.
 *
 * This module previously carried a transcription of ANOTHER brand's analyst
 * study (tea, coffee and ayurveda market sizing, with that industry's
 * incumbents) that had merely been token-swapped word-for-word to "sneaker".
 * It rendered for every brand, so a health-media or news workspace was shown
 * sneaker tonnage in tons, "Black 68% / loose 44%" tea structure, and Tata
 * Consumer / Brooke Bond / Chaayos / Blue Tokai / Patanjali as its competitors.
 * All of it was wrong for every brand on the platform, including this one.
 *
 * It is now rendered from the ACTIVE BRAND'S OWN record:
 *   brand.market_study = { <Region>: { headline, sizing[], tiers[], reads[], gaps[] } }
 * Every `sizing` row must carry its `source`. A brand with no study for a
 * region gets an explicit DATA REQUIRED state - never another brand's numbers,
 * and never an invented one.
 *
 * The HTML renderers live in scripts/lib/market-study-render.js, which is
 * ALSO inlined into research.html so the browser re-renders for the active
 * brand with the same code. This module adds the Node-only pieces: the default
 * brand, the per-brand file names and the .docx body.
 *
 *   reportInnerHTML(region, brand) -> on-page report block
 *   docHTML(region, brand)         -> standalone HTML
 *   docxDocumentXml(region, brand) -> WordprocessingML body for the .docx
 */

const fs = require("fs");
const path = require("path");
const render = require("./lib/market-study-render.js");

const REGIONS = render.REGIONS;

function defaultBrand() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "brands", "_default.json"), "utf8"));
  } catch (_) {
    return { name: "this brand", market_study: {} };
  }
}

// META is derived from the brand so the downloadable filenames follow it too.
function metaFor(brand) {
  const b = brand || defaultBrand();
  const slug = String(b.slug || b.name || "brand").replace(/[^A-Za-z0-9]+/g, "_");
  const out = {};
  REGIONS.forEach(function (r) { out[r] = { file: slug + "_" + r + "_Market_Study", region: r, brand: b.name }; });
  return out;
}

const esc = render.esc;

function studyFor(brand, region) {
  return render.studyFor(brand || defaultBrand(), region);
}

function emptyState(region, brand) {
  return render.emptyState(region, brand || defaultBrand());
}

function reportInnerHTML(region, brand) {
  return render.reportInnerHTML(region, brand || defaultBrand());
}

function docHTML(region, brand) {
  const b = brand || defaultBrand();
  return '<!doctype html><html><head><meta charset="utf-8"><title>' +
    esc(b.name) + " " + esc(region) + ' Market Study</title></head><body>' +
    reportInnerHTML(region, b) + "</body></html>";
}

function docxDocumentXml(region, brand) {
  const b = brand || defaultBrand();
  const s = studyFor(b, region);
  const paras = [];
  function p(text, bold) {
    paras.push('<w:p><w:r>' + (bold ? "<w:rPr><w:b/></w:rPr>" : "") +
      "<w:t xml:space=\"preserve\">" + esc(text) + "</w:t></w:r></w:p>");
  }
  p(b.name + " - " + region + " Market Study", true);
  if (!s) {
    p("[DATA REQUIRED BEFORE LAUNCH: market study, " + region + ", " + b.name + "]");
    p("No study is loaded for this brand and region. Another brand's research is deliberately not substituted.");
  } else {
    p(s.headline || "", true);
    if (s.position && s.position_source) p("Position: " + s.position + " (source: " + s.position_source + ")");
    (s.sizing || []).filter(function (r) { return r && r.source; }).forEach(function (r) {
      p(r.segment + ": " + r.size + " (CAGR " + (r.cagr || "-") + ") - source: " + r.source);
    });
    if (s.tiers && s.tiers.length) { p("Competitive landscape", true); s.tiers.forEach(function (t) { p(t.name + ": " + t.note); }); }
    if (s.reads && s.reads.length) { p("Strategic read", true); s.reads.forEach(function (x) { p(x); }); }
    if (s.gaps && s.gaps.length) { p("Known data gaps (not estimated)", true); s.gaps.forEach(function (x) { p(x); }); }
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join("") + "</w:body></w:document>";
}

module.exports = {
  REGIONS: REGIONS,
  get META() { return metaFor(defaultBrand()); },
  metaFor: metaFor,
  defaultBrand: defaultBrand,
  studyFor: studyFor,
  emptyState: emptyState,
  reportInnerHTML: reportInnerHTML,
  headerCardHTML: function (region, brand, opts) { return render.headerCardHTML(region, brand || defaultBrand(), opts); },
  landscapeHTML: function (brand) { return render.landscapeHTML(brand || defaultBrand()); },
  docHTML: docHTML,
  docxDocumentXml: docxDocumentXml,
};
