from __future__ import annotations

import argparse
import csv
import math
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def generate(path: Path, rows: int, start: datetime | None = None) -> None:
    start = start or datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["timestamp", "active_power_kw"])
        writer.writeheader()
        for index in range(rows):
            hour = (start + timedelta(minutes=index)).hour
            power = max(0.15, 0.45 + 0.12 * math.sin(index / 7) + (0.35 if 18 <= hour <= 22 else 0))
            writer.writerow(
                {
                    "timestamp": (start + timedelta(minutes=index)).isoformat(),
                    "active_power_kw": round(power, 4),
                }
            )


def send_live(path: Path, base_url: str, count: int) -> None:
    readings = list(csv.DictReader(path.open(encoding="utf-8")))
    if count > len(readings):
        raise ValueError("Requested stream count exceeds generated readings.")
    for reading in readings[-count:]:
        body = ("{\"readings\":[" + __import__("json").dumps(reading) + "]}").encode()
        request = Request(
            f"{base_url.rstrip('/')}/data/validate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=5) as response:
            print(response.status, response.read().decode())
        time.sleep(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate clearly labelled synthetic demo readings.")
    parser.add_argument("--output", type=Path, default=Path("data/processed/synthetic_demo.csv"))
    parser.add_argument("--rows", type=int, default=120)
    parser.add_argument("--send", action="store_true", help="Send generated records one at a time to /data/validate.")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    if args.rows < 2 or args.rows > 10000:
        parser.error("--rows must be between 2 and 10000")
    generate(args.output, args.rows)
    print(f"Generated SYNTHETIC demonstration data at {args.output}; not real household measurements.")
    if args.send:
        try:
            send_live(args.output, args.url, min(args.rows, 10))
        except (HTTPError, URLError, OSError, ValueError) as exc:
            parser.error(f"Could not stream demo data: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
