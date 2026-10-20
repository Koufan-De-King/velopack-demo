#!/usr/bin/env bash
# Self-signed ECDSA certificate for localhost. Valid 13 days so Chrome also
# accepts it for WebTransport via serverCertificateHashes (limit: 14 days).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout certs/localhost.key -out certs/localhost.crt -days 13 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
openssl x509 -in certs/localhost.crt -outform der | openssl dgst -sha256 -binary \
  | base64 > certs/localhost.sha256.b64
echo "certs/localhost.crt (sha256 $(cat certs/localhost.sha256.b64))"
# SPKI hash: lets test browsers trust this key without an error
# (--ignore-certificate-errors-spki-list), so HTTP caching behaves normally.
openssl x509 -in certs/localhost.crt -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | base64 > certs/localhost.spki.b64
