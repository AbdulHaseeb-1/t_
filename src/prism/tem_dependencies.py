from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import replace_non_finite, row_layer_norm
from src.prism.types import TemporalAnalysis


try:
    from scipy.stats import f as f_distribution
except ImportError:  # pragma: no cover - scipy is part of requirements.
    f_distribution = None


class TemporalDependencyModule:
    """L2 lightweight temporal state scan plus manual Granger tests."""

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config

    def analyze(
        self,
        frame: pd.DataFrame,
        feature_names: tuple[str, ...],
        encoded_values: np.ndarray,
    ) -> TemporalAnalysis:
        raw_values = replace_non_finite(frame.loc[:, feature_names].to_numpy(dtype=float))
        embedding = tem_state_scan(encoded_values)
        selected_indices = _select_granger_feature_indices(
            feature_names,
            self.config.max_granger_features,
        )
        granger_values = raw_values[-self.config.granger_max_rows :]
        selected_values = granger_values[:, selected_indices]
        selected_p_values = tem_granger_matrix(selected_values, self.config.granger_lags)
        p_values = np.ones((len(feature_names), len(feature_names)), dtype=float)
        for local_effect_idx, effect_idx in enumerate(selected_indices):
            for local_cause_idx, cause_idx in enumerate(selected_indices):
                p_values[effect_idx, cause_idx] = selected_p_values[
                    local_effect_idx,
                    local_cause_idx,
                ]
        significant_edges = []

        for effect_idx, cause_idx in zip(*np.where(p_values < self.config.granger_alpha), strict=False):
            if cause_idx == effect_idx:
                continue
            significant_edges.append(
                {
                    "cause": feature_names[cause_idx],
                    "effect": feature_names[effect_idx],
                    "p_value": float(p_values[effect_idx, cause_idx]),
                }
            )

        significant_edges.sort(key=lambda item: item["p_value"])
        return TemporalAnalysis(
            embedding=embedding,
            granger_p_values=p_values,
            significant_edges=significant_edges,
        )


def tem_state_scan(values: np.ndarray, decay: float = 0.8) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if array.ndim != 2:
        raise ValueError("values must be a 2D array")
    state = np.zeros_like(array)
    state[0] = array[0]
    for row_idx in range(1, len(array)):
        state[row_idx] = decay * state[row_idx - 1] + (1.0 - decay) * array[row_idx]
    return row_layer_norm(state)


def _select_granger_feature_indices(
    feature_names: tuple[str, ...],
    max_features: int,
) -> list[int]:
    priority = (
        "close",
        "returns",
        "log_return",
        "volatility",
        "volatility_5",
        "volatility_20",
        "realized_volatility_24",
        "trend_strength",
        "volume",
        "volume_zscore_20",
        "quote_volume_zscore_20",
        "trade_count_zscore_20",
        "taker_buy_ratio",
        "taker_buy_imbalance",
        "atr_14_pct",
        "rsi_14",
        "macd",
        "macd_hist",
        "bollinger_percent_b",
        "hour_sin",
    )
    selected: list[int] = []
    for name in priority:
        if name in feature_names:
            selected.append(feature_names.index(name))
        if len(selected) >= max_features:
            return selected

    for index in range(len(feature_names)):
        if index not in selected:
            selected.append(index)
        if len(selected) >= max_features:
            break
    return selected


def tem_granger_matrix(values: np.ndarray, lags: tuple[int, ...]) -> np.ndarray:
    array = replace_non_finite(np.asarray(values, dtype=float))
    n_features = array.shape[1]
    result = np.ones((n_features, n_features), dtype=float)

    for effect_idx in range(n_features):
        for cause_idx in range(n_features):
            if cause_idx == effect_idx:
                result[effect_idx, cause_idx] = 1.0
                continue
            p_candidates = [
                tem_granger_p_value(array[:, cause_idx], array[:, effect_idx], lag)
                for lag in lags
            ]
            finite = [p_value for p_value in p_candidates if np.isfinite(p_value)]
            result[effect_idx, cause_idx] = min(finite) if finite else 1.0

    return result


def tem_granger_p_value(cause: np.ndarray, effect: np.ndarray, lag: int) -> float:
    if lag <= 0:
        raise ValueError("lag must be positive")
    cause = np.asarray(cause, dtype=float)
    effect = np.asarray(effect, dtype=float)
    if len(cause) != len(effect):
        raise ValueError("cause and effect must have the same length")
    if len(cause) <= (2 * lag + 2):
        return 1.0

    y = effect[lag:]
    y_lags = _lagged_columns(effect, lag)
    x_lags = _lagged_columns(cause, lag)
    restricted = np.column_stack([np.ones(len(y)), y_lags])
    unrestricted = np.column_stack([np.ones(len(y)), y_lags, x_lags])

    rss_restricted = _rss(restricted, y)
    rss_unrestricted = _rss(unrestricted, y)
    df_num = lag
    df_den = len(y) - unrestricted.shape[1]
    if df_den <= 0 or rss_unrestricted <= 0.0 or rss_restricted < rss_unrestricted:
        return 1.0

    f_stat = ((rss_restricted - rss_unrestricted) / df_num) / (
        rss_unrestricted / df_den
    )
    if not np.isfinite(f_stat) or f_stat < 0.0:
        return 1.0
    if f_distribution is None:
        return 0.0 if f_stat > 10.0 else 1.0
    return float(f_distribution.sf(f_stat, df_num, df_den))


def _lagged_columns(values: np.ndarray, lag: int) -> np.ndarray:
    return np.column_stack([values[lag - offset : -offset] for offset in range(1, lag + 1)])


def _rss(design: np.ndarray, target: np.ndarray) -> float:
    coefficients, *_ = np.linalg.lstsq(design, target, rcond=None)
    residuals = target - design @ coefficients
    return float(residuals.T @ residuals)
