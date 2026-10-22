#!/usr/bin/env python3
"""Verify the local DKIM signature using the generated public key."""

from __future__ import annotations

import argparse
import base64
import hashlib
import re
import subprocess
import tempfile
from email import policy
from email.parser import BytesParser
from pathlib import Path


def relaxed_header(name: str, value: str) -> bytes:
    value = " ".join(value.replace("\r", "").replace("\n", " ").split())
    return f"{name.lower()}:{value}".encode()


def simple_body(body: bytes) -> bytes:
    body = body.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    lines = body.split(b"\n")
    while lines and lines[-1] == b"":
        lines.pop()
    return b"\r\n".join(lines) + b"\r\n"


def parse_headers(header_bytes: bytes) -> dict[str, str]:
    unfolded: list[bytes] = []
    for raw in header_bytes.split(b"\r\n"):
        if raw.startswith((b" ", b"\t")) and unfolded:
            unfolded[-1] += b" " + raw.strip()
        else:
            unfolded.append(raw)
    headers: dict[str, str] = {}
    for raw in unfolded:
        name, value = raw.split(b":", 1)
        headers[name.decode().lower()] = value.decode().strip()
    return headers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("message", type=Path)
    parser.add_argument("--public-key", type=Path, required=True)
    args = parser.parse_args()

    wire = args.message.read_bytes()
    header_bytes, body = wire.split(b"\r\n\r\n", 1)
    headers = parse_headers(header_bytes)

    dkim = headers.get("dkim-signature")
    if not dkim:
        raise SystemExit("FAIL: DKIM-Signature header is missing")
    fields = dict(re.findall(r"(?:^|;\s*)([a-z]+)=([^;]*)", dkim))
    for field in ("h", "bh", "b"):
        if field not in fields:
            raise SystemExit(f"FAIL: DKIM field {field} is missing")
    actual_body_hash = base64.b64encode(hashlib.sha256(simple_body(body)).digest()).decode()
    if actual_body_hash != fields["bh"]:
        raise SystemExit("FAIL: DKIM body hash does not match")

    signature_without_b = re.sub(r"b=[^;]*", "b=", dkim)
    signing_input = b"\r\n".join(
        relaxed_header(name, headers[name]) for name in fields["h"].split(":")
    )
    signing_input += b"\r\n" + relaxed_header("DKIM-Signature", signature_without_b)

    with tempfile.NamedTemporaryFile() as data, tempfile.NamedTemporaryFile() as signature:
        data.write(signing_input)
        data.flush()
        signature.write(base64.b64decode(fields["b"]))
        signature.flush()
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", str(args.public_key), "-signature", signature.name, data.name],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        raise SystemExit(f"FAIL: DKIM signature verification failed: {result.stderr.strip()}")
    print("PASS: DKIM body hash and RSA signature verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
