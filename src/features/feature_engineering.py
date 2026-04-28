from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.utils.validation import load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = PROJECT_ROOT / "data" / "processed" / "engineered.csv"
BTC_FEATURE_OUTPUT_PATH = PROJECT_ROOT / "data" / "processed" / "binance_BTCUSDT_1h_engineered.csv"
EPSILON = 1e-12


def calculate_returns(df: pd.DataFrame) -> pd.DataFrame:
    df["returns"] = df["close"].pct_change()
    return df


def log_returns(df: pd.DataFrame) -> pd.DataFrame:
    df["log_return"] = np.log(df["close"] / df["close"].shift(1))
    return df


def volatility(df: pd.DataFrame, volatility_window: int = 20) -> pd.DataFrame:
    """Rolling volatility using log returns."""
    if "log_return" not in df.columns:
        df = log_returns(df)

    df["volatility"] = df["log_return"].rolling(volatility_window).std()
    df[f"volatility_{volatility_window}"] = df["volatility"]
    return df


def trend_strength(df: pd.DataFrame, trend_window: int = 20) -> pd.DataFrame:
    """
    Trend strength = percentage distance from moving average divided by volatility.

    Positive = price above average
    Negative = price below average
    Strong value = stronger trend
    """
    if "volatility" not in df.columns:
        df = volatility(df, volatility_window=trend_window)

    df["sma"] = df["close"].rolling(trend_window).mean()
    distance_from_average = _safe_divide(df["close"] - df["sma"], df["sma"])
    df["trend_strength"] = _safe_divide(
        pd.Series(distance_from_average, index=df.index),
        df["volatility"],
    )
    return df


def candle_body_ratio(df: pd.DataFrame) -> pd.DataFrame:
    """
    Candle body ratio = abs(close - open) / (high - low)

    Near 1 = strong candle body
    Near 0 = wick-heavy / indecision candle
    """
    df["candle_body"] = (df["close"] - df["open"]).abs()
    df["candle_range"] = df["high"] - df["low"]
    df["candle_body_ratio"] = np.where(
        df["candle_range"] != 0, df["candle_body"] / df["candle_range"], np.nan
    )
    df["body_pressure"] = np.where(
        df["candle_range"] != 0,
        np.sign(df["close"] - df["open"]) * df["candle_body_ratio"],
        np.nan,
    )
    upper_wick = df["high"] - df[["open", "close"]].max(axis=1)
    lower_wick = df[["open", "close"]].min(axis=1) - df["low"]
    df["wick_imbalance"] = _safe_divide(lower_wick - upper_wick, df["candle_range"])
    return df


def range_expansion(df: pd.DataFrame, range_window: int = 20) -> pd.DataFrame:
    """
    Range expansion = current candle range / average previous candle range.

    > 1 means current candle is larger than normal.
    > 2 means strong expansion.
    """
    if "candle_range" not in df.columns:
        df["candle_range"] = df["high"] - df["low"]

    df["avg_range"] = df["candle_range"].rolling(range_window).mean().shift(1)
    df["range_expansion"] = np.where(
        df["avg_range"] != 0, df["candle_range"] / df["avg_range"], np.nan
    )
    return df


def lagged_return_features(df: pd.DataFrame) -> pd.DataFrame:
    for lag in (1, 2, 3, 6, 12, 24):
        df[f"return_lag_{lag}"] = df["returns"].shift(lag)
    for window in (3, 6, 12, 24):
        df[f"rolling_return_{window}"] = df["close"].pct_change(window)
    return df


def volatility_features(df: pd.DataFrame) -> pd.DataFrame:
    if "log_return" not in df.columns:
        df = log_returns(df)
    for window in (5, 20, 60):
        df[f"volatility_{window}"] = df["log_return"].rolling(window).std()
    df["realized_volatility_24"] = df["log_return"].rolling(24).std() * np.sqrt(24.0)
    return df


def range_and_atr_features(df: pd.DataFrame) -> pd.DataFrame:
    high_low = df["high"] - df["low"]
    high_prev_close = (df["high"] - df["close"].shift(1)).abs()
    low_prev_close = (df["low"] - df["close"].shift(1)).abs()
    true_range = pd.concat([high_low, high_prev_close, low_prev_close], axis=1).max(axis=1)
    df["true_range"] = true_range
    df["true_range_pct"] = _safe_divide(true_range, df["close"].shift(1))
    df["atr_14"] = true_range.rolling(14).mean()
    df["atr_14_pct"] = _safe_divide(df["atr_14"], df["close"])
    df["high_low_range_pct"] = _safe_divide(df["high"] - df["low"], df["close"])
    df["close_position_in_range"] = _safe_divide(
        df["close"] - df["low"],
        df["high"] - df["low"],
    )
    return df


def moving_average_features(df: pd.DataFrame) -> pd.DataFrame:
    for window in (12, 26, 50, 200):
        ema = df["close"].ewm(span=window, adjust=False).mean()
        df[f"ema_{window}"] = ema
        df[f"ema_distance_{window}"] = _safe_divide(df["close"] - ema, df["close"])

    ema_12 = df["ema_12"]
    ema_26 = df["ema_26"]
    ema_50 = df["ema_50"]
    ema_200 = df["ema_200"]
    df["ema_spread_12_50"] = _safe_divide(ema_12 - ema_50, df["close"])
    df["ema_spread_50_200"] = _safe_divide(ema_50 - ema_200, df["close"])
    df["macd"] = ema_12 - ema_26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]

    rolling_mean = df["close"].rolling(20).mean()
    rolling_std = df["close"].rolling(20).std()
    upper = rolling_mean + 2.0 * rolling_std
    lower = rolling_mean - 2.0 * rolling_std
    df["bollinger_percent_b"] = _safe_divide(df["close"] - lower, upper - lower)
    df["bollinger_bandwidth"] = _safe_divide(upper - lower, rolling_mean)
    previous_high = df["high"].rolling(20).max().shift(1)
    previous_low = df["low"].rolling(20).min().shift(1)
    df["breakout_pressure_20"] = _safe_divide(
        df["close"] - previous_high,
        previous_high,
    )
    df["breakdown_pressure_20"] = _safe_divide(
        previous_low - df["close"],
        previous_low,
    )
    return df


def momentum_features(df: pd.DataFrame) -> pd.DataFrame:
    delta = df["close"].diff()
    gains = delta.clip(lower=0.0)
    losses = -delta.clip(upper=0.0)
    avg_gain = gains.rolling(14).mean()
    avg_loss = losses.rolling(14).mean()
    rs = _safe_divide(avg_gain, avg_loss)
    df["rsi_14"] = 100.0 - (100.0 / (1.0 + rs))
    df["stochastic_k_14"] = 100.0 * _safe_divide(
        df["close"] - df["low"].rolling(14).min(),
        df["high"].rolling(14).max() - df["low"].rolling(14).min(),
    )
    df["stochastic_d_3"] = df["stochastic_k_14"].rolling(3).mean()
    return df


def liquidity_features(df: pd.DataFrame) -> pd.DataFrame:
    df["volume_change"] = df["volume"].pct_change()
    volume_mean = df["volume"].rolling(20).mean()
    volume_std = df["volume"].rolling(20).std()
    df["volume_zscore_20"] = _safe_divide(df["volume"] - volume_mean, volume_std)

    if "quote_asset_volume" in df.columns:
        df["quote_asset_volume"] = pd.to_numeric(
            df["quote_asset_volume"],
            errors="coerce",
        )
    else:
        df["quote_asset_volume"] = df["close"] * df["volume"]

    quote_mean = df["quote_asset_volume"].rolling(20).mean()
    quote_std = df["quote_asset_volume"].rolling(20).std()
    df["quote_volume_zscore_20"] = _safe_divide(
        df["quote_asset_volume"] - quote_mean,
        quote_std,
    )

    if "number_of_trades" in df.columns:
        df["number_of_trades"] = pd.to_numeric(df["number_of_trades"], errors="coerce")
        trade_mean = df["number_of_trades"].rolling(20).mean()
        trade_std = df["number_of_trades"].rolling(20).std()
        df["trade_count_zscore_20"] = _safe_divide(
            df["number_of_trades"] - trade_mean,
            trade_std,
        )
    else:
        df["number_of_trades"] = np.nan
        df["trade_count_zscore_20"] = np.nan

    if "taker_buy_base_volume" in df.columns:
        df["taker_buy_base_volume"] = pd.to_numeric(
            df["taker_buy_base_volume"],
            errors="coerce",
        )
        df["taker_buy_ratio"] = _safe_divide(df["taker_buy_base_volume"], df["volume"])
        df["taker_buy_imbalance"] = (2.0 * df["taker_buy_ratio"]) - 1.0
    else:
        df["taker_buy_base_volume"] = np.nan
        df["taker_buy_ratio"] = np.nan
        df["taker_buy_imbalance"] = np.nan

    if "taker_buy_quote_volume" in df.columns:
        df["taker_buy_quote_volume"] = pd.to_numeric(
            df["taker_buy_quote_volume"],
            errors="coerce",
        )
        df["taker_quote_ratio"] = _safe_divide(
            df["taker_buy_quote_volume"],
            df["quote_asset_volume"],
        )
    else:
        df["taker_buy_quote_volume"] = np.nan
        df["taker_quote_ratio"] = np.nan

    signed_return = np.sign(pd.to_numeric(df["log_return"], errors="coerce"))
    df["volume_pressure"] = df["volume_zscore_20"] * signed_return
    df["quote_volume_pressure"] = df["quote_volume_zscore_20"] * signed_return
    df["trade_intensity_pressure"] = df["trade_count_zscore_20"] * signed_return
    df["taker_buy_pressure"] = df["taker_buy_imbalance"] * df["volume_zscore_20"]
    df["order_flow_absorption"] = df["taker_buy_imbalance"] - signed_return
    return df


def causal_pressure_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compact mechanism-style features for DAG and rule discovery.

    These columns intentionally combine lower-level indicators into fewer
    directional pressure/regime signals so graph discovery sees less duplicate
    noise.
    """
    df["range_pressure"] = (2.0 * df["close_position_in_range"]) - 1.0
    df["volatility_regime_5_20"] = _safe_divide(
        df["volatility_5"],
        df["volatility_20"],
    ) - 1.0
    df["volatility_regime_20_60"] = _safe_divide(
        df["volatility_20"],
        df["volatility_60"],
    ) - 1.0
    df["atr_regime_14_20"] = _safe_divide(df["atr_14_pct"], df["volatility_20"])
    df["volatility_shock"] = _safe_divide(df["true_range_pct"], df["atr_14_pct"]) - 1.0
    df["momentum_quality_6"] = _safe_divide(df["rolling_return_6"], df["volatility_20"])
    df["momentum_quality_24"] = _safe_divide(
        df["rolling_return_24"],
        df["realized_volatility_24"],
    )
    df["trend_pressure"] = df["ema_spread_12_50"] + df["ema_spread_50_200"]
    df["mean_reversion_pressure"] = -df["trend_strength"]
    df["liquidity_adjusted_return"] = _safe_divide(df["log_return"], df["true_range_pct"])
    return df


def calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    timestamps = pd.to_datetime(df["datetime"])
    hour = timestamps.dt.hour.astype(float)
    day_of_week = timestamps.dt.dayofweek.astype(float)
    df["hour_sin"] = np.sin(2.0 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2.0 * np.pi * hour / 24.0)
    df["day_of_week_sin"] = np.sin(2.0 * np.pi * day_of_week / 7.0)
    df["day_of_week_cos"] = np.cos(2.0 * np.pi * day_of_week / 7.0)
    return df


def calculate_all_features(df: pd.DataFrame) -> pd.DataFrame:
    """Run all feature calculations."""
    df = df.copy()

    df["datetime"] = pd.to_datetime(df["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

    numeric_columns = ["open", "high", "low", "close", "volume"]
    for col in numeric_columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = calculate_returns(df)
    df = log_returns(df)
    df = volatility(df)
    df = lagged_return_features(df)
    df = volatility_features(df)
    df = trend_strength(df)
    df = candle_body_ratio(df)
    df = range_expansion(df)
    df = range_and_atr_features(df)
    df = moving_average_features(df)
    df = momentum_features(df)
    df = liquidity_features(df)
    df = causal_pressure_features(df)
    df = calendar_features(df)
    return df


def export_features(
    output_path: Path = OUTPUT_PATH,
    raw_data_path: Path | None = None,
) -> Path:
    df = load_and_validate_data(raw_data_path) if raw_data_path else load_and_validate_data()
    df = calculate_all_features(df)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"Features exported to: {output_path}")
    return output_path


def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> np.ndarray:
    numerator_array = pd.to_numeric(numerator, errors="coerce").to_numpy(dtype=float)
    denominator_array = pd.to_numeric(denominator, errors="coerce").to_numpy(dtype=float)
    result = np.full_like(numerator_array, np.nan, dtype=float)
    np.divide(
        numerator_array,
        denominator_array,
        out=result,
        where=np.abs(denominator_array) > EPSILON,
    )
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export PRISM engineered features.")
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=OUTPUT_PATH,
        help="Destination feature CSV.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    export_features(args.output_path, args.data_path)


if __name__ == "__main__":
    main()
