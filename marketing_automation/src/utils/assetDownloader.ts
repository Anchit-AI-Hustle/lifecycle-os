import fs from 'fs';
import path from 'path';
import https from 'https';

import { THEMES } from './compiler';

/*
 * Mirrors the images the compiled pages reference into ./public so the Express
 * server can host them offline.
 *
 * The list is DERIVED from the theme records rather than hand-maintained. The
 * previous hardcoded list was inherited from the repo this app was copied from
 * and pointed at another company's Shopify CDN and at stock photos of faces and
 * torsos for a supplement funnel - none of which any KNICKGASM page has ever
 * referenced. Deriving the list means a mirrored asset is, by construction, an
 * asset some page actually uses.
 */

/** Every distinct image URL referenced by a theme record. */
function assetUrls(): string[] {
  const urls = new Set<string>();
  for (const theme of THEMES) {
    for (const url of Object.values(theme.assets)) {
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

/** Local filename for a remote asset: its own basename, query string stripped. */
function localName(url: string): string {
  const base = url.split('?')[0].split('/').pop() || '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'asset.bin';
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

export async function downloadAssets() {
  const publicDir = path.join(process.cwd(), 'public');

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log('Created public directory structure');
  }

  for (const url of assetUrls()) {
    const filename = localName(url);
    const destPath = path.join(publicDir, filename);
    if (fs.existsSync(destPath)) {
      console.log(`Asset ${filename} already exists locally.`);
      continue;
    }
    console.log(`Downloading ${filename} to local host...`);
    try {
      await downloadFile(url, destPath);
      console.log(`Successfully downloaded ${filename}`);
    } catch (error) {
      console.error(`Error downloading ${filename}:`, error);
    }
  }
}
