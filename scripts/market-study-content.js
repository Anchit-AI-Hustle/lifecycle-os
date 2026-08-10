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
 *   reportInnerHTML(region, brand) -> on-page report block
 *   docHTML(region, brand)         -> standalone HTML
 *   docxDocumentXml(region, brand) -> WordprocessingML body for the .docx
 */

const fs = require("fs");
const path = require("path");

const REGIONS = ["US", "UK", "Global", "India"];

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

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function studyFor(brand, region) {
  const b = brand || defaultBrand();
  const ms = b.market_study && typeof b.market_study === "object" ? b.market_study : {};
  return ms[region] || null;
}

// ── The honest empty state ──────────────────────────────────────────────────
// Shown whenever the active brand has no study for this region. It names the
// brand so nobody mistakes another workspace's research for their own.
function emptyState(region, brand) {
  const name = esc((brand || defaultBrand()).name || "this brand");
  return '' +
    '<div class="card p-5">' +
      '<div class="font-head text-lg">No market study loaded for ' + name + ' (' + esc(region) + ')</div>' +
      '<p class="text-[13px] mt-2" style="color:var(--soft);">' +
        '[DATA REQUIRED BEFORE LAUNCH: market study, ' + esc(region) + ', ' + name + '.] ' +
        'This platform never shows another brand\'s research in place of yours: market sizing, the ' +
        'competitive tiers and the strategic read are all specific to an industry, so a study belonging ' +
        'to a different workspace would be actively misleading here.' +
      '</p>' +
      '<p class="text-[13px] mt-2" style="color:var(--soft);">' +
        'To populate this tab, add a <code>market_study</code> block to the brand record ' +
        '(<code>data/brands/_default.json</code>, or the brand\'s profile under ' +
        '<code>data/brands/presets/</code>) with one entry per region. Every sizing row requires a ' +
        '<code>source</code>; rows without one are rejected rather than displayed.' +
      '</p>' +
    '</div>';
}

function sizingTable(rows) {
  const sourced = (rows || []).filter(function (r) { return r && r.source; });
  if (!sourced.length) return "";
  return '' +
    '<div class="card p-0 overflow-hidden">' +
      '<table class="grid-tbl w-full text-[13px]">' +
        '<thead><tr><th>Segment</th><th>Size</th><th>CAGR</th><th>Source</th></tr></thead><tbody>' +
        sourced.map(function (r) {
          return '<tr><td>' + esc(r.segment) + '</td><td>' + esc(r.size) + '</td>' +
                 '<td>' + esc(r.cagr || "-") + '</td><td>' + esc(r.source) + '</td></tr>';
        }).join("") +
        '</tbody></table>' +
    '</div>';
}

function tierCards(tiers) {
  if (!tiers || !tiers.length) return "";
  return '<div class="grid gap-3 md:grid-cols-2">' + tiers.map(function (t) {
    return '<div class="card p-5"><div class="font-head text-base">' + esc(t.name) + '</div>' +
           '<p class="text-[13px] mt-1" style="color:var(--soft);">' + esc(t.note) + '</p></div>';
  }).join("") + '</div>';
}

function bulletCard(title, items) {
  if (!items || !items.length) return "";
  return '<div class="card p-5"><div class="font-head text-base">' + esc(title) + '</div>' +
    '<ul class="mt-2 text-[13px] space-y-1" style="color:var(--soft);">' +
    items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
}

function reportInnerHTML(region, brand) {
  const b = brand || defaultBrand();
  const s = studyFor(b, region);
  if (!s) return emptyState(region, b);
  return '<div class="space-y-3">' +
    '<div class="card p-5"><div class="font-head text-lg">' + esc(s.headline || (b.name + " " + region + " market study")) + '</div>' +
      '<p class="text-[12.5px] mt-1" style="color:var(--soft);">Every figure below carries its published source. Where a number is not published, the gap is listed rather than estimated.</p></div>' +
    sizingTable(s.sizing) +
    tierCards(s.tiers) +
    bulletCard("Strategic read", s.reads) +
    bulletCard("Known data gaps (not estimated)", s.gaps) +
  '</div>';
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
  reportInnerHTML: reportInnerHTML,
  docHTML: docHTML,
  docxDocumentXml: docxDocumentXml,
};
