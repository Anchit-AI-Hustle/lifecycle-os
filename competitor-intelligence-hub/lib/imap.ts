/**
 * IMAP fetching with imapflow + mailparser.
 *
 * Designed for serverless: we open a connection, fetch only UNSEEN messages,
 * parse them, mark them \Seen, and close — all inside one function invocation.
 * Marking \Seen is what prevents duplicate processing on the next cron tick.
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";

export interface FetchedEmail {
  uid: number;
  parsed: ParsedMail;
}

/** One parsed attachment/inline asset normalized for upload. */
export interface EmailAsset {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** true if the asset is referenced inline (cid) rather than a download attachment. */
  inline: boolean;
}

function imapConfig() {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Missing GMAIL_IMAP_USER or GMAIL_IMAP_PASSWORD");
  }
  return {
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    // Keep the serverless run quiet; imapflow logs verbosely by default.
    logger: false as const,
  };
}

/**
 * Connect, fetch up to `limit` unseen messages, parse them, and mark them read.
 * Returns the parsed emails. Always closes the connection, even on error.
 */
export async function fetchUnreadEmails(limit = 25): Promise<FetchedEmail[]> {
  const client = new ImapFlow(imapConfig());
  const out: FetchedEmail[] = [];

  await client.connect();
  // Lock the mailbox so concurrent cron ticks can't race on the same messages.
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Search unseen messages. imapflow returns an array of sequence/uids.
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) return out;

    const targets = uids.slice(0, limit);

    for (const uid of targets) {
      try {
        const msg = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true }
        );
        if (!msg || !msg.source) continue;

        const parsed = await simpleParser(msg.source as Buffer);
        out.push({ uid, parsed });

        // Mark \Seen so we don't reprocess on the next tick.
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } catch (err) {
        // One bad message must not abort the whole batch (PART 3: graceful loop).
        console.error(`[imap] failed to process uid=${uid}:`, err);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => client.close());
  }

  return out;
}

/** Extract inline images + downloadable attachments from a parsed email. */
export function extractAssets(parsed: ParsedMail): EmailAsset[] {
  const atts: Attachment[] = parsed.attachments || [];
  return atts
    .filter((a) => a.content && a.content.length > 0)
    .map((a, i) => {
      const inline =
        a.contentDisposition === "inline" || Boolean(a.cid) || Boolean(a.related);
      const ext = (a.contentType?.split("/")[1] || "bin").split(";")[0];
      return {
        filename: a.filename || `${inline ? "inline" : "attachment"}-${i + 1}.${ext}`,
        mimeType: a.contentType || "application/octet-stream",
        buffer: a.content as Buffer,
        inline,
      };
    });
}

/** Pull the sender display name + address from a parsed email. */
export function extractSender(parsed: ParsedMail): {
  displayName: string;
  address: string;
} {
  const from = parsed.from?.value?.[0];
  return {
    displayName: from?.name || "",
    address: (from?.address || "").toLowerCase(),
  };
}
