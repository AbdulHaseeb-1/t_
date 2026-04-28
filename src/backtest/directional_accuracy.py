from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.prism.directional_accuracy import (
    DirectionalWindow,
    run_directional_accuracy_validation,
    write_directional_accuracy_outputs,
)
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "reports"


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    windows = (
        DirectionalWindow(
            "broad_regime",
            start_index=args.broad_start_index,
            step=args.broad_step,
            max_windows=args.max_broad_windows,
        ),
        DirectionalWindow(
            "dense_recent",
            start_index=args.dense_start_index,
            step=args.dense_step,
            max_windows=args.dense_max_windows,
        ),
    )
    report = run_directional_accuracy_validation(
        data,
        evaluation_windows=windows,
        selector_lookback=args.selector_lookback,
        min_selection_windows=args.min_selection_windows,
        default_variant_id=args.default_variant_id,
    )
    paths = write_directional_accuracy_outputs(report, output_dir=args.output_dir)
    print(f"PRISM direction-first validation complete: {data_path}")
    print(json.dumps({key: str(value) for key, value in paths.items()}, indent=2))
    print("Directional summary:")
    columns = [
        "evaluation_id",
        "variant_id",
        "summary_type",
        "selection_count",
        "n_windows",
        "directional_accuracy",
        "mae_improvement_vs_best_baseline",
        "rmse_improvement_vs_best_baseline",
    ]
    print(report.summary[columns].to_string(index=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run PRISM direction-first BTC accuracy validation.",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument("--broad-start-index", type=int, default=5000)
    parser.add_argument("--broad-step", type=int, default=1000)
    parser.add_argument("--max-broad-windows", type=int, default=None)
    parser.add_argument("--dense-start-index", type=int, default=5000)
    parser.add_argument("--dense-step", type=int, default=100)
    parser.add_argument("--dense-max-windows", type=int, default=240)
    parser.add_argument("--selector-lookback", type=int, default=8)
    parser.add_argument("--min-selection-windows", type=int, default=8)
    parser.add_argument("--default-variant-id", default="long_recency_32")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Report output directory.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
