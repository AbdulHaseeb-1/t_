from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


def _clean_value(value: Any) -> Any:
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return [_clean_value(item) for item in value.tolist()]
    if isinstance(value, tuple):
        return tuple(_clean_value(item) for item in value)
    if isinstance(value, list):
        return [_clean_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _clean_value(item) for key, item in value.items()}
    return value


@dataclass(frozen=True)
class PRISMOutput:
    """The documented PRISM output contract."""

    prediction: float
    probability: float
    reasoning_trace: dict[str, Any]
    uncertainty_bounds: tuple[float, float]

    def as_tuple(self) -> tuple[float, float, dict[str, Any], tuple[float, float]]:
        return (
            self.prediction,
            self.probability,
            self.reasoning_trace,
            self.uncertainty_bounds,
        )

    def to_dict(self) -> dict[str, Any]:
        return _clean_value(
            {
                "prediction": self.prediction,
                "probability": self.probability,
                "reasoning_trace": self.reasoning_trace,
                "uncertainty_bounds": self.uncertainty_bounds,
            }
        )

    def validate(self) -> None:
        lo, hi = self.uncertainty_bounds
        if not np.isfinite(self.prediction):
            raise ValueError("prediction must be finite")
        if not 0.0 <= self.probability <= 1.0:
            raise ValueError("probability must be in [0, 1]")
        if not np.isfinite(lo) or not np.isfinite(hi) or lo > hi:
            raise ValueError("uncertainty_bounds must be finite and ordered")
        if not isinstance(self.reasoning_trace, dict) or not self.reasoning_trace:
            raise ValueError("reasoning_trace must be a non-empty dictionary")


@dataclass(frozen=True)
class ModalityEncoding:
    values: np.ndarray
    feature_names: tuple[str, ...]
    modality: str
    diagnostics: dict[str, Any]


@dataclass(frozen=True)
class CausalGraph:
    adjacency: np.ndarray
    feature_names: tuple[str, ...]
    scores: np.ndarray
    acyclicity: float

    @property
    def edges(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for effect_idx, cause_idx in zip(*np.where(self.adjacency > 0.0), strict=False):
            results.append(
                {
                    "cause": self.feature_names[cause_idx],
                    "effect": self.feature_names[effect_idx],
                    "score": float(self.scores[effect_idx, cause_idx]),
                }
            )
        return results


@dataclass(frozen=True)
class TemporalAnalysis:
    embedding: np.ndarray
    granger_p_values: np.ndarray
    significant_edges: list[dict[str, Any]]


@dataclass(frozen=True)
class SymbolicRule:
    rule_id: int
    feature: str
    target_feature: str
    operator: str
    threshold: float
    observed_value: float
    consequence: float
    confidence: float
    condition_met: bool
    causal_supported: bool
    active: bool

    def to_trace(self) -> dict[str, Any]:
        comparator = ">" if self.operator == ">" else "<="
        target_label = (
            self.target_feature
            if self.target_feature == "target_return"
            else f"{self.target_feature}_next_return"
        )
        return {
            "id": self.rule_id,
            "text": (
                f"IF {self.feature} {comparator} {self.threshold:.8g} "
                f"THEN {target_label} = {self.consequence:.8g}"
            ),
            "feature": self.feature,
            "target_feature": self.target_feature,
            "observed_value": self.observed_value,
            "threshold": self.threshold,
            "consequence": self.consequence,
            "confidence": self.confidence,
            "condition_met": self.condition_met,
            "causal_supported": self.causal_supported,
            "active": self.active,
        }


@dataclass(frozen=True)
class ProbabilisticPrediction:
    prediction: float
    probability: float
    member_predictions: np.ndarray
    uncertainty_bounds: tuple[float, float]
    q_alpha: float
    metadata: dict[str, Any]
