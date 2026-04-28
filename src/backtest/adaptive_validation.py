from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.prism.adaptive_validation import (
    run_adaptive_model_validation,
    write_adaptive_validation_outputs,
)
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "reports"


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    report = run_adaptive_model_validation(
        data,
        start_index=args.start_index,
        step=args.step,
        max_windows=args.max_windows,
        min_selection_windows=args.min_selection_windows,
        default_model_id=args.default_model_id,
    )
    paths = write_adaptive_validation_outputs(report, output_dir=args.output_dir)
    print(f"PRISM adaptive model validation complete: {data_path}")
    print(json.dumps({key: str(value) for key, value in paths.items()}, indent=2))
    print("Model summary:")
    print(report.model_summary.to_string(index=False))
    print("Adaptive selected records tail:")
    print(
        report.adaptive_records[
            [
                "row_index",
                "datetime",
                "selected_model_id",
                "model_selection_reason",
                "model_selection_training_mae",
                "prediction",
                "actual_return",
                "direction_hit",
            ]
        ]
        .tail(10)
        .to_string(index=False)
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run PRISM adaptive model validation with prior-only selection.",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument("--start-index", type=int, default=5000)
    parser.add_argument("--step", type=int, default=1000)
    parser.add_argument("--max-windows", type=int, default=None)
    parser.add_argument("--min-selection-windows", type=int, default=8)
    parser.add_argument("--default-model-id", default="rolling_12000")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Report output directory.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
