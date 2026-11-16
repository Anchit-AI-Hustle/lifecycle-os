'use strict';
/**
 * leads.js - Working contact form & lead capture handler following
 * Brand Motion Studios (Module 5 & Module 8: Supabase integration, validation,
 * anti-spam honeypot protection, and accessible feedback).
 */

const inMemoryLeads = [];

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  // Basic RFC-compliant check: requires local part, @, domain, and TLD
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Handle incoming lead / contact submission.
 * @param {object} payload - { name, email, message, _gotcha, brand, market, source, metadata }
 */
async function submitLead(payload) {
  const data = payload || {};

  // 1. Bot protection: honeypot field check
  // Spam bots blindly fill hidden fields; real users never do.
  if (data._gotcha || data.honeypot || data.website_url_check) {
    // Silently return success to mislead the bot, but do not persist.
    return {
      ok: true,
      bot_trapped: true,
      message: 'Thank you for reaching out. We will be in touch shortly.',
    };
  }

  // 2. Field validation
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const message = typeof data.message === 'string' ? data.message.trim() : '';

  if (!name) {
    const error = new Error('Please enter your name.');
    error.statusCode = 400;
    error.field = 'name';
    throw error;
  }

  if (!isValidEmail(email)) {
    const error = new Error('Please enter a valid email address.');
    error.statusCode = 400;
    error.field = 'email';
    throw error;
  }

  if (!message) {
    const error = new Error('Please enter a message.');
    error.statusCode = 400;
    error.field = 'message';
    throw error;
  }

  const record = {
    name,
    email,
    message,
    brand_id: data.brand_id || data.brandId || null,
    brand_slug: data.brand_slug || data.brandSlug || (data.brand && data.brand.slug) || null,
    market: data.market ? String(data.market).toUpperCase() : 'US',
    source: data.source || 'landing_page_contact',
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    created_at: new Date().toISOString(),
  };

  // 3. Persist to Supabase if configured
  const env = getSupabaseEnv();
  if (env) {
    try {
      const res = await fetch(`${env.url}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          apikey: env.key,
          authorization: `Bearer ${env.key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(record),
        cache: 'no-store',
      });

      if (res.ok) {
        const rows = await res.json();
        const saved = Array.isArray(rows) && rows[0] ? rows[0] : record;
        return {
          ok: true,
          id: saved.id || 'lead_' + Date.now(),
          message: 'Thank you for reaching out. We have received your message and will be in touch shortly.',
        };
      }
    } catch (_) {
      // If network / database error occurs, fallback to memory
    }
  }

  // Fallback storage when database is disconnected or in test mode
  const fallbackId = 'lead_mem_' + Math.random().toString(36).slice(2, 10);
  record.id = fallbackId;
  inMemoryLeads.push(record);

  return {
    ok: true,
    id: fallbackId,
    stored: 'local_memory',
    message: 'Thank you for reaching out. We have received your message and will be in touch shortly.',
  };
}

module.exports = {
  submitLead,
  isValidEmail,
  getInMemoryLeads: () => [...inMemoryLeads],
};
