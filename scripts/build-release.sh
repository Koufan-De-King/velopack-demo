#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible name for the containerized Ubuntu build.
exec "$(dirname "$0")/container-build.sh" "$@"
