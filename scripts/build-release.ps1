param(
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = "Stop"
flutter pub get
flutter build windows --release --build-name $Version --dart-define=APP_VERSION=$Version

$runner = "build/windows/x64/runner/Release"
if (!(Test-Path $runner)) { throw "Flutter output not found at $runner" }

vpk pack `
  --packId com.example.velopackdemo `
  --packVersion $Version `
  --packDir $runner `
  --mainExe velopack_demo.exe `
  --packTitle "Velopack Flutter Demo" `
  --outputDir Releases

Write-Host "Created Releases for $Version."
