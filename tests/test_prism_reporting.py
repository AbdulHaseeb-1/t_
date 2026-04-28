from __future__ import annotations

import pandas as pd

from src.prism.reporting import (
    HISTORY_COLUMNS,
    build_backtest_history_figure,
    update_backtest_history,
)


def test_update_backtest_history_appends_metrics():
    metrics = {
        "n_windows": 4.0,
        "directional_accuracy": 0.75,
        "interval_coverage": 1.0,
        "mae": 0.001,
        "rmse": 0.002,
        "mean_probability": 0.55,
        "strategy_cumulative_return": 0.01,
        "gross_strategy_cumulative_return": 0.012,
        "strategy_mean_return": 0.0025,
        "strategy_return_volatility": 0.001,
        "strategy_sharpe_like": 5.0,
        "strategy_max_drawdown": 0.002,
        "strategy_exposure": 0.5,
        "strategy_trade_count": 2.0,
        "strategy_win_rate": 0.5,
        "strategy_total_cost": 0.001,
        "best_baseline_mae": 0.0015,
        "best_baseline_rmse": 0.0025,
        "mae_improvement_vs_best_baseline": 0.0005,
        "rmse_improvement_vs_best_baseline": 0.0005,
    }
    history = pd.DataFrame(columns=HISTORY_COLUMNS)

    updated = update_backtest_history(
        history,
        metrics,
        label="test_run",
        timestamp_utc="2026-04-28T00:00:00+00:00",
    )

    assert len(updated) == 1
    assert tuple(updated.columns) == HISTORY_COLUMNS
    assert updated.loc[0, "label"] == "test_run"
    assert updated.loc[0, "mae"] == 0.001
    assert updated.loc[0, "strategy_cumulative_return"] == 0.01


def test_build_backtest_history_figure_handles_multiple_rows():
    history = pd.DataFrame(
        [
            {
                "timestamp_utc": "2026-04-28T00:00:00+00:00",
                "label": "a",
                "n_windows": 4.0,
                "directional_accuracy": 0.5,
                "interval_coverage": 0.9,
                "mae": 0.003,
                "rmse": 0.004,
                "mean_probability": 0.5,
                "strategy_cumulative_return": -0.002,
                "gross_strategy_cumulative_return": 0.001,
                "strategy_mean_return": -0.0005,
                "strategy_return_volatility": 0.001,
                "strategy_sharpe_like": -1.0,
                "strategy_max_drawdown": 0.003,
                "strategy_exposure": 0.25,
                "strategy_trade_count": 1.0,
                "strategy_win_rate": 0.0,
                "strategy_total_cost": 0.003,
                "best_baseline_mae": 0.0035,
                "best_baseline_rmse": 0.0045,
                "mae_improvement_vs_best_baseline": 0.0005,
                "rmse_improvement_vs_best_baseline": 0.0005,
            },
            {
                "timestamp_utc": "2026-04-28T01:00:00+00:00",
                "label": "b",
                "n_windows": 4.0,
                "directional_accuracy": 0.75,
                "interval_coverage": 1.0,
                "mae": 0.002,
                "rmse": 0.003,
                "mean_probability": 0.55,
                "strategy_cumulative_return": 0.004,
                "gross_strategy_cumulative_return": 0.008,
                "strategy_mean_return": 0.001,
                "strategy_return_volatility": 0.001,
                "strategy_sharpe_like": 2.0,
                "strategy_max_drawdown": 0.001,
                "strategy_exposure": 0.5,
                "strategy_trade_count": 2.0,
                "strategy_win_rate": 0.5,
                "strategy_total_cost": 0.004,
                "best_baseline_mae": 0.0025,
                "best_baseline_rmse": 0.0035,
                "mae_improvement_vs_best_baseline": 0.0005,
                "rmse_improvement_vs_best_baseline": 0.0005,
            },
        ]
    )
    figure = build_backtest_history_figure(history)
    try:
        titles = [axis.get_title(loc="left") for axis in figure.axes]
        assert "Prediction Error vs Baselines, Lower Is Better" in titles
        assert "Hit Rates, Higher Is Better" in titles
        assert "Cost-Aware Trading, Higher Is Better" in titles
    finally:
        import matplotlib.pyplot as plt

        plt.close(figure)
