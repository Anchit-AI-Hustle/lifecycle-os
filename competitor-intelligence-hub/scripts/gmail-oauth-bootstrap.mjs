#!/usr/bin/env node
/**
 * One-shot OAuth bootstrap to mint a Gmail refresh token.
 *
 * Run locally (not in Vercel):
 *   GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... \
 *     node scripts/gmail-oauth-bootstrap.mjs
 *
 * Prereqs in GCP:
 *   1. OAuth consent screen configured (External, scope `gmail.readonly`).
 *   2. OAuth 2.0 Client ID created. Application type = "Web application".
 *      Authorized redirect URI = http://localhost:8765/cb
 *
 * Output: prints `GMAIL_OAUTH_REFRESH_TOKEN=<token>` — paste that into
 * Vercel env vars (Production + Preview).
 *
 * The refresh token does not expire while the app is in "Testing" mode for
 * up to 7 days. Once published (or set to "Internal" for Workspace), it is
 * long-lived. If you ever invalidate it, just re-run this script.
 */
import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_BOOTSTRAP_PORT || 8765);
const REDIRECT = `http://localhost:${PORT}/cb`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing GMAIL_OAUTH_CLIENT_ID or GMAIL_OAUTH_CLIENT_SECRET.\n" +
      "Set both as env vars and re-run."
  );
  process.exit(1);
}

const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n=========================================================");
console.log(" Open this URL in your browser to authorize:");
console.log("=========================================================\n");
console.log(authUrl);
console.log("\nWaiting for callback on", REDIRECT, "...\n");

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== "/cb") {
    res.writeHead(404).end("not found");
    return;
  }
  const code = u.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("missing code");
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    const refresh = tokens.refresh_token;
    if (!refresh) {
      throw new Error(
        "No refresh_token returned. The account may have already granted " +
          "consent — revoke at https://myaccount.google.com/permissions and retry."
      );
    }
    console.log("\n=========================================================");
    console.log(" ✅ SUCCESS — paste this into Vercel env vars:");
    console.log("=========================================================\n");
    console.log(`GMAIL_OAUTH_REFRESH_TOKEN=${refresh}\n`);
    console.log("Add it via:");
    console.log(
      `  vercel env add GMAIL_OAUTH_REFRESH_TOKEN production\n` +
        `  vercel env add GMAIL_OAUTH_REFRESH_TOKEN preview\n`
    );
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        "<h2>✅ Refresh token minted.</h2><p>Check the terminal for the token. You can close this tab.</p>"
      );
  } catch (err) {
    console.error("\nFAILED:", err.message);
    res.writeHead(500).end(String(err.message || err));
  } finally {
    setTimeout(() => server.close(), 250);
  }
});

server.listen(PORT, () => {
  // already logged URL above
});
