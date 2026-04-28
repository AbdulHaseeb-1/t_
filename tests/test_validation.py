from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.utils.validation import validate_ohlcv_frame


def test_validate_ohlcv_frame_sorts_and_preserves_valid_candles(market_frame):
    shuffled = market_frame.sample(frac=1.0, random_state=11)

    validated = validate_ohlcv_frame(shuffled)

    assert validated["datetime"].is_monotonic_increasing
    assert len(validated) == len(market_frame)
    assert validated[["open", "high", "low", "close", "volume"]].notna().all().all()


def test_validate_ohlcv_frame_rejects_missing_required_columns(market_frame):
    invalid = market_frame.drop(columns=["close"])

    with pytest.raises(ValueError, match="missing required columns"):
        validate_ohlcv_frame(invalid)


def test_validate_ohlcv_frame_rejects_invalid_datetime(market_frame):
    invalid = market_frame.copy()
    invalid["datetime"] = invalid["datetime"].astype(str)
    invalid.loc[0, "datetime"] = "not-a-date"

    with pytest.raises(ValueError, match="datetime"):
        validate_ohlcv_frame(invalid)


def test_validate_ohlcv_frame_rejects_duplicate_timestamps(market_frame):
    invalid = pd.concat([market_frame, market_frame.iloc[[0]]], ignore_index=True)
    invalid.loc[len(invalid) - 1, "close"] = invalid.loc[len(invalid) - 1, "close"] + 1.0

    with pytest.raises(ValueError, match="duplicate candle timestamps"):
        validate_ohlcv_frame(invalid)


def test_validate_ohlcv_frame_rejects_non_finite_numeric_values(market_frame):
    invalid = market_frame.copy()
    invalid.loc[0, "open"] = np.inf

    with pytest.raises(ValueError, match="open contains"):
        validate_ohlcv_frame(invalid)


def test_validate_ohlcv_frame_rejects_broken_high_low_invariants(market_frame):
    invalid_high = market_frame.copy()
    invalid_high.loc[0, "high"] = invalid_high.loc[0, "low"] - 0.01

    with pytest.raises(ValueError, match="high must be"):
        validate_ohlcv_frame(invalid_high)

    invalid_low = market_frame.copy()
    invalid_low.loc[0, "low"] = min(
        invalid_low.loc[0, "open"],
        invalid_low.loc[0, "close"],
    ) + 0.00001

    with pytest.raises(ValueError, match="low must be"):
        validate_ohlcv_frame(invalid_low)
