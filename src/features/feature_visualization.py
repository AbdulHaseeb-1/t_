from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.features.feature_engineering import calculate_all_features
from src.utils.validation import RAW_DATA_PATH, load_and_validate_data


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "reports" / "feature_visualization.png"
DEFAULT_FEATURE_COLUMNS = (
    "returns",
    "log_return",
    "trend_pressure",
    "mean_reversion_pressure",
    "momentum_quality_6",
    "momentum_quality_24",
    "range_pressure",
    "body_pressure",
    "wick_imbalance",
    "breakout_pressure_20",
    "breakdown_pressure_20",
    "volatility_regime_5_20",
    "volatility_regime_20_60",
    "volatility_shock",
    "rsi_14",
    "volume_pressure",
    "quote_volume_pressure",
    "trade_intensity_pressure",
    "taker_buy_imbalance",
    "taker_buy_pressure",
    "order_flow_absorption",
)


def write_feature_visualization(
    raw_frame: pd.DataFrame,
    *,
    output_path: Path,
    title: str = "PRISM Feature Overview",
    tail_rows: int = 1500,
    correlation_columns: tuple[str, ...] = DEFAULT_FEATURE_COLUMNS,
) -> Path:
    if tail_rows <= 0:
        raise ValueError("tail_rows must be positive")

    features = calculate_all_features(raw_frame).replace([np.inf, -np.inf], np.nan)
    features["next_return"] = features["close"].shift(-1) / features["close"] - 1.0
    plot_frame = features.tail(tail_rows).copy()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        2,
        figsize=(18, 13),
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f7f7f2")
    x_values = pd.to_datetime(plot_frame["datetime"])
    feature_label = _feature_label(raw_frame)

    price_axis = axes[0, 0]
    price_axis.plot(x_values, plot_frame["close"], color="#243b53", linewidth=1.3)
    for column, color in (("ema_50", "#2f855a"), ("ema_200", "#c05621")):
        if column in plot_frame:
            price_axis.plot(x_values, plot_frame[column], color=color, linewidth=1.0)
    price_axis.set_title("Price and Trend", loc="left", fontweight="bold")
    price_axis.set_ylabel("Close")
    price_axis.legend(["close", "ema_50", "ema_200"], loc="best", frameon=True)

    returns_axis = axes[0, 1]
    returns_axis.plot(
        x_values,
        plot_frame["returns"],
        color="#2b6cb0",
        linewidth=0.7,
        alpha=0.7,
    )
    returns_axis.plot(
        x_values,
        plot_frame["volatility_20"],
        color="#9b2c2c",
        linewidth=1.1,
    )
    returns_axis.axhline(0.0, color="#2d3748", linewidth=0.8)
    returns_axis.set_title("Returns and Volatility", loc="left", fontweight="bold")
    returns_axis.set_ylabel("Return")
    returns_axis.legend(["returns", "volatility_20"], loc="best", frameon=True)

    rsi_axis = axes[1, 0]
    rsi_axis.plot(x_values, plot_frame["rsi_14"], color="#6b46c1", linewidth=1.0)
    rsi_axis.axhline(70.0, color="#9b2c2c", linestyle="--", linewidth=0.9)
    rsi_axis.axhline(30.0, color="#2f855a", linestyle="--", linewidth=0.9)
    rsi_axis.set_ylim(0, 100)
    rsi_axis.set_title("Momentum: RSI", loc="left", fontweight="bold")
    rsi_axis.set_ylabel("RSI 14")

    macd_axis = axes[1, 1]
    macd_axis.plot(x_values, plot_frame["macd"], color="#2b6cb0", linewidth=1.0)
    macd_axis.plot(x_values, plot_frame["macd_signal"], color="#dd6b20", linewidth=1.0)
    macd_axis.bar(
        x_values,
        plot_frame["macd_hist"],
        color="#718096",
        alpha=0.35,
        width=0.01,
    )
    macd_axis.axhline(0.0, color="#2d3748", linewidth=0.8)
    macd_axis.set_title("Momentum: MACD", loc="left", fontweight="bold")
    macd_axis.legend(["macd", "signal", "hist"], loc="best", frameon=True)

    liquidity_axis = axes[2, 0]
    liquidity_columns = [
        column
        for column in ("volume_zscore_20", "trade_count_zscore_20", "taker_buy_imbalance")
        if column in plot_frame
    ]
    for column, color in zip(
        liquidity_columns,
        ("#285e61", "#805ad5", "#c53030"),
        strict=False,
    ):
        liquidity_axis.plot(x_values, plot_frame[column], linewidth=0.9, label=column, color=color)
    liquidity_axis.axhline(0.0, color="#2d3748", linewidth=0.8)
    liquidity_axis.set_title("Liquidity and Order Flow", loc="left", fontweight="bold")
    liquidity_axis.legend(loc="best", frameon=True)

    correlation_axis = axes[2, 1]
    correlations = _target_correlations(features, correlation_columns)
    correlation_axis.barh(
        correlations.index[::-1],
        correlations.to_numpy()[::-1],
        color="#2f855a",
    )
    correlation_axis.set_title(
        "Absolute Correlation vs Next Return",
        loc="left",
        fontweight="bold",
    )
    correlation_axis.set_xlabel("|correlation|")

    for axis in axes.ravel():
        axis.set_facecolor("#ffffff")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.28)
        axis.tick_params(axis="x", rotation=20)

    figure.suptitle(
        f"{title} - {feature_label} - last {len(plot_frame):,} candles",
        x=0.01,
        y=1.01,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(output_path, dpi=170, bbox_inches="tight")
    plt.close(figure)
    return output_path


def _target_correlations(
    features: pd.DataFrame,
    columns: tuple[str, ...],
    *,
    limit: int = 12,
) -> pd.Series:
    scores: dict[str, float] = {}
    target = pd.to_numeric(features["next_return"], errors="coerce")
    for column in columns:
        if column not in features:
            continue
        values = pd.to_numeric(features[column], errors="coerce")
        valid = values.notna() & target.notna()
        if valid.sum() < 30:
            continue
        score = values.loc[valid].corr(target.loc[valid])
        if pd.notna(score) and np.isfinite(score):
            scores[column] = abs(float(score))
    if not scores:
        return pd.Series({"no_valid_feature_correlations": 0.0})
    return pd.Series(scores).sort_values(ascending=False).head(limit).sort_values()


def _feature_label(raw_frame: pd.DataFrame) -> str:
    symbol = str(raw_frame["symbol"].iloc[0]) if "symbol" in raw_frame else "market"
    interval = str(raw_frame["interval"].iloc[0]) if "interval" in raw_frame else "unknown"
    return f"{symbol} {interval}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a pyplot feature overview from an OHLCV CSV.",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Raw OHLCV CSV path. Defaults to PRISM_DATA_PATH or repository default.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Destination PNG path.",
    )
    parser.add_argument(
        "--tail-rows",
        type=int,
        default=1500,
        help="Number of most recent candles to plot in the time-series panels.",
    )
    parser.add_argument("--title", default="PRISM Feature Overview")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_path = args.data_path or RAW_DATA_PATH
    data = load_and_validate_data(data_path)
    output_path = write_feature_visualization(
        data,
        output_path=args.output_path,
        title=args.title,
        tail_rows=args.tail_rows,
    )
    print(f"Feature visualization written to: {output_path}")


if __name__ == "__main__":
    main()
