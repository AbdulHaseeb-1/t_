from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.backtest.directional_paper_trading import _filter_data_window
from src.prism.directional_accuracy import DirectionalVariant, DirectionalWindow
from src.prism.directional_paper_trading import (
    DirectionalPaperTradingConfig,
    apply_directional_paper_strategy,
    run_directional_paper_trading_validation,
    write_directional_paper_trading_outputs,
)


def test_directional_paper_strategy_applies_accuracy_and_exposure_limits():
    records = _selected_records(rows=6)
    records.loc[0, "selector_training_directional_accuracy"] = np.nan
    records.loc[1:, "selector_training_directional_accuracy"] = 0.75

    traded = apply_directional_paper_strategy(
        records,
        DirectionalPaperTradingConfig(
            transaction_cost_bps=0.0,
            min_selector_accuracy=0.60,
            min_abs_prediction=0.0,
            max_exposure_fraction=0.5,
            max_drawdown=1.0,
        ),
    )

    assert traded.loc[0, "trade_reason"] == "selector_accuracy_too_low"
    assert traded["trade_signal"].abs().sum() == 3
    assert traded["trade_reason"].tolist().count("max_exposure_reached") == 2


def test_directional_paper_strategy_deducts_round_trip_costs():
    records = _selected_records(rows=1)

    traded = apply_directional_paper_strategy(
        records,
        DirectionalPaperTradingConfig(
            transaction_cost_bps=1.0,
            min_selector_accuracy=0.60,
            min_abs_prediction=0.0,
            max_exposure_fraction=1.0,
            max_drawdown=1.0,
        ),
    )

    assert traded.loc[0, "strategy_cost"] == pytest.approx(0.0002)
    assert traded.loc[0, "strategy_return"] == pytest.approx(
        records.loc[0, "actual_return"] - 0.0002,
    )


def test_directional_paper_strategy_drawdown_stop_blocks_later_trades():
    records = _selected_records(rows=4)
    records.loc[0, "actual_return"] = -0.02

    traded = apply_directional_paper_strategy(
        records,
        DirectionalPaperTradingConfig(
            transaction_cost_bps=0.0,
            min_selector_accuracy=0.60,
            min_abs_prediction=0.0,
            max_exposure_fraction=1.0,
            max_drawdown=0.01,
        ),
    )

    assert traded.loc[0, "trade_reason"] == "risk_gate_passed"
    assert set(traded.loc[1:, "trade_reason"]) == {"max_drawdown_stop"}


def test_directional_paper_validation_and_outputs(market_frame):
    variants = (
        DirectionalVariant(
            "return_model",
            training_window=50,
            max_features=4,
            ridge_penalty=1e-3,
        ),
    )

    report = run_directional_paper_trading_validation(
        market_frame,
        evaluation_windows=(DirectionalWindow("unit", start_index=40, step=20, max_windows=2),),
        variants=variants,
        selector_lookback=2,
        min_selection_windows=1,
        default_variant_id="return_model",
        paper_config=DirectionalPaperTradingConfig(max_drawdown=1.0),
    )
    paths = write_directional_paper_trading_outputs(
        report,
        output_dir=Path("reports/test_directional_paper_outputs"),
    )

    assert set(report.summary["strategy_id"]) == {"strict_directional_paper"}
    assert "zero_mae" not in report.summary.columns
    assert "strategy_trade_count" in report.summary.columns
    assert "start_datetime" in report.summary.columns
    assert "end_datetime" in report.summary.columns
    assert paths["paper_records"].exists()
    assert paths["summary"].exists()
    assert paths["plot"].exists()


def test_directional_paper_config_rejects_invalid_limits():
    with pytest.raises(ValueError, match="max_exposure_fraction"):
        apply_directional_paper_strategy(
            _selected_records(rows=1),
            DirectionalPaperTradingConfig(max_exposure_fraction=1.5),
        )


def test_filter_data_window_supports_latest_years_and_dates(market_frame):
    filtered = _filter_data_window(
        market_frame,
        start_date=None,
        end_date=None,
        last_years=1,
    )

    assert filtered["datetime"].min() >= (
        pd.to_datetime(market_frame["datetime"]).max() - pd.DateOffset(years=1)
    )

    dated = _filter_data_window(
        market_frame,
        start_date=str(market_frame.loc[10, "datetime"].date()),
        end_date=str(market_frame.loc[20, "datetime"].date()),
        last_years=None,
    )

    assert not dated.empty
    assert pd.to_datetime(dated["datetime"]).min().date() >= market_frame.loc[
        10,
        "datetime",
    ].date()


def _selected_records(rows: int) -> pd.DataFrame:
    prediction = np.full(rows, 0.001)
    actual = np.full(rows, 0.002)
    return pd.DataFrame(
        {
            "evaluation_id": "unit",
            "row_index": np.arange(rows),
            "datetime": pd.date_range("2026-01-01", periods=rows, freq="h"),
            "prediction": prediction,
            "probability": np.full(rows, 0.55),
            "actual_return": actual,
            "zero_prediction": 0.0,
            "persistence_prediction": 0.0,
            "lower_bound": -0.01,
            "upper_bound": 0.01,
            "interval_hit": True,
            "direction_hit": True,
            "zero_direction_hit": True,
            "persistence_direction_hit": True,
            "selector_training_directional_accuracy": 0.75,
            "selector_training_mae": 0.001,
        }
    )
