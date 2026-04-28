from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import EPSILON, replace_non_finite, safe_corrcoef
from src.prism.types import CausalGraph, SymbolicRule


class SymbolicRuleInducer:
    """L3 deterministic IF-THEN rules with hard DAG gating."""

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config

    def induce(
        self,
        frame: pd.DataFrame,
        feature_names: tuple[str, ...],
        target_returns: np.ndarray,
        causal_graph: CausalGraph,
        fit_indices: np.ndarray | None = None,
    ) -> list[SymbolicRule]:
        values = replace_non_finite(frame.loc[:, feature_names].to_numpy(dtype=float))
        target_returns = np.asarray(target_returns, dtype=float)
        fit_indices = _normalize_fit_indices(fit_indices, len(values))
        fit_mask = np.zeros(len(values), dtype=bool)
        fit_mask[fit_indices] = True
        labeled_train_mask = fit_mask & np.isfinite(target_returns)
        if labeled_train_mask.sum() < 3:
            raise ValueError("At least three finite target returns are required")
        target_idx = _feature_index(
            causal_graph.feature_names,
            self.config.causal_target_feature,
        )
        candidates: list[SymbolicRule] = []

        for feature_idx, feature in enumerate(feature_names):
            if feature == self.config.causal_target_feature:
                continue

            column = values[:, feature_idx]
            graph_feature_idx = _feature_index(causal_graph.feature_names, feature)
            causal_supported = bool(causal_graph.adjacency[target_idx, graph_feature_idx] > 0.0)
            candidates.extend(
                _candidate_rules_for_feature(
                    feature=feature,
                    target_feature=causal_graph.feature_names[target_idx],
                    column=column,
                    target_returns=target_returns,
                    labeled_mask=labeled_train_mask,
                    causal_supported=causal_supported,
                    start_rule_id=len(candidates) + 1,
                )
            )

        candidates.sort(
            key=lambda rule: (rule.active, rule.condition_met, rule.confidence),
            reverse=True,
        )
        selected = candidates[: self.config.num_rules]
        return [
            SymbolicRule(
                rule_id=idx + 1,
                feature=rule.feature,
                target_feature=rule.target_feature,
                operator=rule.operator,
                threshold=rule.threshold,
                observed_value=rule.observed_value,
                consequence=rule.consequence,
                confidence=rule.confidence,
                condition_met=rule.condition_met,
                causal_supported=rule.causal_supported,
                active=rule.active,
            )
            for idx, rule in enumerate(selected)
        ]


def _feature_index(feature_names: tuple[str, ...], preferred: str) -> int:
    if preferred in feature_names:
        return feature_names.index(preferred)
    return len(feature_names) - 1


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


def _candidate_rules_for_feature(
    *,
    feature: str,
    target_feature: str,
    column: np.ndarray,
    target_returns: np.ndarray,
    labeled_mask: np.ndarray,
    causal_supported: bool,
    start_rule_id: int,
) -> list[SymbolicRule]:
    labeled_column = column[labeled_mask]
    labeled_target = target_returns[labeled_mask]
    target_std = float(np.nanstd(labeled_target))
    observed_value = float(column[-1])
    candidates: list[SymbolicRule] = []

    for operator, quantile in (("<=", 0.25), (">", 0.75), ("<=", 0.5), (">", 0.5)):
        threshold = float(np.nanquantile(labeled_column, quantile))
        condition_history = (
            labeled_column <= threshold if operator == "<=" else labeled_column > threshold
        )
        if condition_history.sum() < 3 or (~condition_history).sum() < 3:
            continue

        condition_mean = float(np.nanmean(labeled_target[condition_history]))
        complement_mean = float(np.nanmean(labeled_target[~condition_history]))
        lift = condition_mean - complement_mean
        confidence = float(min(1.0, abs(lift) / max(target_std, EPSILON)))
        condition_met = observed_value <= threshold if operator == "<=" else observed_value > threshold
        candidates.append(
            SymbolicRule(
                rule_id=start_rule_id + len(candidates),
                feature=feature,
                target_feature=target_feature,
                operator=operator,
                threshold=threshold,
                observed_value=observed_value,
                consequence=condition_mean,
                confidence=confidence,
                condition_met=bool(condition_met),
                causal_supported=causal_supported,
                active=bool(condition_met and causal_supported),
            )
        )

    if candidates:
        return candidates

    correlation = safe_corrcoef(labeled_column, labeled_target)
    threshold = float(np.nanmedian(labeled_column))
    operator = ">" if correlation >= 0.0 else "<="
    condition_met = observed_value > threshold if operator == ">" else observed_value <= threshold
    return [
        SymbolicRule(
            rule_id=start_rule_id,
            feature=feature,
            target_feature=target_feature,
            operator=operator,
            threshold=threshold,
            observed_value=observed_value,
            consequence=float(np.nanmean(labeled_target)),
            confidence=float(min(1.0, abs(correlation))),
            condition_met=bool(condition_met),
            causal_supported=causal_supported,
            active=bool(condition_met and causal_supported),
        )
    ]
