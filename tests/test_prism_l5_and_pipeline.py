from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.prism import PRISMConfig, PRISMPipeline, run_prism
from src.prism.fus_reasoning import ReasoningFusionHead
from src.prism.pipeline import (
    impute_feature_frame,
    prepare_prism_frame,
    select_feature_names,
)
from src.prism.types import CausalGraph, ProbabilisticPrediction, SymbolicRule, TemporalAnalysis
from src.utils.validation import load_and_validate_data


def test_l5_reasoning_fusion_head_emits_valid_output_contract(market_frame):
    rule = SymbolicRule(
        rule_id=1,
        feature="open",
        target_feature="close",
        operator=">",
        threshold=1.0,
        observed_value=1.2,
        consequence=0.01,
        confidence=0.8,
        condition_met=True,
        causal_supported=True,
        active=True,
    )
    causal_graph = CausalGraph(
        adjacency=np.array([[0.0, 0.0], [1.0, 0.0]]),
        feature_names=("open", "close"),
        scores=np.array([[0.0, 0.0], [0.8, 0.0]]),
        acyclicity=0.0,
    )
    temporal = TemporalAnalysis(
        embedding=np.zeros((len(market_frame), 2)),
        granger_p_values=np.ones((2, 2)),
        significant_edges=[{"cause": "open", "effect": "close", "p_value": 0.01}],
    )
    probabilistic = ProbabilisticPrediction(
        prediction=0.002,
        probability=0.55,
        member_predictions=np.array([0.0018, 0.002, 0.0022]),
        uncertainty_bounds=(-0.001, 0.005),
        q_alpha=0.003,
        metadata={"n_calibration": 250},
    )

    output = ReasoningFusionHead(PRISMConfig()).fuse(
        frame=market_frame,
        rules=[rule],
        causal_graph=causal_graph,
        temporal=temporal,
        probabilistic=probabilistic,
    )

    prediction, probability, trace, bounds = output.as_tuple()
    assert isinstance(prediction, float)
    assert 0.0 <= probability <= 1.0
    assert bounds[0] <= prediction <= bounds[1]
    assert trace["active_rules"][0]["active"] is True
    assert trace["causal_edges"][0]["cause"] == "open"
    assert trace["trade_signal"]["signal"] in {-1, 0, 1}
    assert trace["trade_signal"]["round_trip_cost"] >= 0.0
    assert trace["output_contract"] == (
        "(prediction, probability, reasoning_trace, uncertainty_bounds)"
    )


def test_prepare_prism_frame_respects_configured_feature_columns(market_frame):
    config = PRISMConfig(feature_columns=("open", "close", "volume"))

    frame, feature_names, target_returns = prepare_prism_frame(market_frame, config)

    assert feature_names == ("open", "close", "volume")
    assert list(frame.columns) == ["open", "close", "volume"]
    assert len(frame) == len(target_returns)
    assert len(frame) == len(market_frame)
    assert np.isfinite(target_returns[:-1]).all()
    assert np.isnan(target_returns[-1])


def test_end_to_end_pipeline_on_synthetic_market_frame(market_frame):
    output = PRISMPipeline(
        PRISMConfig(
            feature_columns=("open", "high", "low", "close", "volume"),
            causal_threshold=0.05,
            granger_lags=(1,),
        )
    ).run(market_frame)

    output.validate()
    assert len(output.as_tuple()) == 4
    assert "active_concepts" in output.reasoning_trace
    assert "all_rules" in output.reasoning_trace
    assert "calibration" in output.reasoning_trace
    assert "trade_signal" in output.reasoning_trace
    assert output.reasoning_trace["calibration"]["prediction_row"] == len(market_frame) - 1
    assert "leakage_guard" in output.reasoning_trace["calibration"]
    assert output.reasoning_trace["calibration"]["preprocessing_fit_rows"] > 0
    assert output.reasoning_trace["calibration"]["selected_feature_count"] <= 5
    assert "selected_features" in output.reasoning_trace["calibration"]
    assert output.reasoning_trace["calibration"]["causal_fit_rows"] > 0
    assert output.reasoning_trace["calibration"]["rule_fit_rows"] > 0


def test_end_to_end_pipeline_can_emit_active_target_return_rules(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        causal_target_feature="target_return",
        target_causal_threshold=0.0,
        granger_lags=(1,),
    )

    output = PRISMPipeline(config).run(market_frame)

    active_rules = output.reasoning_trace["active_rules"]
    assert active_rules
    assert all(rule["target_feature"] == "target_return" for rule in active_rules)
    assert all(rule["causal_supported"] is True for rule in active_rules)
    assert any(edge["effect"] == "target_return" for edge in output.reasoning_trace["causal_edges"])


def test_end_to_end_pipeline_can_limit_fit_to_recent_labeled_rows(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        max_labeled_rows=60,
        min_labeled_rows=35,
        granger_lags=(1,),
    )

    output = PRISMPipeline(config).run(market_frame)
    calibration = output.reasoning_trace["calibration"]

    assert calibration["labeled_rows"] == len(market_frame) - 1
    assert calibration["fit_labeled_rows"] == 60
    assert calibration["fit_labeled_start_row"] == len(market_frame) - 61
    assert calibration["fit_labeled_end_row"] == len(market_frame) - 2
    assert calibration["train_rows"] == 42
    assert calibration["n_calibration"] == 18


def test_end_to_end_pipeline_on_repository_raw_csv():
    raw_path = Path("data/raw/eurusd_1000_candles.csv")
    data = load_and_validate_data(raw_path)

    output = run_prism(data)

    output.validate()
    prediction, probability, trace, bounds = output.as_tuple()
    assert isinstance(prediction, float)
    assert 0.0 <= probability <= 1.0
    assert bounds[0] <= prediction <= bounds[1]
    assert trace["calibration"]["n_calibration"] >= 200
    assert trace["calibration"]["prediction_row"] == len(data) - 1
    assert "calibration_warning" not in trace["calibration"]


def test_impute_feature_frame_uses_train_rows_only():
    frame = pd.DataFrame(
        {
            "feature": [1.0, 3.0, np.nan, 1000.0],
            "other": [np.nan, 2.0, 4.0, 1000.0],
        }
    )

    imputed = impute_feature_frame(frame, ("feature", "other"), np.array([0, 1]))

    assert imputed.loc[2, "feature"] == 2.0
    assert imputed.loc[0, "other"] == 2.0


def test_select_feature_names_uses_train_rows_only():
    frame = pd.DataFrame(
        {
            "close": np.linspace(100.0, 110.0, 20),
            "train_signal": [0.0, 1.0] * 10,
            "future_only_signal": [0.0] * 12 + [10.0, -10.0] * 4,
            "noise": np.arange(20, dtype=float),
        }
    )
    target = np.array([0.0, 1.0] * 10, dtype=float)
    target[12:] = np.array([10.0, -10.0] * 4)

    selected, scores = select_feature_names(
        frame,
        tuple(frame.columns),
        target,
        np.arange(0, 12),
        PRISMConfig(
            feature_columns=tuple(frame.columns),
            max_selected_features=2,
            required_feature_columns=("close",),
        ),
    )

    assert selected == ("close", "train_signal")
    assert scores["train_signal"] > scores["close"]
    assert "future_only_signal" not in selected
