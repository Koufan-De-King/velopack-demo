# Velopack + Flutter on Ubuntu

This repository is a proof-of-concept showing how a Flutter Linux desktop app can discover and install upgrades with Velopack.

```text
Flutter bundle (host SDK) -> Docker/vpk package -> local HTTP feed -> Flutter app update
```

The deliverable is a Linux `.AppImage`. The demo publishes version `1.1.0`, starts version `1.0.0`, detects the newer release in the background, downloads it after the user chooses **Restart to install**, applies it, and relaunches the AppImage.

## What runs where

- Ubuntu host: the already-installed Flutter SDK builds the Linux bundle.
- Docker container: ImageMagick, `vpk`, and the Velopack package step.
- Docker container: a local Python HTTP server exposes `Releases/` on port `8080`.
- App: runs as a packaged AppImage; do not use `flutter run` to validate Velopack updates.

The Dev Container at `.devcontainer/devcontainer.json` contains packaging tools only. It does not clone or install Flutter.

## Prerequisites

- Ubuntu with Flutter installed and able to build Linux desktop apps.
- Docker Desktop or Docker Engine with Compose.
- A working display session for opening the AppImage.

```bash
flutter doctor
docker compose version
```

## Fresh 1.0.0 -> 1.1.0 demo

Run these commands from the repository root. Close any existing demo AppImage first.

### 1. Stop the feed and remove old demo state

Stopping and removing the feed before deleting `Releases/` avoids a stale Docker bind mount.

```bash
cd /home/victoire-ws/Desktop/velopack-demo

docker compose stop feed
docker compose rm -f feed

rm -rf Releases \
  build/first-release \
  build/first-release-artifacts \
  build/installed \
  build/linux \
  build/generated \
  /var/tmp/velopack/com.example.velopackdemo
```

### 2. Build and package version 1.0.0

```bash
flutter pub get

flutter build linux --release \
  --build-name 1.0.0 \
  --dart-define=APP_VERSION=1.0.0

mkdir -p build/first-release
cp -a build/linux/x64/release/bundle/. build/first-release/

```

Package the first release inside Docker:

```bash
docker compose run --rm flutter-velopack bash -lc \
"mkdir -p build/generated && \
  convert -background none assets/velopack-demo.svg -resize 256x256 build/generated/velopack-demo.png && \
  vpk pack \
  --packId com.example.velopackdemo \
  --packVersion 1.0.0 \
  --packDir build/first-release \
  --mainExe velopack_demo \
  --icon build/generated/velopack-demo.png \
  --categories Utility \
  --packTitle 'Velopack Flutter Demo' \
  --outputDir build/first-release-artifacts"
```

### 3. Build and publish version 1.1.0

```bash
./scripts/container-build.sh 1.1.0
```

This builds Flutter 1.1.0 on the host and packages it with the Dockerized Velopack CLI into `Releases/`.

### 4. Install the 1.0.0 starting AppImage

```bash
mkdir -p build/installed
cp build/first-release-artifacts/com.example.velopackdemo.AppImage \
  build/installed/com.example.velopackdemo.AppImage
chmod +x build/installed/com.example.velopackdemo.AppImage
```

### 5. Start the local release feed

```bash
docker compose up -d feed
curl http://127.0.0.1:8080/releases.linux.json
```

The JSON should contain version `1.1.0`.

### 6. Run the demo

```bash
./build/installed/com.example.velopackdemo.AppImage
```

Expected flow:

1. The app starts at version `1.0.0`.
2. It checks the feed automatically after startup.
3. The UI reports that `1.1.0` is available.
4. Click **Restart to install v1.1.0**.
5. Velopack downloads and applies the package.
6. The AppImage relaunches and displays version `1.1.0`.

The app also performs a background check every 15 minutes. The manual check button is included for demonstration and troubleshooting.

## Useful commands

Open the packaging-tool container shell:

```bash
./scripts/container-shell.sh
```

Check the feed:

```bash
docker compose ps
curl -I http://127.0.0.1:8080/releases.linux.json
```

Stop the feed after the demo:

```bash
docker compose down
```

Inspect Velopack’s Linux updater log:

```bash
tail -f /tmp/velopack_com.example.velopackdemo.log
```

## Implementation notes

- `lib/main.dart` initializes Velopack before `runApp`.
- The app checks for updates after startup and periodically in the background.
- The user action downloads the update and calls `updateAndExit`.
- On Linux AppImage, the demo starts a detached relaunch helper before applying the update because the `velopack_flutter` Linux restart callback is not reliable in this proof-of-concept environment.
- `scripts/container-build.sh` builds with host Flutter and packages with containerized `vpk`.
- `scripts/package-release.sh` packages an existing Flutter Linux bundle.

## Validation status and limitations

Validated locally:

- `flutter analyze` passes.
- `flutter test` passes.
- Dockerized Velopack packaging creates a Linux AppImage.
- A local Docker feed serves the release metadata and package.
- The update package applies successfully on Ubuntu.

This is a proof of concept, not a production release pipeline. Before shipping, add artifact signing, HTTPS hosting, release retention, rollback testing, telemetry, and validation on every supported Ubuntu version. The community `velopack_flutter` package also describes Linux support as less tested, so the AppImage restart behavior should be revalidated when upgrading that dependency.
