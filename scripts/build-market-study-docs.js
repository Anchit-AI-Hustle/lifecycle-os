#!/usr/bin/env node
/**
 * One-off: assemble a valid .docx (Office Open XML) for each region's market
 * study directly from the structured content, no LibreOffice required.
 * Run locally and commit docs/market-study/*.docx. Not part of the deploy build.
 *
 *   node scripts/build-market-study-docs.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const msc = require("./market-study-content");

const OUT = path.join(__dirname, "..", "docs", "market-study");

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

msc.REGIONS.forEach(function (r) {
  const base = msc.META[r].file;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docx-"));
  fs.mkdirSync(path.join(dir, "_rels"));
  fs.mkdirSync(path.join(dir, "word"));
  fs.writeFileSync(path.join(dir, "[Content_Types].xml"), CONTENT_TYPES);
  fs.writeFileSync(path.join(dir, "_rels", ".rels"), RELS);
  fs.writeFileSync(path.join(dir, "word", "document.xml"), msc.docxDocumentXml(r));
  const target = path.join(OUT, base + ".docx");
  if (fs.existsSync(target)) fs.unlinkSync(target);
  // zip from inside the staging dir so paths are package-root relative
  execFileSync("zip", ["-X", "-r", "-q", target, "[Content_Types].xml", "_rels", "word"], { cwd: dir });
  console.log("wrote docs/market-study/" + base + ".docx (" + Math.round(fs.statSync(target).size / 1024) + "kb)");
});
