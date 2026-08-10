# Scrape Knickgasm Shopify storefront collections.json -> upsert into lifecycle_collections
$ErrorActionPreference = "Stop"
$SupabasePat = $env:SUPABASE_PAT
if (-not $SupabasePat) {
  Write-Host "ERROR: set SUPABASE_PAT env var first (a fresh Supabase Management API token)" -ForegroundColor Red
  exit 1
}
$ApiUrl = "https://api.supabase.com/v1/projects/ozlmmiyyjmmfdvvrtgdp/database/query"

$Markets = @(
  @{ market = "US";     base = "https://www.knickgasm.com" },
  @{ market = "UK";     base = "https://www.knickgasm.com" },
  @{ market = "IN";     base = "https://www.knickgasm.in" },
  @{ market = "Global"; base = "https://www.knickgasm.com" }
)

function SqlEsc([string]$s){ if($null -eq $s){return "NULL"}; return "'"+($s -replace "'","''")+"'" }

$total = 0
foreach ($m in $Markets) {
  Write-Host ""
  Write-Host "=== $($m.market) - $($m.base) ===" -ForegroundColor Cyan
  $page = 1
  $rows = @()
  while ($true) {
    $url = $m.base + "/collections.json?limit=250" + [char]38 + "page=" + $page
    try {
      $resp = Invoke-RestMethod -Method Get -Uri $url -Headers @{ "User-Agent" = "KnickgasmMailerStudio/1.0" } -TimeoutSec 30
    } catch { break }
    if (-not $resp.collections -or $resp.collections.Count -eq 0) { break }
    Write-Host "  page $page -> $($resp.collections.Count) collections" -ForegroundColor DarkGray
    foreach ($c in $resp.collections) {
      if (-not $c.handle) { continue }
      $url2 = $m.base + "/collections/" + $c.handle
      $desc = ''
      if ($c.body_html) { $desc = ($c.body_html -replace '<[^>]+>',' ' -replace '\s+',' ').Trim(); if ($desc.Length -gt 400) { $desc = $desc.Substring(0,400) + '...' } }
      $vals = "(" + (SqlEsc $m.market) + ", " + (SqlEsc $c.handle) + ", " + (SqlEsc $c.title) + ", " + (SqlEsc $desc) + ", " + (SqlEsc $url2) + ")"
      $rows += $vals
    }
    if ($resp.collections.Count -lt 250) { break }
    $page++
    if ($page -gt 5) { break }
  }
  if ($rows.Count -gt 0) {
    $sql = "INSERT INTO public.lifecycle_collections (market, handle, title, description, url) VALUES " + ($rows -join ", ") + " ON CONFLICT (market, handle) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, url=EXCLUDED.url, refreshed_at=now();"
    $reqBody = @{ query = $sql } | ConvertTo-Json -Compress
    try {
      Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers @{ Authorization = "Bearer $SupabasePat"; "Content-Type" = "application/json" } -Body $reqBody | Out-Null
      Write-Host "  upserted $($rows.Count) collections" -ForegroundColor Green
      $total += $rows.Count
    } catch { Write-Host "  upsert failed: $($_.Exception.Message)" -ForegroundColor Red }
  }
}

Write-Host ""
Write-Host "Total collections upserted: $total" -ForegroundColor Green

$verify = @{ query = "SELECT market, COUNT(*) AS n FROM public.lifecycle_collections GROUP BY market ORDER BY market;" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers @{ Authorization = "Bearer $SupabasePat"; "Content-Type" = "application/json" } -Body $verify | ConvertTo-Json
