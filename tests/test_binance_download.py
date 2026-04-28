from __future__ import annotations

import io
import zipfile
from datetime import date

import pandas as pd

from src.data.binance_download import (
    iter_binance_kline_files,
    parse_binance_kline_zip,
)
from src.utils.validation import validate_ohlcv_frame


def test_iter_binance_kline_files_uses_monthly_for_full_months_and_daily_for_partial():
    files = list(
        iter_binance_kline_files(
            symbol="BTCUSDT",
            interval="1h",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 2),
        )
    )

    periods = [item.period for item in files]
    assert periods[:2] == ["2026-01", "2026-02"]
    assert periods[2:] == ["2026-03-01", "2026-03-02"]
    assert "monthly/klines/BTCUSDT/1h" in files[0].url
    assert "daily/klines/BTCUSDT/1h" in files[-1].url


def test_parse_binance_kline_zip_handles_milliseconds_and_microseconds():
    archive = _make_kline_zip(
        [
            [
                "1735603200000",
                "94000.0",
                "95000.0",
                "93000.0",
                "94500.0",
                "100.0",
                "1735606799999",
                "9450000.0",
                "500",
                "60.0",
                "5670000.0",
                "0",
            ],
            [
                "1735689600000000",
                "94500.0",
                "95500.0",
                "94000.0",
                "95000.0",
                "110.0",
                "1735693199999999",
                "10450000.0",
                "550",
                "55.0",
                "5225000.0",
                "0",
            ],
        ]
    )

    frame = parse_binance_kline_zip(archive, symbol="btcusdt", interval="1h")
    validated = validate_ohlcv_frame(frame)

    assert len(validated) == 2
    assert validated.loc[0, "datetime"] == pd.Timestamp("2024-12-31 00:00:00")
    assert validated.loc[1, "datetime"] == pd.Timestamp("2025-01-01 00:00:00")
    assert validated.loc[0, "symbol"] == "BTCUSDT"
    assert validated.loc[1, "quote_asset_volume"] == 10450000.0


def _make_kline_zip(rows: list[list[str]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        body = "\n".join(",".join(row) for row in rows)
        archive.writestr("BTCUSDT-1h-test.csv", body)
    return buffer.getvalue()
