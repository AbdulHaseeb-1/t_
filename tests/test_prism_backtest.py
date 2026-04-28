from __future__ import annotations

import numpy as np
import pytest

from src.prism import PRISMConfig
from src.prism.evaluation import walk_forward_backtest


def test_walk_forward_backtest_uses_past_only_windows(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        min_labeled_rows=35,
        granger_lags=(1,),
    )

    report = walk_forward_backtest(
        market_frame,
        config,
        start_index=80,
        step=5,
        max_windows=6,
    )

    assert len(report.records) == 6
    assert report.metrics["n_windows"] == 6.0
    assert np.isfinite(report.records["prediction"]).all()
    assert np.isfinite(report.records["actual_return"]).all()
    assert np.isfinite(report.records["zero_prediction"]).all()
    assert np.isfinite(report.records["persistence_prediction"]).all()
    assert np.isfinite(report.records["strategy_return"]).all()
    assert set(report.records["trade_signal"].unique()).issubset({-1, 0, 1})
    assert set(report.records["trade_side"].unique()).issubset({"long", "short", "flat"})
    assert set(report.records["interval_hit"].unique()).issubset({True, False})
    assert (
        report.records["trace_prediction_row"].to_numpy()
        == report.records["row_index"].to_numpy()
    ).all()


def test_walk_forward_backtest_metrics_are_bounded(market_frame):
    report = walk_forward_backtest(
        market_frame,
        PRISMConfig(
            feature_columns=("open", "high", "low", "close", "volume"),
            min_labeled_rows=35,
            granger_lags=(1,),
        ),
        start_index=90,
        step=10,
        max_windows=4,
    )

    assert report.metrics["mae"] >= 0.0
    assert report.metrics["rmse"] >= 0.0
    assert report.metrics["zero_mae"] >= 0.0
    assert report.metrics["persistence_mae"] >= 0.0
    assert report.metrics["strategy_max_drawdown"] >= 0.0
    assert report.metrics["strategy_trade_count"] >= 0.0
    assert report.metrics["strategy_total_cost"] >= 0.0
    assert report.metrics["best_baseline_mae"] == min(
        report.metrics["zero_mae"],
        report.metrics["persistence_mae"],
    )
    assert 0.0 <= report.metrics["directional_accuracy"] <= 1.0
    assert 0.0 <= report.metrics["zero_directional_accuracy"] <= 1.0
    assert 0.0 <= report.metrics["persistence_directional_accuracy"] <= 1.0
    assert 0.0 <= report.metrics["interval_coverage"] <= 1.0
    assert 0.0 <= report.metrics["mean_probability"] <= 1.0
    assert 0.0 <= report.metrics["strategy_exposure"] <= 1.0
    assert 0.0 <= report.metrics["strategy_win_rate"] <= 1.0


def test_walk_forward_backtest_rejects_invalid_window_args(market_frame):
    with pytest.raises(ValueError, match="step"):
        walk_forward_backtest(market_frame, step=0)

    with pytest.raises(ValueError, match="max_windows"):
        walk_forward_backtest(market_frame, max_windows=0)
