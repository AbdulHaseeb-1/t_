from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.prism.adaptive_validation import (
    build_adaptive_records,
    select_model_from_prior,
    summarize_model_candidates,
)
from src.prism.evaluation import apply_trade_strategy, calculate_backtest_metrics
from src.prism import PRISMConfig


def test_select_model_from_prior_prefers_lowest_mae():
    records = _candidate_records()

    selected = select_model_from_prior(
        records.loc[records["row_index"] < 4],
        ["model_a", "model_b"],
    )

    assert selected["model_id"] == "model_b"
    assert selected["mae"] < 0.001


def test_build_adaptive_records_uses_only_prior_windows():
    records = _candidate_records()

    adaptive = build_adaptive_records(
        records,
        min_selection_windows=4,
        default_model_id="model_a",
    )
    mutated = records.copy()
    mask = (mutated["model_id"] == "model_a") & (mutated["row_index"] >= 4)
    mutated.loc[mask, "actual_return"] = mutated.loc[mask, "prediction"]
    adaptive_after_future_change = build_adaptive_records(
        mutated,
        min_selection_windows=4,
        default_model_id="model_a",
    )

    assert adaptive.loc[0, "selected_model_id"] == "model_a"
    assert adaptive.loc[4, "selected_model_id"] == "model_b"
    assert adaptive_after_future_change.loc[4, "selected_model_id"] == "model_b"
    assert adaptive_after_future_change.loc[4, "model_selection_training_mae"] == pytest.approx(
        adaptive.loc[4, "model_selection_training_mae"],
    )


def test_build_adaptive_records_rejects_misaligned_candidates():
    records = _candidate_records()
    records = records.loc[
        ~((records["model_id"] == "model_b") & (records["row_index"] == 5))
    ]

    with pytest.raises(ValueError, match="aligned"):
        build_adaptive_records(records)


def test_summarize_model_candidates_includes_adaptive_selector():
    records = _candidate_records()
    adaptive = build_adaptive_records(
        records,
        min_selection_windows=4,
        default_model_id="model_a",
    )

    summary = summarize_model_candidates(records, adaptive)

    assert set(summary["model_id"]) == {"model_a", "model_b", "adaptive_selector"}
    assert calculate_backtest_metrics(adaptive)["n_windows"] == 6.0


def _candidate_records() -> pd.DataFrame:
    actual = np.array([0.01, -0.01, 0.01, -0.01, 0.01, -0.01])
    frames = []
    for model_id, prediction in {
        "model_a": np.array([-0.01, 0.01, -0.01, 0.01, 0.01, -0.01]),
        "model_b": actual + np.array([0.0001, -0.0001, 0.0001, -0.0001, -0.02, 0.02]),
    }.items():
        frame = pd.DataFrame(
            {
                "model_id": model_id,
                "row_index": np.arange(len(actual)),
                "datetime": pd.date_range("2026-01-01", periods=len(actual), freq="h"),
                "prediction": prediction,
                "probability": np.where(prediction >= 0.0, 0.51, 0.49),
                "actual_return": actual,
                "zero_prediction": 0.0,
                "persistence_prediction": np.r_[0.0, actual[:-1]],
                "lower_bound": -0.02,
                "upper_bound": 0.02,
                "interval_hit": True,
                "direction_hit": prediction >= 0.0,
                "zero_direction_hit": actual >= 0.0,
                "persistence_direction_hit": np.r_[True, actual[:-1] >= 0.0],
                "active_rule_count": 1,
                "causal_edge_count": 1,
                "calibration_rows": 20,
                "trace_prediction_row": np.arange(len(actual)),
            }
        )
        frames.append(
            apply_trade_strategy(
                frame,
                PRISMConfig(
                    transaction_cost_bps=0.0,
                    min_signal_probability_edge=0.0,
                    require_interval_confirmation=False,
                ),
            )
        )
    return pd.concat(frames, ignore_index=True)
