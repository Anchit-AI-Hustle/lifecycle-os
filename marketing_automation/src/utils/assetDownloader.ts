import fs from 'fs';
import path from 'path';
import https from 'https';

const ASSETS_TO_DOWNLOAD = {
  'hero_face.png': 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=800',
  'ksm.png': 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&q=80&w=800',
  'peri.png': 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800',
  'belly.jpg': 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=800',
  'taste.png': 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=800',
  'Coffee_Pack_Front.png': 'https://cdn.shopify.com/s/files/1/2422/3321/files/Coffee_Pack_Front.png',
  'Ingredients_Airbrush.jpg': 'https://cdn.shopify.com/s/files/1/2422/3321/files/Ingredients_Airbrush.jpg',
  'Trust_Badges_Horizontal.png': 'https://cdn.shopify.com/s/files/1/2422/3321/files/Trust_Badges_Horizontal.png'
};

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

  for (const [filename, url] of Object.entries(ASSETS_TO_DOWNLOAD)) {
    const destPath = path.join(publicDir, filename);
    if (!fs.existsSync(destPath)) {
      console.log(`Downloading online asset ${filename} to local host...`);
      try {
        await downloadFile(url, destPath);
        console.log(`Successfully downloaded ${filename}`);
      } catch (error) {
        console.error(`Error downloading ${filename}:`, error);
      }
    } else {
      console.log(`Asset ${filename} already exists locally.`);
    }
  }
}
