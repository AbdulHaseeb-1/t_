from __future__ import annotations

import pytest

from src.prism.config import PRISMConfig
from src.prism.trading import (
    generate_trade_decision,
    round_trip_cost_as_return,
    transaction_cost_as_return,
)


def test_transaction_cost_converts_basis_points_to_returns():
    config = PRISMConfig(transaction_cost_bps=0.5)

    assert transaction_cost_as_return(config) == pytest.approx(0.00005)
    assert round_trip_cost_as_return(config) == pytest.approx(0.0001)


def test_trade_decision_goes_long_when_edge_clears_cost_floor():
    config = PRISMConfig(transaction_cost_bps=0.5)

    decision = generate_trade_decision(
        prediction=0.001,
        probability=0.7,
        uncertainty_bounds=(0.0002, 0.002),
        config=config,
    )

    assert decision.signal == 1
    assert decision.side == "long"
    assert decision.tradable is True
    assert decision.edge_after_cost == pytest.approx(0.0009)
    assert decision.interval_crosses_zero is False


def test_trade_decision_goes_short_when_probability_confirms_direction():
    config = PRISMConfig(
        transaction_cost_bps=0.0,
        min_signal_probability_edge=0.1,
    )

    decision = generate_trade_decision(
        prediction=-0.002,
        probability=0.35,
        uncertainty_bounds=(-0.003, -0.001),
        config=config,
    )

    assert decision.signal == -1
    assert decision.side == "short"
    assert decision.reason == "edge_clears_cost_floor"


def test_trade_decision_stays_flat_when_edge_does_not_cover_cost():
    config = PRISMConfig(transaction_cost_bps=1.0)

    decision = generate_trade_decision(
        prediction=0.0001,
        probability=0.8,
        uncertainty_bounds=(-0.0001, 0.0003),
        config=config,
    )

    assert decision.signal == 0
    assert decision.side == "flat"
    assert decision.tradable is False
    assert decision.reason == "edge_below_cost_floor"


def test_trade_decision_stays_flat_when_probability_edge_is_too_small():
    config = PRISMConfig(
        transaction_cost_bps=0.0,
        min_signal_probability_edge=0.1,
    )

    decision = generate_trade_decision(
        prediction=0.002,
        probability=0.55,
        uncertainty_bounds=(0.001, 0.003),
        config=config,
    )

    assert decision.signal == 0
    assert decision.reason == "probability_edge_too_small"


def test_trade_decision_stays_flat_when_uncertainty_crosses_zero():
    config = PRISMConfig(
        transaction_cost_bps=0.0,
        require_interval_confirmation=True,
    )

    decision = generate_trade_decision(
        prediction=-0.002,
        probability=0.4,
        uncertainty_bounds=(-0.01, 0.01),
        config=config,
    )

    assert decision.signal == 0
    assert decision.reason == "uncertainty_interval_crosses_zero"


def test_trade_decision_rejects_invalid_bounds():
    with pytest.raises(ValueError, match="ordered"):
        generate_trade_decision(
            prediction=0.001,
            probability=0.6,
            uncertainty_bounds=(0.002, 0.001),
            config=PRISMConfig(),
        )


def test_config_rejects_invalid_trading_parameters():
    with pytest.raises(ValueError, match="transaction_cost_bps"):
        PRISMConfig(transaction_cost_bps=-0.1)

    with pytest.raises(ValueError, match="min_signal_probability_edge"):
        PRISMConfig(min_signal_probability_edge=0.5)

    with pytest.raises(ValueError, match="max_labeled_rows"):
        PRISMConfig(max_labeled_rows=10, min_labeled_rows=30)
