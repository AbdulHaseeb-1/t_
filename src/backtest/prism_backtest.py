from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.prism.evaluation import walk_forward_backtest
from src.prism.reporting import (
    DEFAULT_HISTORY_PATH,
    DEFAULT_PLOT_PATH,
    append_backtest_history,
)
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    report = walk_forward_backtest(
        data,
        start_index=args.start_index,
        step=args.step,
        max_windows=args.max_windows,
    )
    print(f"PRISM walk-forward backtest complete: {data_path}")
    print(json.dumps(report.metrics, indent=2, sort_keys=True))
    print("Recent windows:")
    print(report.records.tail(5).to_string(index=False))
    if args.record_history:
        history = append_backtest_history(
            report.metrics,
            label=args.label,
            history_path=args.history_path,
            plot_path=args.plot_path,
        )
        print(f"History rows: {len(history)}")
        print(f"History CSV: {args.history_path}")
        print(f"History plot: {args.plot_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PRISM walk-forward backtest.")
    parser.add_argument(
        "--label",
        default="cost_aware_trading_layer",
        help="Label to store in the backtest history.",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=300,
        help="First walk-forward row index.",
    )
    parser.add_argument(
        "--step",
        type=int,
        default=10,
        help="Rows to skip between evaluated windows.",
    )
    parser.add_argument(
        "--max-windows",
        type=int,
        default=50,
        help="Maximum number of walk-forward windows.",
    )
    parser.add_argument(
        "--history-path",
        type=Path,
        default=DEFAULT_HISTORY_PATH,
        help="CSV path for historical backtest metrics.",
    )
    parser.add_argument(
        "--plot-path",
        type=Path,
        default=DEFAULT_PLOT_PATH,
        help="PNG path for historical backtest plot.",
    )
    parser.add_argument(
        "--no-record-history",
        action="store_false",
        dest="record_history",
        help="Run the backtest without appending to the history CSV.",
    )
    parser.set_defaults(record_history=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()
