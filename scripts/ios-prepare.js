#!/usr/bin/env node
'use strict';
/**
 * ios-prepare.js - make the iOS project from nothing, in the platform's chrome.
 *
 * ios/ is not in git (Swift in the repo trips code scanning), so a clean
 * checkout has no iOS project. This adds it with Capacitor when it is missing,
 * replaces Capacitor's template icon and launch images with the Lifecycle OS
 * mark's (scripts/build-platform-mark.js IOS_ASSETS), then syncs. Used by
 * `npm run mobile:ios:open` and .github/workflows/mobile-builds.yml.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { IOS_ASSETS } = require('./build-platform-mark.js');

const ROOT = path.join(__dirname, '..');
const run = (cmd) => cp.execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

if (!fs.existsSync(path.join(ROOT, 'ios', 'App'))) run('npx cap add ios');
for (const [src, dests] of Object.entries(IOS_ASSETS)) {
  for (const d of dests) {
    fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, d));
    console.log(`${src} -> ${d}`);
  }
}
if (!process.argv.includes('--no-sync')) run('npx cap sync ios');
