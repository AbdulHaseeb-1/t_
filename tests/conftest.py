from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def market_frame() -> pd.DataFrame:
    rng = np.random.default_rng(42)
    rows = 160
    drift = np.linspace(0.0, 0.015, rows)
    seasonal = 0.002 * np.sin(np.linspace(0.0, 8.0 * np.pi, rows))
    close = 1.10 + drift + seasonal + rng.normal(0.0, 0.0004, rows)
    open_ = close + rng.normal(0.0, 0.0002, rows)
    spread = np.abs(rng.normal(0.0005, 0.0001, rows))
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    volume = 1000.0 + 20.0 * np.cos(np.linspace(0.0, 4.0 * np.pi, rows))

    return pd.DataFrame(
        {
            "exchange": "synthetic",
            "symbol": "EURUSD",
            "interval": "1h",
            "datetime": pd.date_range("2026-01-01", periods=rows, freq="h"),
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


@pytest.fixture
def causal_frame() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    rows = 220
    x = rng.normal(0.0, 1.0, rows)
    y = np.zeros(rows)
    y[1:] = 0.9 * x[:-1] + rng.normal(0.0, 0.04, rows - 1)
    z = rng.normal(0.0, 1.0, rows)
    return pd.DataFrame({"x": x, "y": y, "z": z})
