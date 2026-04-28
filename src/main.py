from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.prism import PRISMPipeline
from src.prism.directional_accuracy import predict_latest_directional_signal
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    output = PRISMPipeline().run(data)
    response = output.to_dict()
    if not args.no_directional_sidecar:
        response["directional_signal"] = predict_latest_directional_signal(data).to_dict()
    print(f"PRISM inference complete: {data_path}")
    print(json.dumps(response, indent=2, sort_keys=True))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PRISM inference.")
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument(
        "--no-directional-sidecar",
        action="store_true",
        help="Print only the original PRISM output contract without sidecar research signal.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
