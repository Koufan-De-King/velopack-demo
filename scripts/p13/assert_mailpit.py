#!/usr/bin/env python3
"""Assert the exact message delivered by the local SMTP test."""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from email import policy
from email.parser import BytesParser


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def get_text(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read()


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8025")
    parser.add_argument("--message-id", required=True)
    parser.add_argument("--sender", default="no-reply@another.camer.digital")
    parser.add_argument("--recipient", default="test-recipient@example.test")
    args = parser.parse_args()

    listing = get_json(f"{args.base_url}/api/v1/messages")
    matches = [m for m in listing.get("messages", []) if m.get("MessageID") == args.message_id]
    if len(matches) != 1:
        fail(f"expected exactly one matching message, found {len(matches)}")

    summary = matches[0]
    if summary["From"]["Address"] != args.sender:
        fail("sender does not match")
    recipients = {entry["Address"] for entry in summary.get("To", [])}
    if recipients != {args.recipient}:
        fail(f"recipients do not match: {sorted(recipients)}")
    if summary["Subject"] != "Your Another sign-in code":
        fail("subject does not match")
    if summary.get("Attachments", 0) != 0:
        fail("unexpected attachment found")

    raw = get_text(f"{args.base_url}/api/v1/message/{summary['ID']}/raw")
    message = BytesParser(policy=policy.default).parsebytes(raw)
    body = message.get_body(preferencelist=("plain",)).get_content()
    if not re.search(r"\b\d{6}\b", body):
        fail("six-digit code is missing")
    if "expires in 10 minutes" not in body:
        fail("expiry text is missing")
    if message["X-Authz-Idp-Test"] != "true":
        fail("AUTHZ-IDP test header is missing")
    if not message["DKIM-Signature"]:
        fail("DKIM-Signature header is missing")

    unexpected = [part.get_content_type() for part in message.walk() if part.get_content_disposition() == "attachment"]
    if unexpected:
        fail(f"unexpected MIME attachments: {unexpected}")

    print("PASS: exactly one expected Mailpit message was delivered")
    print("PASS: sender, recipient, subject, code, expiry, headers, and attachments verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
