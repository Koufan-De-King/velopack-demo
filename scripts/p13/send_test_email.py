#!/usr/bin/env python3
"""Send a DKIM-signed AUTHZ-IDP-style code email to an SMTP relay."""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import secrets
import smtplib
import subprocess
import tempfile
from email.message import EmailMessage
from email.policy import SMTP
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_KEY = ROOT / "spikes" / "p13" / "private" / "authz2026.private.pem"


def relaxed_header(name: str, value: str) -> bytes:
    value = " ".join(value.replace("\r", "").replace("\n", " ").split())
    return f"{name.lower()}:{value}".encode()


def simple_body(body: bytes) -> bytes:
    body = body.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    lines = body.split(b"\n")
    while lines and lines[-1] == b"":
        lines.pop()
    return b"\r\n".join(lines) + b"\r\n"


def sign(private_key: Path, data: bytes) -> bytes:
    with tempfile.NamedTemporaryFile() as source:
        source.write(data)
        source.flush()
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", str(private_key), source.name],
            check=True,
            capture_output=True,
        )
    return result.stdout


def dkim_signature(message: EmailMessage, private_key: Path, domain: str, selector: str) -> str:
    wire = message.as_bytes(policy=SMTP)
    header_bytes, body = wire.split(b"\r\n\r\n", 1)
    body_hash = base64.b64encode(hashlib.sha256(simple_body(body)).digest()).decode()
    signed_headers = ["from", "to", "subject", "date", "message-id"]
    dkim_value = (
        "v=1; a=rsa-sha256; c=relaxed/simple; "
        f"d={domain}; s={selector}; h={':'.join(signed_headers)}; "
        f"bh={body_hash}; b="
    )
    headers = {}
    for raw in header_bytes.split(b"\r\n"):
        name, value = raw.split(b":", 1)
        headers[name.decode().lower()] = value.decode().strip()
    signing_input = b"\r\n".join(
        relaxed_header(name, headers[name]) for name in signed_headers
    )
    signing_input += b"\r\n" + relaxed_header("DKIM-Signature", dkim_value)
    signature = base64.b64encode(sign(private_key, signing_input)).decode()
    return dkim_value + signature


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", default="test-recipient@example.test")
    parser.add_argument("--from", dest="sender", default=os.getenv("MAIL_FROM", "no-reply@another.camer.digital"))
    parser.add_argument("--host", default=os.getenv("SMTP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("SMTP_PORT", "1025")))
    parser.add_argument("--subject", default="Your Another sign-in code")
    parser.add_argument("--domain", default=os.getenv("MAIL_DOMAIN", "another.camer.digital"))
    parser.add_argument("--selector", default=os.getenv("DKIM_SELECTOR", "authz2026"))
    parser.add_argument("--private-key", type=Path, default=Path(os.getenv("DKIM_PRIVATE_KEY", DEFAULT_KEY)))
    parser.add_argument("--code", help="Use a supplied code instead of generating one")
    parser.add_argument("--save", type=Path, help="Save the signed RFC 5322 message locally")
    args = parser.parse_args()

    if not args.private_key.exists():
        raise SystemExit(
            f"DKIM private key not found: {args.private_key}\n"
            "Run scripts/p13/generate_dkim_key.sh first."
        )

    code = args.code or f"{secrets.randbelow(1_000_000):06d}"
    if not code.isdigit() or len(code) != 6:
        raise SystemExit("code must be exactly six digits")
    issued_at = datetime.now(timezone.utc).isoformat()
    message = EmailMessage()
    message["From"] = args.sender
    message["To"] = args.to
    message["Subject"] = args.subject
    message["X-Authz-Idp-Test"] = "true"
    message["X-Authz-Code-Issued-At"] = issued_at
    message["Date"] = datetime.now().astimezone().strftime("%a, %d %b %Y %H:%M:%S %z")
    message["Message-ID"] = f"<{secrets.token_hex(12)}@{args.domain}>"
    message.set_content(
        f"Your sign-in code is {code}. It expires in 10 minutes.\n\n"
        "If you did not request this code, you can ignore this email.\n"
    )
    signature = dkim_signature(
        message, args.private_key, args.domain, args.selector
    )
    wire = b"DKIM-Signature: " + signature.encode() + b"\r\n" + message.as_bytes(policy=SMTP)
    if args.save:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_bytes(wire)

    with smtplib.SMTP(args.host, args.port, timeout=10) as smtp:
        smtp.ehlo()
        smtp.sendmail(args.sender, [args.to], wire)

    print(f"sent_to={args.to}")
    print(f"sender={args.sender}")
    print(f"issued_at={issued_at}")
    print(f"dkim_selector={args.selector}")
    print("dkim_signed=true")
    print("code=<redacted>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
