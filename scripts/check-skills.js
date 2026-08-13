#!/usr/bin/env node
'use strict';
/**
 * scripts/check-skills.js — the skills that OPERATE the platform must be as
 * brand-agnostic as the platform itself.
 *
 *   node scripts/check-skills.js          report
 *   node scripts/check-skills.js --fail   exit 1 on any error (CI gate)
 *
 * The app became multi-tenant; `.claude/commands/` did not follow. 18 of 23
 * skills hardcoded tenant zero ("Plan a campaign for Knickgasm"), none read the
 * active brand, and several carried tenant-zero product nouns in their EXAMPLES
 * ("Q3 airbrush winback") plus leftovers from the fork's origin ("coffee
 * collection", "vs coffee crash, vs stale supermarket sneaker"). A skill is a
 * prompt: a hardcoded brand there writes another company's product into this
 * company's campaign just as surely as a hardcoded string in a page.
 *
 * Structure borrowed from github.com/arnabbagxd/brand-building-skills (MIT),
 * which gets one thing right that this repo did not: a `brand-context`
 * foundation skill every other skill reads FIRST. Ours differs where it counts
 * - theirs is a questionnaire the user hand-fills into a markdown file, ours
 * resolves the real workspace and can derive from the brand's own site with
 * per-field provenance, so a brand fact is never something someone typed from
 * memory.
 */
const fs = require('fs');
const path = require('path');

const FAIL = process.argv.includes('--fail');
const DIR = path.join(__dirname, '..', '.claude', 'commands');
const FOUNDATION = 'brand-context';

/* Byte-exact by design: real store URLs, a real env var, a real external skill
   name. Rewriting these breaks them - the same carve-out brand-context.js makes
   when it refuses to touch a text node containing "://" or "_". */
const KEEP = /knickgasm\.(com|co|io|vercel)|KNICKGASM_|anthropic-skills:knickgasm-/;

/* Tenant zero's product nouns, and the fork's origin vocabulary. The foundation
   skill is exempt: naming them is how it bans them. */
const VOCAB = /\b(sneakers?|colorways?|airbrush(?:ed|ing)?|streetwear|hand-painted|grail|coffee collection)\b/i;

const problems = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();

for (const f of files) {
  const slug = f.slice(0, -3);
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const fm = src.startsWith('---\n') ? src.slice(4, src.indexOf('\n---', 4)) : '';
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (fm.match(/^description:\s*(.+)$/m) || [])[1];

  // Agent Skills spec (agentskills.io/specification.md): name must match the
  // file, description carries the trigger phrases an agent matches on.
  if (!name) problems.push([f, 'missing `name` in frontmatter']);
  else if (name.trim() !== slug) problems.push([f, `name "${name.trim()}" does not match filename "${slug}"`]);
  if (!desc) problems.push([f, 'missing `description` in frontmatter']);
  else if (desc.length > 1024) problems.push([f, `description is ${desc.length} chars (spec max 1024)`]);

  for (const [i, line] of src.split('\n').entries()) {
    if (KEEP.test(line)) continue;
    if (/\bknickgasm\b/i.test(line)) problems.push([f, `line ${i + 1}: names tenant zero - resolve the ACTIVE brand`]);
    if (slug !== FOUNDATION && VOCAB.test(line)) {
      problems.push([f, `line ${i + 1}: tenant zero's vocabulary "${line.match(VOCAB)[0]}" - examples must belong to no tenant`]);
    }
    // Artefacts of a mechanical find-replace. This repo has shipped two of
    // these ("sneaker drinkers", "A world of sneaker"), so they are checked.
    const mangled = line.match(/\b(?:a|an|the) the active brand\b|\bthe active brand the active brand\b/i);
    if (mangled) problems.push([f, `line ${i + 1}: mangled substitution "${mangled[0]}"`]);
  }

  // Every skill that acts on a brand must send the reader to the foundation
  // first. The foundation itself is the exception.
  if (slug !== FOUNDATION && !src.includes('/brand-context')) {
    problems.push([f, 'does not reference /brand-context - a skill that acts before the brand is resolved acts for the wrong one']);
  }
}

if (!files.includes(FOUNDATION + '.md')) problems.push(['(repo)', `the foundation skill ${FOUNDATION}.md is missing`]);

for (const [f, msg] of problems) console.log(`  ${f}: ${msg}`);
console.log(`\n${files.length} skills checked · ${problems.length} problem(s)`);
if (problems.length) { console.error('\nFAIL: a skill is not brand-agnostic.'); process.exit(FAIL ? 1 : 0); }
console.log('OK: every skill resolves the active brand and matches the Agent Skills spec.');
