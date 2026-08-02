/**
 * Gmail OAuth2 helpers — used for the Push notification path.
 *
 * Two responsibilities:
 *   1. registerWatch() — call users.watch() so Gmail starts pushing
 *      notifications to our Pub/Sub topic whenever a message hits INBOX.
 *      Tokens expire after 7 days; a daily cron re-arms them.
 *   2. verifyPubSubJwt() — verify the JWT that Pub/Sub Push attaches to
 *      every webhook call, so only Google can trigger our sync.
 *
 * OAuth client/secret/refresh token are stored as env vars. The refresh
 * token is minted once via scripts/gmail-oauth-bootstrap.mjs.
 */
import { google, gmail_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getOAuth2Client(): OAuth2Client {
  const clientId = readEnv("GMAIL_OAUTH_CLIENT_ID");
  const clientSecret = readEnv("GMAIL_OAUTH_CLIENT_SECRET");
  const refreshToken = readEnv("GMAIL_OAUTH_REFRESH_TOKEN");

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function getGmailClient(): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: getOAuth2Client() });
}

/**
 * Tell Gmail to start pushing to our Pub/Sub topic. Expires after 7 days.
 * Idempotent: re-calling refreshes the expiration window.
 */
export async function registerWatch(): Promise<{
  historyId: string;
  expirationMs: number;
  expirationIso: string;
}> {
  const topic = readEnv("GMAIL_PUBSUB_TOPIC");
  const gmail = getGmailClient();

  const { data } = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: topic,
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    },
  });

  const expirationMs = Number(data.expiration || 0);
  return {
    historyId: String(data.historyId || ""),
    expirationMs,
    expirationIso: expirationMs ? new Date(expirationMs).toISOString() : "",
  };
}

/** Stop receiving push notifications (used for teardown / debugging). */
export async function stopWatch(): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.stop({ userId: "me" });
}

/**
 * Verify the JWT that Pub/Sub attaches to each push request.
 * Pub/Sub signs it as the service account configured on the subscription.
 * We check (a) the signature, (b) the audience matches our webhook URL,
 * and (c) the issuer matches our allowlisted SA email if one is configured.
 */
export async function verifyPubSubJwt(token: string): Promise<void> {
  if (!token) throw new Error("Missing Authorization bearer token");

  const audience = process.env.GMAIL_PUBSUB_AUDIENCE;
  if (!audience) throw new Error("Missing GMAIL_PUBSUB_AUDIENCE");

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Empty JWT payload");

  const expectedSa = process.env.GMAIL_PUBSUB_SA_EMAIL;
  if (expectedSa && payload.email !== expectedSa) {
    throw new Error(`Unexpected JWT issuer: ${payload.email}`);
  }
}

/**
 * Decode the Pub/Sub message body. Gmail encodes `{ emailAddress, historyId }`
 * as base64-encoded JSON in `message.data`.
 */
export function decodePubSubMessage(body: unknown): {
  emailAddress?: string;
  historyId?: string;
} {
  const data =
    body &&
    typeof body === "object" &&
    "message" in body &&
    body.message &&
    typeof body.message === "object" &&
    "data" in body.message
      ? (body.message as { data?: string }).data
      : undefined;

  if (!data) return {};
  try {
    const decoded = Buffer.from(data, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}
