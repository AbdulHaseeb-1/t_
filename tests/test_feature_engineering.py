from __future__ import annotations

import numpy as np

import pandas as pd

from src.features.feature_engineering import calculate_all_features, trend_strength
from src.prism.config import CRYPTO_FEATURE_COLUMNS, PRISMConfig


def test_calculate_all_features_adds_btc_liquidity_and_momentum_features(market_frame):
    frame = market_frame.copy()
    frame["quote_asset_volume"] = frame["close"] * frame["volume"]
    frame["number_of_trades"] = np.linspace(100.0, 400.0, len(frame))
    frame["taker_buy_base_volume"] = frame["volume"] * 0.55
    frame["taker_buy_quote_volume"] = frame["quote_asset_volume"] * 0.55

    features = calculate_all_features(frame)

    expected_columns = {
        "return_lag_24",
        "realized_volatility_24",
        "atr_14_pct",
        "ema_distance_50",
        "ema_spread_12_50",
        "ema_spread_50_200",
        "macd_hist",
        "bollinger_percent_b",
        "breakout_pressure_20",
        "breakdown_pressure_20",
        "rsi_14",
        "range_pressure",
        "body_pressure",
        "wick_imbalance",
        "trend_pressure",
        "mean_reversion_pressure",
        "momentum_quality_6",
        "momentum_quality_24",
        "volatility_regime_5_20",
        "volatility_regime_20_60",
        "volatility_shock",
        "liquidity_adjusted_return",
        "volume_zscore_20",
        "quote_volume_zscore_20",
        "trade_count_zscore_20",
        "taker_buy_ratio",
        "taker_buy_imbalance",
        "taker_buy_pressure",
        "order_flow_absorption",
        "hour_sin",
        "day_of_week_cos",
    }
    assert expected_columns.issubset(features.columns)
    assert np.isfinite(features["taker_buy_ratio"].dropna()).all()
    assert features["taker_buy_ratio"].dropna().between(0.0, 1.0).all()
    assert features["range_pressure"].dropna().between(-1.0, 1.0).all()


def test_causal_pressure_features_are_past_only(market_frame):
    frame = market_frame.copy()
    frame["quote_asset_volume"] = frame["close"] * frame["volume"]
    frame["number_of_trades"] = np.linspace(100.0, 400.0, len(frame))
    frame["taker_buy_base_volume"] = frame["volume"] * 0.55
    frame["taker_buy_quote_volume"] = frame["quote_asset_volume"] * 0.55

    baseline = calculate_all_features(frame)
    mutated = frame.copy()
    mutated.loc[mutated.index > 80, ["open", "high", "low", "close"]] *= 10.0
    mutated.loc[mutated.index > 80, "volume"] *= 3.0
    changed = calculate_all_features(mutated)
    columns = [
        "trend_pressure",
        "range_pressure",
        "body_pressure",
        "wick_imbalance",
        "volatility_regime_20_60",
        "volatility_shock",
        "taker_buy_pressure",
        "order_flow_absorption",
    ]

    pd.testing.assert_frame_equal(
        baseline.loc[:80, columns],
        changed.loc[:80, columns],
        check_dtype=False,
    )


def test_default_crypto_features_are_curated_for_causal_dag():
    feature_set = set(CRYPTO_FEATURE_COLUMNS)
    config = PRISMConfig()

    assert "close" not in feature_set
    assert {"trend_pressure", "range_pressure", "taker_buy_pressure"}.issubset(
        feature_set,
    )
    assert set(config.required_feature_columns).issubset(feature_set)
    assert len(CRYPTO_FEATURE_COLUMNS) < 40


def test_trend_strength_is_dimensionless_volatility_normalized():
    frame = pd.DataFrame(
        {
            "close": np.linspace(100.0, 124.0, 25),
            "log_return": np.full(25, 0.01),
            "volatility": np.full(25, 0.02),
        },
    )

    features = trend_strength(frame, trend_window=20)
    latest_sma = frame["close"].rolling(20).mean().iloc[-1]
    expected = ((frame["close"].iloc[-1] - latest_sma) / latest_sma) / 0.02

    assert features["trend_strength"].iloc[-1] == expected
