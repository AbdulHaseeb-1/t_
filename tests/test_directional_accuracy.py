from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.prism import PRISMConfig
from src.prism.directional_accuracy import (
    DirectionalVariant,
    DirectionalWindow,
    build_prior_directional_selection,
    default_directional_variants,
    run_directional_accuracy_validation,
    predict_latest_directional_signal,
    select_directional_variant_from_prior,
    write_directional_accuracy_outputs,
)


def test_default_directional_variants_include_direction_first_candidates():
    variants = default_directional_variants()

    assert variants[0].variant_id == "short_recency_18"
    assert {variant.target_mode for variant in variants} == {"return", "class"}
    assert "short_classifier_24" in {variant.variant_id for variant in variants}


def test_select_directional_variant_from_prior_prefers_highest_direction_accuracy():
    records = _candidate_records()

    selected = select_directional_variant_from_prior(
        records.loc[records["row_index"] < 4],
        ["model_a", "model_b"],
    )

    assert selected["variant_id"] == "model_b"
    assert selected["directional_accuracy"] == 1.0


def test_prior_directional_selection_uses_only_completed_prior_windows():
    records = _candidate_records()

    selected = build_prior_directional_selection(
        records,
        selector_lookback=4,
        min_selection_windows=4,
        default_variant_id="model_a",
    )
    mutated = records.copy()
    future_mask = (mutated["variant_id"] == "model_a") & (mutated["row_index"] >= 4)
    mutated.loc[future_mask, "actual_return"] = mutated.loc[future_mask, "prediction"]
    selected_after_future_change = build_prior_directional_selection(
        mutated,
        selector_lookback=4,
        min_selection_windows=4,
        default_variant_id="model_a",
    )

    assert selected.loc[0, "selected_variant_id"] == "model_a"
    assert selected.loc[4, "selected_variant_id"] == "model_b"
    assert selected_after_future_change.loc[4, "selected_variant_id"] == "model_b"
    assert selected_after_future_change.loc[
        4,
        "selector_training_directional_accuracy",
    ] == pytest.approx(selected.loc[4, "selector_training_directional_accuracy"])


def test_run_directional_accuracy_validation_returns_candidate_and_selector_metrics(
    market_frame,
):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        required_feature_columns=("close",),
        prediction_horizon=1,
    )
    variants = (
        DirectionalVariant(
            "return_model",
            training_window=50,
            max_features=4,
            ridge_penalty=1e-3,
            target_mode="return",
        ),
        DirectionalVariant(
            "class_model",
            training_window=50,
            max_features=4,
            ridge_penalty=1e-3,
            target_mode="class",
        ),
    )

    report = run_directional_accuracy_validation(
        market_frame,
        config,
        evaluation_windows=(DirectionalWindow("unit", start_index=40, step=20, max_windows=2),),
        variants=variants,
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
    )

    assert set(report.candidate_records["variant_id"]) == {"return_model", "class_model"}
    assert set(report.selected_records["evaluation_id"]) == {"unit"}
    assert "prior_direction_selector" in set(report.summary["variant_id"])
    assert np.isfinite(report.summary["directional_accuracy"]).all()


def test_directional_prediction_does_not_change_when_future_rows_change(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        required_feature_columns=("close",),
        prediction_horizon=1,
    )
    variant = DirectionalVariant(
        "return_model",
        training_window=50,
        max_features=4,
        ridge_penalty=1e-3,
    )
    window = DirectionalWindow("unit", start_index=70, step=1, max_windows=1)

    base_report = run_directional_accuracy_validation(
        market_frame,
        config,
        evaluation_windows=(window,),
        variants=(variant,),
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
    )
    mutated = market_frame.copy()
    future_mask = mutated.index > 71
    mutated.loc[future_mask, ["open", "high", "low", "close"]] *= 10.0
    mutated.loc[future_mask, "volume"] *= 3.0
    mutated_report = run_directional_accuracy_validation(
        mutated,
        config,
        evaluation_windows=(window,),
        variants=(variant,),
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
    )

    base_row = base_report.candidate_records.iloc[0]
    mutated_row = mutated_report.candidate_records.iloc[0]
    assert mutated_row["prediction"] == pytest.approx(base_row["prediction"])
    assert mutated_row["probability"] == pytest.approx(base_row["probability"])
    assert mutated_row["selected_features"] == base_row["selected_features"]


def test_directional_windows_include_final_predictable_row(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        required_feature_columns=("close",),
        prediction_horizon=1,
    )
    variant = DirectionalVariant(
        "return_model",
        training_window=50,
        max_features=4,
        ridge_penalty=1e-3,
    )

    report = run_directional_accuracy_validation(
        market_frame,
        config,
        evaluation_windows=(DirectionalWindow("unit", start_index=40, step=37),),
        variants=(variant,),
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
    )

    assert int(report.selected_records["row_index"].max()) == len(market_frame) - 2


def test_write_directional_accuracy_outputs_creates_csv_and_png(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        required_feature_columns=("close",),
    )
    report = run_directional_accuracy_validation(
        market_frame,
        config,
        evaluation_windows=(DirectionalWindow("unit", start_index=40, step=20, max_windows=2),),
        variants=(
            DirectionalVariant(
                "return_model",
                training_window=50,
                max_features=4,
                ridge_penalty=1e-3,
            ),
        ),
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
    )

    paths = write_directional_accuracy_outputs(
        report,
        output_dir=Path("reports/test_directional_accuracy_outputs"),
    )

    assert paths["candidate_records"].exists()
    assert paths["selected_records"].exists()
    assert paths["summary"].exists()
    assert paths["plot"].exists()


def test_predict_latest_directional_signal_is_research_sidecar(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        required_feature_columns=("close",),
    )
    variants = (
        DirectionalVariant(
            "return_model",
            training_window=50,
            max_features=4,
            ridge_penalty=1e-3,
        ),
        DirectionalVariant(
            "class_model",
            training_window=50,
            max_features=4,
            ridge_penalty=1e-3,
            target_mode="class",
        ),
    )

    signal = predict_latest_directional_signal(
        market_frame,
        config,
        variants=variants,
        selector_start_index=40,
        selector_step=20,
        selector_lookback=2,
        min_selection_windows=2,
        default_variant_id="return_model",
    )
    payload = signal.to_dict()

    assert signal.direction in {"up", "down", "flat"}
    assert 0.0 <= signal.probability <= 1.0
    assert signal.selected_variant_id in {"return_model", "class_model"}
    assert len(signal.candidate_signals) == 2
    assert "not used by PRISM trade execution" in str(payload["note"])


def _candidate_records() -> pd.DataFrame:
    actual = np.array([0.01, -0.01, 0.01, -0.01, 0.01, -0.01])
    frames = []
    for variant_id, prediction in {
        "model_a": np.array([-0.01, 0.01, -0.01, 0.01, 0.01, -0.01]),
        "model_b": np.array([0.01, -0.01, 0.01, -0.01, -0.01, 0.01]),
    }.items():
        frame = pd.DataFrame(
            {
                "evaluation_id": "unit",
                "variant_id": variant_id,
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
                "direction_hit": (prediction >= 0.0) == (actual >= 0.0),
                "zero_direction_hit": actual >= 0.0,
                "persistence_direction_hit": np.r_[True, actual[:-1] >= 0.0],
                "trade_signal": 0,
                "trade_side": "flat",
                "trade_reason": "test",
                "trade_edge_after_cost": 0.0,
                "trade_probability_edge": 0.0,
                "trade_interval_crosses_zero": True,
                "gross_strategy_return": 0.0,
                "strategy_cost": 0.0,
                "strategy_return": 0.0,
            }
        )
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)
