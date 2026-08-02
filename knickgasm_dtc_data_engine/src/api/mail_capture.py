import email
from email.policy import default
from datetime import datetime
import logging
from typing import Dict, Any, Optional
from fastapi import FastAPI, Request, HTTPException, Header, status
from pydantic import BaseModel

app = FastAPI(title="Knickgasm Inbound Email Capture Engine")
logger = logging.getLogger("dtc_data_engine")

class InboundMailPayload(BaseModel):
    from_address: str
    to_address: str
    subject: str
    raw_smtp: str

@app.post("/v1/incoming-mail", status_code=status.HTTP_201_CREATED)
async def process_incoming_mail(
    payload: InboundMailPayload,
    x_engine_secret_key: Optional[str] = Header(None, alias="X-Engine-Secret-Key")
):
    """
    Receives raw SMTP payloads from the Cloudflare worker, parses the headers,
    extracts the high-fidelity HTML content, and processes it for archival storage.
    """
    # Simple security key verification placeholder
    # In production, check this against environment variables (e.g., os.getenv("ENGINE_SECRET_SIGNATURE"))
    # if x_engine_secret_key != EXPECTED_SECRET:
    #     raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key signature.")

    try:
        # Parse the raw SMTP string using the standard default policy (which exposes body parts and clean unicode strings)
        msg = email.message_from_string(payload.raw_smtp, policy=default)

        # Safely extract core metadata
        sender = msg.get("from", payload.from_address)
        subject = msg.get("subject", payload.subject)
        timestamp_str = msg.get("date")

        # Parse date representation, falling back to current UTC if header is malformed
        try:
            timestamp = email.utils.parsedate_to_datetime(timestamp_str)
        except Exception:
            timestamp = datetime.utcnow()

        html_content = ""
        text_content = ""

        # Recursive parsing of multipart messages
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))

                # Skip standard attachment payloads
                if "attachment" in content_disposition:
                    continue

                if content_type == "text/html":
                    html_content = part.get_content()
                    break  # Found our primary HTML representation
                elif content_type == "text/plain":
                    text_content = part.get_content()
        else:
            content_type = msg.get_content_type()
            if content_type == "text/html":
                html_content = msg.get_content()
            elif content_type == "text/plain":
                text_content = msg.get_content()

        # Fallback formatting if HTML section is missing but text exists
        if not html_content and text_content:
            html_content = f"<html><body><pre>{text_content}</pre></body></html>"
        elif not html_content:
            html_content = "<html><body><p>[Empty Email Body]</p></body></html>"

        # Database insert placeholder hook:
        # db_record = save_to_postgres(sender, subject, timestamp, html_content)

        return {
            "status": "success",
            "parsed_meta": {
                "sender": sender,
                "subject": subject,
                "captured_at": timestamp.isoformat(),
                "html_content_length": len(html_content)
            }
        }

    except Exception as e:
        logger.error(f"Failed to parse inbound email payload: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing raw SMTP content string."
        )

# ==============================================================================
# OPTIONAL VISUAL SNAPSHOT ARCHIVAL UTILITY
# ==============================================================================
# This utility demonstrates how a background worker can use headless Playwright
# to safely render parsed HTML content and export full-page screenshots to Amazon S3.
#
# To run this utility, install dependencies:
#     pip install playwright boto3
#     playwright install chromium
#
# import boto3
# from playwright.async_api import async_playwright
#
# async def capture_and_archive_html_to_s3(mailer_id: str, raw_html: str) -> str:
#     """
#     Renders the provided raw HTML locally inside a headless browser viewport
#     and uploads a visual PNG snapshot of the rendering to an S3 bucket.
#     """
#     async with async_playwright() as p:
#         # Spin up browser instance in sandboxed headless mode
#         browser = await p.chromium.launch(headless=True)
#         context = await browser.new_context(
#             viewport={"width": 800, "height": 1200},
#             device_scale_factor=2  # High-density Retina snapshot for crisp detail
#         )
#         page = await context.new_page()
#         
#         # Safe content injection (networkidle ensures external assets like web fonts and images resolve)
#         await page.set_content(raw_html, wait_until="networkidle", timeout=30000)
#         
#         # Capture full height scroll footprint dynamically
#         screenshot_buffer = await page.screenshot(full_page=True, type="png")
#         
#         await context.close()
#         await browser.close()
#
#     # Store the binary snapshot payload directly to S3
#     s3_client = boto3.client('s3')
#     bucket_name = "knickgasm-competitor-intelligence-vault"
#     object_key = f"snapshots/{mailer_id}.png"
#     
#     s3_client.put_object(
#         Bucket=bucket_name,
#         Key=object_key,
#         Body=screenshot_buffer,
#         ContentType="image/png"
#     )
#     
#     return f"https://{bucket_name}.s3.amazonaws.com/{object_key}"
# ==============================================================================
