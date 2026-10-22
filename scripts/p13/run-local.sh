#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "Starting local SMTP sink..."
docker compose up -d mailpit

echo "Preparing local DKIM key..."
scripts/p13/generate_dkim_key.sh

echo "Validating local DNS record proposals..."
python3 scripts/p13/validate_dns_records.py

echo "Resetting the local test inbox..."
curl -fsS -X DELETE http://127.0.0.1:8025/api/v1/messages >/dev/null

echo "Sending AUTHZ-IDP-style test email..."
message_file="$(mktemp /tmp/p13-message.XXXXXX.eml)"
trap 'rm -f "$message_file"' EXIT
python3 scripts/p13/send_test_email.py \
  --to "test-recipient@example.test" \
  --save "$message_file"

echo "Verifying the local DKIM signature..."
python3 scripts/p13/verify_dkim.py "$message_file" \
  --public-key spikes/p13/private/authz2026.public.pem

message_id="$(python3 -c 'from email import policy; from email.parser import BytesParser; import sys; print(BytesParser(policy=policy.default).parsebytes(open(sys.argv[1], "rb").read())["Message-ID"].strip("<>"))' "$message_file")"
echo "Asserting the captured message..."
python3 scripts/p13/assert_mailpit.py --message-id "$message_id"

echo "Exporting the DNS handoff record..."
scripts/p13/export_dns_records.sh

echo
echo "Local P13 test complete. Open http://localhost:8025 to inspect the message."
