from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_HISTORY_PATH = PROJECT_ROOT / "reports" / "backtest_history.csv"
DEFAULT_PLOT_PATH = PROJECT_ROOT / "reports" / "backtest_history.png"
HISTORY_COLUMNS = (
    "timestamp_utc",
    "label",
    "n_windows",
    "directional_accuracy",
    "interval_coverage",
    "mae",
    "rmse",
    "mean_probability",
    "strategy_cumulative_return",
    "gross_strategy_cumulative_return",
    "strategy_mean_return",
    "strategy_return_volatility",
    "strategy_sharpe_like",
    "strategy_max_drawdown",
    "strategy_exposure",
    "strategy_trade_count",
    "strategy_win_rate",
    "strategy_total_cost",
    "zero_mae",
    "zero_rmse",
    "zero_directional_accuracy",
    "persistence_mae",
    "persistence_rmse",
    "persistence_directional_accuracy",
    "best_baseline_mae",
    "best_baseline_rmse",
    "mae_improvement_vs_best_baseline",
    "rmse_improvement_vs_best_baseline",
)


def append_backtest_history(
    metrics: dict[str, float],
    *,
    label: str,
    history_path: Path = DEFAULT_HISTORY_PATH,
    plot_path: Path = DEFAULT_PLOT_PATH,
    timestamp_utc: str | None = None,
) -> pd.DataFrame:
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history = update_backtest_history(
        _read_history(history_path),
        metrics,
        label=label,
        timestamp_utc=timestamp_utc,
    )
    history.to_csv(history_path, index=False)
    write_backtest_history_plot(history, plot_path)
    return history


def update_backtest_history(
    history: pd.DataFrame,
    metrics: dict[str, float],
    *,
    label: str,
    timestamp_utc: str | None = None,
) -> pd.DataFrame:
    row = {
        "timestamp_utc": timestamp_utc or datetime.now(UTC).replace(microsecond=0).isoformat(),
        "label": label,
        **{column: metrics[column] for column in HISTORY_COLUMNS if column in metrics},
    }
    normalized_history = _normalize_history(history)
    new_row = _normalize_history(pd.DataFrame([row]))
    updated = (
        new_row
        if normalized_history.empty
        else pd.concat(
            [
                normalized_history.dropna(axis=1, how="all"),
                new_row.dropna(axis=1, how="all"),
            ],
            ignore_index=True,
        )
    )
    return _normalize_history(updated)


def write_backtest_history_plot(
    history: pd.DataFrame,
    plot_path: Path = DEFAULT_PLOT_PATH,
) -> Path:
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    figure = build_backtest_history_figure(history)
    try:
        figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    finally:
        import matplotlib.pyplot as plt

        plt.close(figure)
    return plot_path


def build_backtest_history_figure(history: pd.DataFrame):
    if history.empty:
        raise ValueError("history must not be empty")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    history = history.reset_index(drop=True)
    labels = history["label"].astype(str).str.replace("_", " ", regex=False)
    x_values = range(len(history))
    latest = history.iloc[-1]

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        1,
        figsize=(13.5, 10.5),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")

    error_axis, hit_axis, strategy_axis = axes
    error_axis.plot(x_values, history["mae"], marker="o", linewidth=2.6, label="PRISM MAE")
    error_axis.plot(
        x_values,
        history["rmse"],
        marker="o",
        linewidth=2.6,
        label="PRISM RMSE",
    )
    if "best_baseline_mae" in history and history["best_baseline_mae"].notna().any():
        error_axis.plot(
            x_values,
            history["best_baseline_mae"],
            linestyle="--",
            marker="s",
            linewidth=2.0,
            label="Best baseline MAE",
        )
    error_axis.set_title(
        "Prediction Error vs Baselines, Lower Is Better",
        loc="left",
        fontweight="bold",
    )
    error_axis.set_ylabel("Return error")
    error_axis.legend(loc="upper right", frameon=True)

    hit_axis.plot(
        x_values,
        history["directional_accuracy"],
        marker="o",
        linewidth=2.6,
        label="Directional accuracy",
    )
    if (
        "persistence_directional_accuracy" in history
        and history["persistence_directional_accuracy"].notna().any()
    ):
        hit_axis.plot(
            x_values,
            history["persistence_directional_accuracy"],
            linestyle="--",
            marker="s",
            linewidth=2.0,
            label="Persistence direction",
        )
    hit_axis.plot(
        x_values,
        history["interval_coverage"],
        marker="o",
        linewidth=2.6,
        label="Interval coverage",
    )
    hit_axis.set_title("Hit Rates, Higher Is Better", loc="left", fontweight="bold")
    hit_axis.set_ylabel("Rate")
    hit_axis.set_ylim(0.0, 1.05)
    hit_axis.legend(loc="lower right", frameon=True)

    if (
        "strategy_cumulative_return" in history
        and history["strategy_cumulative_return"].notna().any()
    ):
        strategy_axis.plot(
            x_values,
            history["strategy_cumulative_return"],
            marker="o",
            linewidth=2.6,
            label="Net cumulative return",
        )
    if (
        "gross_strategy_cumulative_return" in history
        and history["gross_strategy_cumulative_return"].notna().any()
    ):
        strategy_axis.plot(
            x_values,
            history["gross_strategy_cumulative_return"],
            linestyle="--",
            marker="s",
            linewidth=2.0,
            label="Gross cumulative return",
        )
    strategy_axis.axhline(0.0, color="#394247", linewidth=1.1, alpha=0.6)
    strategy_axis.set_title(
        "Cost-Aware Trading, Higher Is Better",
        loc="left",
        fontweight="bold",
    )
    strategy_axis.set_ylabel("Return")
    strategy_handles, _ = strategy_axis.get_legend_handles_labels()
    if strategy_handles:
        strategy_axis.legend(loc="upper right", frameon=True)

    for axis in axes:
        axis.set_facecolor("#fffaf1")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.35)

    hit_axis.set_xticks(list(x_values))
    hit_axis.set_xticklabels(labels, rotation=16, ha="right")
    hit_axis.set_xlabel("Recorded PRISM iteration")

    figure.suptitle(
        "PRISM Walk-Forward Backtest Improvement History",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.text(
        0.01,
        0.965,
        (
            f"Latest: {latest['label']} | MAE {latest['mae']:.8f} | "
            f"RMSE {latest['rmse']:.8f} | Direction {latest['directional_accuracy']:.2f} | "
            f"Coverage {latest['interval_coverage']:.2f} | "
            f"MAE edge {latest.get('mae_improvement_vs_best_baseline', float('nan')):.8f} | "
            f"Net return {latest.get('strategy_cumulative_return', float('nan')):.6f} | "
            f"Exposure {latest.get('strategy_exposure', float('nan')):.2f}"
        ),
        ha="left",
        fontsize=10.5,
        color="#42565f",
    )
    return figure


def _read_history(history_path: Path) -> pd.DataFrame:
    if not history_path.exists():
        return pd.DataFrame(columns=HISTORY_COLUMNS)
    return _normalize_history(pd.read_csv(history_path))


def _normalize_history(history: pd.DataFrame) -> pd.DataFrame:
    for column in HISTORY_COLUMNS:
        if column not in history.columns:
            history[column] = pd.NA
    return history.loc[:, HISTORY_COLUMNS]
