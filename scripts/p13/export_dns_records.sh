#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
key="$repo_root/spikes/p13/private/authz2026.private.pem"
output="$repo_root/spikes/p13/dns-records.generated.txt"

if [[ ! -f "$key" ]]; then
  "$repo_root/scripts/p13/generate_dkim_key.sh" >/dev/null
fi

public_key="$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | openssl base64 -A)"
cat > "$output" <<EOF
# Handoff only. The platform/domain owner must publish these records.
# Replace 203.0.113.10 with the real relay IP before publication.
another.camer.digital. TXT "v=spf1 ip4:203.0.113.10 -all"
authz2026._domainkey.another.camer.digital. TXT "v=DKIM1; k=rsa; p=${public_key}"
_dmarc.another.camer.digital. TXT "v=DMARC1; p=none; rua=mailto:dmarc-reports@another.camer.digital; adkim=s; aspf=s"
EOF

echo "generated=$output"
