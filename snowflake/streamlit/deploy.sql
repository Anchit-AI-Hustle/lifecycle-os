-- Deploy the Lifecycle OS Analytics app (Data Analysis + Ads) as Streamlit-in-Snowflake.
-- Run in a Snowflake worksheet (Snowsight) with a role that can READ the ad-pipeline
-- tables in your warehouse and CREATE objects in the target schema.
--
-- Substitute before running:
--   <DATABASE>   the database that holds your ad tables (and will hold the app)
--   <WAREHOUSE>  the warehouse the app queries with, e.g. COMPUTE_WH
--
-- The app does NOT hardcode any source table. At runtime it resolves each source
-- from the SF_*_TABLE environment overrides, else by discovery against
-- INFORMATION_SCHEMA in the session's current database, and reports anything it
-- cannot resolve rather than querying a guess. So the only grant that matters is
-- read access to whatever tables your own pipelines load.
--
-- The app authenticates via get_active_session() at runtime — no keys stored.

-- 1) A home for the app + a stage to hold its files.
CREATE SCHEMA IF NOT EXISTS <DATABASE>.APPS;
CREATE STAGE IF NOT EXISTS <DATABASE>.APPS.STREAMLIT_STAGE
  DIRECTORY = (ENABLE = TRUE);

-- 2) Upload the two files to the stage. Easiest path: Snowsight -> Data ->
--    <DATABASE> -> APPS -> STREAMLIT_STAGE -> + Files, and drop:
--       streamlit_app.py
--       environment.yml
--    (Or via SnowSQL:
--       PUT file://streamlit_app.py  @<DATABASE>.APPS.STREAMLIT_STAGE/lifecycle_os AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--       PUT file://environment.yml   @<DATABASE>.APPS.STREAMLIT_STAGE/lifecycle_os AUTO_COMPRESS=FALSE OVERWRITE=TRUE; )

-- 3) Create the Streamlit app object. Keep the object name stable across deploys
--    so the app URL Snowflake minted on first create does not change.
CREATE OR REPLACE STREAMLIT <DATABASE>.APPS.KNICKGASM_ADS_ANALYSIS
  ROOT_LOCATION = '@<DATABASE>.APPS.STREAMLIT_STAGE/lifecycle_os'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = '<WAREHOUSE>'
  TITLE = 'Lifecycle OS Analytics';

-- 4) Grant usage to the analyst role(s) that should open it.
-- GRANT USAGE ON STREAMLIT <DATABASE>.APPS.KNICKGASM_ADS_ANALYSIS TO ROLE <ANALYST_ROLE>;

-- Snowflake mints the app URL when the object is created; find it in
-- Snowsight -> Projects -> Streamlit. It is account-specific, so it is not
-- recorded here.
--
-- FASTER ALTERNATIVE (no staging): Snowsight -> Projects -> Streamlit ->
--   + Streamlit App -> pick your database/schema + a warehouse -> paste
--   streamlit_app.py -> add altair to the Packages picker -> Run.
