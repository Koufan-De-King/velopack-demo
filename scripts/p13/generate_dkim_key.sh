#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
key_dir="$repo_root/spikes/p13/private"
private_key="$key_dir/authz2026.private.pem"
public_key="$key_dir/authz2026.public.pem"

mkdir -p "$key_dir"
chmod 700 "$key_dir"

if [[ ! -f "$private_key" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key" >/dev/null 2>&1
  chmod 600 "$private_key"
fi

openssl pkey -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1
chmod 644 "$public_key"

echo "private_key=$private_key"
echo "public_key=$public_key"
echo "private_key_is_gitignored=true"
