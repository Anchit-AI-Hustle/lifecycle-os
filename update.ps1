# =============================================================
#  KNICKGASM Mailer Studio -- Update Pipeline (Git -> Vercel)
#  Runs:  git add -> git commit -> git push (Vercel auto-deploys)
#  Usage:  .\update.ps1 "describe what changed"
#       or .\update.ps1                        (auto-generated message)
# =============================================================

param(
  [string]$Message = ""
)

# -- Config -----------------------------------------------------
$LiveUrl  = "https://knickgasm.vercel.app"
$RepoUrl  = "https://github.com/anchittandon-knickgasm/marketing_mailers__html_architect"
$VercelDashboard = "https://vercel.com/dashboard"

# -- Paths ------------------------------------------------------
$Src = $PSScriptRoot
Set-Location $Src

# Auto-generate commit message if none provided
if (-not $Message) {
  try {
    $build = (Select-String -Path "$Src\knickgasm_mailer_architect_v23.html" -Pattern "__KNICKGASM_BUILD__='([^']+)'" | Select-Object -First 1).Matches[0].Groups[1].Value
  } catch { $build = "auto" }
  $Message = "Update -- build $build at $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " KNICKGASM Mailer Studio -- Git -> Vercel Pipeline" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Message: $Message" -ForegroundColor Gray
Write-Host ""

# -- 1. Git add + commit ----------------------------------------
Write-Host "[1/3] Committing changes to local git..." -ForegroundColor Cyan
git add -A 2>$null
$pending = (git status --porcelain | Measure-Object).Count
if ($pending -eq 0) {
  Write-Host "      No changes to commit (working tree clean)" -ForegroundColor DarkGray
  $hasNewCommit = $false
} else {
  $commitOut = git commit -m $Message 2>&1
  Write-Host "      $($commitOut[-1])" -ForegroundColor DarkGray
  $hasNewCommit = $true
}

# -- 2. Git push to GitHub (triggers Vercel auto-deploy) --------
$remote = git remote 2>$null
if (-not $remote) {
  Write-Host ""
  Write-Host "X No GitHub remote configured. Add one with:" -ForegroundColor Red
  Write-Host "    git remote add origin $RepoUrl" -ForegroundColor Yellow
  exit 1
}

Write-Host "[2/3] Pushing to GitHub: $RepoUrl" -ForegroundColor Cyan
$pushOut = git push origin HEAD 2>&1
$pushSuccess = $LASTEXITCODE -eq 0
if ($pushSuccess) {
  $latestSha = (git rev-parse --short HEAD).Trim()
  Write-Host "      Pushed commit $latestSha" -ForegroundColor DarkGreen
} else {
  Write-Host "      Push failed:" -ForegroundColor Red
  Write-Host "        $($pushOut -join '; ')" -ForegroundColor DarkYellow
  exit 1
}

# -- 3. Notify about Vercel auto-deploy -------------------------
Write-Host "[3/3] Vercel will auto-deploy from this push..." -ForegroundColor Cyan
Write-Host "      Vercel detects the push and builds in ~30 seconds." -ForegroundColor DarkGray
Write-Host "      No further action needed -- the deploy happens server-side." -ForegroundColor DarkGray

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " DONE" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Commit:    $latestSha"                                -ForegroundColor White
Write-Host "  GitHub:    $RepoUrl/commit/$latestSha"                -ForegroundColor White
Write-Host "  Vercel:    $VercelDashboard"                          -ForegroundColor White
Write-Host "  Live URL:  $LiveUrl"                                  -ForegroundColor White
Write-Host ""
Write-Host "  Live site refreshes automatically once Vercel finishes building (~30s)." -ForegroundColor Gray
Write-Host ""
