---
name: finish-setup
description: Finish the operator's account setup for Lifecycle OS, end to end, from a Claude session on the operator's OWN computer. Use when the user says "finish setup", "fix the dead model keys", "replace my AI keys", "set up OAuth apps", "connect Meta / Google Ads / TikTok / Pinterest / YouTube / Klaviyo sign-in", "rewrite git history", or "do the things only I can do". Three jobs: (1) replace or top up every refused AI model key and prove each with Test, (2) create each platform's OAuth app and put its client id + secret on Vercel without the secret ever appearing in chat, (3) rewrite git history to drop removed files and a personal email.
argument-hint: "[keys | oauth | history | all]"
---

# Finish setup: the three jobs only the account owner can do

This is ACCOUNT setup, not brand work: it touches no brand record, so `/brand-context`
is not needed first. Run it in a Claude session on the operator's own Mac
(`claude remote-control` in the repo folder, or the Claude desktop app), because every
job needs something only that machine has: the operator signed in to each provider's
console in their browser, the Vercel CLI logged in, and permission to force-push.

## Hard rules (never relax)
- **A secret never enters the chat.** Not in your reply, not in a command line, not in a
  file. The operator copies a secret to the clipboard; you move it with
  `pbpaste | vercel env add NAME production --sensitive` (the value goes through the pipe
  only). Never `echo`, `cat`, `pbpaste` alone, or `vercel env pull` a secret.
- **The operator signs in, pays and accepts terms.** You open the right page
  (`open <url>`), say exactly what to click and what to copy, and wait. Never type a
  password, card number or one-time code; never click "Pay", "Agree" or "Create key" for them.
- A model key the operator brings belongs in THEIR workspace (AI Models page), never on
  Vercel. Only platform OAuth app credentials go on Vercel.
- Ask before each job; stop when they say stop. Report what is done and what is not.

## Job 1: the dead model keys (`keys`)
Production logs on 2026-10-31 showed every connected model refused. For each row: open
the page, tell the operator the fix, wait for "done", then have them paste the new key on
**https://lifecycle-os.anchit-tandon.com/ai-models** (the "Paste any AI key" box detects the
provider) and press **Test** on that card. Test quotes the provider's own reason; if it
still fails, read that sentence back and fix what it names. A model the operator does
not want can be removed instead (Remove on its card): the platform's models then answer.

| Card | Refused with | What it means | Open |
|---|---|---|---|
| Claude (Anthropic) | 401 | key revoked or mistyped: make a new key | https://console.anthropic.com/settings/keys (credit: /settings/billing) |
| Bedrock (AWS) | 403 | the IAM user lacks Bedrock permission or the model is not enabled in that region | https://console.aws.amazon.com/bedrock/home#/modelaccess and https://console.aws.amazon.com/iam/home#/users (attach `AmazonBedrockFullAccess`, new access key pair; on the card fill key id, secret and region) |
| OpenAI | 429 | no credit left on the API account (ChatGPT Plus does not count) | https://platform.openai.com/settings/organization/billing then https://platform.openai.com/api-keys |
| Grok (xAI) | 403 | team spending limit reached | https://console.x.ai (Billing: raise the limit or add credit) |
| DeepSeek | 401 | key revoked or mistyped | https://platform.deepseek.com/api_keys (credit: https://platform.deepseek.com/top_up) |
| Groq | 401 | key revoked or mistyped | https://console.groq.com/keys |
| Ollama (cloud) | 402 | the plan's usage is used up | https://ollama.com/settings (plan) and https://ollama.com/settings/keys |
| Gemini | 503 then 404 | 503 = Google was overloaded (temporary); 404 = the model asked for is not on this key. Make a key in AI Studio, or press "Sign in with Google" on the card | https://aistudio.google.com/apikey |

Done when every card the operator keeps shows Test passed.

## Job 2: the OAuth apps (`oauth`)
"Sign in to connect" on /connections needs one app per platform, registered by the
operator, whose id and secret the server reads from these Vercel env vars (names from
`api/_shared/oauth-core.js` `clientIdFor`/`clientSecretFor`; never invent another):

| Platform | Console | Client id env | Secret env |
|---|---|---|---|
| Meta (Facebook, Instagram, Meta Ads) | https://developers.facebook.com/apps (type Business; add Facebook Login for Business + Marketing API) | `META_APP_ID` | `META_APP_SECRET` |
| Google Ads | https://console.cloud.google.com/apis/credentials (OAuth client, Web application; enable Google Ads API) | `GOOGLE_ADS_CLIENT_ID` | `GOOGLE_ADS_CLIENT_SECRET` |
| YouTube | same Google console, its own Web client; enable YouTube Data API v3 | `YOUTUBE_OAUTH_CLIENT_ID` | `YOUTUBE_OAUTH_CLIENT_SECRET` |
| TikTok | https://developers.tiktok.com/apps (Login Kit + Content Posting API) | `TIKTOK_CLIENT_KEY` | `TIKTOK_CLIENT_SECRET` |
| Pinterest | https://developers.pinterest.com/apps | `PINTEREST_APP_ID` | `PINTEREST_APP_SECRET` |
| Klaviyo | https://www.klaviyo.com/manage-apps (create app, OAuth) | `KLAVIYO_OAUTH_CLIENT_ID` | `KLAVIYO_OAUTH_CLIENT_SECRET` |

The **redirect URI** each app must allow (exactly, one per platform; `<provider>` is the
first column's id: `meta`, `google_ads`, `youtube`, `tiktok`, `pinterest`, `klaviyo`):

`https://lifecycle-os.anchit-tandon.com/api/public-config?action=connections&op=oauth-callback&provider=<provider>`

Google Ads also needs `GOOGLE_ADS_DEVELOPER_TOKEN` (Google Ads > Tools > API Center),
set the same way. Meta and TikTok review an app before strangers can use it; until then
only accounts added as app testers can sign in, which is enough for the operator's own.

For each platform the operator chooses:
1. `open` the console; tell them what to create and the redirect URI to paste.
2. They copy the **client id**; you run `pbpaste | vercel env add <ID_ENV> production`.
3. They copy the **secret**; you run `pbpaste | vercel env add <SECRET_ENV> production --sensitive`.
   (Check first with `vercel env ls production | grep <NAME>`; if it exists, `vercel env rm <NAME> production -y` then add.)
4. After the last one, `vercel deploy --prod` (an env change reaches only a new deployment),
   or redeploy the latest production deployment from the dashboard.
5. Have them open /connections, press "Sign in to connect" on that card and finish the
   provider's consent screen. Done when the card says Connected.

If the Vercel CLI is not logged in: `npx vercel login`, then `npx vercel link` in the repo
(project `lifecycle-os`, team `anchit-ai-hustle`).

## Job 3: the git history rewrite (`history`)
Files removed from the tree on 2026-10-30 (`image.png`, `update.ps1`,
`deploy-copilot.sh`, `Raw Prompts/`) and a personal email address are still readable in
old commits. `scripts/history-rewrite.sh` removes them from every commit.
1. Ask whether anything else must go (another file, or a secret that was ever committed;
   for a secret, ROTATE it at the provider first: a rewrite does not un-leak it).
   Add it to `PATHS` / `REPLACE` in the script.
2. `brew install git-filter-repo` if missing.
3. Dry run: `bash scripts/history-rewrite.sh`. Show the report (what is left, the size).
4. Only on the operator's explicit "push it": `bash scripts/history-rewrite.sh --push`;
   they type `REWRITE` at the prompt themselves.
5. Afterwards: every clone must be re-cloned (`git clone` fresh); open PRs and agent
   branches based on old history are re-based or recreated; CI caches are cleared.
Never run `--push` with an open PR the operator still wants to merge as is.

## Report
One line per job: done / partly done (what is left) / not started, and for keys a row per
card with its Test result. Never include a key, secret or token.
