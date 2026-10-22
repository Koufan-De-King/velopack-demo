#!/usr/bin/env python3
"""Local negative tests for the sender boundary."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SENDER = ROOT / "scripts" / "p13" / "send_test_email.py"
KEY = ROOT / "spikes" / "p13" / "private" / "authz2026.private.pem"


def expect_failure(name: str, *args: str) -> None:
    result = subprocess.run(
        [sys.executable, str(SENDER), "--private-key", str(KEY), *args],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        raise SystemExit(f"FAIL: {name} unexpectedly succeeded")
    print(f"PASS: {name}")


def main() -> int:
    if not KEY.exists():
        subprocess.run([str(ROOT / "scripts/p13/generate_dkim_key.sh")], check=True)
    compile_check = subprocess.run(
        [sys.executable, "-m", "py_compile", str(SENDER)],
        capture_output=True,
        text=True,
    )
    if compile_check.returncode != 0:
        raise SystemExit(f"FAIL: sender does not compile:\n{compile_check.stderr}")
    expect_failure("invalid code", "--code", "12345", "--port", "1025")
    expect_failure("unavailable SMTP relay", "--port", "19999")
    print("NOTE: duplicate, expiry, replay, and wrong-code tests belong to AUTHZ-IDP state handling, not SMTP delivery.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
