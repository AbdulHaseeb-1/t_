from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from src.prism.directional_accuracy import DirectionalWindow
from src.prism.directional_paper_trading import (
    DirectionalPaperTradingConfig,
    run_directional_paper_trading_validation,
    write_directional_paper_trading_outputs,
)
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "reports"


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    data = _filter_data_window(
        data,
        start_date=args.start_date,
        end_date=args.end_date,
        last_years=args.last_years,
    )
    if args.full_history:
        windows = (
            DirectionalWindow(
                "full_history",
                start_index=args.full_start_index,
                step=args.full_step,
                max_windows=args.full_max_windows,
            ),
        )
    else:
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
    config = DirectionalPaperTradingConfig(
        transaction_cost_bps=args.transaction_cost_bps,
        min_selector_accuracy=args.min_selector_accuracy,
        min_abs_prediction=args.min_abs_prediction,
        min_probability_edge=args.min_probability_edge,
        max_exposure_fraction=args.max_exposure_fraction,
        max_drawdown=args.max_drawdown,
        position_fraction=args.position_fraction,
    )
    report = run_directional_paper_trading_validation(
        data,
        evaluation_windows=windows,
        selector_lookback=args.selector_lookback,
        min_selection_windows=args.min_selection_windows,
        default_variant_id=args.default_variant_id,
        paper_config=config,
    )
    paths = write_directional_paper_trading_outputs(report, output_dir=args.output_dir)
    print(f"PRISM direction paper-trading validation complete: {data_path}")
    print(json.dumps({key: str(value) for key, value in paths.items()}, indent=2))
    print("Paper trading summary:")
    columns = [
        "evaluation_id",
        "strategy_id",
        "n_windows",
        "directional_accuracy",
        "strategy_cumulative_return",
        "gross_strategy_cumulative_return",
        "strategy_trade_count",
        "strategy_win_rate",
        "strategy_max_drawdown",
        "strategy_exposure",
        "strategy_total_cost",
        "strategy_sharpe_like",
    ]
    print(report.summary[columns].to_string(index=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run strict paper trading for PRISM direction sidecar.",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument(
        "--full-history",
        action="store_true",
        help="Run one walk-forward window from the earliest usable row through the end.",
    )
    parser.add_argument(
        "--start-date",
        default=None,
        help="Inclusive datetime/date filter before evaluation, e.g. 2024-04-28.",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="Inclusive datetime/date filter before evaluation, e.g. 2026-04-27.",
    )
    parser.add_argument(
        "--last-years",
        type=float,
        default=None,
        help="Keep only the latest N years ending at the dataset's last timestamp.",
    )
    parser.add_argument("--full-start-index", type=int, default=30)
    parser.add_argument("--full-step", type=int, default=100)
    parser.add_argument("--full-max-windows", type=int, default=None)
    parser.add_argument("--broad-start-index", type=int, default=5000)
    parser.add_argument("--broad-step", type=int, default=1000)
    parser.add_argument("--max-broad-windows", type=int, default=None)
    parser.add_argument("--dense-start-index", type=int, default=5000)
    parser.add_argument("--dense-step", type=int, default=100)
    parser.add_argument("--dense-max-windows", type=int, default=240)
    parser.add_argument("--selector-lookback", type=int, default=8)
    parser.add_argument("--min-selection-windows", type=int, default=8)
    parser.add_argument("--default-variant-id", default="long_recency_32")
    parser.add_argument("--transaction-cost-bps", type=float, default=0.2)
    parser.add_argument("--min-selector-accuracy", type=float, default=0.60)
    parser.add_argument("--min-abs-prediction", type=float, default=5e-5)
    parser.add_argument("--min-probability-edge", type=float, default=0.0)
    parser.add_argument("--max-exposure-fraction", type=float, default=0.50)
    parser.add_argument("--max-drawdown", type=float, default=0.03)
    parser.add_argument("--position-fraction", type=float, default=1.0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Report output directory.",
    )
    return parser.parse_args()


def _filter_data_window(
    data,
    *,
    start_date: str | None,
    end_date: str | None,
    last_years: float | None,
):
    if last_years is not None and last_years <= 0.0:
        raise ValueError("--last-years must be positive")
    if last_years is not None and start_date is not None:
        raise ValueError("--last-years and --start-date cannot be combined")

    filtered = data.copy()
    timestamps = pd.to_datetime(filtered["datetime"])
    if last_years is not None:
        end_ts = timestamps.max()
        if float(last_years).is_integer():
            start_ts = end_ts - pd.DateOffset(years=int(last_years))
        else:
            start_ts = end_ts - pd.DateOffset(days=int(round(365.25 * last_years)))
    elif start_date is not None:
        start_ts = pd.Timestamp(start_date)
    else:
        start_ts = None

    if end_date is not None:
        end_ts = pd.Timestamp(end_date)
        if len(str(end_date)) <= 10:
            end_ts = end_ts + pd.Timedelta(days=1) - pd.Timedelta(nanoseconds=1)
    else:
        end_ts = None

    if start_ts is not None:
        filtered = filtered.loc[timestamps >= start_ts].copy()
        timestamps = pd.to_datetime(filtered["datetime"])
    if end_ts is not None:
        filtered = filtered.loc[timestamps <= end_ts].copy()
    if filtered.empty:
        raise ValueError("date filters leave no data to evaluate")
    return filtered.reset_index(drop=True)


if __name__ == "__main__":
    main()
