# Readers in each country

Some brands' regional stores send a server outside that country to another
country's store (Lenskart's India, UAE, Saudi Arabia and Thailand stores send a
US server to `/en-us/`). The catalogue importer cannot read those markets from
where Lifecycle OS runs. A **reader** is a small server that actually runs in
the market's country and fetches that market's pages for the importer.

This is not pretending a location: the request really originates in that
country. Nothing else about it changes - the reader sends the importer's own
user agent (`LifecycleOS-BrandCrawler/1.0 ...`), no cookie, no
Accept-Language, no X-Forwarded-For, no Accept-Encoding; robots.txt, pacing,
geo-redirect detection and the currency check stay in the importer and apply
to everything a reader returns. If a store still redirects the reader, the
importer says so.

No dependencies; Node 20 or later. The same code runs two ways.

## Protocol

```
POST /api/read        (also /read)
  body    {"url": "https://store.example/p/1", "accept": "text/html", "ts": 1760000000000}
  header  X-Reader-Signature: hex(HMAC-SHA256(READER_SECRET, ts + "\n" + url))
          ts is milliseconds since the epoch; refused when more than 120 s from the reader's clock
  200     {ok, status, final_url, hops:[{url,status}], content_type, retry_after,
           body_base64, truncated, reader:{country, region}}
  401     READER_SECRET missing or under 32 characters, bad signature, stale ts
  400     not http(s), not port 80/443, or a private / loopback / link-local /
          metadata / internal address - checked on every redirect hop (at most 5),
          the socket pinned to the checked address
GET  /api/health      (also /health)  {ok:true, country, region}  (fetches nothing)
```

A body is cut at 8 MB (`truncated: true`); on Vercel at 3 MB, because a Vercel
function response is capped at 4.5 MB and base64 adds a third. Override with
`READER_MAX_BYTES`. One read has 25 seconds.

## Environment

| Variable | Where | Value |
|---|---|---|
| `READER_SECRET` | each reader | the same random string as the main project's `CATALOG_READER_SECRET`, at least 32 characters (`openssl rand -hex 32`) |
| `READER_COUNTRY` | each reader | the ISO country it runs in: `IN`, `AE`, `SA`, `TH` |
| `READER_REGION` | VM readers | the cloud region name, for the health answer (Vercel sets `VERCEL_REGION` itself) |
| `PORT`, `HOST` | VM readers | default `8080`, `0.0.0.0` |
| `CATALOG_READERS` | main project | JSON, market -> reader base URL: `{"IN":"https://lifecycle-reader-in.vercel.app","SA":"https://reader-sa.example.com"}` |
| `CATALOG_READER_SECRET` | main project | the shared secret; used only as the HMAC key, never sent |

## On Vercel (India, UAE)

A separate Vercel project per country, with **Root Directory = `readers`**.
`readers/vercel.json` names no region on purpose: the region is the country,
chosen per project at deploy time.

```bash
cd readers
vercel link --project lifecycle-reader-in
vercel env add READER_SECRET production        # paste the shared secret
vercel env add READER_COUNTRY production       # IN
vercel deploy --prod --regions bom1            # Mumbai

vercel link --project lifecycle-reader-ae
vercel env add READER_SECRET production
vercel env add READER_COUNTRY production       # AE
vercel deploy --prod --regions dxb1            # Dubai
```

Check: `curl https://lifecycle-reader-in.vercel.app/api/health` should answer
`{"ok":true,"country":"IN","region":"bom1"}`. Vercel has no region in Saudi
Arabia or Thailand (Singapore is not Thailand), so those two are VMs.

## On a VM (Saudi Arabia, Thailand)

Copy `readers/` to the VM (no `npm install` needed) and run it under systemd.

`/etc/systemd/system/lifecycle-reader.service`:

```ini
[Unit]
Description=Lifecycle OS catalogue reader
After=network-online.target
Wants=network-online.target

[Service]
User=reader
WorkingDirectory=/opt/lifecycle-reader
EnvironmentFile=/etc/lifecycle-reader.env
ExecStart=/usr/bin/node /opt/lifecycle-reader/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/lifecycle-reader.env` (mode 600, owner root):

```
READER_SECRET=<the shared secret>
READER_COUNTRY=SA
READER_REGION=me-central2
PORT=8080
```

Put it behind HTTPS (a load balancer, or Caddy on the VM:
`reader-sa.example.com { reverse_proxy 127.0.0.1:8080 }`) and set `HOST=127.0.0.1`
when a proxy on the same machine terminates TLS. The secret signs every
request, but a plain-HTTP reader would still expose page bodies in transit.

### GCE commands

**Region names to confirm before running** (`gcloud compute regions list`):
- Saudi Arabia: `me-central2` (Dammam). Confirm it is listed for the project
  and that the e2 family is offered there (`gcloud compute machine-types list
  --filter="zone~me-central2"`).
- Thailand: **not confirmed here.** Google has announced a Thailand region, but
  its name and availability were not verified when this was written. Run
  `gcloud compute regions list` and use the Bangkok region only if it is listed;
  if there is none, Thailand needs a provider with a data centre in Thailand.
  `asia-southeast1` is Singapore and does NOT make requests from Thailand.

```bash
PROJECT=<gcp project>
REGION=me-central2            # confirm (see above)
ZONE=${REGION}-a              # confirm: gcloud compute zones list --filter="region:${REGION}"

gcloud compute instances create lifecycle-reader-sa \
  --project="$PROJECT" --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --tags=lifecycle-reader \
  --metadata=startup-script='#!/bin/bash
apt-get update && apt-get install -y ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
id reader || useradd --system --home /opt/lifecycle-reader reader
mkdir -p /opt/lifecycle-reader'

gcloud compute firewall-rules create lifecycle-reader-https \
  --project="$PROJECT" --allow=tcp:443 --target-tags=lifecycle-reader

gcloud compute scp --recurse --project="$PROJECT" --zone="$ZONE" readers/* lifecycle-reader-sa:/tmp/reader/
gcloud compute ssh lifecycle-reader-sa --project="$PROJECT" --zone="$ZONE" --command='
  sudo cp -r /tmp/reader/. /opt/lifecycle-reader/ && sudo chown -R reader /opt/lifecycle-reader
  # write /etc/lifecycle-reader.env and the unit above, then:
  sudo systemctl daemon-reload && sudo systemctl enable --now lifecycle-reader
  curl -s http://127.0.0.1:8080/health'
```

For Thailand, the same commands with `lifecycle-reader-th`, `READER_COUNTRY=TH`
and the confirmed region.

## Confirming a market through its reader

With `CATALOG_READERS` and `CATALOG_READER_SECRET` set in the environment:

```bash
node scripts/market-probe.js --url https://www.lenskart.com --region IN
```

The probe asks each market's reader and says, per market, whether it was
reached through it (`read through the reader <host> (a server in IN)`).

## Not done here

Nothing has been deployed and no cloud resource has been created. The
operator deploys each reader, sets the env vars above on the readers and on
the main project, and runs the probe.
