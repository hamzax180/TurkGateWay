$deleted = git show --name-status 496809d --pretty=format:"" | Where-Object { $_ -match '^D\s+' } | ForEach-Object { ($_ -replace '^D\s+','').Trim() }
foreach ($f in $deleted) {
    $ext = [IO.Path]::GetExtension($f).ToLower()
    if ($ext -in '.py','.json','.md','.txt') {
        $dir = Split-Path $f
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        try {
            git show d713339:$f | Out-File -Encoding utf8 $f
            Write-Host "RESTORED $f"
        } catch {
            Write-Host "MISSING in d713339: $f"
        }
    } else {
        Write-Host "SKIP (non-source): $f"
    }
}
Write-Host "\n-- git status for backend (first 200 lines) --"
git status --short backend | Select-Object -First 200 | ForEach-Object { Write-Host $_ }
