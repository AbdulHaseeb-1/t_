from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.pipeline import PRISMPipeline
from src.prism.trading import generate_trade_decision
from src.utils.validation import validate_ohlcv_frame


@dataclass(frozen=True)
class BacktestResult:
    records: pd.DataFrame
    metrics: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "metrics": self.metrics,
            "records": self.records.to_dict(orient="records"),
        }


def walk_forward_backtest(
    raw_frame: pd.DataFrame,
    config: PRISMConfig | None = None,
    *,
    start_index: int | None = None,
    step: int = 1,
    max_windows: int | None = None,
) -> BacktestResult:
    """Evaluate PRISM with past-only rolling inference windows.

    At each evaluated row t, the pipeline only receives candles through t. The
    realized next-horizon return is read outside the pipeline afterward.
    """
    if step <= 0:
        raise ValueError("step must be positive")
    if max_windows is not None and max_windows <= 0:
        raise ValueError("max_windows must be positive when provided")

    cfg = config or PRISMConfig()
    frame = validate_ohlcv_frame(raw_frame)
    horizon = cfg.prediction_horizon
    last_predictable_index = len(frame) - horizon - 1
    if last_predictable_index < cfg.min_labeled_rows:
        raise ValueError("not enough rows for walk-forward evaluation")

    first_index = start_index if start_index is not None else cfg.min_labeled_rows
    first_index = max(first_index, cfg.min_labeled_rows)
    if first_index > last_predictable_index:
        raise ValueError("start_index leaves no predictable rows")

    candidate_indices = list(range(first_index, last_predictable_index + 1, step))
    if max_windows is not None:
        candidate_indices = candidate_indices[-max_windows:]

    pipeline = PRISMPipeline(cfg)
    rows: list[dict[str, Any]] = []
    close = frame["close"].to_numpy(dtype=float)

    for row_index in candidate_indices:
        history = frame.iloc[: row_index + 1].copy()
        output = pipeline.run(history)
        actual_return = float(close[row_index + horizon] / close[row_index] - 1.0)
        zero_prediction = 0.0
        persistence_prediction = (
            float(close[row_index] / close[row_index - horizon] - 1.0)
            if row_index >= horizon
            else 0.0
        )
        lower, upper = output.uncertainty_bounds
        trade_signal = output.reasoning_trace["trade_signal"]
        strategy_fields = _strategy_fields_from_trade_trace(
            trade_signal,
            actual_return,
        )
        rows.append(
            {
                "row_index": int(row_index),
                "datetime": frame.loc[row_index, "datetime"],
                "prediction": output.prediction,
                "probability": output.probability,
                "actual_return": actual_return,
                "zero_prediction": zero_prediction,
                "persistence_prediction": persistence_prediction,
                "lower_bound": lower,
                "upper_bound": upper,
                "interval_hit": bool(lower <= actual_return <= upper),
                "direction_hit": bool((output.prediction >= 0.0) == (actual_return >= 0.0)),
                **strategy_fields,
                "zero_direction_hit": bool(
                    (zero_prediction >= 0.0) == (actual_return >= 0.0)
                ),
                "persistence_direction_hit": bool(
                    (persistence_prediction >= 0.0) == (actual_return >= 0.0)
                ),
                "active_rule_count": len(output.reasoning_trace["active_rules"]),
                "causal_edge_count": len(output.reasoning_trace["causal_edges"]),
                "calibration_rows": int(
                    output.reasoning_trace["calibration"]["n_calibration"]
                ),
                "trace_prediction_row": int(
                    output.reasoning_trace["calibration"]["prediction_row"]
                ),
            }
        )

    records = pd.DataFrame(rows)
    return BacktestResult(records=records, metrics=calculate_backtest_metrics(records))


def apply_trade_strategy(records: pd.DataFrame, config: PRISMConfig) -> pd.DataFrame:
    """Recompute trade decisions from stored forecasts without rerunning PRISM.

    This is used for threshold validation. It only consumes prediction-time
    fields plus realized returns already present in completed backtest records.
    """
    required = {
        "prediction",
        "probability",
        "actual_return",
        "lower_bound",
        "upper_bound",
    }
    missing = sorted(required - set(records.columns))
    if missing:
        raise ValueError(f"records missing required strategy columns: {missing}")

    updated = records.copy()
    if updated.empty:
        return updated

    strategy_rows = []
    for row in updated.itertuples(index=False):
        decision = generate_trade_decision(
            prediction=float(row.prediction),
            probability=float(row.probability),
            uncertainty_bounds=(float(row.lower_bound), float(row.upper_bound)),
            config=config,
        )
        strategy_rows.append(
            _strategy_fields_from_trade_trace(
                decision.to_trace(),
                float(row.actual_return),
            )
        )

    for key in strategy_rows[0]:
        updated[key] = [row[key] for row in strategy_rows]
    return updated


def calculate_backtest_metrics(records: pd.DataFrame) -> dict[str, float]:
    if records.empty:
        raise ValueError("records must not be empty")

    error = records["prediction"] - records["actual_return"]
    zero_error = records["zero_prediction"] - records["actual_return"]
    persistence_error = records["persistence_prediction"] - records["actual_return"]
    zero_mae = float(zero_error.abs().mean())
    persistence_mae = float(persistence_error.abs().mean())
    zero_rmse = float(np.sqrt(np.mean(zero_error.to_numpy(dtype=float) ** 2)))
    persistence_rmse = float(
        np.sqrt(np.mean(persistence_error.to_numpy(dtype=float) ** 2))
    )
    strategy_returns = records["strategy_return"].to_numpy(dtype=float)
    gross_strategy_returns = records["gross_strategy_return"].to_numpy(dtype=float)
    strategy_equity = np.cumprod(1.0 + strategy_returns)
    gross_strategy_equity = np.cumprod(1.0 + gross_strategy_returns)
    strategy_signal = records["trade_signal"].abs()
    non_flat = records[strategy_signal > 0]
    strategy_std = float(np.std(strategy_returns, ddof=1)) if len(records) > 1 else 0.0
    mae = float(error.abs().mean())
    rmse = float(np.sqrt(np.mean(error.to_numpy(dtype=float) ** 2)))
    best_baseline_mae = min(zero_mae, persistence_mae)
    best_baseline_rmse = min(zero_rmse, persistence_rmse)
    return {
        "n_windows": float(len(records)),
        "mae": mae,
        "rmse": rmse,
        "directional_accuracy": float(records["direction_hit"].mean()),
        "interval_coverage": float(records["interval_hit"].mean()),
        "mean_prediction": float(records["prediction"].mean()),
        "mean_actual_return": float(records["actual_return"].mean()),
        "mean_probability": float(records["probability"].mean()),
        "strategy_cumulative_return": float(strategy_equity[-1] - 1.0),
        "gross_strategy_cumulative_return": float(gross_strategy_equity[-1] - 1.0),
        "strategy_mean_return": float(np.mean(strategy_returns)),
        "strategy_return_volatility": strategy_std,
        "strategy_sharpe_like": (
            float(np.mean(strategy_returns) / strategy_std * np.sqrt(len(records)))
            if strategy_std > 0.0
            else 0.0
        ),
        "strategy_max_drawdown": _max_drawdown(strategy_returns),
        "strategy_exposure": float(strategy_signal.mean()),
        "strategy_trade_count": float(strategy_signal.sum()),
        "strategy_win_rate": (
            float((non_flat["strategy_return"] > 0.0).mean())
            if len(non_flat) > 0
            else 0.0
        ),
        "strategy_total_cost": float(records["strategy_cost"].sum()),
        "zero_mae": zero_mae,
        "zero_rmse": zero_rmse,
        "zero_directional_accuracy": float(records["zero_direction_hit"].mean()),
        "persistence_mae": persistence_mae,
        "persistence_rmse": persistence_rmse,
        "persistence_directional_accuracy": float(
            records["persistence_direction_hit"].mean()
        ),
        "best_baseline_mae": best_baseline_mae,
        "best_baseline_rmse": best_baseline_rmse,
        "mae_improvement_vs_best_baseline": best_baseline_mae - mae,
        "rmse_improvement_vs_best_baseline": best_baseline_rmse - rmse,
    }


def _strategy_fields_from_trade_trace(
    trade_signal: dict[str, Any],
    actual_return: float,
) -> dict[str, Any]:
    signal = int(trade_signal["signal"])
    round_trip_cost = float(trade_signal["round_trip_cost"])
    gross_strategy_return = float(signal * actual_return)
    strategy_cost = float(abs(signal) * round_trip_cost)
    strategy_return = gross_strategy_return - strategy_cost
    return {
        "trade_signal": signal,
        "trade_side": str(trade_signal["side"]),
        "trade_reason": str(trade_signal["reason"]),
        "trade_edge_after_cost": float(trade_signal["edge_after_cost"]),
        "trade_probability_edge": float(trade_signal["probability_edge"]),
        "trade_interval_crosses_zero": bool(trade_signal["interval_crosses_zero"]),
        "gross_strategy_return": gross_strategy_return,
        "strategy_cost": strategy_cost,
        "strategy_return": strategy_return,
    }


def _max_drawdown(returns: np.ndarray) -> float:
    if len(returns) == 0:
        return 0.0
    equity = np.concatenate(([1.0], np.cumprod(1.0 + returns)))
    peaks = np.maximum.accumulate(equity)
    drawdowns = equity / peaks - 1.0
    return float(abs(np.min(drawdowns)))
