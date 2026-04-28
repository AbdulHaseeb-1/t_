from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.evaluation import (
    apply_trade_strategy,
    calculate_backtest_metrics,
    walk_forward_backtest,
)


DEFAULT_THRESHOLD_GRID = (0.0, 0.0005, 0.001, 0.0015, 0.002, 0.003, 0.005)


@dataclass(frozen=True)
class RegimeValidationReport:
    forecast_records: pd.DataFrame
    tuned_records: pd.DataFrame
    regime_summary: pd.DataFrame
    threshold_history: pd.DataFrame


def run_regime_validation(
    raw_frame: pd.DataFrame,
    config: PRISMConfig | None = None,
    *,
    start_index: int = 5000,
    step: int = 1000,
    max_windows: int | None = None,
    threshold_grid: Iterable[float] = DEFAULT_THRESHOLD_GRID,
    min_threshold_training_windows: int = 12,
    min_tuning_trades: int = 2,
    min_training_return: float = 0.0,
) -> RegimeValidationReport:
    cfg = config or PRISMConfig()
    forecast_config = replace(
        cfg,
        require_interval_confirmation=False,
        min_signal_probability_edge=0.0,
    )
    forecast_report = walk_forward_backtest(
        raw_frame,
        forecast_config,
        start_index=start_index,
        step=step,
        max_windows=max_windows,
    )
    tuned_records, threshold_history = walk_forward_threshold_tuning(
        forecast_report.records,
        cfg,
        threshold_grid=tuple(threshold_grid),
        min_training_windows=min_threshold_training_windows,
        min_tuning_trades=min_tuning_trades,
        min_training_return=min_training_return,
    )
    regime_summary = build_regime_summary(tuned_records)
    return RegimeValidationReport(
        forecast_records=forecast_report.records,
        tuned_records=tuned_records,
        regime_summary=regime_summary,
        threshold_history=threshold_history,
    )


def walk_forward_threshold_tuning(
    records: pd.DataFrame,
    config: PRISMConfig,
    *,
    threshold_grid: tuple[float, ...] = DEFAULT_THRESHOLD_GRID,
    min_training_windows: int = 12,
    min_tuning_trades: int = 2,
    min_training_return: float = 0.0,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if min_training_windows <= 0:
        raise ValueError("min_training_windows must be positive")
    if min_tuning_trades < 0:
        raise ValueError("min_tuning_trades must be non-negative")
    if not threshold_grid:
        raise ValueError("threshold_grid must not be empty")
    if any(value < 0.0 or value >= 0.5 for value in threshold_grid):
        raise ValueError("threshold_grid values must be in [0, 0.5)")

    ordered = records.sort_values("row_index").reset_index(drop=True)
    tuned_rows: list[pd.DataFrame] = []
    history_rows: list[dict[str, float | int | str]] = []

    for row_number in range(len(ordered)):
        current = ordered.iloc[[row_number]].copy()
        if row_number < min_training_windows:
            selected_threshold = float("nan")
            selected_reason = "insufficient_prior_windows"
            selected_training_return = 0.0
            selected_training_trades = 0.0
            decision_config = replace(
                config,
                min_signal_probability_edge=0.5 - 1e-12,
                require_interval_confirmation=False,
            )
        else:
            prior = ordered.iloc[:row_number].copy()
            selected = select_probability_threshold(
                prior,
                config,
                threshold_grid=threshold_grid,
                min_tuning_trades=min_tuning_trades,
                min_training_return=min_training_return,
            )
            selected_threshold = selected["threshold"]
            selected_reason = selected["reason"]
            selected_training_return = selected["strategy_cumulative_return"]
            selected_training_trades = selected["strategy_trade_count"]
            decision_config = replace(
                config,
                min_signal_probability_edge=selected_threshold,
                require_interval_confirmation=False,
            )

        tuned_current = apply_trade_strategy(current, decision_config)
        tuned_current["selected_probability_edge"] = selected_threshold
        tuned_current["threshold_training_windows"] = row_number
        tuned_current["threshold_training_return"] = selected_training_return
        tuned_current["threshold_training_trade_count"] = selected_training_trades
        tuned_current["threshold_selection_reason"] = selected_reason
        tuned_rows.append(tuned_current)
        history_rows.append(
            {
                "row_index": int(current["row_index"].iloc[0]),
                "datetime": str(current["datetime"].iloc[0]),
                "selected_probability_edge": selected_threshold,
                "threshold_training_windows": row_number,
                "threshold_training_return": selected_training_return,
                "threshold_training_trade_count": selected_training_trades,
                "threshold_selection_reason": selected_reason,
            }
        )

    tuned = pd.concat(tuned_rows, ignore_index=True) if tuned_rows else ordered
    return tuned, pd.DataFrame(history_rows)


def select_probability_threshold(
    prior_records: pd.DataFrame,
    config: PRISMConfig,
    *,
    threshold_grid: tuple[float, ...] = DEFAULT_THRESHOLD_GRID,
    min_tuning_trades: int = 2,
    min_training_return: float = 0.0,
) -> dict[str, float | str]:
    candidates: list[dict[str, float | str]] = []
    for threshold in threshold_grid:
        candidate_config = replace(
            config,
            min_signal_probability_edge=float(threshold),
            require_interval_confirmation=False,
        )
        simulated = apply_trade_strategy(prior_records, candidate_config)
        metrics = calculate_backtest_metrics(simulated)
        if metrics["strategy_trade_count"] < float(min_tuning_trades):
            reason = "below_min_tuning_trades"
        elif metrics["strategy_cumulative_return"] <= min_training_return:
            reason = "below_min_training_return"
        else:
            reason = "eligible"
        candidates.append(
            {
                "threshold": float(threshold),
                "strategy_cumulative_return": metrics["strategy_cumulative_return"],
                "strategy_max_drawdown": metrics["strategy_max_drawdown"],
                "strategy_trade_count": metrics["strategy_trade_count"],
                "strategy_win_rate": metrics["strategy_win_rate"],
                "reason": reason,
            }
        )

    eligible = [row for row in candidates if row["reason"] == "eligible"]
    if not eligible:
        return {
            "threshold": 0.5 - 1e-12,
            "strategy_cumulative_return": 0.0,
            "strategy_max_drawdown": 0.0,
            "strategy_trade_count": 0.0,
            "strategy_win_rate": 0.0,
            "reason": "no_positive_prior_threshold",
        }

    eligible.sort(
        key=lambda row: (
            -float(row["strategy_cumulative_return"]),
            float(row["strategy_max_drawdown"]),
            float(row["strategy_trade_count"]),
            float(row["threshold"]),
        )
    )
    return eligible[0]


def build_regime_summary(records: pd.DataFrame) -> pd.DataFrame:
    if records.empty:
        raise ValueError("records must not be empty")

    ordered = records.sort_values("row_index").reset_index(drop=True)
    regime_rows = [_summary_row("all_windows", "all", ordered)]
    for name, subset in _chronological_regimes(ordered):
        regime_rows.append(_summary_row(name, "chronological", subset))
    for name, subset in _volatility_regimes(ordered):
        regime_rows.append(_summary_row(name, "realized_volatility", subset))
    for name, subset in _directional_regimes(ordered):
        regime_rows.append(_summary_row(name, "realized_direction", subset))
    return pd.DataFrame(regime_rows)


def write_regime_validation_outputs(
    report: RegimeValidationReport,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    forecast_path = output_dir / "regime_forecast_records.csv"
    tuned_path = output_dir / "regime_tuned_records.csv"
    summary_path = output_dir / "regime_validation.csv"
    threshold_path = output_dir / "regime_threshold_history.csv"
    plot_path = output_dir / "regime_validation.png"

    report.forecast_records.to_csv(forecast_path, index=False)
    report.tuned_records.to_csv(tuned_path, index=False)
    report.regime_summary.to_csv(summary_path, index=False)
    report.threshold_history.to_csv(threshold_path, index=False)
    write_regime_validation_plot(report.regime_summary, plot_path)
    return {
        "forecast_records": forecast_path,
        "tuned_records": tuned_path,
        "summary": summary_path,
        "threshold_history": threshold_path,
        "plot": plot_path,
    }


def write_regime_validation_plot(summary: pd.DataFrame, plot_path: Path) -> Path:
    if summary.empty:
        raise ValueError("summary must not be empty")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plot_path.parent.mkdir(parents=True, exist_ok=True)
    labels = summary["regime"].astype(str).str.replace("_", " ", regex=False)
    x_values = np.arange(len(summary))

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        1,
        figsize=(14.0, 11.0),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")

    axes[0].bar(x_values, summary["mae_improvement_vs_best_baseline"], color="#4b7f8c")
    axes[0].axhline(0.0, color="#394247", linewidth=1.0)
    axes[0].set_title("MAE Edge By Regime", loc="left", fontweight="bold")
    axes[0].set_ylabel("MAE edge")

    axes[1].bar(x_values, summary["strategy_cumulative_return"], color="#6f8f52")
    axes[1].axhline(0.0, color="#394247", linewidth=1.0)
    axes[1].set_title("Net Strategy Return By Regime", loc="left", fontweight="bold")
    axes[1].set_ylabel("Return")

    axes[2].plot(
        x_values,
        summary["directional_accuracy"],
        marker="o",
        linewidth=2.2,
        label="PRISM direction",
    )
    axes[2].plot(
        x_values,
        summary["zero_directional_accuracy"],
        marker="s",
        linestyle="--",
        linewidth=1.8,
        label="Zero baseline direction",
    )
    axes[2].set_ylim(0.0, 1.05)
    axes[2].set_title("Directional Accuracy By Regime", loc="left", fontweight="bold")
    axes[2].set_ylabel("Accuracy")
    axes[2].legend(loc="lower right", frameon=True)

    for axis in axes:
        axis.set_facecolor("#fffaf1")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.35)

    axes[-1].set_xticks(x_values)
    axes[-1].set_xticklabels(labels, rotation=18, ha="right")
    axes[-1].set_xlabel("Regime")
    figure.suptitle(
        "PRISM BTC Regime Validation",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    plt.close(figure)
    return plot_path


def _summary_row(regime: str, regime_type: str, subset: pd.DataFrame) -> dict[str, float | str]:
    metrics = calculate_backtest_metrics(subset)
    return {
        "regime": regime,
        "regime_type": regime_type,
        "start_datetime": str(subset["datetime"].iloc[0]),
        "end_datetime": str(subset["datetime"].iloc[-1]),
        **metrics,
    }


def _chronological_regimes(records: pd.DataFrame) -> list[tuple[str, pd.DataFrame]]:
    index_splits = np.array_split(np.arange(len(records)), 3)
    names = ("early_period", "middle_period", "recent_period")
    return [
        (name, records.iloc[indexes].reset_index(drop=True))
        for name, indexes in zip(names, index_splits, strict=True)
        if len(indexes) > 0
    ]


def _volatility_regimes(records: pd.DataFrame) -> list[tuple[str, pd.DataFrame]]:
    absolute_returns = records["actual_return"].abs()
    threshold = float(absolute_returns.median())
    low = records.loc[absolute_returns <= threshold].reset_index(drop=True)
    high = records.loc[absolute_returns > threshold].reset_index(drop=True)
    result: list[tuple[str, pd.DataFrame]] = []
    if not low.empty:
        result.append(("low_realized_volatility", low))
    if not high.empty:
        result.append(("high_realized_volatility", high))
    return result


def _directional_regimes(records: pd.DataFrame) -> list[tuple[str, pd.DataFrame]]:
    up = records.loc[records["actual_return"] >= 0.0].reset_index(drop=True)
    down = records.loc[records["actual_return"] < 0.0].reset_index(drop=True)
    result: list[tuple[str, pd.DataFrame]] = []
    if not up.empty:
        result.append(("positive_forward_return", up))
    if not down.empty:
        result.append(("negative_forward_return", down))
    return result
