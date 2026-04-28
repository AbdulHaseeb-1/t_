from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from src.prism.directional_accuracy import (
    DirectionalAccuracyReport,
    DirectionalVariant,
    DirectionalWindow,
    run_directional_accuracy_validation,
)
from src.prism.evaluation import calculate_backtest_metrics


@dataclass(frozen=True)
class DirectionalPaperTradingConfig:
    transaction_cost_bps: float = 0.2
    min_selector_accuracy: float = 0.60
    min_abs_prediction: float = 5e-5
    min_probability_edge: float = 0.0
    max_exposure_fraction: float = 0.50
    max_drawdown: float = 0.03
    position_fraction: float = 1.0


@dataclass(frozen=True)
class DirectionalPaperTradingReport:
    candidate_records: pd.DataFrame
    selected_records: pd.DataFrame
    paper_records: pd.DataFrame
    summary: pd.DataFrame


PAPER_SUMMARY_COLUMNS = (
    "evaluation_id",
    "strategy_id",
    "n_windows",
    "start_row_index",
    "end_row_index",
    "start_datetime",
    "end_datetime",
    "first_trade_datetime",
    "last_trade_datetime",
    "strategy_trade_count",
    "strategy_exposure",
    "strategy_win_rate",
    "strategy_cumulative_return",
    "gross_strategy_cumulative_return",
    "strategy_total_cost",
    "strategy_max_drawdown",
    "strategy_sharpe_like",
    "directional_accuracy",
    "mae",
    "rmse",
    "mean_prediction",
    "mean_actual_return",
    "mean_probability",
    "transaction_cost_bps",
    "min_selector_accuracy",
    "min_abs_prediction",
    "min_probability_edge",
    "max_exposure_fraction",
    "max_drawdown_limit",
    "position_fraction",
)


def run_directional_paper_trading_validation(
    raw_frame: pd.DataFrame,
    *,
    evaluation_windows: tuple[DirectionalWindow, ...] | None = None,
    variants: tuple[DirectionalVariant, ...] | None = None,
    selector_lookback: int = 8,
    min_selection_windows: int = 8,
    default_variant_id: str = "long_recency_32",
    paper_config: DirectionalPaperTradingConfig | None = None,
) -> DirectionalPaperTradingReport:
    directional = run_directional_accuracy_validation(
        raw_frame,
        evaluation_windows=evaluation_windows,
        variants=variants,
        selector_lookback=selector_lookback,
        min_selection_windows=min_selection_windows,
        default_variant_id=default_variant_id,
    )
    cfg = paper_config or DirectionalPaperTradingConfig()
    paper_records = apply_directional_paper_strategy(directional.selected_records, cfg)
    summary = summarize_directional_paper_strategy(
        directional,
        paper_records,
        cfg,
    )
    return DirectionalPaperTradingReport(
        candidate_records=directional.candidate_records,
        selected_records=directional.selected_records,
        paper_records=paper_records,
        summary=summary,
    )


def apply_directional_paper_strategy(
    records: pd.DataFrame,
    config: DirectionalPaperTradingConfig | None = None,
) -> pd.DataFrame:
    cfg = config or DirectionalPaperTradingConfig()
    _validate_paper_config(cfg)
    if records.empty:
        raise ValueError("records must not be empty")
    required = {
        "prediction",
        "probability",
        "actual_return",
        "selector_training_directional_accuracy",
    }
    missing = sorted(required - set(records.columns))
    if missing:
        raise ValueError(f"records missing required paper-trading columns: {missing}")

    if "evaluation_id" not in records.columns:
        working = records.copy()
        working["evaluation_id"] = "default"
    else:
        working = records.copy()

    frames = [
        _apply_strategy_to_group(group, cfg)
        for _, group in working.groupby("evaluation_id", sort=False)
    ]
    return pd.concat(frames, ignore_index=True)


def summarize_directional_paper_strategy(
    directional_report: DirectionalAccuracyReport,
    paper_records: pd.DataFrame,
    config: DirectionalPaperTradingConfig,
) -> pd.DataFrame:
    rows: list[dict[str, float | str]] = []
    for evaluation_id, subset in paper_records.groupby("evaluation_id", sort=False):
        metrics = calculate_backtest_metrics(subset.reset_index(drop=True))
        rows.append(
            {
                "evaluation_id": str(evaluation_id),
                "strategy_id": "strict_directional_paper",
                "source_signal": "prior_direction_selector",
                "transaction_cost_bps": float(config.transaction_cost_bps),
                "min_selector_accuracy": float(config.min_selector_accuracy),
                "min_abs_prediction": float(config.min_abs_prediction),
                "min_probability_edge": float(config.min_probability_edge),
                "max_exposure_fraction": float(config.max_exposure_fraction),
                "max_drawdown_limit": float(config.max_drawdown),
                "position_fraction": float(config.position_fraction),
                **_paper_period_fields(subset),
                **metrics,
            }
        )

    return pd.DataFrame(rows).loc[:, PAPER_SUMMARY_COLUMNS]


def write_directional_paper_trading_outputs(
    report: DirectionalPaperTradingReport,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    paper_records_path = output_dir / "directional_paper_records.csv"
    summary_path = output_dir / "directional_paper_summary.csv"
    plot_path = output_dir / "directional_paper_trading.png"
    report.paper_records.to_csv(paper_records_path, index=False)
    report.summary.to_csv(summary_path, index=False)
    write_directional_paper_plot(report.summary, plot_path)
    return {
        "paper_records": paper_records_path,
        "summary": summary_path,
        "plot": plot_path,
    }


def write_directional_paper_plot(summary: pd.DataFrame, plot_path: Path) -> Path:
    if summary.empty:
        raise ValueError("summary must not be empty")
    required = {
        "evaluation_id",
        "strategy_id",
        "strategy_cumulative_return",
        "strategy_max_drawdown",
        "strategy_trade_count",
        "strategy_win_rate",
    }
    missing = sorted(required - set(summary.columns))
    if missing:
        raise ValueError(f"summary missing required columns: {missing}")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plot_path.parent.mkdir(parents=True, exist_ok=True)
    strategies = list(dict.fromkeys(summary["strategy_id"].astype(str)))
    evaluations = list(dict.fromkeys(summary["evaluation_id"].astype(str)))
    x_values = np.arange(len(strategies), dtype=float)
    bar_width = 0.78 / max(len(evaluations), 1)

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        1,
        figsize=(14.5, 11.5),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")
    metrics = (
        ("strategy_cumulative_return", "Net Return After Fees"),
        ("strategy_max_drawdown", "Max Drawdown"),
        ("strategy_trade_count", "Trade Count"),
    )
    colors = ("#4b7f8c", "#b36b3f", "#766f9b", "#6f8f52")

    for axis, (metric, title) in zip(axes, metrics, strict=True):
        for eval_index, evaluation_id in enumerate(evaluations):
            offset = (eval_index - (len(evaluations) - 1) / 2.0) * bar_width
            values = _metric_values(summary, strategies, evaluation_id, metric)
            axis.bar(
                x_values + offset,
                values,
                width=bar_width,
                label=evaluation_id.replace("_", " "),
                color=colors[eval_index % len(colors)],
            )
        if metric == "strategy_cumulative_return":
            axis.axhline(0.0, color="#394247", linewidth=1.0)
        axis.set_title(title, loc="left", fontweight="bold")
        axis.set_ylabel(title)
        axis.set_facecolor("#fffaf1")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.35)

    axes[0].legend(loc="best", frameon=True)
    axes[-1].set_xticks(x_values)
    axes[-1].set_xticklabels(
        [strategy.replace("_", " ") for strategy in strategies],
        rotation=12,
        ha="right",
    )
    axes[-1].set_xlabel("Paper strategy")
    figure.suptitle(
        "PRISM Direction Sidecar Paper Trading",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    plt.close(figure)
    return plot_path


def _apply_strategy_to_group(
    group: pd.DataFrame,
    config: DirectionalPaperTradingConfig,
) -> pd.DataFrame:
    ordered = group.sort_values("row_index").reset_index(drop=True).copy()
    round_trip_cost = 2.0 * float(config.transaction_cost_bps) / 10_000.0
    max_trades = int(np.floor(len(ordered) * config.max_exposure_fraction + 1e-12))
    equity = 1.0
    peak = 1.0
    trade_count = 0
    rows: list[dict[str, float | int | bool | str]] = []

    for row in ordered.itertuples(index=False):
        prediction = float(row.prediction)
        probability = float(row.probability)
        actual_return = float(row.actual_return)
        selector_accuracy = float(row.selector_training_directional_accuracy)
        probability_edge = abs(probability - 0.5)
        drawdown = 1.0 - (equity / peak) if peak > 0.0 else 0.0
        signal = 0
        reason = "flat"

        if drawdown >= config.max_drawdown:
            reason = "max_drawdown_stop"
        elif trade_count >= max_trades:
            reason = "max_exposure_reached"
        elif not np.isfinite(selector_accuracy) or (
            selector_accuracy < config.min_selector_accuracy
        ):
            reason = "selector_accuracy_too_low"
        elif probability_edge < config.min_probability_edge:
            reason = "probability_edge_too_low"
        elif abs(prediction) < config.min_abs_prediction:
            reason = "prediction_too_small"
        else:
            signal = 1 if prediction >= 0.0 else -1
            trade_count += 1
            reason = "risk_gate_passed"

        position = signal * float(config.position_fraction)
        gross_return = position * actual_return
        strategy_cost = abs(position) * round_trip_cost
        strategy_return = gross_return - strategy_cost
        equity *= 1.0 + strategy_return
        peak = max(peak, equity)
        rows.append(
            {
                "trade_signal": signal,
                "trade_side": "long" if signal > 0 else "short" if signal < 0 else "flat",
                "trade_reason": reason,
                "trade_edge_after_cost": abs(prediction) - round_trip_cost,
                "trade_probability_edge": probability_edge,
                "trade_interval_crosses_zero": True,
                "gross_strategy_return": gross_return,
                "strategy_cost": strategy_cost,
                "strategy_return": strategy_return,
                "paper_equity": equity,
                "paper_drawdown": 1.0 - (equity / peak) if peak > 0.0 else 0.0,
                "paper_position_fraction": abs(position),
                "paper_round_trip_cost": round_trip_cost,
            }
        )

    for key in rows[0]:
        ordered[key] = [row[key] for row in rows]
    return ordered


def _validate_paper_config(config: DirectionalPaperTradingConfig) -> None:
    if config.transaction_cost_bps < 0.0:
        raise ValueError("transaction_cost_bps must be non-negative")
    if not 0.0 <= config.min_selector_accuracy <= 1.0:
        raise ValueError("min_selector_accuracy must be in [0, 1]")
    if config.min_abs_prediction < 0.0:
        raise ValueError("min_abs_prediction must be non-negative")
    if not 0.0 <= config.min_probability_edge < 0.5:
        raise ValueError("min_probability_edge must be in [0, 0.5)")
    if not 0.0 <= config.max_exposure_fraction <= 1.0:
        raise ValueError("max_exposure_fraction must be in [0, 1]")
    if config.max_drawdown < 0.0:
        raise ValueError("max_drawdown must be non-negative")
    if not 0.0 <= config.position_fraction <= 1.0:
        raise ValueError("position_fraction must be in [0, 1]")


def _paper_period_fields(records: pd.DataFrame) -> dict[str, int | str]:
    ordered = records.sort_values("row_index").reset_index(drop=True)
    traded = ordered.loc[ordered["trade_signal"].abs() > 0]
    return {
        "start_row_index": int(ordered.loc[0, "row_index"]),
        "end_row_index": int(ordered.loc[len(ordered) - 1, "row_index"]),
        "start_datetime": str(ordered.loc[0, "datetime"]),
        "end_datetime": str(ordered.loc[len(ordered) - 1, "datetime"]),
        "first_trade_datetime": (
            str(traded.iloc[0]["datetime"]) if not traded.empty else ""
        ),
        "last_trade_datetime": (
            str(traded.iloc[-1]["datetime"]) if not traded.empty else ""
        ),
    }


def _metric_values(
    summary: pd.DataFrame,
    strategies: list[str],
    evaluation_id: str,
    metric: str,
) -> list[float]:
    subset = summary.loc[summary["evaluation_id"].astype(str) == evaluation_id]
    by_strategy = subset.set_index(subset["strategy_id"].astype(str))
    values: list[float] = []
    for strategy in strategies:
        if strategy not in by_strategy.index:
            values.append(float("nan"))
        else:
            values.append(float(by_strategy.loc[strategy, metric]))
    return values
