# Spike P13: Authentication email delivery

## Status

Local implementation ready. This spike does not require access to `another.camer.digital`, DNS credentials, or a production SMTP relay.

## Question

Can AUTHZ-IDP deliver one-time authentication codes reliably through a dedicated SMTP relay, with valid SPF, DKIM, and DMARC configuration, to Gmail, Yahoo, and local providers?

## Timebox and owners

- Timebox: 1 working day
- Owners: Architect and Senior 1

## What is implemented locally

This repository now provides:

- A Mailpit SMTP sink at `localhost:1025`.
- A Mailpit web inbox at `http://localhost:8025`.
- A deterministic AUTHZ-IDP-style one-time-code sender.
- Local structural validation for SPF, DKIM, and DMARC proposals.
- A DNS record example and a report location.

The current project does not contain AUTHZ-IDP or control the `another.camer.digital` DNS zone. The local harness validates the email path and message shape. Public DNS publication, relay setup, and Gmail/Yahoo inbox placement are handoff items for the domain/platform owner and are outside this spike's scope.

## Run the local test

From the repository root:

```bash
docker compose up -d mailpit
python3 scripts/p13/validate_dns_records.py
python3 scripts/p13/send_test_email.py --to test-recipient@example.test
```

Open `http://localhost:8025` and verify:

- The message arrived.
- The sender is `no-reply@another.camer.digital`.
- The six-digit code is present.
- The code-expiry text is present.
- The `X-Authz-Idp-Test` header is present.
- No unexpected recipient or attachment is present.

The sender prints only redacted test metadata. Never commit the generated code or a real recipient address.

## DNS handoff package

The proposed records are in `spikes/p13/dns-records.example.txt` and the local values are in `spikes/p13/dns-records.env`.

No action is required from the spike owner. If the platform owner later chooses to deploy the relay, they can use the files as a handoff reference and should:

1. Replace the placeholder DKIM public key.
2. Replace the documentation IP address with the real SMTP relay IP.
3. Confirm the report mailbox exists.
4. Have the domain owner publish the records.
5. Query the public records with `dig` from outside the local network.

The local validator checks syntax only. It does not prove that public DNS contains the records, and the spike owner is not responsible for publishing or verifying those records.

## External test - handoff only

If the platform/domain owner later provides a public relay and test mailboxes, they may send the same message to:

- Gmail
- Yahoo
- One local business or ISP mailbox
- One self-hosted or organizational mailbox, if available

Record the following for each provider:

| Provider | SPF | DKIM | DMARC | Inbox | Spam | Rejected | Delivery time |
|---|---|---|---|---|---|---|---|
| Gmail | | | | | | | |
| Yahoo | | | | | | | |
| Local provider | | | | | | | |
| Organizational | | | | | | | |

Preserve message headers and bounce messages with personal information redacted.

## Acceptance criteria for this local spike

- AUTHZ-IDP or the local sender can submit a one-time-code email to SMTP.
- Mailpit captures the message successfully.
- The message content and headers are correct.
- SPF, DKIM, and DMARC proposals pass local structural validation.
- The final report distinguishes local validation from public inbox-placement evidence.
- No secret, private key, real code, or personal mailbox is committed.
- The DNS and external-provider portion is clearly marked as a platform-owner handoff, not unfinished work for the spike owner.

## Final recommendation

Choose one:

- Local validation is complete; hand off DNS, relay deployment, and external inbox placement to the platform/domain owner.
- Changes are required to the message or authentication configuration before handoff.
