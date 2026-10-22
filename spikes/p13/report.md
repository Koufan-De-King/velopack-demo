# P13 Local Spike Report: Authentication Email Delivery

## Scope

This report covers local SMTP submission, message content, and local SPF/DKIM/DMARC proposal validation.

The spike owner does not have access to `another.camer.digital` and is not responsible for public DNS publication, production SMTP relay setup, or Gmail/Yahoo inbox-placement testing.

## Environment

- Repository commit: local working tree
- Operating system: Linux
- Python version: 3.15
- Docker version: Docker Compose available
- Mailpit version: `axllent/mailpit:v1.26`
- DKIM selector: `authz2026`

## Test command

```bash
./scripts/p13/run-local.sh
```

## Local results

| Check | Result | Evidence |
|---|---|---|
| SMTP sink started | Pass | Mailpit healthy on ports 1025/8025 |
| Test email accepted | Pass | Mailpit API reported captured messages |
| Sender header correct | Pass | `no-reply@another.camer.digital` |
| One-time code present | Pass | Six-digit code generated and redacted in logs |
| Expiry text present | Pass | 10-minute expiry text included |
| AUTHZ-IDP test header present | Pass | `X-Authz-Idp-Test: true` |
| DKIM signature generated locally | Pass | RSA-SHA256 signature added to message |
| DKIM signature verified locally | Pass | Body hash and RSA signature verified with OpenSSL |
| Exact Mailpit message assertions | Pass | Sender, recipient, subject, code, expiry, headers, and attachments |
| SPF proposal structurally valid | Pass | Local validator |
| DKIM proposal structurally valid | Pass with placeholder | Public key is not published |
| DMARC proposal structurally valid | Pass | Local validator |

## External validation status

| Item | Status | Owner |
|---|---|---|
| Public DNS access | Not available for this spike | Domain/platform owner |
| SMTP relay deployment | Not available for this spike | Platform owner |
| Gmail placement | Not tested | Domain/platform owner |
| Yahoo placement | Not tested | Domain/platform owner |
| Local provider placement | Not tested | Domain/platform owner |

## Negative tests

| Test | Result |
|---|---|
| Invalid six-digit code | Pass: rejected before SMTP submission |
| Unavailable SMTP relay | Pass: connection failure surfaced |
| Duplicate code request | Not implemented: requires AUTHZ-IDP state store |
| Expired code | Not implemented: requires AUTHZ-IDP verification endpoint |
| Wrong code | Not implemented: requires AUTHZ-IDP verification endpoint |
| Replayed code | Not implemented: requires AUTHZ-IDP verification endpoint |

## Handoff package

- `spikes/p13/dns-records.example.txt`
- `spikes/p13/dns-records.env`
- `scripts/p13/validate_dns_records.py`
- This report

## Recommendation

Local validation is complete. Hand off DNS publication, production relay deployment, and external inbox-placement testing to the platform/domain owner.
