from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import sigmoid
from src.prism.trading import generate_trade_decision
from src.prism.types import (
    CausalGraph,
    PRISMOutput,
    ProbabilisticPrediction,
    SymbolicRule,
    TemporalAnalysis,
)


class ReasoningFusionHead:
    """L5 concept bottleneck and reasoning trace assembly."""

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config

    def fuse(
        self,
        frame: pd.DataFrame,
        rules: list[SymbolicRule],
        causal_graph: CausalGraph,
        temporal: TemporalAnalysis,
        probabilistic: ProbabilisticPrediction,
    ) -> PRISMOutput:
        concepts = fus_concepts(frame, rules)
        active_rules = [rule for rule in rules if rule.active]
        rule_signal = (
            float(np.mean([rule.consequence * rule.confidence for rule in active_rules]))
            if active_rules
            else 0.0
        )
        concept_signal = float(np.mean(list(concepts.values())) - 0.5)
        adjustment = 0.2 * rule_signal + 0.05 * concept_signal * abs(
            probabilistic.prediction
        )
        prediction = float(probabilistic.prediction + adjustment)
        old_lo, old_hi = probabilistic.uncertainty_bounds
        half_width = max((old_hi - old_lo) / 2.0, 0.0)
        bounds = (prediction - half_width, prediction + half_width)
        scale = max(half_width, abs(prediction), 1e-12)
        probability = float(sigmoid(prediction / scale))
        trade_decision = generate_trade_decision(
            prediction=prediction,
            probability=probability,
            uncertainty_bounds=bounds,
            config=self.config,
        )

        trace = {
            "output_contract": "(prediction, probability, reasoning_trace, uncertainty_bounds)",
            "active_concepts": {
                key: value
                for key, value in concepts.items()
                if value >= self.config.concept_threshold
            },
            "concepts": concepts,
            "active_rules": [rule.to_trace() for rule in active_rules],
            "all_rules": [rule.to_trace() for rule in rules],
            "causal_edges": causal_graph.edges,
            "temporal_edges": temporal.significant_edges[:10],
            "calibration": probabilistic.metadata,
            "trade_signal": trade_decision.to_trace(),
            "fusion": {
                "base_prediction": probabilistic.prediction,
                "rule_signal": rule_signal,
                "concept_signal": concept_signal,
                "adjustment": adjustment,
            },
        }
        output = PRISMOutput(
            prediction=prediction,
            probability=probability,
            reasoning_trace=trace,
            uncertainty_bounds=bounds,
        )
        output.validate()
        return output


def fus_concepts(frame: pd.DataFrame, rules: list[SymbolicRule]) -> dict[str, float]:
    if "close" in frame.columns:
        close = frame["close"].astype(float)
        returns = close.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
    elif "returns" in frame.columns:
        returns = (
            pd.to_numeric(frame["returns"], errors="coerce")
            .replace([np.inf, -np.inf], np.nan)
            .fillna(0.0)
        )
    elif "log_return" in frame.columns:
        returns = (
            np.expm1(pd.to_numeric(frame["log_return"], errors="coerce"))
            .replace([np.inf, -np.inf], np.nan)
            .fillna(0.0)
        )
    else:
        returns = pd.Series(np.zeros(len(frame), dtype=float), index=frame.index)
    recent_returns = returns.tail(8)
    volatility = float(recent_returns.std()) if len(recent_returns) > 1 else 0.0
    baseline_volatility = float(returns.std()) if len(returns) > 1 else 0.0
    active_ratio = (
        sum(1 for rule in rules if rule.active) / float(len(rules)) if rules else 0.0
    )

    if {"high", "low"}.issubset(frame.columns):
        latest_range = float((frame["high"].iloc[-1] - frame["low"].iloc[-1]))
        median_range = float((frame["high"] - frame["low"]).median())
    elif "volatility_shock" in frame.columns:
        latest_range = float(frame["volatility_shock"].iloc[-1])
        median_range = float(frame["volatility_shock"].median())
    elif "high_low_range_pct" in frame.columns:
        latest_range = float(frame["high_low_range_pct"].iloc[-1])
        median_range = float(frame["high_low_range_pct"].median())
    else:
        latest_range = 0.0
        median_range = 1.0

    return {
        "momentum_bullish": float(sigmoid(recent_returns.mean() * 1000.0)),
        "volatility_elevated": 1.0 if volatility > baseline_volatility else 0.0,
        "range_expanding": 1.0 if latest_range > median_range else 0.0,
        "rules_aligned": float(active_ratio),
    }
