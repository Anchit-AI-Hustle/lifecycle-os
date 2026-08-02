# Smart Brain migrations (applied 2026-06-12 to linked project gubbckgjujwqodghcavv)

Applied directly via the Supabase management API in this order:
1. smart_brain_core_schema   — own-data tables: smart_products, smart_assets,
   smart_campaigns, smart_campaign_assets, smart_campaign_metrics, smart_users,
   smart_orders, smart_events, smart_sales_history
2. smart_brain_state_schema  — competitor (isolated): smart_competitor_campaigns,
   smart_competitor_signals; brain state: smart_brain_config, smart_brain_runs,
   smart_cohorts, smart_library_scores, smart_festivals, smart_calendar,
   smart_calendar_reviews, smart_feedback, smart_mvt_results, smart_funnels,
   smart_generated_campaigns, smart_generated_assets, smart_review_queue,
   smart_confidence, smart_recalibrations
3. legacy_tables_auth_rls    — app_users (+auth trigger), kb_knowledge,
   kb_top_emails, competitor_brands, competitor_emails_classified, RLS policies
4. knickgasm_agents             — smart_agents, smart_agent_knowledge,
   smart_agent_sessions, smart_agent_messages + seed agents

Authoritative DDL: `select * from supabase_migrations.schema_migrations` on the
linked project, or docs/SMART_BRAIN.md for the schema contract. Synthetic seed
data (24 months) was loaded via SQL; replace with real exports when provided.
