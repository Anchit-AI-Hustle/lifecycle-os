# Uploaded by Anchit — raw source exports

Drop CSVs here. The dashboard's "Link Database" → "Import uploads" flow
reads from this folder and writes into whichever Supabase schema you've
linked the app to.

## Expected files (KNICKGASM exports)

| File | Source | Maps to table |
|---|---|---|
| `shopify_customers.csv` | Shopify customer export (knickgasm.com admin) | `<schema>.shopify_customers` |
| `shopify_orders.csv` | Shopify order export (line-item per row) | `<schema>.shopify_orders_lines` |
| `shopify_products.csv` | Shopify product/variant export | `<schema>.shopify_products` |
| `klaviyo_campaigns.csv` | Klaviyo campaigns export | `<schema>.klaviyo_campaigns` |
| `klaviyo_flows__sample_5k.csv` | Sample of the Klaviyo Flows export | `<schema>.klaviyo_flow_events` |
| `webengage_users__sample_5k.csv` | Sample of the WebEngage user export | `<schema>.webengage_users` |

> This folder ships EMPTY in the KNICKGASM repo: the previous brand's raw
> customer exports were removed at replication time (real PII never crosses
> brands). Export the equivalent files from the Knickgasm Shopify admin and
> marketing tools, drop them here, then run `scripts/ingest-uploads.js`.
