from __future__ import annotations

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import (
    deterministic_projection,
    gelu,
    row_layer_norm,
    safe_correlation_matrix,
    standardize,
    standardize_from_reference,
)
from src.prism.types import ModalityEncoding


class ModalityRouter:
    """L0 deterministic modality router.

    The implementation is intentionally small, but each modality produces a
    stable d_model representation that downstream layers can consume.
    """

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config

    def encode(
        self,
        frame: pd.DataFrame,
        feature_names: tuple[str, ...],
        fit_indices: np.ndarray | None = None,
    ) -> ModalityEncoding:
        values = frame.loc[:, feature_names].to_numpy(dtype=float)
        fit_indices = _normalize_fit_indices(fit_indices, len(values))

        if self.config.modality == "tabular":
            encoded = self.mod_tabular_encoder(values, fit_indices)
        elif self.config.modality == "temporal":
            encoded = self.mod_temporal_encoder(values, fit_indices)
        elif self.config.modality == "graph":
            encoded = self.mod_graph_encoder(values, fit_indices)
        elif self.config.modality == "hybrid":
            encoded = self.mod_hybrid_encoder(values, fit_indices)
        else:
            raise ValueError(f"Unsupported modality: {self.config.modality!r}")

        return ModalityEncoding(
            values=encoded,
            feature_names=feature_names,
            modality=self.config.modality,
            diagnostics={
                "rows": int(encoded.shape[0]),
                "input_features": int(values.shape[1]),
                "d_model": int(encoded.shape[1]),
                "fitted_rows": int(len(fit_indices)),
                "fit_strategy": "train_indices",
            },
        )

    def mod_tabular_encoder(
        self,
        values: np.ndarray,
        fit_indices: np.ndarray | None = None,
    ) -> np.ndarray:
        normalized = _standardize_values(values, fit_indices)
        projection = deterministic_projection(normalized.shape[1], self.config.d_model)
        hidden = gelu(normalized @ projection)
        return row_layer_norm(hidden)

    def mod_temporal_encoder(
        self,
        values: np.ndarray,
        fit_indices: np.ndarray | None = None,
    ) -> np.ndarray:
        normalized = _standardize_values(values, fit_indices)
        window = self.config.temporal_window
        rolling_mean = np.empty_like(normalized)
        rolling_slope = np.zeros_like(normalized)

        for row_idx in range(normalized.shape[0]):
            start = max(0, row_idx - window + 1)
            segment = normalized[start : row_idx + 1]
            rolling_mean[row_idx] = segment.mean(axis=0)
            if len(segment) > 1:
                rolling_slope[row_idx] = segment[-1] - segment[0]

        temporal = np.concatenate([rolling_mean, rolling_slope], axis=1)
        projection = deterministic_projection(temporal.shape[1], self.config.d_model)
        return row_layer_norm(gelu(temporal @ projection))

    def mod_graph_encoder(
        self,
        values: np.ndarray,
        fit_indices: np.ndarray | None = None,
    ) -> np.ndarray:
        normalized = _standardize_values(values, fit_indices)
        if normalized.shape[1] == 1:
            graph_values = normalized
        else:
            reference = normalized if fit_indices is None else normalized[fit_indices]
            corr = safe_correlation_matrix(reference)
            np.fill_diagonal(corr, 0.0)
            weights = np.abs(corr)
            graph_values = normalized @ weights

        projection = deterministic_projection(graph_values.shape[1], self.config.d_model)
        return row_layer_norm(gelu(graph_values @ projection))

    def mod_hybrid_encoder(
        self,
        values: np.ndarray,
        fit_indices: np.ndarray | None = None,
    ) -> np.ndarray:
        tabular = self.mod_tabular_encoder(values, fit_indices)
        temporal = self.mod_temporal_encoder(values, fit_indices)
        graph = self.mod_graph_encoder(values, fit_indices)
        hybrid = 0.4 * tabular + 0.4 * temporal + 0.2 * graph
        return row_layer_norm(hybrid)


def _normalize_fit_indices(
    fit_indices: np.ndarray | None,
    n_rows: int,
) -> np.ndarray:
    if fit_indices is None:
        return np.arange(n_rows, dtype=int)
    indices = np.asarray(fit_indices, dtype=int)
    if len(indices) == 0:
        raise ValueError("fit_indices must not be empty")
    if indices.min() < 0 or indices.max() >= n_rows:
        raise ValueError("fit_indices contains out-of-range row positions")
    return indices


def _standardize_values(values: np.ndarray, fit_indices: np.ndarray | None) -> np.ndarray:
    if fit_indices is None:
        normalized, _, _ = standardize(values)
    else:
        normalized, _, _ = standardize_from_reference(values, fit_indices)
    return normalized
