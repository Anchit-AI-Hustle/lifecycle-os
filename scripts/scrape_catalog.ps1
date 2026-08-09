# Scrape Knickgasm Shopify storefronts and upsert into knickgasm_products
$ErrorActionPreference = "Stop"
if (-not $env:SUPABASE_PAT) { Write-Error "Set the SUPABASE_PAT env var first (Supabase Personal Access Token)."; exit 1 }
$SupabasePat = $env:SUPABASE_PAT
$ApiUrl = "https://api.supabase.com/v1/projects/ozlmmiyyjmmfdvvrtgdp/database/query"

$Markets = @(
  @{ market = "US";     base = "https://www.knickgasm.com";    currency = "USD" },
  @{ market = "UK";     base = "https://www.knickgasm.com";  currency = "GBP" },
  @{ market = "IN";     base = "https://www.knickgasm.in";     currency = "INR" },
  @{ market = "Global"; base = "https://www.knickgasm.com"; currency = "USD" }
)

function Run-Sql([string]$sql) {
  $body = @{ query = $sql } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri $ApiUrl `
    -Headers @{ Authorization = "Bearer $SupabasePat"; "Content-Type" = "application/json" } `
    -Body $body
}

function Sql-Esc([string]$s) {
  if ($null -eq $s) { return "NULL" }
  return "'" + ($s -replace "'", "''") + "'"
}

function To-JsonbLit($obj) {
  if ($null -eq $obj) { return "NULL" }
  $j = $obj | ConvertTo-Json -Compress -Depth 6
  return "'" + ($j -replace "'", "''") + "'::jsonb"
}

function Categorize([string]$title, [string]$tagsCsv, [string]$productType) {
  $t = "$title $tagsCsv $productType".ToLower()
  if ($t -match 'lace|lace tag|care kit|cleaner|accessor') { return 'Accessories & Care' }
  if ($t -match 'denim|jacket|apparel') { return 'Hand-painted Apparel' }
  if ($t -match 'jordan') { return 'Air Jordan Customs' }
  if ($t -match 'adidas|samba|gazelle') { return 'Adidas Customs' }
  if ($t -match 'converse|chuck|all star') { return 'Converse Customs' }
  if ($t -match 'court vision') { return 'Court Vision Customs' }
  if ($t -match 'anime|demon slayer|jujutsu|naruto|one piece|dragon ball') { return 'Anime Customs' }
  if ($t -match 'football|cricket|f1|formula|basketball|sport|club') { return 'Football & Sport Customs' }
  if ($t -match 'gaming|playstation|xbox|valorant|minecraft') { return 'Gaming Customs' }
  if ($t -match 'car|supercar|jdm|motorsport') { return 'Car & Motorsport Customs' }
  if ($t -match 'wedding|bride|groom|couple') { return 'Wedding Customs' }
  if ($t -match 'pet|dog|cat|portrait') { return 'Pet & Portrait Customs' }
  if ($t -match 'bling|crystal|rhinestone|drip') { return 'Bling & Crystal Customs' }
  if ($t -match 'embroider|patch|stitch') { return 'Embroidery Customs' }
  if ($t -match 'coffee|latte|espresso') { return 'Coffee-ART Customs' }
  if ($t -match 'taylor swift|celebrity|concert|tour') { return 'Celebrity & Music Customs' }
  if ($t -match 'air force|airforce|af1') { return 'Air Force 1 Customs' }
  return 'Specialty Customs'
}

$totalUpserts = 0

foreach ($m in $Markets) {
  Write-Host ""
  Write-Host "=== $($m.market) - $($m.base) ===" -ForegroundColor Cyan
  $marketKey = $m.market
  $base = $m.base
  $cur = $m.currency
  $page = 1
  $rowsForMarket = 0
  $batchValues = @()

  while ($true) {
    $url = $base + "/products.json?limit=250" + [char]38 + "page=" + $page
    try {
      $resp = Invoke-RestMethod -Method Get -Uri $url -Headers @{ "User-Agent" = "KnickgasmMailerStudio/1.0" } -TimeoutSec 30
    } catch {
      Write-Host "  page $page fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
      break
    }
    if (-not $resp.products -or $resp.products.Count -eq 0) { break }
    Write-Host "  page $page -> $($resp.products.Count) products" -ForegroundColor DarkGray

    foreach ($p in $resp.products) {
      $handle = $p.handle
      if (-not $handle) { continue }
      $name = $p.title
      if (-not $name) { continue }

      $variant = $p.variants[0]
      $price = if ($variant) { [decimal]$variant.price } else { $null }
      $compareAt = if ($variant -and $variant.compare_at_price) { [decimal]$variant.compare_at_price } else { $null }
      $sku = if ($variant) { $variant.sku } else { $null }

      $img = if ($p.images -and $p.images.Count -gt 0) { $p.images[0].src } else { "" }
      $imgAlt = if ($p.images -and $p.images.Count -gt 0 -and $p.images[0].alt) { $p.images[0].alt } else { $name }

      $tagsArr = @()
      if ($p.tags) {
        if ($p.tags -is [string]) { $tagsArr = $p.tags -split ',\s*' } else { $tagsArr = $p.tags }
      }
      $tagsCsv = ($tagsArr -join ',').ToLower()

      $cat = Categorize $name $tagsCsv $p.product_type

      $isFeatured = $tagsCsv -match 'featured|hero'
      $isBestseller = $tagsCsv -match 'bestseller|best.seller|top.seller'

      $body2 = ''
      if ($p.body_html) {
        $body2 = ($p.body_html -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim()
        if ($body2.Length -gt 800) { $body2 = $body2.Substring(0, 800) + '...' }
      }

      $pdpUrl = $base + "/products/" + $handle

      $cols = @(
        ([long]$p.id),
        (Sql-Esc $marketKey),
        (Sql-Esc $handle),
        (Sql-Esc $name),
        (Sql-Esc $cat),
        (Sql-Esc $p.vendor),
        (Sql-Esc $p.product_type),
        (Sql-Esc $body2),
        (Sql-Esc $img),
        (Sql-Esc $imgAlt),
        $(if ($null -eq $price) { "NULL" } else { $price.ToString([System.Globalization.CultureInfo]::InvariantCulture) }),
        $(if ($null -eq $compareAt) { "NULL" } else { $compareAt.ToString([System.Globalization.CultureInfo]::InvariantCulture) }),
        (Sql-Esc $cur),
        (Sql-Esc $sku),
        (To-JsonbLit $tagsArr),
        (Sql-Esc $pdpUrl),
        $(if ($isFeatured) { "true" } else { "false" }),
        $(if ($isBestseller) { "true" } else { "false" })
      )

      $batchValues += "(" + ($cols -join ", ") + ")"
      $rowsForMarket++
    }

    if ($resp.products.Count -lt 250) { break }
    $page++
    if ($page -gt 20) { Write-Host "  capped at 20 pages" -ForegroundColor Yellow; break }
    Start-Sleep -Milliseconds 250
  }

  if ($batchValues.Count -gt 0) {
    $chunkSize = 50
    for ($i = 0; $i -lt $batchValues.Count; $i += $chunkSize) {
      $end = [Math]::Min($i + $chunkSize - 1, $batchValues.Count - 1)
      $chunk = $batchValues[$i..$end]
      $sql = "INSERT INTO public.knickgasm_products (shopify_id, market, handle, name, category, vendor, product_type, description, image_url, image_alt, price, compare_at, currency, sku, tags, pdp_url, is_featured, is_bestseller) VALUES " + ($chunk -join ", ") + " ON CONFLICT (market, handle) DO UPDATE SET shopify_id = EXCLUDED.shopify_id, name = EXCLUDED.name, category = EXCLUDED.category, vendor = EXCLUDED.vendor, product_type = EXCLUDED.product_type, description = EXCLUDED.description, image_url = EXCLUDED.image_url, image_alt = EXCLUDED.image_alt, price = EXCLUDED.price, compare_at = EXCLUDED.compare_at, currency = EXCLUDED.currency, sku = EXCLUDED.sku, tags = EXCLUDED.tags, pdp_url = EXCLUDED.pdp_url, is_featured = EXCLUDED.is_featured OR knickgasm_products.is_featured, is_bestseller = EXCLUDED.is_bestseller OR knickgasm_products.is_bestseller, refreshed_at = now();"
      try {
        Run-Sql $sql | Out-Null
        Write-Host "  upserted rows $($i+1) to $($end+1)" -ForegroundColor DarkGreen
      } catch {
        Write-Host "  chunk failed: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
    $totalUpserts += $rowsForMarket
    Write-Host "  $marketKey total: $rowsForMarket products upserted" -ForegroundColor Green
  } else {
    Write-Host "  $marketKey no products found" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Catalog scrape complete - $totalUpserts total upserts" -ForegroundColor Green

$verify = @{ query = "SELECT market, COUNT(*) AS n, COUNT(*) FILTER (WHERE is_featured) AS featured, COUNT(*) FILTER (WHERE is_bestseller) AS bestsellers FROM public.knickgasm_products GROUP BY market ORDER BY market;" } | ConvertTo-Json -Compress
$r = Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers @{ Authorization = "Bearer $SupabasePat"; "Content-Type" = "application/json" } -Body $verify
$r | ConvertTo-Json -Depth 4
