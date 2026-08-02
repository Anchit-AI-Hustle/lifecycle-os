-- Deploy the KNICKGASM Analytics app (Data Analysis + Ads) as Streamlit-in-Snowflake.
-- Run in a Snowflake worksheet (Snowsight) with a role that can read
-- KNICKGASM_DB.MAPLEMONK/MAPLEMONK1 and DATON.RAW, and create objects in the target
-- schema. Replace <WAREHOUSE> with your warehouse (e.g. COMPUTE_WH).
--
-- The app authenticates via get_active_session() at runtime — no keys stored.

-- 1) A home for the app + a stage to hold its files.
CREATE SCHEMA IF NOT EXISTS KNICKGASM_DB.APPS;
CREATE STAGE IF NOT EXISTS KNICKGASM_DB.APPS.STREAMLIT_STAGE
  DIRECTORY = (ENABLE = TRUE);

-- 2) Upload the two files to the stage. Easiest path: Snowsight -> Data ->
--    KNICKGASM_DB -> APPS -> STREAMLIT_STAGE -> + Files, and drop:
--       streamlit_app.py
--       environment.yml
--    (Or via SnowSQL:
--       PUT file://streamlit_app.py  @KNICKGASM_DB.APPS.STREAMLIT_STAGE/knickgasm_ads AUTO_COMPRESS=FALSE OVERWRITE=TRUE;
--       PUT file://environment.yml   @KNICKGASM_DB.APPS.STREAMLIT_STAGE/knickgasm_ads AUTO_COMPRESS=FALSE OVERWRITE=TRUE; )

-- 3) Create the Streamlit app object. Object name kept as KNICKGASM_ADS_ANALYSIS so
--    the app URL stays stable even though it now covers Data Analysis + Ads.
CREATE OR REPLACE STREAMLIT KNICKGASM_DB.APPS.KNICKGASM_ADS_ANALYSIS
  ROOT_LOCATION = '@KNICKGASM_DB.APPS.STREAMLIT_STAGE/knickgasm_ads'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = '<WAREHOUSE>'
  TITLE = 'KNICKGASM Analytics';

-- 4) Grant usage to the analyst role(s) that should open it.
-- GRANT USAGE ON STREAMLIT KNICKGASM_DB.APPS.KNICKGASM_ADS_ANALYSIS TO ROLE <ANALYST_ROLE>;

-- The app URL (opens in Snowsight):
--   https://app.snowflake.com/uxdeihw/mo06981/#/streamlit-apps/KNICKGASM_DB.APPS.KNICKGASM_ADS_ANALYSIS
--
-- FASTER ALTERNATIVE (no staging): Snowsight -> Projects -> Streamlit ->
--   + Streamlit App -> pick KNICKGASM_DB.APPS + a warehouse -> paste streamlit_app.py
--   -> add altair to the Packages picker -> Run. Snowflake mints the URL on save.
