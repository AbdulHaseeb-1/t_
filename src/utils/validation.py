from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LEGACY_RAW_DATA_PATH = PROJECT_ROOT / "data" / "raw" / "eurusd_1000_candles.csv"
BTC_DATA_PATH = PROJECT_ROOT / "data" / "raw" / "binance_BTCUSDT_1h.csv"
RAW_DATA_PATH = Path(
    os.environ.get(
        "PRISM_DATA_PATH",
        str(BTC_DATA_PATH if BTC_DATA_PATH.exists() else LEGACY_RAW_DATA_PATH),
    )
)
REQUIRED_OHLCV_COLUMNS = ("datetime", "open", "high", "low", "close", "volume")
PRICE_COLUMNS = ("open", "high", "low", "close")


def load_and_validate_data(raw_data_path: Path = RAW_DATA_PATH) -> pd.DataFrame:
    if not raw_data_path.exists():
        raise FileNotFoundError(f"Raw data file does not exist: {raw_data_path}")
    data = pd.read_csv(raw_data_path)
    return validate_ohlcv_frame(data, source=str(raw_data_path))


def validate_ohlcv_frame(data: pd.DataFrame, source: str = "<memory>") -> pd.DataFrame:
    """Validate and normalize an OHLCV candle frame.

    The pipeline treats malformed candles as hard failures. Silent coercion is
    dangerous for trading systems because a bad high/low or timestamp can leak
    into every downstream explanation.
    """
    missing = [column for column in REQUIRED_OHLCV_COLUMNS if column not in data.columns]
    if missing:
        raise ValueError(f"{source}: missing required columns: {missing}")
    if data.empty:
        raise ValueError(f"{source}: data is empty")

    df = data.drop_duplicates().copy()
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce", format="mixed")
    if df["datetime"].isna().any():
        raise ValueError(f"{source}: datetime contains missing or invalid values")
    if df["datetime"].duplicated().any():
        duplicates = df.loc[df["datetime"].duplicated(), "datetime"].dt.strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        raise ValueError(
            f"{source}: duplicate candle timestamps: {duplicates.head(3).tolist()}"
        )

    for column in (*PRICE_COLUMNS, "volume"):
        df[column] = pd.to_numeric(df[column], errors="coerce")
        if df[column].isna().any() or not np.isfinite(df[column].to_numpy()).all():
            raise ValueError(f"{source}: {column} contains missing or non-finite values")

    for column in PRICE_COLUMNS:
        if (df[column] <= 0.0).any():
            raise ValueError(f"{source}: {column} must be positive")
    if (df["volume"] < 0.0).any():
        raise ValueError(f"{source}: volume must be non-negative")

    expected_high = df.loc[:, ("open", "low", "close")].max(axis=1)
    expected_low = df.loc[:, ("open", "high", "close")].min(axis=1)
    if (df["high"] < expected_high).any():
        raise ValueError(f"{source}: high must be >= open, low, and close")
    if (df["low"] > expected_low).any():
        raise ValueError(f"{source}: low must be <= open, high, and close")

    return df.sort_values("datetime").reset_index(drop=True)


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    df = load_and_validate_data(data_path)
    print(f"Loaded {len(df)} rows from: {data_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate an OHLCV CSV file.")
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()
