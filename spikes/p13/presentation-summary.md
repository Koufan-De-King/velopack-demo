# P13 presentation summary

## Authentication email delivery: local feasibility result

### Question

Can the AUTHZ-IDP-style authentication email path produce a correctly formed, DKIM-signed one-time-code email and deliver it reliably through an SMTP relay?

### Result

**Local delivery path passed.** The repository now has a working local SMTP test environment with Mailpit, real RSA-SHA256 DKIM signing, DKIM verification, message assertions, and negative-path checks.

### Evidence

Running:

```bash
./scripts/p13/run-local.sh
```

Passed checks:

- Mailpit SMTP service started successfully.
- Authentication email was accepted by the SMTP relay.
- Exactly one expected message was captured.
- Sender was `no-reply@another.camer.digital`.
- Recipient was the configured test mailbox.
- Subject was correct.
- A six-digit code was present.
- The ten-minute expiry text was present.
- `X-Authz-Idp-Test` was present.
- No attachment was present.
- A real DKIM signature was generated.
- The DKIM body hash was verified.
- The DKIM RSA signature was verified.
- SPF, DKIM, and DMARC proposals passed structural validation.
- Invalid-code input was rejected.
- An unavailable SMTP relay was handled as a failure.

### Artifacts

- `scripts/p13/send_test_email.py`
- `scripts/p13/verify_dkim.py`
- `scripts/p13/assert_mailpit.py`
- `scripts/p13/test_failures.py`
- `scripts/p13/run-local.sh`
- `spikes/p13/dns-records.generated.txt`
- `spikes/p13/report.md`

### What this proves

The local email path is technically viable and produces a message with the expected authentication-email shape and a valid DKIM signature when verified against the locally generated public key.

### What this does not prove

This local result does not prove public DNS visibility, Gmail/Yahoo inbox placement, domain reputation, or production relay behavior. Those require a platform-owned SMTP relay and public DNS for the sending domain.

### Follow-up dependency

The platform/domain owner must later:

1. Replace the placeholder SPF relay IP.
2. Publish SPF, DKIM, and DMARC records.
3. Configure the production SMTP relay.
4. Send the same test message to Gmail, Yahoo, and local providers.
5. Record Inbox, Spam, rejection, authentication, and delivery-time results.

### Recommended status

**P13 local feasibility complete. External inbox-placement validation is a follow-up dependency owned by the platform/domain team.**
