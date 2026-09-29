# Agents status — what each agent needs, what production answers, what unblocks it

Measured 2026-09-29. Every production answer below was fetched from production itself through the
Vercel connector (the container's egress policy refuses the production host), with GET requests only,
at 10:22–10:23 UTC. Nothing here was probed with a POST: on the code production runs, an anonymous POST
to a model action spends the deployment's provider keys (see "Why the deploy matters" below), and a
status document is not worth that spend.

## Production today

| Fact | Measured |
|---|---|
| Deployment serving `lifecycle-os.anchit-tandon.com` | `dpl_8AEwJP1NWLjyvxvSB7yuLmZzSiB9`, commit `2b2a992` (PR #105), created 2026-09-29 07:09 UTC, state READY |
| Main commits with no production deployment | #108, #111, #112 (`5d2ad8c`), #113 (`9e92f68`) and this branch. The six newest production-target deployments listed by the Vercel API end at `2b2a992`; #113's own commit message records Vercel refusing main pushes with "Deployment rate limited - retry in 24 hours" |
| Sign-in store (`/api/public-config?action=auth&op=status`) | `200 {"mode":"device","reason":"no_database_url"}`: every mobile+PIN account lives only in the browser that made it, and its token is never sent |
| Liveness (`/api/health`) | `200 {"ok":true,"build":"lifecycle-os"}` |
| Workspace database | Supabase project `fswdwmkgggzyxrdzabnh` is PAUSED for unpaid invoices on the Vercel-provisioned org (recorded 2026-09-12: `status: INACTIVE`, `restore_project` answers `PaymentRequiredException`). Not re-measured today |
| Project-level environment variable NAMES on Vercel (values not read) | `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OpenRouter_API_KEY`, `GITHUB_MODELS_TOKEN`, `INGEST_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Absent: `DATABASE_URL`, `CREDITS_COMP_PHONES`, `CREDITS_COMP_ACCOUNTS`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `AGENT_BUILDER_API_KEY`, `CONNECTION_SECRET_KEY`, `KLAVIYO_API_KEY`. Team-shared variables, if any, are not in this list |

## Every agent surface

"Needs" is read from the code on this branch. "Production today" is what `2b2a992` answered, or why it
was not measured. "After this branch deploys" is what the executed specs (`tests/agents-review.spec.js`,
`tests/agents-executed.spec.js`, `tests/router-brain.spec.js`) prove the new code answers.

| Agent | Page | Route | Needs | Production today (`2b2a992`) | After this branch deploys, with production's env as listed | Unblocks it |
|---|---|---|---|---|---|---|
| KicksGPT (brand assistant) | `kicksgpt.html` | `POST /api/brain?action=brand-chat` | verified caller; wallet (`assistant.chat`, 2/turn); model key | Not probed (POST). The page, in device mode, refuses before sending. Per its code, an anonymous server-to-server POST reaches the model | Page: the device-session sentence, nothing sent. Server: anonymous 401, device/forged token 401, unlisted number 403, listed number metered | `DATABASE_URL`, `CREDITS_COMP_PHONES`, the Supabase invoice (the ledger is a Supabase table) |
| KicksGPT tool manifest | `kicksgpt.html` | `GET /api/brain?action=brand-tools` | nothing (public) | `200`, 19 tools, `klaviyo_connected:false`, assistant name `KicksGPT` | Same; a signed-out page gets it with no workspace | — |
| Brand / buyer agents | `agent.html`, `agent-widget.js` | `GET agents`, `POST agent-chat` (`assistant.chat`), `agent-sessions`, `agent-upsert`, `agent-sync`, `POST tts` (`audio.tts`) | agents live in `smart_agents` (Supabase, per workspace); chat needs a verified caller + wallet + key; tts needs `ELEVENLABS_API_KEY` | `GET agents` (no Origin, no token): `200 {"ok":true,"agents":[]}` | A phone account has no workspace, so no agents: chat `404 agent_not_found` with a sentence; writes `409 no_workspace`; tts `501` without the key | The Supabase invoice (a workspace with agents), `ELEVENLABS_API_KEY` for voice |
| Team copilot | `team.html` | `POST team-chat` (`assistant.chat`) | verified caller; wallet; key | Not probed (POST) | Listed number: answers over NOTHING of another workspace (before the review fix it read tenant zero's rows) | `DATABASE_URL`, `CREDITS_COMP_PHONES`, Supabase |
| Analyst Q&A | no page names it | `POST agent-analyze` (`assistant.chat`) | as above | Not probed (POST) | As above | As above |
| Smart Brain console | `smart-brain.html` | `POST console-chat` (`assistant.chat`), `POST agentic-run` (`campaign.plan`), `/api/calendar?action=smart-brain-plan|sync-daily|preview|approve|reject` | verified caller + wallet for the model actions and preview; a brand WORKSPACE for approve/reject/feedback | `GET /api/brain?action=status`: `200`, `db_linked:true`, every count 0, `weekly_recalibration.overdue:true`, `llm_available:true` (which reports only that `llm.js` loaded, not that a key works) | Phone account: plan/sync compute and persist nothing; preview works for a listed number; approve/reject `409 no_workspace` | Supabase (a workspace to plan into) |
| Platform analyst agents | no page names it | `GET platform-agents` (`analytics.report`) | session + wallet + key | `401 sign_in_required` with a sentence | Same gate, now also metered | `DATABASE_URL`, `CREDITS_COMP_PHONES`, Supabase |
| Social Media OS | `social-media.html` | `POST social-run-daily` (`social.daily_run`), `GET social-list`, `POST social-approve|skip` | verified caller + wallet for the run; Supabase to save posts | Not probed (POST) | Listed number: a dry run as the brand it carried; saving needs a workspace | `DATABASE_URL`, `CREDITS_COMP_PHONES`, Supabase |
| TeleSuite | `telesuite.html` | `?action=telesuite&op=registry|clone|n8n` public; every other op | an email-account session in Supabase (a phone account has no identity there) | `op=registry`: `200`, 23 subfeatures and the full price list | Phone account: `403 account_type_unsupported` with a sentence, before any hold or model call | Supabase AND an account kind TeleSuite can hold (a phone account cannot today) |
| Copilot (every page) | `copilot.js` | `POST /api/ai/generate` `mode:'chat'` (`assistant.chat`) | verified caller; wallet; key | Not probed (POST) | Unlisted number `403` even with the meter unconfigured | `DATABASE_URL`, `CREDITS_COMP_PHONES`, Supabase |
| Landing-page agent | `landing-page-agent.html` | `POST /api/ai/generate` (autofill), `/api/ai/landing-page` | as above | Not probed (POST) | As above | As above |
| Access narrative | `access-issues.html` | `POST access-narrative` (`analytics.narrative`) | verified caller; wallet; key | Not probed (POST) | Metered | As above |
| Analysis narrative | no page names it | `GET|POST analysis-narrative` (`analytics.narrative`) | as above, and only the owner of the bundled export gets numbers | Not probed | Metered; a non-owner's "not yours" note is refunded | As above |
| Jarvis (navigation) | no page names it | `POST jarvis` | nothing; no model | Not measured: the connector issues GET only, the route is POST-only, and for this path it answered "deployment could not be found" twice while other paths on the same host answered | Signed-out page: internal routes only, no storefront; phone account: the store its own record names | — |
| Agent Builder bridge | — | `GET agent-builder&op=spec` public; tool ops need `x-agent-key` | `AGENT_BUILDER_API_KEY` for tool ops | `op=spec`: `200` OpenAPI 3.0.3, title "Lifecycle OS — growth tools", server `https://lifecycle-os.anchit-tandon.com`, no brand name | Same for a signed-out page (no workspace, no brand name) | `AGENT_BUILDER_API_KEY` |
| Credits | every page (pill) | `/api/public-config?action=credits&op=balance` | a verified session | `401 sign_in_required` (anonymous) | Unlisted number: `200 wallet:null`, "No credit wallet on this sign-in"; listed: its personal wallet. Store down: `503 backend_unreachable` naming the host | `CREDITS_COMP_PHONES`, Supabase |

## Why the deploy matters

`2b2a992` predates PR #112 and this branch. On it, per its code and the 2026-09-28 router pin
(`tests/router-brain.spec.js`), an anonymous POST with no Origin reaches `brand-chat`, `console-chat`,
`team-chat`, `agent-chat`, `agent-analyze`, `access-narrative`, `agentic-run`, `generate`,
`video-generate`, `mailer-assets`, `tts` and `social-run-daily`, and production carries four
model-provider variables (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OpenRouter_API_KEY`,
`GITHUB_MODELS_TOKEN`). That was not probed, for the reason above; it is what the code at that commit
does, and what the executed specs on this branch prove the new code refuses.

## What unblocks the agents, in order

1. **Deploy main.** Production is `2b2a992`. #113 stops agent branches spending the team's daily
   deployment budget, so the next main push can deploy once the rolling window allows.
2. **Settle the Supabase invoice** for the Vercel-provisioned org, so project `fswdwmkgggzyxrdzabnh`
   restores. Every workspace table, the credit ledger (so every metered turn) and TeleSuite live there.
   Until then a listed number's metered turn answers `503 backend_unreachable` naming the host.
3. **Set `DATABASE_URL`** (Neon). Without it every sign-in is device-only, the token is never sent, and
   every agent that needs a caller refuses in the page before anything is sent.
4. **Set `CREDITS_COMP_PHONES`** with the operator's own number. A phone number holds a wallet only
   when it is on that list; an unlisted number is refused before any wallet row exists.
5. Optional: `ELEVENLABS_API_KEY` (agent voice), `AGENT_BUILDER_API_KEY` (the Agent Builder bridge).
