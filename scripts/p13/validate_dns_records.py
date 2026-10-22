#!/usr/bin/env python3
"""Validate the local SPF, DKIM, and DMARC proposal without external DNS."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RECORDS = ROOT / "spikes" / "p13" / "dns-records.env"


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in RECORDS.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> int:
    values = load_env()
    domain = values.get("MAIL_DOMAIN", "")
    selector = values.get("DKIM_SELECTOR", "")
    spf = values.get("SPF_RECORD", "")
    dkim = values.get("DKIM_RECORD", "")
    dmarc = values.get("DMARC_RECORD", "")

    require(bool(re.fullmatch(r"[A-Za-z0-9.-]+", domain)), "invalid MAIL_DOMAIN")
    require(bool(re.fullmatch(r"[A-Za-z0-9_-]+", selector)), "invalid DKIM_SELECTOR")
    require(spf.startswith("v=spf1 "), "SPF must start with v=spf1")
    require("-all" in spf or "~all" in spf or "?all" in spf, "SPF is missing an all mechanism")
    require(dkim.startswith("v=DKIM1;"), "DKIM must start with v=DKIM1")
    require("k=rsa" in dkim, "DKIM must declare an RSA key")
    dkim_is_placeholder = "p=REPLACE_WITH_PUBLIC_KEY" in dkim
    require(
        dkim_is_placeholder or bool(re.search(r"(?:^|;\s*)p=[A-Za-z0-9+/=]+", dkim)),
        "DKIM public key is missing",
    )
    require(dmarc.startswith("v=DMARC1;"), "DMARC must start with v=DMARC1")
    require(bool(re.search(r"(?:^|;\s*)p=(none|quarantine|reject)", dmarc)), "DMARC policy is missing")
    require("rua=mailto:" in dmarc, "DMARC aggregate report address is missing")

    print("PASS: local SPF/DKIM/DMARC records are structurally valid")
    print(f"domain={domain}")
    print(f"dkim_selector={selector}")
    if dkim_is_placeholder:
        print("warning=replace the DKIM public-key placeholder before public deployment")
    print("note=This does not prove public DNS visibility or inbox placement")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
