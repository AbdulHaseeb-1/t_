from __future__ import annotations

import pytest
import numpy as np

from src.prism.cau_dagma import (
    CausalStructureModule,
    cau_acyclicity,
    dagma_logdet_acyclicity,
)
from src.prism.config import PRISMConfig
from src.prism.tem_dependencies import (
    TemporalDependencyModule,
    tem_granger_matrix,
    tem_granger_p_value,
    tem_state_scan,
)


def test_l1_causal_adjacency_uses_documented_orientation(causal_frame):
    feature_names = ("x", "y", "z")
    config = PRISMConfig(
        feature_columns=feature_names,
        causal_target_feature="y",
        causal_threshold=0.25,
    )

    graph = CausalStructureModule(config).infer(causal_frame, feature_names)

    assert graph.adjacency.shape == (3, 3)
    assert graph.adjacency[1, 0] == 1.0
    assert graph.adjacency[0, 1] == 0.0
    assert graph.acyclicity < 1e-10
    assert cau_acyclicity(graph.adjacency) < 1e-10
    assert {"cause": "x", "effect": "y", "score": graph.scores[1, 0]} in graph.edges


def test_l1_can_append_terminal_target_return_node(causal_frame):
    feature_names = ("x", "y", "z")
    target_return = np.full(len(causal_frame), np.nan)
    target_return[:-1] = causal_frame["x"].to_numpy()[1:] * 0.01
    config = PRISMConfig(
        feature_columns=feature_names,
        causal_target_feature="target_return",
        target_causal_threshold=0.01,
    )

    graph = CausalStructureModule(config).infer_with_target(
        causal_frame,
        feature_names,
        target_return,
    )

    target_idx = graph.feature_names.index("target_return")
    x_idx = graph.feature_names.index("x")
    assert graph.feature_names == ("x", "y", "z", "target_return")
    assert graph.adjacency[target_idx, x_idx] == 1.0
    assert graph.acyclicity < 1e-10
    assert any(edge["cause"] == "x" and edge["effect"] == "target_return" for edge in graph.edges)


def test_l1_target_edges_are_fit_index_bounded(causal_frame):
    feature_names = ("x", "y", "z")
    target_return = np.full(len(causal_frame), np.nan)
    target_return[:-1] = causal_frame["x"].to_numpy()[1:] * 0.01
    shifted = causal_frame.copy()
    shifted.loc[150:, "x"] = shifted.loc[150:, "x"] + 1000.0
    shifted_target = target_return.copy()
    shifted_target[150:-1] = shifted_target[150:-1] - 10.0
    fit_indices = np.arange(0, 120)
    config = PRISMConfig(
        feature_columns=feature_names,
        causal_target_feature="target_return",
        target_causal_threshold=0.0,
    )
    module = CausalStructureModule(config)

    baseline_graph = module.infer_with_target(
        causal_frame,
        feature_names,
        target_return,
        fit_indices=fit_indices,
    )
    shifted_graph = module.infer_with_target(
        shifted,
        feature_names,
        shifted_target,
        fit_indices=fit_indices,
    )

    np.testing.assert_allclose(baseline_graph.scores, shifted_graph.scores)
    np.testing.assert_allclose(baseline_graph.adjacency, shifted_graph.adjacency)


def test_l1_dagma_logdet_acyclicity_detects_feedback_cycles():
    dag = np.array([[0.0, 0.8], [0.0, 0.0]])
    cycle = np.array([[0.0, 0.4], [0.7, 0.0]])

    assert dagma_logdet_acyclicity(dag) == pytest.approx(0.0, abs=1e-12)
    assert dagma_logdet_acyclicity(cycle) > 0.0


def test_l2_granger_detects_known_lagged_direction(causal_frame):
    feature_names = ("x", "y", "z")
    values = causal_frame.loc[:, feature_names].to_numpy(dtype=float)

    p_x_causes_y = tem_granger_p_value(values[:, 0], values[:, 1], lag=1)
    p_y_causes_x = tem_granger_p_value(values[:, 1], values[:, 0], lag=1)
    matrix = tem_granger_matrix(values, (1, 2))

    assert p_x_causes_y < 0.001
    assert p_x_causes_y < p_y_causes_x
    assert matrix[1, 0] < 0.001
    assert matrix[0, 1] > matrix[1, 0]


def test_l2_temporal_module_returns_state_scan_and_significant_edges(causal_frame):
    feature_names = ("x", "y", "z")
    config = PRISMConfig(
        feature_columns=feature_names,
        granger_lags=(1, 2),
        granger_alpha=0.01,
        d_model=3,
    )
    encoded = causal_frame.loc[:, feature_names].to_numpy(dtype=float)

    analysis = TemporalDependencyModule(config).analyze(causal_frame, feature_names, encoded)

    assert analysis.embedding.shape == encoded.shape
    assert np.isfinite(analysis.embedding).all()
    assert tem_state_scan(encoded).shape == encoded.shape
    assert any(
        edge["cause"] == "x" and edge["effect"] == "y"
        for edge in analysis.significant_edges
    )
