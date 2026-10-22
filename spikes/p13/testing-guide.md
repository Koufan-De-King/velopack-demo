# P13 Local Testing Guide

## Purpose

This guide explains how to test the local P13 authentication-email delivery implementation.

The local test covers:

- SMTP delivery through Mailpit
- Six-digit authentication-code generation
- Email content and headers
- Real RSA-SHA256 DKIM signing
- DKIM body-hash verification
- DKIM RSA signature verification
- SPF, DKIM, and DMARC proposal validation
- Message assertions
- Basic negative-path behavior

It does not test public Gmail/Yahoo inbox placement. That requires a public SMTP relay and public DNS records for the sending domain.

## Requirements

Install or verify:

- Docker and Docker Compose
- Python 3
- OpenSSL

From the repository root:

```bash
cd /home/victoire-ws/Desktop/velopack-demo
```

## 1. Start Mailpit

Start the local SMTP capture service:

```bash
docker compose up -d mailpit
```

Check that it is healthy:

```bash
docker compose ps
```

Expected ports:

```text
SMTP:  localhost:1025
Web:   http://localhost:8025
```

Open the Mailpit inbox in a browser:

```text
http://localhost:8025
```

## 2. Run the complete automated test

Run:

```bash
./scripts/p13/run-local.sh
```

The script performs these steps automatically:

1. Starts or reuses Mailpit.
2. Generates a local RSA DKIM key if one does not exist.
3. Validates the SPF, DKIM, and DMARC proposals.
4. Clears the local Mailpit inbox.
5. Generates a six-digit authentication code.
6. Builds an authentication email.
7. Adds a real DKIM signature.
8. Sends the email through SMTP.
9. Verifies the DKIM body hash.
10. Verifies the DKIM RSA signature.
11. Queries Mailpit for the delivered message.
12. Verifies that exactly one expected message exists.
13. Verifies the sender and recipient.
14. Verifies the subject.
15. Verifies the six-digit code.
16. Verifies the ten-minute expiry text.
17. Verifies the `X-Authz-Idp-Test` header.
18. Verifies that the message has no attachments.
19. Generates the DNS handoff file.

Expected successful output:

```text
PASS: DKIM body hash and RSA signature verified
PASS: exactly one expected Mailpit message was delivered
PASS: sender, recipient, subject, code, expiry, headers, and attachments verified
```

The code is deliberately redacted from the command output.

## 3. Inspect the captured message manually

Open:

```text
http://localhost:8025
```

Confirm that the latest message has:

```text
From: no-reply@another.camer.digital
Subject: Your Another sign-in code
```

The body should contain:

```text
Your sign-in code is 123456. It expires in 10 minutes.
```

The six-digit value will be different on every run.

Confirm that:

- The message is readable.
- The sender is correct.
- The recipient is correct.
- The expiry text is present.
- There are no attachments.
- The message has a `DKIM-Signature` header.
- The `X-Authz-Idp-Test` header is present.

## 4. Run the negative tests

Run:

```bash
python3 scripts/p13/test_failures.py
```

Expected output:

```text
PASS: invalid code
PASS: unavailable SMTP relay
```

These tests verify that:

- A code that is not exactly six digits is rejected.
- An unavailable SMTP relay is reported as a failure.
- The sender script compiles before the failure tests execute.

## 5. Validate the DNS proposals

Run:

```bash
python3 scripts/p13/validate_dns_records.py
```

Expected output:

```text
PASS: local SPF/DKIM/DMARC records are structurally valid
```

This checks syntax only. It does not prove that public DNS contains these records.

## 6. Inspect the generated DKIM handoff

Run:

```bash
cat spikes/p13/dns-records.generated.txt
```

The file contains:

- SPF record proposal
- Real generated DKIM public key
- DMARC record proposal

The platform/domain owner must replace the placeholder SPF address with the real public SMTP relay IP before publishing the record.

The private DKIM key is stored under:

```text
spikes/p13/private/
```

That directory is Git-ignored and must never be committed or shared.

## 7. Run the Python syntax checks

Run:

```bash
python3 -m py_compile scripts/p13/*.py
```

There should be no output and the command should exit successfully.

## 8. Run repository whitespace checks

Run:

```bash
git diff --check
```

There should be no output.

## 9. Check the Mailpit API

To confirm that one message was captured:

```bash
curl -fsS http://127.0.0.1:8025/api/v1/messages \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("captured_messages=" + str(d.get("total")))'
```

After a clean `run-local.sh` execution, the expected result is:

```text
captured_messages=1
```

## 10. Test the sender manually

Generate and send one message manually:

```bash
python3 scripts/p13/send_test_email.py \
  --to test-recipient@example.test \
  --save /tmp/p13-message.eml
```

Verify the saved message's DKIM signature:

```bash
python3 scripts/p13/verify_dkim.py \
  /tmp/p13-message.eml \
  --public-key spikes/p13/private/authz2026.public.pem
```

Expected output:

```text
PASS: DKIM body hash and RSA signature verified
```

## 11. Test custom values

Use a fixed code for repeatable tests:

```bash
python3 scripts/p13/send_test_email.py \
  --to test-recipient@example.test \
  --code 123456
```

Use another local SMTP host or port:

```bash
SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
python3 scripts/p13/send_test_email.py
```

Use a different sender address for header testing:

```bash
python3 scripts/p13/send_test_email.py \
  --from no-reply@another.camer.digital
```

## 12. Stop the local services

When testing is complete:

```bash
docker compose down
```

## Expected final result

The local P13 test is successful when:

- Mailpit is healthy.
- One message is captured.
- The message content is correct.
- The DKIM signature verifies.
- The automated assertions pass.
- The negative tests pass.
- The DNS proposal validator passes.
- No private key or real code is committed.

## Scope boundary

This local test does not prove:

- Public DNS visibility
- Production SMTP relay behavior
- Gmail inbox placement
- Yahoo inbox placement
- Domain reputation
- Public SPF/DKIM/DMARC results

Those require a platform-owned SMTP relay and public DNS access for `another.camer.digital`.
