/**
 * Cloudflare Email Worker - Inbound Mail Capture Router
 * 
 * Intercepts incoming emails, decodes the raw stream, and forwards
 * it as a JSON payload to the FastAPI mail ingestion endpoint.
 */

export default {
  async email(message, env, ctx) {
    const reader = message.raw.getReader();
    const decoder = new TextDecoder("utf-8");
    let rawSmtpContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawSmtpContent += decoder.decode(value, { stream: true });
      }
      rawSmtpContent += decoder.decode(); // Flush text decoder stream buffer
    } catch (readErr) {
      console.error("Error reading SMTP stream:", readErr);
      message.setReject("Failed to stream raw email payload at edge worker.");
      return;
    }

    const payload = {
      from_address: message.from,
      to_address: message.to,
      subject: message.headers.get("subject") || "No Subject",
      raw_smtp: rawSmtpContent
    };

    // Retrieve target webhook API URL and shared secret from Cloudflare Env variables
    const targetUrl = env.INGESTION_API_URL || "https://your-api-engine.com/v1/incoming-mail";
    const secretSignature = env.ENGINE_SECRET_SIGNATURE;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Engine-Secret-Key": secretSignature || ""
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error(`Backend returned status ${response.status}: ${errBody}`);
        message.setReject("Inbound ingestion endpoint rejected the payload.");
      }
    } catch (fetchErr) {
      console.error("Failed to forward payload to backend API:", fetchErr);
      message.setReject("Failed to route email payload to ingestion backend.");
    }
  }
};
