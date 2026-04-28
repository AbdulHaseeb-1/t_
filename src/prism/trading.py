from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from src.prism.config import PRISMConfig


TradeSide = Literal["long", "short", "flat"]


@dataclass(frozen=True)
class TradeDecision:
    """Cost-aware one-step trade decision derived from PRISM output."""

    signal: int
    side: TradeSide
    predicted_return: float
    probability: float
    lower_bound: float
    upper_bound: float
    one_way_cost: float
    round_trip_cost: float
    minimum_required_edge: float
    edge_after_cost: float
    probability_edge: float
    interval_crosses_zero: bool
    tradable: bool
    reason: str

    def to_trace(self) -> dict[str, float | int | bool | str]:
        return {
            "signal": self.signal,
            "side": self.side,
            "predicted_return": self.predicted_return,
            "probability": self.probability,
            "lower_bound": self.lower_bound,
            "upper_bound": self.upper_bound,
            "one_way_cost": self.one_way_cost,
            "round_trip_cost": self.round_trip_cost,
            "minimum_required_edge": self.minimum_required_edge,
            "edge_after_cost": self.edge_after_cost,
            "probability_edge": self.probability_edge,
            "interval_crosses_zero": self.interval_crosses_zero,
            "tradable": self.tradable,
            "reason": self.reason,
        }


def transaction_cost_as_return(config: PRISMConfig) -> float:
    """Convert one-way transaction cost from basis points to fractional return."""
    return float(config.transaction_cost_bps) / 10_000.0


def round_trip_cost_as_return(config: PRISMConfig) -> float:
    return 2.0 * transaction_cost_as_return(config)


def generate_trade_decision(
    *,
    prediction: float,
    probability: float,
    uncertainty_bounds: tuple[float, float],
    config: PRISMConfig,
) -> TradeDecision:
    """Convert a probabilistic return forecast into a cost-aware position.

    The decision is intentionally conservative: it trades only when the
    predicted absolute return clears the estimated round-trip cost plus any
    configured safety margin, and the probability agrees with the direction.
    """
    lower, upper = (float(uncertainty_bounds[0]), float(uncertainty_bounds[1]))
    prediction = float(prediction)
    probability = float(probability)
    values = (prediction, probability, lower, upper)
    if not all(np.isfinite(value) for value in values):
        raise ValueError("prediction, probability, and bounds must be finite")
    if lower > upper:
        raise ValueError("uncertainty_bounds must be ordered")
    if not 0.0 <= probability <= 1.0:
        raise ValueError("probability must be in [0, 1]")

    round_trip_cost = round_trip_cost_as_return(config)
    minimum_required_edge = round_trip_cost + float(config.min_signal_return)
    probability_edge = abs(probability - 0.5)
    edge_after_cost = abs(prediction) - round_trip_cost
    interval_crosses_zero = lower <= 0.0 <= upper

    if abs(prediction) <= minimum_required_edge:
        return _flat_decision(
            prediction,
            probability,
            lower,
            upper,
            config,
            edge_after_cost,
            probability_edge,
            interval_crosses_zero,
            "edge_below_cost_floor",
        )
    if probability_edge < config.min_signal_probability_edge:
        return _flat_decision(
            prediction,
            probability,
            lower,
            upper,
            config,
            edge_after_cost,
            probability_edge,
            interval_crosses_zero,
            "probability_edge_too_small",
        )
    if config.require_interval_confirmation and interval_crosses_zero:
        return _flat_decision(
            prediction,
            probability,
            lower,
            upper,
            config,
            edge_after_cost,
            probability_edge,
            interval_crosses_zero,
            "uncertainty_interval_crosses_zero",
        )

    if prediction > 0.0 and probability >= 0.5 + config.min_signal_probability_edge:
        signal = 1
        side: TradeSide = "long"
    elif prediction < 0.0 and probability <= 0.5 - config.min_signal_probability_edge:
        signal = -1
        side = "short"
    else:
        return _flat_decision(
            prediction,
            probability,
            lower,
            upper,
            config,
            edge_after_cost,
            probability_edge,
            interval_crosses_zero,
            "prediction_probability_disagree",
        )

    return TradeDecision(
        signal=signal,
        side=side,
        predicted_return=prediction,
        probability=probability,
        lower_bound=lower,
        upper_bound=upper,
        one_way_cost=transaction_cost_as_return(config),
        round_trip_cost=round_trip_cost,
        minimum_required_edge=minimum_required_edge,
        edge_after_cost=edge_after_cost,
        probability_edge=probability_edge,
        interval_crosses_zero=interval_crosses_zero,
        tradable=True,
        reason="edge_clears_cost_floor",
    )


def _flat_decision(
    prediction: float,
    probability: float,
    lower: float,
    upper: float,
    config: PRISMConfig,
    edge_after_cost: float,
    probability_edge: float,
    interval_crosses_zero: bool,
    reason: str,
) -> TradeDecision:
    round_trip_cost = round_trip_cost_as_return(config)
    return TradeDecision(
        signal=0,
        side="flat",
        predicted_return=prediction,
        probability=probability,
        lower_bound=lower,
        upper_bound=upper,
        one_way_cost=transaction_cost_as_return(config),
        round_trip_cost=round_trip_cost,
        minimum_required_edge=round_trip_cost + float(config.min_signal_return),
        edge_after_cost=edge_after_cost,
        probability_edge=probability_edge,
        interval_crosses_zero=interval_crosses_zero,
        tradable=False,
        reason=reason,
    )
