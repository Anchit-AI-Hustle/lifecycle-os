import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { THEMES, FUNNEL_VARIANTS, compileHTML } from './src/utils/compiler.js';
import { downloadAssets } from './src/utils/assetDownloader.js';

const app = express();
const PORT = 3000;

app.use(express.json());

// API route to let the dashboard query themes and variants
app.get('/api/metadata', (req: Request, res: Response) => {
  res.json({
    themes: THEMES,
    variants: FUNNEL_VARIANTS
  });
});

// API route to request compiling a standalone HTML for a theme + variant combination
app.post('/api/compile', (req: Request, res: Response) => {
  const { themeId, variantCode } = req.body;
  
  const theme = THEMES.find(t => t.id === parseInt(themeId));
  const variant = FUNNEL_VARIANTS.find(v => v.code === variantCode);

  if (!theme || !variant) {
    return res.status(404).json({ error: 'Theme or variant configuration not found.' });
  }

  const htmlContent = compileHTML(theme, variant);
  res.json({
    theme,
    variant,
    filename: `Variant${variant.code}_${theme.slug}.html`,
    html: htmlContent
  });
});

// Vite middleware flow for development or continuous static serving
async function bootstrap() {
  // Download static visual assets to local 'public' folder so they are hosted online with the app
  try {
    await downloadAssets();
  } catch (err) {
    console.error('Failed to pre-download hosted visual assets:', err);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express custom server live on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
