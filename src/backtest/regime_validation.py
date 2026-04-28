from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.prism.regime_validation import (
    DEFAULT_THRESHOLD_GRID,
    run_regime_validation,
    write_regime_validation_outputs,
)
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "reports"


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    report = run_regime_validation(
        data,
        start_index=args.start_index,
        step=args.step,
        max_windows=args.max_windows,
        threshold_grid=tuple(args.threshold_grid),
        min_threshold_training_windows=args.min_threshold_training_windows,
        min_tuning_trades=args.min_tuning_trades,
        min_training_return=args.min_training_return,
    )
    paths = write_regime_validation_outputs(report, output_dir=args.output_dir)
    print(f"PRISM BTC regime validation complete: {data_path}")
    print(json.dumps({key: str(value) for key, value in paths.items()}, indent=2))
    print("Regime summary:")
    print(report.regime_summary.to_string(index=False))
    print("Threshold history tail:")
    print(report.threshold_history.tail(10).to_string(index=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run PRISM regime validation with prior-only threshold tuning.",
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
    parser.add_argument(
        "--threshold-grid",
        type=float,
        nargs="+",
        default=list(DEFAULT_THRESHOLD_GRID),
        help="Probability-edge thresholds to tune using prior windows only.",
    )
    parser.add_argument("--min-threshold-training-windows", type=int, default=12)
    parser.add_argument("--min-tuning-trades", type=int, default=2)
    parser.add_argument(
        "--min-training-return",
        type=float,
        default=0.0,
        help="Minimum prior net strategy return required before selecting a threshold.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Report output directory.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
