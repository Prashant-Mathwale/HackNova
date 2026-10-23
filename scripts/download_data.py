from __future__ import annotations

import argparse
import tempfile
import urllib.request
import zipfile
from pathlib import Path


SOURCES = {
    "household": (
        "https://archive.ics.uci.edu/static/public/235/individual+household+electric+power+consumption.zip",
        "household_power_consumption.txt",
    ),
    "appliances": (
        "https://archive.ics.uci.edu/static/public/374/appliances+energy+prediction.zip",
        "energydata_complete.csv",
    ),
}


def download(name: str, destination: Path) -> None:
    url, expected_name = SOURCES[name]
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "dataset.zip"
            urllib.request.urlretrieve(url, archive)
            with zipfile.ZipFile(archive) as zipped:
                member = next((item for item in zipped.namelist() if item.endswith(expected_name)), None)
                if member is None:
                    raise ValueError(f"Official archive did not contain {expected_name}")
                target = destination / expected_name
                with zipped.open(member) as source, target.open("wb") as output:
                    output.write(source.read())
        print(f"Downloaded {name} dataset to {target}")
    except Exception as exc:
        print(f"Download failed: {exc}")
        print(f"Download the {name} dataset manually from https://archive.ics.uci.edu/ and place {expected_name} in {destination}")
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Download UCI datasets explicitly to a local folder.")
    parser.add_argument("dataset", choices=["household", "appliances", "all"])
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    args = parser.parse_args()
    choices = SOURCES if args.dataset == "all" else {args.dataset: SOURCES[args.dataset]}
    for name in choices:
        download(name, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
