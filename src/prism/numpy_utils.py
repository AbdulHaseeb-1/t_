from __future__ import annotations

import numpy as np


EPSILON = 1e-12


def ensure_2d(values: np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if array.ndim == 1:
        array = array.reshape(-1, 1)
    if array.ndim != 2:
        raise ValueError("values must be one- or two-dimensional")
    return array


def replace_non_finite(values: np.ndarray) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if np.isfinite(array).all():
        return array

    cleaned = array.copy()
    for col_idx in range(cleaned.shape[1]):
        column = cleaned[:, col_idx]
        finite = np.isfinite(column)
        fill_value = float(np.nanmedian(column[finite])) if finite.any() else 0.0
        column[~finite] = fill_value
        cleaned[:, col_idx] = column
    return cleaned


def replace_non_finite_with_reference(
    values: np.ndarray,
    reference_indices: np.ndarray,
) -> np.ndarray:
    array = ensure_2d(np.asarray(values, dtype=float))
    reference_indices = np.asarray(reference_indices, dtype=int)
    if len(reference_indices) == 0:
        raise ValueError("reference_indices must not be empty")
    cleaned = array.copy()
    for col_idx in range(cleaned.shape[1]):
        column = cleaned[:, col_idx]
        reference = column[reference_indices]
        finite_reference = reference[np.isfinite(reference)]
        fill_value = float(np.nanmedian(finite_reference)) if len(finite_reference) else 0.0
        column[~np.isfinite(column)] = fill_value
        cleaned[:, col_idx] = column
    return cleaned


def standardize(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    array = replace_non_finite(ensure_2d(values))
    mean = array.mean(axis=0)
    std = array.std(axis=0)
    std = np.where(std < EPSILON, 1.0, std)
    return (array - mean) / std, mean, std


def standardize_from_reference(
    values: np.ndarray,
    reference_indices: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    array = replace_non_finite_with_reference(values, reference_indices)
    reference = array[np.asarray(reference_indices, dtype=int)]
    mean = reference.mean(axis=0)
    std = reference.std(axis=0)
    std = np.where(std < EPSILON, 1.0, std)
    return (array - mean) / std, mean, std


def row_layer_norm(values: np.ndarray) -> np.ndarray:
    array = ensure_2d(values)
    mean = array.mean(axis=1, keepdims=True)
    std = array.std(axis=1, keepdims=True)
    std = np.where(std < EPSILON, 1.0, std)
    return (array - mean) / std


def gelu(values: np.ndarray) -> np.ndarray:
    return 0.5 * values * (
        1.0 + np.tanh(np.sqrt(2.0 / np.pi) * (values + 0.044715 * values**3))
    )


def deterministic_projection(input_dim: int, output_dim: int) -> np.ndarray:
    rows = np.arange(1, input_dim + 1, dtype=float).reshape(-1, 1)
    cols = np.arange(1, output_dim + 1, dtype=float).reshape(1, -1)
    projection = np.sin(rows * cols) + 0.5 * np.cos((rows + 1.0) * cols)
    return projection / np.sqrt(max(input_dim, 1))


def sigmoid(value: float | np.ndarray) -> float | np.ndarray:
    clipped = np.clip(value, -60.0, 60.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def safe_corrcoef(left: np.ndarray, right: np.ndarray) -> float:
    left = np.asarray(left, dtype=float)
    right = np.asarray(right, dtype=float)
    mask = np.isfinite(left) & np.isfinite(right)
    if mask.sum() < 3:
        return 0.0
    left = left[mask]
    right = right[mask]
    if left.std() < EPSILON or right.std() < EPSILON:
        return 0.0
    return float(np.corrcoef(left, right)[0, 1])


def safe_correlation_matrix(values: np.ndarray) -> np.ndarray:
    array = ensure_2d(values)
    n_features = array.shape[1]
    matrix = np.eye(n_features, dtype=float)
    for row_idx in range(n_features):
        for col_idx in range(row_idx + 1, n_features):
            corr = safe_corrcoef(array[:, row_idx], array[:, col_idx])
            matrix[row_idx, col_idx] = corr
            matrix[col_idx, row_idx] = corr
    return matrix
