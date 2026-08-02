# Ads Metrics Reference — Meta · Google · TikTok (+ derived / blended)

Purpose: the authoritative catalog of **every metric available directly from each ad
platform's API**, grouped the way the platform groups it, plus the **derived and blended
metrics** that are the actually-insightful ones. This is the spec the dashboard metric
catalog (`api/_shared/ad-metrics-catalog.js`) and the Snowflake / SiS surfaces compute
against — base metrics are read as-is; derived metrics are computed once, here-defined.

Legend: **base** = returned directly by the platform API · **derived** = computed by us
from base metrics · **blended** = spans platforms and/or e-commerce revenue.
All ratios guard their denominator (return null, never a fabricated 0, when inputs missing).

---

## 1. META (Facebook / Instagram) — Marketing API `insights` edge

### 1.1 Delivery & reach  (base)
| Field | Meaning |
|---|---|
| `impressions` | times ads were shown |
| `reach` | unique people who saw an ad |
| `frequency` | avg impressions per person (derived by Meta: impressions/reach) |

### 1.2 Cost & spend  (base)
| Field | Meaning |
|---|---|
| `spend` | amount spent |
| `cpm` | cost per 1,000 impressions |
| `cpc` | cost per (any) click |
| `cpp` | cost per 1,000 people reached |
| `cost_per_inline_link_click` | cost per link click |
| `cost_per_unique_click` | cost per unique click |
| `cost_per_thruplay` | cost per ThruPlay |
| `cost_per_action_type` | cost per each action (purchase, add-to-cart, LPV, lead…) |
| `cost_per_unique_action_type` | same, unique |

### 1.3 Clicks & CTR  (base)
| Field | Meaning |
|---|---|
| `clicks` | all clicks |
| `unique_clicks` | unique all-clicks |
| `inline_link_clicks` | link clicks |
| `unique_inline_link_clicks` | unique link clicks |
| `outbound_clicks` | clicks leaving the platform |
| `unique_outbound_clicks` | unique outbound |
| `ctr` | all-click CTR |
| `unique_ctr` | unique CTR |
| `inline_link_click_ctr` | link CTR (the honest CTR) |
| `outbound_clicks_ctr` | outbound CTR |

### 1.4 Video engagement  (base)
| Field | Meaning |
|---|---|
| `video_play_actions` | video plays (incl. 3-sec via `video_play_actions`/`actions:video_view`) |
| `video_thruplay_watched_actions` | ThruPlays (15s or complete) |
| `video_p25_watched_actions` | reached 25% |
| `video_p50_watched_actions` | reached 50% |
| `video_p75_watched_actions` | reached 75% |
| `video_p95_watched_actions` | reached 95% |
| `video_p100_watched_actions` | reached 100% |
| `video_avg_time_watched_actions` | avg seconds watched |
| `video_play_curve_actions` | retention curve (per-second) |
| `video_30_sec_watched_actions` | 30-sec views |

### 1.5 Actions / conversions & value  (base — via `actions` / `action_values`)
| Field | Meaning |
|---|---|
| `actions` | breakdown of all conversions by `action_type` (purchase, add_to_cart, initiate_checkout, landing_page_view, lead, complete_registration, add_payment_info…) |
| `action_values` | monetary value per action_type |
| `conversions` / `conversion_values` | custom-conversion counts / values |
| `purchase_roas` | purchase ROAS (per attribution) |
| `website_purchase_roas` | website purchase ROAS |
| `mobile_app_purchase_roas` | app purchase ROAS |
| `cost_per_conversion` | cost per custom conversion |

Pull specific conversions from `actions`/`action_values` by `action_type`:
`purchase`, `omni_purchase`, `offsite_conversion.fb_pixel_purchase`, `add_to_cart`,
`initiate_checkout`, `landing_page_view`, `lead`, `add_payment_info`,
`complete_registration`, `subscribe`, `view_content`, `search`.

### 1.6 Quality / auction diagnostics  (base)
| Field | Meaning |
|---|---|
| `quality_ranking` | vs ads competing for same audience |
| `engagement_rate_ranking` | expected engagement rank |
| `conversion_rate_ranking` | expected conversion rank |

### 1.7 Breakdown dimensions (for cohorts)
`age`, `gender`, `country`, `region`, `dma`, `impression_device`, `device_platform`,
`publisher_platform` (facebook/instagram/audience_network/messenger),
`platform_position` (feed/story/reels/…), `hourly_stats_aggregated_by_advertiser_time_zone`.

---

## 2. GOOGLE ADS — `metrics.*` (GAQL)

### 2.1 Delivery  (base)
`metrics.impressions`, `metrics.active_view_impressions`, `metrics.active_view_measurability`,
`metrics.search_impression_share`, `metrics.search_budget_lost_impression_share`,
`metrics.search_rank_lost_impression_share`.

### 2.2 Cost  (base)
`metrics.cost_micros` (÷1e6 = currency), `metrics.average_cpc`, `metrics.average_cpm`,
`metrics.average_cpv` (cost/view), `metrics.average_cpe` (cost/engagement),
`metrics.cost_per_conversion`, `metrics.cost_per_all_conversions`,
`metrics.cost_per_current_model_attributed_conversion`.

### 2.3 Clicks & interactions  (base)
`metrics.clicks`, `metrics.ctr`, `metrics.interactions`, `metrics.interaction_rate`,
`metrics.engagements`, `metrics.engagement_rate`, `metrics.interaction_event_types`.

### 2.4 Video  (base)
`metrics.video_views`, `metrics.video_view_rate`, `metrics.video_quartile_p25_rate`,
`metrics.video_quartile_p50_rate`, `metrics.video_quartile_p75_rate`,
`metrics.video_quartile_p100_rate`.

### 2.5 Conversions & value  (base)
`metrics.conversions`, `metrics.conversions_value`, `metrics.all_conversions`,
`metrics.all_conversions_value`, `metrics.conversions_from_interactions_rate`,
`metrics.value_per_conversion`, `metrics.value_per_all_conversions`,
`metrics.cross_device_conversions`, `metrics.view_through_conversions`.

### 2.6 Rank / competitive  (base)
`metrics.search_top_impression_share`, `metrics.search_absolute_top_impression_share`,
`metrics.search_click_share`, `historical_quality_score` (+ creative/landing/expected-CTR
components on the ad_group_criterion).

### 2.7 Segments / dimensions
`segments.date`, `segments.device`, `segments.ad_network_type`, `segments.conversion_action`,
`segments.conversion_action_category`; demographics via `age_range_view` / `gender_view`;
geo via `geographic_view` / `user_location_view`.

---

## 3. TIKTOK ADS — Reporting API (`/report/integrated/get/`)

### 3.1 Delivery  (base)
`impressions`, `reach`, `frequency`.

### 3.2 Cost  (base)
`spend`, `cpc`, `cpm`, `cost_per_1000_reached`, `cost_per_conversion`,
`cost_per_result`, `cost_per_secondary_goal_result`.

### 3.3 Clicks  (base)
`clicks`, `ctr`.

### 3.4 Video engagement  (base)
`video_play_actions`, `video_watched_2s`, `video_watched_6s`,
`video_views_p25`, `video_views_p50`, `video_views_p75`, `video_views_p100`,
`average_video_play`, `average_video_play_per_user`,
`engaged_view` (6s), `engaged_view_15s`.

### 3.5 Social engagement  (base)
`likes`, `comments`, `shares`, `follows`, `profile_visits`, `profile_visits_rate`,
`clicks_on_music_disc`.

### 3.6 Conversions & value  (base)
`conversion`, `conversion_rate` (`cvr`), `cost_per_conversion`, `result`, `result_rate`,
`complete_payment`, `complete_payment_roas`, `total_complete_payment_rate`,
`total_purchase_value`, `total_onsite_shopping_value`, `value_per_complete_payment`.

### 3.7 Interactive / on-site  (base)
`ix_page_view_rate`, `page_visit`, `landing_page_view`, `button_click`, `form`.

### 3.8 Dimensions
`age`, `gender`, `country_code`, `province_id`, `platform`, `placement`,
`interest_category`, `ad_creative` (via creative report).

---

## 4. DERIVED metrics (single-platform — the insightful layer)

| Metric | Formula | Why it matters |
|---|---|---|
| **Frequency** | impressions / reach | fatigue signal; >2–3 in a short window = creative wear-out |
| **CPM** | spend / impressions × 1000 | auction/price pressure |
| **CPC (link)** | spend / link_clicks | traffic cost quality |
| **Cost per reach / CPP** | spend / reach (×1000) | true unique-reach cost |
| **Link CTR** | link_clicks / impressions × 100 | creative + targeting pull (honest CTR) |
| **Hook Rate** | 3-sec plays / impressions × 100 | first-frame stopping power of the creative |
| **Hold Rate** | ThruPlays / impressions × 100 | mid-video retention strength |
| **Through Rate** | 100%-plays / impressions × 100 | full-completion share |
| **Hook → Hold retention** | ThruPlays / 3-sec plays × 100 | isolates mid-video drop-off from the hook |
| **Completion of starts** | 100%-plays / 3-sec plays × 100 | of those who started, who finished |
| **CVR** | purchases / link_clicks × 100 | landing + offer conversion |
| **CPA / cost per purchase** | spend / purchases | acquisition efficiency |
| **ROAS** | purchase_value / spend | platform-attributed return |
| **AOV (attributed)** | purchase_value / purchases | basket size of ad-driven orders |
| **LP-view rate** | landing_page_views / link_clicks × 100 | page-load/speed quality after the click |
| **Click→LPV drop-off** | 100 − LP-view rate | clicks lost before the page loaded |

---

## 5. BLENDED / omnichannel metrics (spend + realized e-commerce/retail revenue)

These need ad spend joined to **actual realized revenue** (Shopify + retail), not just
platform-attributed conversions. This is where attribution-window mismatches cause
double-counting — join on a common date grain and a single revenue source of truth.

| Metric | Formula | Why it matters |
|---|---|---|
| **MER** (Marketing Efficiency Ratio) | total revenue / total ad spend | the blended, attribution-proof truth of media efficiency |
| **TACOS** (Total Ad Cost of Sales) | total ad spend / total revenue | share of revenue eaten by media; trend it, not a point |
| **ACOS** | ad spend / ad-attributed revenue | channel-level ad cost of sales |
| **Blended CPA** | total spend / total new orders | real acquisition cost across channels |
| **nCAC** (new-customer CAC) | spend / **new** customers | the growth metric — excludes repeat buyers |
| **CAC** | spend / all customers | blended acquisition cost |
| **LTV : CAC** | customer LTV / CAC | unit-economics health (target ≥ 3:1) |
| **CAC payback (months)** | CAC / (AOV × margin × monthly orders) | how fast media pays back |
| **Contribution margin after ad** | revenue − COGS − shipping − ad spend | profit the media actually left |
| **iROAS** (incremental ROAS) | incremental revenue / spend | true causal return (needs a holdout/experiment) |
| **New-customer revenue %** | new-customer revenue / total revenue | acquisition vs retention mix |

---

## 6. Grouping used across the app (7 categories)

The dashboard catalog (`ad-metrics-catalog.js`) rolls the above into 7 analysis aspects so
every surface groups identically: **Delivery & Reach · Cost & Efficiency · Click
Engagement · Video Engagement · Conversion & Value · Landing Page · Experiment (A/B)**.
Blended metrics (§5) sit in a portfolio/executive layer above per-platform metrics.

## 7. Notes on accuracy / traps (why numbers can drift)

- **Attribution windows differ** (Meta 7d-click/1d-view default; Google/TikTok their own).
  Never sum platform-attributed conversions across platforms and call it truth — use MER.
- **Video quartiles are separate tables/fields** in Meta (per-action rows), so Hook/Hold/
  Through are `unavailable` until those are flattened into the metric row — honest by design.
- **Currency**: Google returns `cost_micros` (÷1e6). Show a currency toggle (USD default,
  INR optional) and never mix currencies in one aggregate.
- **De-dup on join**: blending ad spend with revenue on a bad key produces duplicate rows —
  join on a single date grain + one revenue source of truth.
