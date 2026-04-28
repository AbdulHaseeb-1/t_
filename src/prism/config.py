from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


Modality = Literal["tabular", "temporal", "graph", "hybrid"]


CRYPTO_FEATURE_COLUMNS: tuple[str, ...] = (
    "returns",
    "log_return",
    "return_lag_1",
    "return_lag_3",
    "return_lag_6",
    "return_lag_24",
    "rolling_return_3",
    "rolling_return_6",
    "rolling_return_24",
    "trend_pressure",
    "mean_reversion_pressure",
    "ema_spread_12_50",
    "ema_spread_50_200",
    "macd_hist",
    "momentum_quality_6",
    "momentum_quality_24",
    "rsi_14",
    "range_pressure",
    "body_pressure",
    "wick_imbalance",
    "breakout_pressure_20",
    "breakdown_pressure_20",
    "volatility_regime_5_20",
    "volatility_regime_20_60",
    "atr_regime_14_20",
    "volatility_shock",
    "liquidity_adjusted_return",
    "volume_pressure",
    "quote_volume_pressure",
    "trade_intensity_pressure",
    "taker_buy_imbalance",
    "taker_buy_pressure",
    "order_flow_absorption",
    "hour_sin",
    "hour_cos",
)


@dataclass(frozen=True)
class PRISMConfig:
    """Configuration for the deterministic PRISM test implementation."""

    modality: Modality = "hybrid"
    d_model: int = 16
    feature_columns: tuple[str, ...] = CRYPTO_FEATURE_COLUMNS
    max_selected_features: int | None = 12
    required_feature_columns: tuple[str, ...] = (
        "returns",
        "log_return",
        "trend_pressure",
        "range_pressure",
        "volatility_regime_20_60",
        "taker_buy_pressure",
    )
    causal_target_feature: str = "target_return"
    prediction_horizon: int = 1
    temporal_window: int = 16
    causal_threshold: float = 0.15
    target_causal_threshold: float = 0.005
    dagma_lambda1: float = 0.01
    dagma_mu_init: float = 1.0
    dagma_mu_factor: float = 0.2
    dagma_s: tuple[float, ...] = (1.0, 0.9, 0.8)
    dagma_warm_iter: int = 120
    dagma_max_iter: int = 240
    dagma_learning_rate: float = 0.01
    dagma_beta1: float = 0.99
    dagma_beta2: float = 0.999
    granger_lags: tuple[int, ...] = (1, 2, 4)
    granger_alpha: float = 0.05
    max_granger_features: int = 16
    granger_max_rows: int = 5000
    train_fraction: float = 0.7
    max_labeled_rows: int | None = 12_000
    min_labeled_rows: int = 30
    alpha: float = 0.05
    min_calibration_size: int = 200
    ensemble_size: int = 5
    ridge_penalty: float = 1e-3
    shrinkage_grid: tuple[float, ...] = (0.0, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0)
    magnitude_cap_quantiles: tuple[float, ...] = (0.05, 0.1, 0.25, 0.5, 0.75, 1.0)
    min_magnitude_cap: float = 2e-6
    transaction_cost_bps: float = 0.2
    min_signal_return: float = 0.0
    min_signal_probability_edge: float = 0.002
    require_interval_confirmation: bool = True
    num_rules: int = 8
    concept_threshold: float = 0.5

    def __post_init__(self) -> None:
        valid_modalities = {"tabular", "temporal", "graph", "hybrid"}
        if self.modality not in valid_modalities:
            raise ValueError(f"Unsupported modality: {self.modality!r}")
        if self.d_model <= 0:
            raise ValueError("d_model must be positive")
        if self.max_selected_features is not None and self.max_selected_features <= 0:
            raise ValueError("max_selected_features must be positive when provided")
        if self.prediction_horizon <= 0:
            raise ValueError("prediction_horizon must be positive")
        if self.temporal_window <= 1:
            raise ValueError("temporal_window must be greater than 1")
        if self.causal_threshold < 0.0:
            raise ValueError("causal_threshold must be non-negative")
        if self.target_causal_threshold < 0.0:
            raise ValueError("target_causal_threshold must be non-negative")
        if self.dagma_lambda1 < 0.0:
            raise ValueError("dagma_lambda1 must be non-negative")
        if self.dagma_mu_init <= 0.0:
            raise ValueError("dagma_mu_init must be positive")
        if not 0.0 < self.dagma_mu_factor <= 1.0:
            raise ValueError("dagma_mu_factor must be in (0, 1]")
        if not self.dagma_s:
            raise ValueError("dagma_s must not be empty")
        if any(value <= 0.0 for value in self.dagma_s):
            raise ValueError("dagma_s values must be positive")
        if self.dagma_warm_iter <= 0:
            raise ValueError("dagma_warm_iter must be positive")
        if self.dagma_max_iter <= 0:
            raise ValueError("dagma_max_iter must be positive")
        if self.dagma_learning_rate <= 0.0:
            raise ValueError("dagma_learning_rate must be positive")
        if not 0.0 <= self.dagma_beta1 < 1.0:
            raise ValueError("dagma_beta1 must be in [0, 1)")
        if not 0.0 <= self.dagma_beta2 < 1.0:
            raise ValueError("dagma_beta2 must be in [0, 1)")
        if self.max_granger_features <= 0:
            raise ValueError("max_granger_features must be positive")
        if self.granger_max_rows <= 0:
            raise ValueError("granger_max_rows must be positive")
        if not 0.0 < self.alpha < 1.0:
            raise ValueError("alpha must be between 0 and 1")
        if not 0.0 < self.train_fraction < 1.0:
            raise ValueError("train_fraction must be between 0 and 1")
        if self.max_labeled_rows is not None and self.max_labeled_rows <= 1:
            raise ValueError("max_labeled_rows must be greater than 1 when provided")
        if self.min_labeled_rows <= 1:
            raise ValueError("min_labeled_rows must be greater than 1")
        if (
            self.max_labeled_rows is not None
            and self.max_labeled_rows < self.min_labeled_rows
        ):
            raise ValueError("max_labeled_rows must be >= min_labeled_rows")
        if self.ensemble_size <= 0:
            raise ValueError("ensemble_size must be positive")
        if not self.shrinkage_grid:
            raise ValueError("shrinkage_grid must not be empty")
        if any(value < 0.0 for value in self.shrinkage_grid):
            raise ValueError("shrinkage_grid values must be non-negative")
        if not self.magnitude_cap_quantiles:
            raise ValueError("magnitude_cap_quantiles must not be empty")
        if any(
            value < 0.0 or value > 1.0 for value in self.magnitude_cap_quantiles
        ):
            raise ValueError("magnitude_cap_quantiles values must be in [0, 1]")
        if self.min_magnitude_cap < 0.0:
            raise ValueError("min_magnitude_cap must be non-negative")
        if self.transaction_cost_bps < 0.0:
            raise ValueError("transaction_cost_bps must be non-negative")
        if self.min_signal_return < 0.0:
            raise ValueError("min_signal_return must be non-negative")
        if not 0.0 <= self.min_signal_probability_edge < 0.5:
            raise ValueError("min_signal_probability_edge must be in [0, 0.5)")
        if self.num_rules <= 0:
            raise ValueError("num_rules must be positive")
