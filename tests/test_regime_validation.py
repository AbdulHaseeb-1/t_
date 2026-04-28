from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.evaluation import apply_trade_strategy, calculate_backtest_metrics
from src.prism.regime_validation import (
    build_regime_summary,
    select_probability_threshold,
    walk_forward_threshold_tuning,
)


def test_apply_trade_strategy_recomputes_threshold_without_rerunning_model():
    records = _forecast_records()
    config = PRISMConfig(
        transaction_cost_bps=0.0,
        min_signal_probability_edge=0.002,
        require_interval_confirmation=False,
    )

    updated = apply_trade_strategy(records, config)

    assert updated.loc[0, "trade_signal"] == 0
    assert updated.loc[2, "trade_signal"] == 1
    assert updated.loc[2, "strategy_return"] == records.loc[2, "actual_return"]
    assert calculate_backtest_metrics(updated)["strategy_trade_count"] == 4.0


def test_threshold_tuning_uses_only_prior_completed_windows():
    records = _forecast_records()
    config = PRISMConfig(transaction_cost_bps=0.0, require_interval_confirmation=False)

    tuned, _ = walk_forward_threshold_tuning(
        records,
        config,
        threshold_grid=(0.0, 0.002),
        min_training_windows=3,
        min_tuning_trades=1,
    )
    mutated = records.copy()
    mutated.loc[4:, "actual_return"] = 100.0
    tuned_after_future_change, _ = walk_forward_threshold_tuning(
        mutated,
        config,
        threshold_grid=(0.0, 0.002),
        min_training_windows=3,
        min_tuning_trades=1,
    )

    assert tuned.loc[0, "threshold_selection_reason"] == "insufficient_prior_windows"
    assert tuned.loc[3, "selected_probability_edge"] == 0.002
    assert tuned_after_future_change.loc[3, "selected_probability_edge"] == 0.002
    assert tuned_after_future_change.loc[3, "threshold_training_return"] == tuned.loc[
        3,
        "threshold_training_return",
    ]


def test_select_probability_threshold_requires_minimum_trade_count():
    records = _forecast_records().iloc[:2].copy()
    config = PRISMConfig(transaction_cost_bps=0.0, require_interval_confirmation=False)

    selected = select_probability_threshold(
        records,
        config,
        threshold_grid=(0.004, 0.005),
        min_tuning_trades=1,
    )

    assert selected["reason"] == "no_positive_prior_threshold"
    assert selected["threshold"] > 0.49


def test_select_probability_threshold_rejects_negative_prior_return():
    records = _forecast_records().iloc[:2].copy()
    config = PRISMConfig(transaction_cost_bps=0.0, require_interval_confirmation=False)

    selected = select_probability_threshold(
        records,
        config,
        threshold_grid=(0.0,),
        min_tuning_trades=1,
        min_training_return=0.0,
    )

    assert selected["reason"] == "no_positive_prior_threshold"
    assert selected["threshold"] > 0.49


def test_build_regime_summary_reports_chronological_and_volatility_slices():
    records = apply_trade_strategy(
        _forecast_records(rows=12),
        PRISMConfig(transaction_cost_bps=0.0, require_interval_confirmation=False),
    )

    summary = build_regime_summary(records)

    assert "all_windows" in set(summary["regime"])
    assert "early_period" in set(summary["regime"])
    assert "high_realized_volatility" in set(summary["regime"])
    assert np.isfinite(summary["mae_improvement_vs_best_baseline"]).all()


def _forecast_records(rows: int = 6) -> pd.DataFrame:
    base_predictions = np.array([0.001, 0.001, 0.001, 0.001, -0.001, -0.001])
    base_probabilities = np.array([0.501, 0.501, 0.503, 0.503, 0.497, 0.497])
    base_actuals = np.array([-0.001, -0.001, 0.002, 0.003, 0.002, -0.003])
    repeats = int(np.ceil(rows / len(base_predictions)))
    prediction = np.tile(base_predictions, repeats)[:rows]
    probability = np.tile(base_probabilities, repeats)[:rows]
    actual = np.tile(base_actuals, repeats)[:rows]
    return pd.DataFrame(
        {
            "row_index": np.arange(rows),
            "datetime": pd.date_range("2026-01-01", periods=rows, freq="h"),
            "prediction": prediction,
            "probability": probability,
            "actual_return": actual,
            "zero_prediction": 0.0,
            "persistence_prediction": np.r_[0.0, actual[:-1]],
            "lower_bound": -0.01,
            "upper_bound": 0.01,
            "interval_hit": True,
            "direction_hit": prediction >= 0.0,
            "zero_direction_hit": actual >= 0.0,
            "persistence_direction_hit": np.r_[True, actual[:-1] >= 0.0],
            "active_rule_count": 1,
            "causal_edge_count": 1,
            "calibration_rows": 20,
            "trace_prediction_row": np.arange(rows),
        }
    )
