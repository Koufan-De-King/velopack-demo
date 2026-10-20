#!/usr/bin/env bash
# ECDSA P-256 cert valid 13 days: WebTransport's serverCertificateHashes
# accepts only certificates valid for less than 14 days.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout certs/server.key -out certs/server.crt -days 13 -subj "/CN=wt-server" \
  -addext "subjectAltName=DNS:wt-server,DNS:localhost,IP:127.0.0.1" 2>/dev/null
openssl x509 -in certs/server.crt -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | base64 > certs/server.spki.b64
echo "certs/server.crt, SPKI $(cat certs/server.spki.b64)"
