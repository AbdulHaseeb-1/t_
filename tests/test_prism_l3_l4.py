from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.pro_calibration import (
    ProbabilisticCalibrationModule,
    _ridge_fit,
    pro_apply_magnitude_cap,
    pro_conformal_quantile,
    pro_select_magnitude_cap,
    pro_select_shrinkage_factor,
)
from src.prism.sym_rule_induction import SymbolicRuleInducer
from src.prism.types import CausalGraph


def test_l3_dag_gate_allows_supported_rule_and_blocks_unsupported_rule():
    frame = pd.DataFrame(
        {
            "x": np.linspace(0.0, 1.0, 40),
            "y": np.linspace(1.0, 2.0, 40),
        }
    )
    target_returns = np.linspace(0.0, 0.02, 40)
    feature_names = ("x", "y")
    scores = np.array([[0.0, 0.0], [0.9, 0.0]])
    allowed_graph = CausalGraph(
        adjacency=np.array([[0.0, 0.0], [1.0, 0.0]]),
        feature_names=feature_names,
        scores=scores,
        acyclicity=0.0,
    )
    blocked_graph = CausalGraph(
        adjacency=np.zeros((2, 2)),
        feature_names=feature_names,
        scores=scores,
        acyclicity=0.0,
    )
    config = PRISMConfig(
        feature_columns=feature_names,
        causal_target_feature="y",
        num_rules=1,
    )
    inducer = SymbolicRuleInducer(config)

    allowed_rule = inducer.induce(frame, feature_names, target_returns, allowed_graph)[0]
    blocked_rule = inducer.induce(frame, feature_names, target_returns, blocked_graph)[0]

    assert allowed_rule.feature == "x"
    assert allowed_rule.condition_met is True
    assert allowed_rule.causal_supported is True
    assert allowed_rule.active is True
    assert blocked_rule.condition_met is True
    assert blocked_rule.causal_supported is False
    assert blocked_rule.active is False


def test_l3_rule_thresholds_are_fit_index_bounded():
    frame = pd.DataFrame({"x": np.linspace(0.0, 1.0, 80), "y": np.linspace(1.0, 2.0, 80)})
    shifted = frame.copy()
    shifted.loc[60:, "x"] = shifted.loc[60:, "x"] + 1000.0
    target_returns = np.linspace(0.0, 0.02, 80)
    shifted_target_returns = target_returns.copy()
    shifted_target_returns[60:] = shifted_target_returns[60:] - 10.0
    feature_names = ("x", "y")
    graph = CausalGraph(
        adjacency=np.array([[0.0, 0.0], [1.0, 0.0]]),
        feature_names=feature_names,
        scores=np.array([[0.0, 0.0], [0.9, 0.0]]),
        acyclicity=0.0,
    )
    config = PRISMConfig(
        feature_columns=feature_names,
        causal_target_feature="y",
        num_rules=4,
    )
    inducer = SymbolicRuleInducer(config)
    fit_indices = np.arange(0, 50)

    baseline_rules = inducer.induce(
        frame,
        feature_names,
        target_returns,
        graph,
        fit_indices=fit_indices,
    )
    shifted_rules = inducer.induce(
        shifted,
        feature_names,
        shifted_target_returns,
        graph,
        fit_indices=fit_indices,
    )

    assert [rule.threshold for rule in baseline_rules] == [
        rule.threshold for rule in shifted_rules
    ]
    assert [rule.confidence for rule in baseline_rules] == [
        rule.confidence for rule in shifted_rules
    ]


def test_l4_conformal_quantile_uses_finite_sample_higher_quantile():
    scores = np.array([1.0, 2.0, 3.0, 4.0])

    assert pro_conformal_quantile(scores, alpha=0.75) == 3.0
    assert pro_conformal_quantile(scores, alpha=0.05) == 4.0


def test_l4_ridge_ensemble_emits_ordered_bounds_and_small_calibration_warning():
    x = np.linspace(-1.0, 1.0, 80).reshape(-1, 1)
    y = 0.02 * x[:, 0] + 0.001
    config = PRISMConfig(
        d_model=1,
        ensemble_size=5,
        min_calibration_size=200,
        ridge_penalty=1e-4,
    )
    module = ProbabilisticCalibrationModule(config)

    module.fit(x[:50], y[:50])
    module.calibrate(x[50:70], y[50:70])
    prediction = module.predict_one(np.array([0.25]))

    lo, hi = prediction.uncertainty_bounds
    assert lo <= prediction.prediction <= hi
    assert 0.0 <= prediction.probability <= 1.0
    assert prediction.member_predictions.shape == (5,)
    assert prediction.q_alpha >= 0.0
    assert prediction.metadata["n_calibration"] == 20
    assert "calibration_warning" in prediction.metadata
    assert "shrinkage_factor" in prediction.metadata
    assert "magnitude_cap" in prediction.metadata


def test_l4_selects_shrinkage_factor_that_reduces_calibration_mae():
    predictions = np.array([0.10, -0.10, 0.20, -0.20])
    targets = predictions * 0.25

    factor = pro_select_shrinkage_factor(
        predictions,
        targets,
        shrinkage_grid=(0.0, 0.25, 0.5, 1.0),
    )

    assert factor == 0.25


def test_l4_applies_selected_shrinkage_to_prediction_members():
    x = np.linspace(-1.0, 1.0, 80).reshape(-1, 1)
    y = 0.05 * x[:, 0]
    config = PRISMConfig(
        d_model=1,
        ensemble_size=3,
        ridge_penalty=1e-6,
        shrinkage_grid=(0.0, 0.5, 1.0),
    )
    module = ProbabilisticCalibrationModule(config)

    module.fit(x[:50], y[:50])
    module.calibrate(x[50:70], np.zeros(20))
    prediction = module.predict_one(np.array([1.0]))

    assert prediction.metadata["shrinkage_factor"] == 0.0
    assert abs(prediction.prediction) < 1e-12


def test_l4_magnitude_cap_preserves_sign_and_limits_absolute_value():
    predictions = np.array([-0.5, -0.1, 0.0, 0.2, 0.8])

    clipped = pro_apply_magnitude_cap(predictions, 0.2)

    np.testing.assert_allclose(clipped, np.array([-0.2, -0.1, 0.0, 0.2, 0.2]))
    assert np.sign(clipped[0]) == np.sign(predictions[0])
    assert np.sign(clipped[-1]) == np.sign(predictions[-1])


def test_l4_selects_magnitude_cap_that_reduces_calibration_rmse():
    predictions = np.array([0.01, -0.01, 0.50, -0.50])
    targets = np.array([0.01, -0.01, 0.02, -0.02])

    cap = pro_select_magnitude_cap(
        predictions,
        targets,
        cap_quantiles=(0.5, 1.0),
        min_cap=1e-12,
    )

    unclipped_rmse = np.sqrt(np.mean((predictions - targets) ** 2))
    clipped_rmse = np.sqrt(np.mean((pro_apply_magnitude_cap(predictions, cap) - targets) ** 2))
    assert clipped_rmse < unclipped_rmse


def test_l4_weighted_ridge_matches_weighted_normal_equation():
    design = np.array(
        [
            [1.0, -1.0],
            [1.0, 0.0],
            [1.0, 2.0],
        ],
    )
    target = np.array([-1.0, 0.0, 2.0])
    weights = np.array([1.0, 3.0, 2.0])
    penalty = 0.25
    regularizer = np.diag([0.0, penalty])
    expected = np.linalg.solve(
        design.T @ np.diag(weights) @ design + regularizer,
        design.T @ np.diag(weights) @ target,
    )

    actual = _ridge_fit(design, target, penalty, weights)

    np.testing.assert_allclose(actual, expected)
