'use strict';

const crypto = require('crypto');
const supa = require('./supa.js');
const adsCore = require('./ad-insights-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const pagedeck = require('./pagedeck-core.js');
const alerts = require('./alert-channels.js');
// Env-driven sender identity (no hardcoded personal mailbox).
const { senderIdentity } = require('./live-connectors.js');
const SENDER = () => senderIdentity();

const iso = () => new Date().toISOString();
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const text = (v) => String(v == null ? '' : v).trim();
const rate = (a, b) => b ? a / b : 0;
const safe = async (p, fallback) => { try { return await p; } catch (_) { return fallback; } };
const fingerprint = (x) => crypto.createHash('sha1').update(String(x)).digest('hex');

const DEFAULT_SETTINGS = Object.freeze({
  id: 'default', enabled: true, cadence_hours: 1,
  sender_email: SENDER(),
  channels: { gmail: true, google_chat: false, sms: false },
  recipients: { email: SENDER() ? [SENDER()] : [], sms: [] },
  thresholds: {
    ad_roas_min: 1.5, ad_ctr_drop_pct: 0.25, ad_spend_spike_pct: 0.5,
    ad_spend_no_conversion: 200, mailer_open_rate_min: 0.2,
    mailer_click_rate_min: 0.015, mailer_unsubscribe_rate_max: 0.005,
    landing_conversion_rate_min: 0.02, action_error_rate_max: 0.1,
    connector_stale_hours: 3,
  },
  cooldown_minutes: 180,
  quiet_hours: { enabled: true, timezone: 'Asia/Kolkata', start_hour: 22, end_hour: 7, critical_bypass: true },
});
function mergeSettings(row) {
  const x = row || {};
  return { ...DEFAULT_SETTINGS, ...x, sender_email: SENDER(),
    channels: { ...DEFAULT_SETTINGS.channels, ...(x.channels || {}) },
    recipients: { ...DEFAULT_SETTINGS.recipients, ...(x.recipients || {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(x.thresholds || {}) },
    quiet_hours: { ...DEFAULT_SETTINGS.quiet_hours, ...(x.quiet_hours || {}) } };
}
async function loadSettings() {
  const rows = await safe(supa.select('analytics_alert_settings', { filters: { id: 'eq.default' }, limit: 1 }), []);
  return mergeSettings(Array.isArray(rows) ? rows[0] : null);
}
const clamp = (v, lo, hi, old) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : old;
const boolOr = (o, k, old) => !o || o[k] == null ? old : Boolean(o[k]);
function list(v, old) { const a = (Array.isArray(v) ? v : String(v || '').split(',')).map(text).filter(Boolean).slice(0, 20); return a.length ? a : old; }
async function saveSettings(input, updatedBy) {
  const old = await loadSettings(), x = input || {};
  const row = mergeSettings({ ...old,
    enabled: x.enabled == null ? old.enabled : Boolean(x.enabled),
    cadence_hours: clamp(x.cadence_hours, 1, 24, old.cadence_hours),
    channels: { gmail: boolOr(x.channels, 'gmail', old.channels.gmail), google_chat: boolOr(x.channels, 'google_chat', old.channels.google_chat), sms: boolOr(x.channels, 'sms', old.channels.sms) },
    recipients: { email: list(x.recipients && x.recipients.email, old.recipients.email), sms: list(x.recipients && x.recipients.sms, old.recipients.sms) },
    thresholds: Object.fromEntries(Object.entries(old.thresholds).map(([k, v]) => [k, clamp(x.thresholds && x.thresholds[k], 0, k.includes('spend_no') ? 10000000 : 10, v)])),
    cooldown_minutes: clamp(x.cooldown_minutes, 15, 1440, old.cooldown_minutes),
    quiet_hours: { enabled: boolOr(x.quiet_hours, 'enabled', old.quiet_hours.enabled), timezone: text(x.quiet_hours && x.quiet_hours.timezone) || old.quiet_hours.timezone,
      start_hour: clamp(x.quiet_hours && x.quiet_hours.start_hour, 0, 23, old.quiet_hours.start_hour), end_hour: clamp(x.quiet_hours && x.quiet_hours.end_hour, 0, 23, old.quiet_hours.end_hour),
      critical_bypass: boolOr(x.quiet_hours, 'critical_bypass', old.quiet_hours.critical_bypass) },
  });
  const payload = { id: 'default', enabled: row.enabled, cadence_hours: row.cadence_hours, sender_email: SENDER(), channels: row.channels,
    recipients: row.recipients, thresholds: row.thresholds, cooldown_minutes: row.cooldown_minutes, quiet_hours: row.quiet_hours, updated_by: updatedBy || null, updated_at: iso() };
  const saved = await safe(supa.insert('analytics_alert_settings', [payload], { upsertOn: 'id' }), null);
  return { ok: Boolean(saved), persisted: Boolean(saved), settings: row, note: saved ? 'Alert settings saved.' : 'The settings table is not available; apply the Data Analysis migration.' };
}

function bearer(req) { const h = text(req && req.headers && (req.headers.authorization || req.headers.Authorization)); return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : ''; }
async function authorize(req, { cron = false } = {}) {
  const token = bearer(req), secret = text(process.env.CRON_SECRET);
  if (secret && token === secret) return { ok: true, kind: 'cron' };
  if (cron) return { ok: false, status: 401, error: 'cron_secret_required' };
  if (!token) return { ok: false, status: 401, error: 'operator_session_required' };
  try {
    const { url, key } = supa.env();
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return { ok: false, status: 401, error: 'invalid_operator_session' };
    const user = await r.json(), email = text(user.email).toLowerCase();
    const domains = text(process.env.ANALYTICS_ADMIN_DOMAINS || 'knickgasm.com').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    return email && domains.some((d) => email.endsWith(`@${d}`)) ? { ok: true, kind: 'user', email, user_id: user.id } : { ok: false, status: 403, error: 'operator_not_allowed' };
  } catch (_) { return { ok: false, status: 401, error: 'operator_verification_unavailable' }; }
}

// Meta / Google / TikTok row mapping and the rollup used to be duplicated
// here. They now live in _shared/ad-rows-core.js so one mapping serves every
// consumer: the private copies had already drifted, and the rollup here
// returned 0 for ROAS, CPA and conversion rate on an account with no
// conversions. An account whose checkout happens on a third party reports
// zero purchases by construction, so a 0 reads as "sold nothing" and drags a
// blended ROAS toward zero. ad-rows-core returns null there instead.
const adRows = require('./ad-rows-core.js');
async function ads({ market = 'US', level = 'ad', since, until } = {}) {
  const raw = await adsCore.summary({ market, level, metricGroup: 'all', since, until });
  const platforms = (raw.platforms || []).map((p) => { const rows = adRows.rowsFor(p); return { platform: p.platform, connected: Boolean(p.connected), ok: Boolean(p.ok), source: p.source || null, fetched_at: p.fetched_at || null, status: p.status || null, error: p.error || null, need_env: p.need_env || [], rows, kpis: adRows.rollup(rows), raw_note: p.hint || null }; });
  const rows = platforms.flatMap((p) => p.rows).sort((a,b) => b.spend - a.spend);
  // Fallback: when the live Snowflake read yields no rows (PAT / network-policy
  // blocked, or unconfigured on this deploy), serve a cached real-data snapshot
  // so ad-level history stays viewable. Flips back to live automatically the
  // moment live rows return.
  if (!rows.length) {
    try {
      const snap = require('./ads-snapshot.json');
      if (snap && Array.isArray(snap.rows) && snap.rows.length) {
        const srows = snap.rows;
        const sp = ['meta', 'google', 'tiktok'].map((name) => {
          const pr = srows.filter((r) => String(r.platform || '').toLowerCase() === name);
          return { platform: name, connected: false, ok: pr.length > 0, source: 'snapshot', fetched_at: snap.generated_at, status: null, error: null, need_env: [], rows: pr, kpis: adRows.rollup(pr), raw_note: null };
        });
        return { ok: true, generated_at: iso(), cached: true, cached_at: snap.generated_at, market, level: 'ad', window: snap.window || raw.window, freshness: 'Cached snapshot of real Snowflake ad data — the live read is unavailable on this deployment (network policy pending); it resumes automatically once set.', connected_platforms: snap.connected_platforms || [], pending_platforms: snap.pending_platforms || [], kpis: adRows.rollup(srows), platforms: sp, rows: srows, note: snap.note };
      }
    } catch (e) { /* no snapshot bundled — fall through to the live (empty) shape */ }
  }
  return { ok: true, generated_at: iso(), market: raw.market, level: raw.level, window: raw.window, freshness: 'Fetched on request with cache disabled; source-platform processing and attribution latency still applies.', connected_platforms: raw.connected_platforms || [], pending_platforms: raw.pending_platforms || [], kpis: adRows.rollup(rows), platforms, rows, note: raw.note };
}

function metricNames(resp) { const rows = resp && resp.ok && resp.data && Array.isArray(resp.data.data) ? resp.data.data : []; return Object.fromEntries(rows.map((m) => [m.id, text(m.attributes && m.attributes.name)])); }
function klEvents(resp, names) { const rows = resp && resp.ok && resp.data && Array.isArray(resp.data.data) ? resp.data.data : []; return rows.map((e) => { const a = e.attributes || {}, p = a.event_properties || {}, id = e.relationships && e.relationships.metric && e.relationships.metric.data && e.relationships.metric.data.id; return { name: names[id] || p.metric_name || p.event_name || 'Unknown event', campaign: p['Campaign Name'] || p.campaign_name || p.Campaign || '(unattributed)', value: n(p.$value || p.value || p.revenue), at: a.datetime || a.timestamp || null }; }); }
const sumEvents = (map, re) => Object.entries(map).filter(([k]) => re.test(k)).reduce((a,[,v]) => a+v,0);
async function mailer({ market = 'US', hours = 720 } = {}) {
  const [mr, er, cm, sm, we, wc] = await Promise.all([
    klaviyo.getMetrics().catch((e)=>({ok:false,error:e.message})), klaviyo.getEvents({limit:100,sort:'-datetime'}).catch((e)=>({ok:false,error:e.message})),
    safe(supa.select('klaviyo_campaigns',{order:'send_time.desc',limit:100}),[]), safe(supa.select('klaviyo_segments',{order:'profile_count.desc',limit:100}),[]),
    webengage.eventSummary({hours,market}).catch((e)=>({ok:false,error:e.message})), webengage.campaignPerformance({event:'Notification Clicked',hours,market,top:30}).catch((e)=>({ok:false,error:e.message})),
  ]);
  const events = klEvents(er, metricNames(mr)), by = {};
  for (const e of events) by[e.name] = (by[e.name] || 0) + 1;
  for (const x of we && we.by_event || []) by[x.event] = (by[x.event] || 0) + n(x.n);
  const delivered = sumEvents(by,/received email|delivered|notification delivered/i), opens = sumEvents(by,/opened email|notification opened|email open/i), clicks = sumEvents(by,/clicked email|notification clicked|email click/i), conversions = sumEvents(by,/placed order|order placed|purchase|complete payment/i), unsubscribes = sumEvents(by,/unsubscribe/i), bounces = sumEvents(by,/bounce/i);
  const revenue = events.filter((e)=>/placed order|purchase/i.test(e.name)).reduce((a,e)=>a+e.value,0), cmap = new Map();
  for (const e of events) { const x = cmap.get(e.campaign) || {campaign:e.campaign,events:0,opens:0,clicks:0,conversions:0,revenue:0,source:'Klaviyo'}; x.events++; if(/open/i.test(e.name))x.opens++; if(/click/i.test(e.name))x.clicks++; if(/placed order|purchase/i.test(e.name)){x.conversions++;x.revenue+=e.value;} cmap.set(e.campaign,x); }
  for (const c of wc && wc.campaigns || []) cmap.set(`WebEngage · ${c.campaign}`, {campaign:c.campaign,events:c.events,opens:null,clicks:c.events,conversions:null,revenue:null,source:'WebEngage',unique_users:c.unique_users});
  const mirrors = (Array.isArray(cm)?cm:[]).map((c)=>({campaign:c.name||c.id,status:c.status,sent_at:c.send_time,source:'Klaviyo mirror',opens:null,clicks:null,conversions:null,revenue:null}));
  const campaigns = [...cmap.values(), ...mirrors.filter((c)=>!cmap.has(c.campaign))].slice(0,100), segments = Array.isArray(sm)?sm:[];
  return { ok:true, generated_at:iso(), market, window_hours:hours, sources:{ klaviyo:{connected:klaviyo.isConnected(),live_events:events.length,mirrored_campaigns:Array.isArray(cm)?cm.length:0,segments:segments.length,note:er&&er.hint}, webengage:{connected:webengage.connected(),events:we&&we.total_events||0,note:we&&we.error} },
    kpis:{delivered,opens,open_rate:rate(opens,delivered),clicks,click_rate:rate(clicks,delivered),ctor:rate(clicks,opens),conversions,conversion_rate:rate(conversions,delivered),revenue,revenue_per_recipient:rate(revenue,delivered),unsubscribes,unsubscribe_rate:rate(unsubscribes,delivered),bounces,bounce_rate:rate(bounces,delivered),known_campaigns:campaigns.length,known_segments:segments.length,segment_profiles:segments.reduce((a,x)=>a+n(x.profile_count),0)},
    event_mix:Object.entries(by).map(([event,count])=>({event,count})).sort((a,b)=>b.count-a.count), campaigns, segments, note: delivered?'Rates use available source events in the selected window.':'No delivery denominator is available; rates remain zero rather than being estimated.' };
}
async function landing({ market = 'US' } = {}) { return pagedeck.analytics({ market }); }

const getTable = (name,order,limit) => safe(supa.select(name,{order,limit}),[]);
function median(xs){const a=xs.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
async function actions(){
  const [activity,agents,outcomes,runs,reviews]=await Promise.all([getTable('activity_logs','created_at.desc',300),getTable('agent_runs','started_at.desc',200),getTable('analytics_action_outcomes','created_at.desc',500),getTable('connector_sync_runs','started_at.desc',200),getTable('smart_review_queue','created_at.desc',200)]);
  const out=Array.isArray(outcomes)?outcomes:[], completed=out.filter((x)=>/complete|launched|measured|success/i.test(x.status||'')), failures=out.filter((x)=>/fail|error|rollback/i.test(x.status||'')||x.rolled_back), measured=out.filter((x)=>x.baseline_value!=null&&x.observed_value!=null), exp=out.filter((x)=>x.experiment_id), winners=exp.filter((x)=>n(x.observed_value)>n(x.baseline_value)&&!x.guardrail_breach);
  const rows=out.length?out:(Array.isArray(activity)?activity:[]).map((x)=>({id:x.id,action_type:x.action,action_id:x.entity_id,channel:x.entity_type,status:x.status,recommended_at:x.created_at,launched_at:null,observed_value:null,baseline_value:null,incremental_revenue:null,roi:null,guardrail_breach:false,rolled_back:false,metadata:x.metadata}));
  const agentErrors=(Array.isArray(agents)?agents:[]).filter((x)=>/fail|error/i.test(x.status||'')).length, connectorErrors=(Array.isArray(runs)?runs:[]).filter((x)=>/fail|error/i.test(x.status||'')).length, denom=Math.max(1,(agents||[]).length+(runs||[]).length), revenue=out.reduce((a,x)=>a+n(x.incremental_revenue),0), cost=out.reduce((a,x)=>a+n(x.cost),0);
  return {ok:true,generated_at:iso(),kpis:{actions_tracked:rows.length,completed_actions:completed.length,completion_rate:rate(completed.length,out.length),failed_or_rolled_back:failures.length,error_rate:rate(agentErrors+connectorErrors,denom),median_time_to_launch_hours:median(out.map((x)=>x.recommended_at&&x.launched_at?(new Date(x.launched_at)-new Date(x.recommended_at))/36e5:null).filter((x)=>x!=null&&x>=0)),measured_actions:measured.length,realized_incremental_revenue:revenue,realized_roi:rate(revenue,cost),guardrail_breaches:out.filter((x)=>x.guardrail_breach).length,rollback_rate:rate(out.filter((x)=>x.rolled_back).length,completed.length),experiment_win_rate:rate(winners.length,exp.length),pending_reviews:(Array.isArray(reviews)?reviews:[]).filter((x)=>/pending|tentative/i.test(x.state||x.status||'')).length},actions:rows.slice(0,200),recent_activity:(activity||[]).slice(0,50),connector_runs:(runs||[]).slice(0,50),note:out.length?'Outcome KPIs use analytics_action_outcomes.':'No measured outcome rows exist yet; activity is shown without invented impact.'};
}

function addAnomaly(a, x){a.push({id:fingerprint([x.market||'ALL',x.source||'',x.metric||'',x.kind||'threshold'].join('|')),detected_at:iso(),severity:x.severity||'watch',kind:x.kind||'threshold',market:x.market||'ALL',source:x.source||'Data Analysis',metric:x.metric,current:x.current,baseline:x.baseline==null?null:x.baseline,threshold:x.threshold,message:x.message});}
function detectHourly({markets,actionData,previous,settings}){
  const out=[],t=settings.thresholds,prevMarkets=previous&&previous.payload&&previous.payload.markets||{};
  for(const [market,d] of Object.entries(markets)){const a=d.ads.kpis,m=d.mailer.kpis,l=d.landing.kpis,p=prevMarkets[market];
    if(a.spend>=t.ad_spend_no_conversion&&a.conversions<=0)addAnomaly(out,{severity:'critical',market,source:'Paid Media',metric:'Spend with zero conversions',current:a.spend,threshold:t.ad_spend_no_conversion,message:`${market} spent ${a.spend.toFixed(2)} with no attributed conversions.`});
    if(a.spend>0&&a.roas<t.ad_roas_min)addAnomaly(out,{severity:a.roas<t.ad_roas_min*.6?'critical':'watch',market,source:'Paid Media',metric:'ROAS',current:a.roas,threshold:t.ad_roas_min,message:`${market} blended ROAS is ${a.roas.toFixed(2)}.`});
    if(p&&p.ads&&p.ads.kpis){const pa=p.ads.kpis;if(pa.ctr>0&&a.ctr<pa.ctr*(1-t.ad_ctr_drop_pct))addAnomaly(out,{market,source:'Paid Media',metric:'CTR drop',current:a.ctr,baseline:pa.ctr,threshold:t.ad_ctr_drop_pct,message:`${market} paid-media CTR fell versus the prior run.`});if(pa.spend>0&&a.spend>pa.spend*(1+t.ad_spend_spike_pct))addAnomaly(out,{market,source:'Paid Media',metric:'Spend spike',current:a.spend,baseline:pa.spend,threshold:t.ad_spend_spike_pct,message:`${market} spend spiked versus the prior run.`});}
    if(m.delivered>=100&&m.open_rate<t.mailer_open_rate_min)addAnomaly(out,{market,source:'Mailer',metric:'Open rate',current:m.open_rate,threshold:t.mailer_open_rate_min,message:`${market} open rate is ${(m.open_rate*100).toFixed(1)}%.`});
    if(m.delivered>=100&&m.click_rate<t.mailer_click_rate_min)addAnomaly(out,{market,source:'Mailer',metric:'Click rate',current:m.click_rate,threshold:t.mailer_click_rate_min,message:`${market} click rate is ${(m.click_rate*100).toFixed(2)}%.`});
    if(m.delivered>=100&&m.unsubscribe_rate>t.mailer_unsubscribe_rate_max)addAnomaly(out,{severity:'critical',market,source:'Mailer',metric:'Unsubscribe rate',current:m.unsubscribe_rate,threshold:t.mailer_unsubscribe_rate_max,message:`${market} unsubscribe rate is ${(m.unsubscribe_rate*100).toFixed(2)}%.`});
    if(l.visitors>=100&&l.conversion_rate<t.landing_conversion_rate_min)addAnomaly(out,{market,source:'Landing Pages',metric:'Conversion rate',current:l.conversion_rate,threshold:t.landing_conversion_rate_min,message:`${market} landing-page CVR is ${(l.conversion_rate*100).toFixed(2)}%.`});
    if(l.srm_flags>0)addAnomaly(out,{severity:'critical',market,source:'Experiments',metric:'Sample-ratio mismatch',current:l.srm_flags,threshold:0,message:`${l.srm_flags} PageDeck experiment(s) show sample-ratio mismatch.`});
    for(const pform of d.ads.platforms){if(!pform.connected)addAnomaly(out,{severity:'info',market,source:'Connector',metric:`${pform.platform} Ads disconnected`,current:0,threshold:1,message:`${pform.platform} Ads is not connected for ${market}; no figures are invented.`});else if(!pform.ok)addAnomaly(out,{severity:'critical',market,source:'Connector',metric:`${pform.platform} Ads reporting error`,current:pform.status||0,threshold:200,message:`${pform.platform} Ads is connected for ${market} but the reporting request failed: ${pform.error||'unknown error'}.`});else if(pform.fetched_at&&Date.now()-new Date(pform.fetched_at).getTime()>t.connector_stale_hours*3600000)addAnomaly(out,{market,source:'Connector',metric:`${pform.platform} Ads stale`,current:(Date.now()-new Date(pform.fetched_at).getTime())/3600000,threshold:t.connector_stale_hours,message:`${pform.platform} Ads data for ${market} is older than ${t.connector_stale_hours} hours.`});}
  }
  if(actionData.kpis.error_rate>t.action_error_rate_max)addAnomaly(out,{severity:'critical',source:'Actions',metric:'Execution error rate',current:actionData.kpis.error_rate,threshold:t.action_error_rate_max,message:`Action/connector error rate is ${(actionData.kpis.error_rate*100).toFixed(1)}%.`});
  if(actionData.kpis.guardrail_breaches>0)addAnomaly(out,{severity:'critical',source:'Actions',metric:'Guardrail breach',current:actionData.kpis.guardrail_breaches,threshold:0,message:`${actionData.kpis.guardrail_breaches} measured action(s) breached a guardrail.`});
  const latestConnector=new Map();for(const r of actionData.connector_runs||[]){const id=text(r.connector_id||r.connector||r.source);if(id&&!latestConnector.has(id))latestConnector.set(id,r);}for(const [id,r] of latestConnector){if(r.started_at){const age=(Date.now()-new Date(r.started_at).getTime())/3600000;if(age>t.connector_stale_hours)addAnomaly(out,{source:'Connector',metric:`${id} sync stale`,current:age,threshold:t.connector_stale_hours,message:`${id} has not completed a recorded sync within ${t.connector_stale_hours} hours.`});}}
  return out;
}
function quietNow(q){if(!q||!q.enabled)return false;try{const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:q.timezone||'Asia/Kolkata',hour:'2-digit',hour12:false}).format(new Date())),s=n(q.start_hour),e=n(q.end_hour);return s===e?false:s>e?h>=s||h<e:h>=s&&h<e;}catch(_){return false;}}
async function dedupe(items,settings){const rows=await safe(supa.select('analytics_anomaly_state',{order:'last_seen.desc',limit:1000}),[]),by=new Map((rows||[]).map((r)=>[r.fingerprint,r])),cut=Date.now()-settings.cooldown_minutes*60000,send=[];for(const a of items){const p=by.get(a.id),last=p&&p.last_sent_at?new Date(p.last_sent_at).getTime():0;if(!p||last<cut)send.push(a);await safe(supa.insert('analytics_anomaly_state',[{fingerprint:a.id,status:'open',first_seen_at:p&&p.first_seen_at||a.detected_at,last_seen_at:a.detected_at,last_sent_at:p&&p.last_sent_at||null,occurrence_count:n(p&&p.occurrence_count)+1,severity:a.severity,detail:a,updated_at:a.detected_at}],{upsertOn:'fingerprint'}),null);}return send;}
async function markSent(items){const at=iso();for(const a of items||[])await safe(supa.update('analytics_anomaly_state',{last_sent_at:at,updated_at:at},{fingerprint:`eq.${a.id}`}),null);}
const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function alertMessage(items){const lines=items.map((a)=>`${a.severity.toUpperCase()} · ${a.market} · ${a.source} · ${a.metric}: ${a.message}`),rows=items.map((a)=>`<tr><td>${esc(a.severity)}</td><td>${esc(a.market)}</td><td>${esc(a.source)}</td><td><b>${esc(a.metric)}</b><br>${esc(a.message)}</td></tr>`).join('');return{subject:`[KNICKGASM] ${items.some((a)=>a.severity==='critical')?'Critical ':''}Data Analysis anomalies: ${items.length}`,text:`Lifecycle OS${SENDER()?`\nSender: ${SENDER()}`:''}\n\n${lines.join('\n')}`,html:`<!doctype html><html><body style="font-family:Arial,sans-serif"><h2>Lifecycle OS anomaly review</h2><table>${rows}</table><p>${SENDER()?`From ${esc(SENDER())} · `:''}automated hourly analysis</p></body></html>`};}
async function latestRun(){const r=await safe(supa.select('analytics_hourly_runs',{order:'started_at.desc',limit:1}),[]);return r&&r[0]||null;}
async function runHourly({force=false,trigger='schedule'}={}){
  const settings=await loadSettings(),last=await latestRun();if(!settings.enabled)return{ok:true,skipped:true,reason:'disabled_in_alert_settings',settings};if(!force&&last&&last.started_at&&Date.now()-new Date(last.started_at).getTime()<settings.cadence_hours*3600000-300000)return{ok:true,skipped:true,reason:`cadence_${settings.cadence_hours}h_not_due`,last_run_at:last.started_at,settings};
  const started_at=iso(),marketList=text(process.env.ANALYTICS_MARKETS||'US,UK').split(',').map((x)=>x.trim().toUpperCase()).filter(Boolean),sync=await Promise.all([safe(require('./klaviyo-sync.js').run(),{ok:false,message:'Klaviyo sync failed'}),safe(webengage.syncFromStorage(),{ok:false,message:'WebEngage sync failed'})]),actionData=await actions(),marketPayload={};
  await Promise.all(marketList.map(async(market)=>{const [adData,mailData,landingData]=await Promise.all([ads({market,level:'account'}),mailer({market,hours:72}),landing({market})]);marketPayload[market]={ads:adData,mailer:mailData,landing:landingData};}));
  const anomalies=detectHourly({markets:marketPayload,actionData,previous:last,settings}),notify=await dedupe(anomalies,settings),quiet=quietNow(settings.quiet_hours),critical=notify.some((a)=>a.severity==='critical');let alert_result={attempted:0,sent_any:false,results:[],reason:'no_new_anomalies'};
  if(notify.length&&(!quiet||(critical&&settings.quiet_hours.critical_bypass))){alert_result=await alerts.dispatch({...alertMessage(notify),settings});if(alert_result.sent_any)await markSent(notify);}else if(notify.length&&quiet)alert_result={attempted:0,sent_any:false,results:[],reason:'quiet_hours',queued_anomalies:notify.length};
  const payload={generated_at:iso(),markets:marketPayload,actions:actionData,sync},finished_at=iso(),row={started_at,finished_at,trigger,status:'success',cadence_hours:settings.cadence_hours,markets:marketList,payload,anomalies,alert_result},persisted=await safe(supa.insert('analytics_hourly_runs',[row]),null);
  return{ok:true,skipped:false,started_at,finished_at,markets:marketList,sync,anomalies,notified:notify,alert_result,persisted:Boolean(persisted),payload};
}
async function testAlert(override){const settings=mergeSettings({...await loadSettings(),...(override||{})}),msg=alertMessage([{severity:'info',market:'TEST',source:'Alert Settings',metric:'Delivery test',message:'This is a test from Lifecycle OS. No business anomaly was detected.'}]);msg.subject='[KNICKGASM] Data Analysis alert delivery test';return alerts.dispatch({...msg,settings});}
async function status(){const settings=await loadSettings(),last=await latestRun();return{ok:true,generated_at:iso(),settings,last_run:last?{started_at:last.started_at,finished_at:last.finished_at,status:last.status,anomalies:Array.isArray(last.anomalies)?last.anomalies.length:null}:null,connectors:{ads:['US','UK','IN'].map((market)=>adsCore.status(market)),klaviyo:{connected:klaviyo.isConnected()},webengage:{connected:webengage.connected()},pagedeck:{connected:Boolean(text(process.env.PAGEDECK_ANALYTICS_EXPORT_URL)||text(process.env.PAGEDECK_EXPERIMENTS_EXPORT_URL)||text(process.env.PAGEDECK_COMPETITOR_EXPORT_URL)||text(process.env.PAGEDECK_API_KEY))},gmail:{connected:Boolean(text(process.env.GMAIL_CLIENT_ID)&&text(process.env.GMAIL_CLIENT_SECRET)&&text(process.env.GMAIL_REFRESH_TOKEN)),sender:alerts.senderEmail()},google_chat:{connected:Boolean(text(process.env.GOOGLE_CHAT_WEBHOOK_URL))},sms:{connected:Boolean(text(process.env.TWILIO_ACCOUNT_SID)&&text(process.env.TWILIO_AUTH_TOKEN)&&text(process.env.TWILIO_FROM_NUMBER))}}};}
async function view(name,params){switch(String(name||'status').toLowerCase()){case'ads':return ads(params);case'mailer':return mailer(params);case'landing':case'pagedeck':return landing(params);case'actions':return actions(params);case'alerts':return{ok:true,settings:await loadSettings(),status:await status()};default:return status();}}

module.exports={DEFAULT_SETTINGS,authorize,loadSettings,saveSettings,view,status,ads,mailer,landing,actions,runHourly,testAlert,detectHourly};
