from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import (
    EPSILON,
    replace_non_finite_with_reference,
    safe_corrcoef,
)
from src.prism.types import CausalGraph


try:
    from scipy.linalg import expm
except ImportError:  # pragma: no cover - scipy is part of requirements.
    expm = None


class CausalStructureModule:
    """DAGMA-style lagged causal graph discovery.

    Public adjacency follows the project contract: A[i, j] means feature j
    causes feature i. Internally the optimizer fits W[cause, effect] on
    lagged rows and uses DAGMA's log-det acyclicity function on W.
    """

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config

    def infer(
        self,
        frame: pd.DataFrame,
        feature_names: tuple[str, ...],
        fit_indices: np.ndarray | None = None,
    ) -> CausalGraph:
        values = frame.loc[:, feature_names].to_numpy(dtype=float)
        adjacency, scores = self._feature_adjacency(values, fit_indices=fit_indices)

        return CausalGraph(
            adjacency=adjacency,
            feature_names=feature_names,
            scores=scores,
            acyclicity=cau_acyclicity(adjacency),
        )

    def infer_with_target(
        self,
        frame: pd.DataFrame,
        feature_names: tuple[str, ...],
        target_values: np.ndarray,
        target_name: str = "target_return",
        fit_indices: np.ndarray | None = None,
    ) -> CausalGraph:
        """Infer feature DAG plus a terminal predictive target node."""
        values = frame.loc[:, feature_names].to_numpy(dtype=float)
        target_values = np.asarray(target_values, dtype=float)
        if len(target_values) != len(values):
            raise ValueError("target_values must have the same length as frame")
        if target_name in feature_names:
            raise ValueError("target_name must not already exist in feature_names")
        fit_indices = _normalize_fit_indices(fit_indices, len(values))
        values = replace_non_finite_with_reference(values, fit_indices)

        feature_adjacency, feature_scores = self._feature_adjacency(
            values,
            fit_indices=fit_indices,
        )
        n_features = len(feature_names)
        n_nodes = n_features + 1
        adjacency = np.zeros((n_nodes, n_nodes), dtype=float)
        scores = np.zeros_like(adjacency)
        adjacency[:n_features, :n_features] = feature_adjacency
        scores[:n_features, :n_features] = feature_scores

        target_idx = n_features
        labeled_fit_indices = fit_indices[np.isfinite(target_values[fit_indices])]
        for cause_idx in range(n_features):
            score = abs(
                safe_corrcoef(
                    values[labeled_fit_indices, cause_idx],
                    target_values[labeled_fit_indices],
                )
            )
            scores[target_idx, cause_idx] = score
            if score >= self.config.target_causal_threshold:
                adjacency[target_idx, cause_idx] = 1.0

        graph_feature_names = (*feature_names, target_name)
        return CausalGraph(
            adjacency=adjacency,
            feature_names=graph_feature_names,
            scores=scores,
            acyclicity=cau_acyclicity(adjacency),
        )

    def _feature_adjacency(
        self,
        values: np.ndarray,
        fit_indices: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        fit_indices = _normalize_fit_indices(fit_indices, len(values))
        values = replace_non_finite_with_reference(values, fit_indices)
        reference_values = values[fit_indices]
        n_features = values.shape[1]

        weights = _lagged_dagma_weights(reference_values, self.config)
        scores = np.abs(weights).T
        np.fill_diagonal(scores, 0.0)
        adjacency = _threshold_acyclic_adjacency(
            scores,
            threshold=float(self.config.causal_threshold),
        )

        return adjacency, scores


def dagma_logdet_acyclicity(weights: np.ndarray, s: float = 1.0) -> float:
    """DAGMA log-det acyclicity score for a weighted adjacency matrix."""
    matrix = np.asarray(weights, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("weights must be a square matrix")
    if s <= 0.0:
        raise ValueError("s must be positive")

    dim = matrix.shape[0]
    shifted = s * np.eye(dim, dtype=float) - matrix * matrix
    sign, logdet = np.linalg.slogdet(shifted)
    if sign <= 0.0 or not np.isfinite(logdet):
        return float("inf")
    return float(max(-logdet + dim * np.log(s), 0.0))


def cau_acyclicity(adjacency: np.ndarray) -> float:
    matrix = np.asarray(adjacency, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("adjacency must be a square matrix")
    if expm is None:
        return 0.0 if _is_strictly_triangular(matrix) else float("inf")
    return float(np.trace(expm(matrix * matrix)) - matrix.shape[0])


def _lagged_dagma_weights(
    reference_values: np.ndarray,
    config: PRISMConfig,
) -> np.ndarray:
    n_features = reference_values.shape[1]
    if n_features == 0:
        return np.zeros((0, 0), dtype=float)
    if len(reference_values) < 3:
        return np.zeros((n_features, n_features), dtype=float)

    normalized = _standardize_rows(reference_values)
    design = normalized[:-1]
    response = normalized[1:]
    if len(design) < 2:
        return np.zeros((n_features, n_features), dtype=float)

    weights = np.zeros((n_features, n_features), dtype=float)
    mu = float(config.dagma_mu_init)
    for stage_idx, s_value in enumerate(config.dagma_s):
        iterations = (
            int(config.dagma_max_iter)
            if stage_idx == len(config.dagma_s) - 1
            else int(config.dagma_warm_iter)
        )
        weights = _optimize_dagma_stage(
            weights=weights,
            design=design,
            response=response,
            mu=mu,
            lambda1=float(config.dagma_lambda1),
            s=float(s_value),
            learning_rate=float(config.dagma_learning_rate),
            beta1=float(config.dagma_beta1),
            beta2=float(config.dagma_beta2),
            iterations=iterations,
        )
        mu *= float(config.dagma_mu_factor)

    weights = np.where(np.isfinite(weights), weights, 0.0)
    np.fill_diagonal(weights, 0.0)
    return weights


def _standardize_rows(values: np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    mean = array.mean(axis=0)
    std = array.std(axis=0)
    std = np.where(std < EPSILON, 1.0, std)
    return (array - mean) / std


def _optimize_dagma_stage(
    *,
    weights: np.ndarray,
    design: np.ndarray,
    response: np.ndarray,
    mu: float,
    lambda1: float,
    s: float,
    learning_rate: float,
    beta1: float,
    beta2: float,
    iterations: int,
) -> np.ndarray:
    current = np.asarray(weights, dtype=float).copy()
    first_moment = np.zeros_like(current)
    second_moment = np.zeros_like(current)
    np.fill_diagonal(current, 0.0)

    for step_idx in range(1, iterations + 1):
        gradient = _dagma_gradient(
            current,
            design=design,
            response=response,
            mu=mu,
            lambda1=lambda1,
            s=s,
        )
        if not np.isfinite(gradient).all():
            break

        first_moment = beta1 * first_moment + (1.0 - beta1) * gradient
        second_moment = beta2 * second_moment + (1.0 - beta2) * gradient * gradient
        first_hat = first_moment / (1.0 - beta1**step_idx)
        second_hat = second_moment / (1.0 - beta2**step_idx)
        update = first_hat / (np.sqrt(second_hat) + EPSILON)
        candidate_step = learning_rate

        for _ in range(12):
            candidate = current - candidate_step * update
            np.fill_diagonal(candidate, 0.0)
            if np.isfinite(dagma_logdet_acyclicity(candidate, s=s)):
                current = candidate
                break
            candidate_step *= 0.5
        else:
            break

    np.fill_diagonal(current, 0.0)
    return current


def _dagma_gradient(
    weights: np.ndarray,
    *,
    design: np.ndarray,
    response: np.ndarray,
    mu: float,
    lambda1: float,
    s: float,
) -> np.ndarray:
    h_gradient = _dagma_acyclicity_gradient(weights, s=s)
    residual = design @ weights - response
    loss_gradient = design.T @ residual / max(len(design), 1)
    gradient = mu * (loss_gradient + lambda1 * np.sign(weights)) + h_gradient
    np.fill_diagonal(gradient, 0.0)
    return gradient


def _dagma_acyclicity_gradient(weights: np.ndarray, *, s: float) -> np.ndarray:
    dim = weights.shape[0]
    shifted = s * np.eye(dim, dtype=float) - weights * weights
    sign, logdet = np.linalg.slogdet(shifted)
    if sign <= 0.0 or not np.isfinite(logdet):
        return np.full_like(weights, np.nan)
    inverse_transpose = np.linalg.inv(shifted).T
    gradient = 2.0 * weights * inverse_transpose
    np.fill_diagonal(gradient, 0.0)
    return gradient


def _threshold_acyclic_adjacency(scores: np.ndarray, *, threshold: float) -> np.ndarray:
    adjacency = np.zeros_like(scores, dtype=float)
    candidates: list[tuple[float, int, int]] = []
    for effect_idx, cause_idx in zip(*np.where(scores >= threshold), strict=False):
        if effect_idx != cause_idx:
            candidates.append((float(scores[effect_idx, cause_idx]), effect_idx, cause_idx))
    candidates.sort(key=lambda row: (-row[0], row[1], row[2]))

    for _, effect_idx, cause_idx in candidates:
        if not _has_directed_path(adjacency, start=effect_idx, target=cause_idx):
            adjacency[effect_idx, cause_idx] = 1.0
    return adjacency


def _has_directed_path(adjacency: np.ndarray, *, start: int, target: int) -> bool:
    stack = [start]
    seen: set[int] = set()
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        for child in np.flatnonzero(adjacency[:, node] > 0.0):
            child_idx = int(child)
            if child_idx == target:
                return True
            stack.append(child_idx)
    return False


def _is_strictly_triangular(matrix: np.ndarray) -> bool:
    return bool(
        np.allclose(matrix, np.tril(matrix, k=-1))
        or np.allclose(matrix, np.triu(matrix, k=1))
    )


def _normalize_fit_indices(
    fit_indices: np.ndarray | None,
    n_rows: int,
) -> np.ndarray:
    if fit_indices is None:
        return np.arange(n_rows, dtype=int)
    indices = np.asarray(fit_indices, dtype=int)
    if len(indices) == 0:
        raise ValueError("fit_indices must not be empty")
    if indices.min() < 0 or indices.max() >= n_rows:
        raise ValueError("fit_indices contains out-of-range row positions")
    return indices
