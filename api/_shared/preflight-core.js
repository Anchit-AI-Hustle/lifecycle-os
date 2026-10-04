'use strict';
/**
 * preflight-core.js — the gate every send passes through.
 * ---------------------------------------------------------------------------
 * This is where the two halves of this feature meet. The dispatcher can reach
 * a real audience through a real platform; this decides whether it should.
 *
 * Three checks, in the order the brief set, plus the two that publishing itself
 * needs (is the credential usable, and does it carry the permission):
 *
 *   1. DOMAIN AUTH + WARMUP   is the sending domain authenticated, and is this
 *                             volume inside today's ramp cap
 *   2. SEGMENT QUALITY        list hygiene, engagement mix, estimated bounce
 *                             risk, cross-channel frequency cap
 *   3. CONTENT                spam signals, unsubscribe, link and image checks
 *   4. CREDENTIAL             connected, not expired, not revoked
 *   5. SCOPE                  the grant actually covers this action
 *   6. COMPLIANCE             the brand's banned phrases, unapproved claims and
 *                             the regulatory rule packs its record selects
 *                             (compliance-lint.js); it can block
 *
 * ── WHY "UNKNOWN" IS NEVER "PASS" ──────────────────────────────────────────
 * Every check returns pass | warn | block | skip, and a check that could not be
 * performed returns WARN, never pass. That is the whole discipline of this file:
 * a gate that silently approves what it could not inspect is worse than no gate,
 * because it converts an absence of information into a green light somebody acts
 * on. The verdict is the worst status any check returned.
 *
 * A BLOCK is overridable by an operator, and the override is recorded against
 * their user id in preflight_audits with a note. It is a decision with a name on
 * it, not a switch.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const deliverability = require('./deliverability-core.js');
const cohorts = require('./cohort-engine.js');
const oauth = require('./oauth-core.js');
const { adapterForChannel } = require('./adapters/registry.js');

const ORDER = { pass: 0, skip: 0, warn: 1, block: 2 };
const worst = (a, b) => (ORDER[b] > ORDER[a] ? b : a);

/** An email channel is the only one a sending domain applies to. */
const EMAIL_CHANNELS = /(_email|_campaign|mailer|klaviyo_sms|webengage_email|webengage_sms|cio_transactional|ac_campaign)/i;

function check(id, label, status, detail, remediation) {
  return { id, label, status, detail, remediation: remediation || undefined };
}

const COMPLIANCE_LABEL = 'Brand safety and compliance';

/**
 * The compliance check. A payload with no copy has nothing to lint (skip); a
 * gate that never learned whose brand this is cannot pick its rule packs, and
 * says so (warn, never pass). The findings ride on the check, so the audit
 * row keeps every rule id, matched phrase and citation that was overridden.
 */
function complianceCheck(i, payload) {
  const lintCore = require('./compliance-lint.js');
  if (!lintCore.fieldsOf(payload || {}).length) {
    return check('compliance', COMPLIANCE_LABEL, 'skip', 'This channel carries no copy to lint.');
  }
  if (!i.brand || typeof i.brand !== 'object') {
    return check('compliance', COMPLIANCE_LABEL, 'warn',
      'No brand record reached the gate, so its banned phrases, its approved claims and the rule packs for its sector and markets could not be selected. This is not a pass.',
      'Publish from an active brand workspace so the brand record is read before the send.');
  }
  const r = lintCore.lint(payload, {
    brand: i.brand,
    market: i.market || i.region || '',
    approvedClaims: i.approved_claims,
    offer: i.offer,
  });
  const top = r.findings.filter((f) => f.severity === 'BLOCK').concat(r.findings.filter((f) => f.severity !== 'BLOCK'));
  const detail = r.findings.length
    ? `${r.blocking} blocking, ${r.warnings} warning(s): ${top.slice(0, 3).map((f) => `${f.title}${f.matched ? ` ("${f.matched}")` : ''}`).join('; ')}${top.length > 3 ? `; and ${top.length - 3} more` : ''}.`
    : `No findings in ${r.fields} copy field(s). Rule packs: ${r.packs.join(', ')}.`;
  // The mandated text (the FDA disclaimer) is quoted in the remediation an
  // operator reads, whichever finding offered it.
  const offered = r.findings.find((f) => f.offer);
  const out = check('compliance', COMPLIANCE_LABEL, r.verdict, detail,
    top.length ? `${top[0].fix}${offered ? ` Required text: ${offered.offer}` : ''}` : undefined);
  out.findings = r.findings;
  out.packs = r.packs;
  out.selection = r.selection;
  out.limits = r.limits;
  return out;
}

/**
 * @returns {Promise<{verdict:'pass'|'warn'|'block', score:number, checks:Array, blocking:string[]}>}
 */
async function run(input) {
  const i = input || {};
  const checks = [];
  const channel = String(i.channel || '');
  const isEmail = EMAIL_CHANNELS.test(channel);
  const priority = String(i.message_priority || (i.mode === 'draft' ? 'draft' : 'promotional'));

  /* ── 4 + 5: can we even act as this brand ─────────────────────────────── */

  const conn = i.connection || null;
  if (!conn) {
    checks.push(check('credential', 'Platform connection', 'block',
      `No ${i.provider} connection on this brand.`,
      'Connect the platform on the Connections page before publishing to it.'));
  } else if (conn.revoked_at) {
    checks.push(check('credential', 'Platform connection', 'block',
      `The ${i.provider} connection was revoked on ${String(conn.revoked_at).slice(0, 10)}.`,
      'Reconnect the platform: a revoked grant cannot be refreshed.'));
  } else if (conn.status === 'disabled') {
    checks.push(check('credential', 'Platform connection', 'block', 'The connection is disabled.', 'Re-enable it on the Connections page.'));
  } else {
    const expiresAt = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
    const expired = expiresAt && expiresAt < Date.now();
    const refreshable = Array.isArray(conn.secret_fields) && conn.secret_fields.indexOf('refresh_token') >= 0;
    checks.push(expired && !refreshable
      ? check('credential', 'Platform connection', 'block', 'The access token has expired and there is no refresh token stored.', 'Reconnect the platform.')
      : check('credential', 'Platform connection', 'pass',
        expired ? 'The access token is expired and will be refreshed before the send.' : 'Connected.'));

    // Publishing is a second, explicit switch beyond storing a credential.
    const publishEnabled = !!(conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
    checks.push(publishEnabled
      ? check('publishing_enabled', 'Live publishing', 'pass', 'This brand has enabled live publishing for this platform.')
      : check('publishing_enabled', 'Live publishing', 'warn',
        'Live publishing is off for this connection, so the job will build the request and stop without sending.',
        'Turn on live publishing for this platform on the Connections page when you are ready to send for real.'));

    const scope = oauth.validateScopes(i.provider, channel, conn.oauth_scopes, 'write');
    checks.push(scope.ok
      ? check('scopes', 'Permissions', scope.unknown ? 'warn' : 'pass', scope.note,
        scope.unknown ? 'Reconnect the platform to record the granted scopes, so a missing permission is caught here rather than at send time.' : undefined)
      : check('scopes', 'Permissions', 'block', scope.note, 'Reconnect and grant the missing scopes.'));
  }

  /* ── mapping gaps ─────────────────────────────────────────────────────── */

  const missing = Array.isArray(i.mapping_missing) ? i.mapping_missing : [];
  checks.push(missing.length
    ? check('mapping', 'Asset mapping', 'block',
      `${missing.length} required field(s) could not be filled: ${missing.join(' ')}`,
      'Supply the missing fields on the asset, or map them from an existing field.')
    : check('mapping', 'Asset mapping', 'pass', 'Every required field for this channel resolved.'));

  const Adapter = adapterForChannel(channel);
  if (Adapter) {
    const ch = Adapter.channels.find((c) => c.id === channel);
    if (ch && ch.supported === false) {
      checks.push(check('channel_support', 'Channel', 'block',
        `${ch.label} is not implemented for ${Adapter.label}.`,
        'Use a supported channel, or drive this one by sending an event that triggers the platform\'s own journey.'));
    }
  }

  /* ── 1: domain authentication + warmup ────────────────────────────────── */

  if (isEmail) {
    const domain = String(i.sending_domain || i.from_domain || '').trim();
    if (!domain) {
      checks.push(check('domain_auth', 'Sending domain', 'warn',
        'No sending domain was supplied, so authentication could not be checked. This is not a pass.',
        'Set the brand\'s sending domain so SPF, DKIM and DMARC can be verified before a send.'));
    } else {
      const health = i.domain_health || await deliverability.auditDomain(domain, { selectors: i.dkim_selectors || [] });
      if (!health.ok) {
        checks.push(check('domain_auth', 'Sending domain', 'warn', health.error, 'Re-run the domain check.'));
      } else {
        const by = {};
        for (const r of health.records) by[r.type] = r;
        const spfBad = by.SPF && by.SPF.unavailable !== true && by.SPF.passed === false;
        const dkimBad = by.DKIM && by.DKIM.unavailable !== true && by.DKIM.passed === false;
        const noDmarc = by.DMARC && by.DMARC.unavailable !== true && by.DMARC.found === false;

        // Google and Yahoo bulk-sender rules make these hard requirements, not
        // recommendations, so they block rather than warn.
        if (spfBad || dkimBad || noDmarc) {
          const gaps = [spfBad && 'SPF', dkimBad && 'DKIM', noDmarc && 'DMARC'].filter(Boolean);
          checks.push(check('domain_auth', 'Sending domain', 'block',
            `${domain} fails ${gaps.join(' and ')}. Since 2024 Google and Yahoo require all three from bulk senders; mail without them is rejected or filtered rather than delivered.`,
            'Fix the records on the Domain Strength page, then re-check. Each finding there carries the exact record to publish.'));
        } else if (health.score_breakdown && health.score_breakdown.partial) {
          // A score of null is not a number to print: nothing was assessable.
          checks.push(check('domain_auth', 'Sending domain', 'warn',
            health.score == null
              ? `${domain} could not be scored. ${health.score_breakdown.coverage_note}`
              : `${domain} scores ${health.score}/100 across the ${health.score_breakdown.coverage_pct}% of checks that completed. ${health.score_breakdown.coverage_note}`,
            'Re-run the check so the unverified records are assessed before a large send.'));
        } else {
          checks.push(check('domain_auth', 'Sending domain', health.score >= 75 ? 'pass' : 'warn',
            `${domain} scores ${health.score}/100 (${health.grade}).`,
            health.score >= 75 ? undefined : 'Raise the score on the Domain Strength page before increasing volume.'));
        }

        if (health.blacklists && health.blacklists.checked && health.blacklists.listed.length) {
          checks.push(check('blocklist', 'Blocklists', 'block',
            `Listed on ${health.blacklists.listed.map((l) => l.list).join(', ')}.`,
            'Delist before sending. Sending while listed deepens the problem and the delisting cools down slowly.'));
        } else if (health.blacklists && !health.blacklists.checked) {
          checks.push(check('blocklist', 'Blocklists', 'warn', health.blacklists.note,
            'Check from your own mail server or the provider\'s web lookup.'));
        }
      }

      // Warmup cap
      const warmup = i.warmup || null;
      const size = Number(i.audience_size || (i.segment && i.segment.size) || 0);
      // A PAUSED ramp is the throttle having fired (evaluateWarmupSafety):
      // bounces or complaints over the line. Until 2026-09-28 this branch sat
      // INSIDE `status === 'active'`, so a paused warmup produced no check at
      // all and the send went out at exactly the moment the ramp had said
      // stop. Found by executing the gate with a paused warmup.
      if (warmup && warmup.status === 'paused') {
        checks.push(check('warmup', 'Warmup', 'block', `The warmup is paused: ${warmup.paused_reason || 'safety threshold breached'}.`, 'Resolve the bounce or complaint problem, then resume the ramp.'));
      } else if (warmup && warmup.status === 'active') {
        const today = warmup.plan && warmup.plan.find((d) => d.date === new Date().toISOString().slice(0, 10));
        const cap = today ? Number(today.cap) : null;
        if (cap != null && size > cap) {
          checks.push(check('warmup', 'Warmup', 'block',
            `This send is ${size} recipients and today's warmup cap is ${cap}. Exceeding a ramp is how a new domain gets filtered, and the damage outlasts the campaign.`,
            `Reduce the audience to ${cap}, or split the send across days.`));
        } else {
          checks.push(check('warmup', 'Warmup', 'pass', cap == null ? 'Warmup active; no cap for today.' : `${size} recipients, inside today's cap of ${cap}.`));
        }
      }
    }
  }

  /* ── 2: segment quality ───────────────────────────────────────────────── */

  const audience = i.audience || (i.contacts ? cohorts.analyseAudience(i.contacts, { messagePriority: priority }) : null);
  if (audience && audience.computed) {
    const h = audience.health;
    checks.push(check('segment_health', 'Segment health',
      h.verdict,
      `${h.size} contacts, ${Math.round(h.engaged_share * 100)}% engaged in 60 days, ${h.risky} risky address(es). Score ${h.score}/100.`,
      h.verdict === 'pass' ? undefined : h.reasons.join(' ')));

    const f = audience.frequency;
    checks.push(f.ok
      ? check('frequency', 'Frequency cap', 'pass', f.note)
      : check('frequency', 'Frequency cap', f.share > 0.25 ? 'block' : 'warn', f.note,
        'Exclude the over-capped contacts, or delay this send.'));

    if (audience.sunset && audience.sunset.count > 0 && audience.sunset.share > 0.2) {
      checks.push(check('sunset', 'Sunset policy', 'warn',
        audience.sunset.summary,
        'Suppress them before this send. Every unengaged recipient is a vote against your next send.'));
    }
  } else if (isEmail && priority !== 'draft') {
    checks.push(check('segment_health', 'Segment health', 'warn',
      (audience && audience.note) || '[DATA REQUIRED BEFORE LAUNCH: eligible segment size] No engagement data was supplied, so segment quality could not be assessed. This is not a pass.',
      'Sync engagement from the connected ESP so cohorts and bounce risk can be computed.'));
  }

  /* ── 3: content ───────────────────────────────────────────────────────── */

  const payload = i.payload || {};
  const hasContent = payload.html || payload.sms_body || payload.caption || payload.subject;
  if (hasContent) {
    const content = deliverability.analyzeContent({
      subject: payload.subject || '',
      html: payload.html || '',
      text: payload.caption || payload.sms_body || '',
      fromDomain: String(i.sending_domain || i.from_domain || ''),
      recentSubjects: i.recent_subjects || [],
      // A subject line and an unsubscribe path are EMAIL requirements (the
      // latter bulk email law); a caption has neither and must not be scored
      // as if it should.
      emailRules: isEmail,
    });

    // The unsubscribe check is legal exposure, not a spam heuristic, so it is
    // pulled out and blocks on its own for bulk email.
    if (isEmail && priority === 'promotional' && !content.has_unsubscribe) {
      checks.push(check('unsubscribe', 'Unsubscribe', 'block',
        'No unsubscribe link found in this message. Bulk commercial email requires one under CAN-SPAM, and Google and Yahoo require one-click List-Unsubscribe from bulk senders.',
        'Add the unsubscribe tag your ESP provides. Klaviyo only injects one where the template places it.'));
    }

    checks.push(check('content_spam', 'Content spam signals',
      content.band === 'high' ? 'block' : content.band === 'medium' ? 'warn' : 'pass',
      content.signals.length
        ? `${content.band} risk (score ${content.score}): ${content.signals.slice(0, 3).map((s) => s.signal).join(' ')}`
        : 'No spam signals found.',
      content.signals.length ? content.signals.slice(0, 3).map((s) => s.signal).join(' ') : undefined));
  } else {
    checks.push(check('content_spam', 'Content spam signals', 'skip', 'This channel carries no message body to analyse.'));
  }

  /* ── 6: brand safety + regulatory compliance ──────────────────────────── */

  // The deterministic linter (compliance-lint.js), with the rule packs the
  // BRAND's own record selects: its banned phrases, its approved claims, its
  // sector and the market this send goes to. It can BLOCK, and a block is
  // overridden like every other one here: with the operator's id and reason
  // on the audit (dispatch-core requires the reason for this check).
  checks.push(complianceCheck(i, payload));

  /* ── verdict ──────────────────────────────────────────────────────────── */

  const verdict = checks.reduce((acc, c) => worst(acc, c.status), 'pass');
  const blocking = checks.filter((c) => c.status === 'block').map((c) => `${c.label}: ${c.detail}`);
  const graded = checks.filter((c) => c.status !== 'skip');
  const score = graded.length
    ? Math.round((graded.filter((c) => c.status === 'pass').length / graded.length) * 100)
    : 0;

  return { verdict, score, checks, blocking };
}

module.exports = { run, EMAIL_CHANNELS, worst };
