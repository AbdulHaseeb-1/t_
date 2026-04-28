from __future__ import annotations

import math

import numpy as np

from src.prism.config import PRISMConfig
from src.prism.numpy_utils import EPSILON, replace_non_finite, sigmoid
from src.prism.types import ProbabilisticPrediction


class ProbabilisticCalibrationModule:
    """L4 deterministic ridge ensemble and conformal intervals."""

    def __init__(self, config: PRISMConfig) -> None:
        self.config = config
        self._coefficients: list[np.ndarray] = []
        self._q_alpha = 0.0
        self._shrinkage_factor = 1.0
        self._magnitude_cap = float("inf")
        self._metadata: dict[str, object] = {}

    def fit(self, x_train: np.ndarray, y_train: np.ndarray) -> None:
        x_train = replace_non_finite(np.asarray(x_train, dtype=float))
        y_train = np.asarray(y_train, dtype=float)
        if len(x_train) != len(y_train):
            raise ValueError("x_train and y_train must have the same length")
        if len(y_train) == 0:
            raise ValueError("training data must not be empty")
        design = _with_intercept(x_train)
        self._coefficients = []

        for member_idx in range(self.config.ensemble_size):
            penalty = self.config.ridge_penalty * float(member_idx + 1)
            weights = 1.0 + 0.03 * np.cos(
                np.arange(len(design), dtype=float) + float(member_idx)
            )
            coefficients = _ridge_fit(design, y_train, penalty, weights)
            self._coefficients.append(coefficients)
        self._metadata = {
            "n_train": int(len(y_train)),
            "n_features": int(x_train.shape[1]),
            "ensemble_size": int(self.config.ensemble_size),
        }

    def calibrate(self, x_calibration: np.ndarray, y_calibration: np.ndarray) -> None:
        if not self._coefficients:
            raise RuntimeError("fit must be called before calibrate")

        y_calibration = np.asarray(y_calibration, dtype=float)
        if len(x_calibration) != len(y_calibration):
            raise ValueError("x_calibration and y_calibration must have the same length")
        predictions = self.predict_mean(x_calibration)
        self._shrinkage_factor = pro_select_shrinkage_factor(
            predictions,
            y_calibration,
            self.config.shrinkage_grid,
        )
        calibrated_predictions = predictions * self._shrinkage_factor
        self._magnitude_cap = pro_select_magnitude_cap(
            calibrated_predictions,
            y_calibration,
            self.config.magnitude_cap_quantiles,
            self.config.min_magnitude_cap,
        )
        clipped_predictions = pro_apply_magnitude_cap(
            calibrated_predictions,
            self._magnitude_cap,
        )
        scores = np.abs(y_calibration - clipped_predictions)
        self._q_alpha = pro_conformal_quantile(scores, self.config.alpha)
        n_cal = int(len(scores))
        metadata: dict[str, object] = {
            **self._metadata,
            "alpha": self.config.alpha,
            "n_calibration": n_cal,
            "q_alpha": self._q_alpha,
            "shrinkage_factor": self._shrinkage_factor,
            "magnitude_cap": self._magnitude_cap,
            "method": "split_conformal_abs_residual",
        }
        if n_cal < self.config.min_calibration_size:
            metadata["calibration_warning"] = (
                f"n_cal={n_cal} below recommended "
                f"{self.config.min_calibration_size}; coverage is diagnostic."
            )
        self._metadata = metadata

    def predict_one(self, x_row: np.ndarray) -> ProbabilisticPrediction:
        x = np.asarray(x_row, dtype=float).reshape(1, -1)
        members = self.predict_members(x)[0] * self._shrinkage_factor
        members = pro_apply_magnitude_cap(members, self._magnitude_cap)
        prediction = float(members.mean())
        epistemic = float(members.std())
        half_width = float(self._q_alpha + epistemic)
        bounds = (prediction - half_width, prediction + half_width)
        probability_scale = max(half_width, float(np.std(members)), EPSILON)
        probability = float(sigmoid(prediction / probability_scale))
        return ProbabilisticPrediction(
            prediction=prediction,
            probability=probability,
            member_predictions=members,
            uncertainty_bounds=bounds,
            q_alpha=self._q_alpha,
            metadata=dict(self._metadata),
        )

    def predict_mean(self, x_values: np.ndarray) -> np.ndarray:
        return self.predict_members(x_values).mean(axis=1)

    def predict_members(self, x_values: np.ndarray) -> np.ndarray:
        if not self._coefficients:
            raise RuntimeError("fit must be called before prediction")
        x_values = replace_non_finite(np.asarray(x_values, dtype=float))
        design = _with_intercept(x_values)
        return np.column_stack([design @ coef for coef in self._coefficients])


def pro_conformal_quantile(scores: np.ndarray, alpha: float) -> float:
    scores = np.asarray(scores, dtype=float)
    scores = scores[np.isfinite(scores)]
    if len(scores) == 0:
        return 0.0
    level = math.ceil((len(scores) + 1) * (1.0 - alpha)) / len(scores)
    level = min(1.0, max(0.0, level))
    return float(np.quantile(scores, level, method="higher"))


def pro_select_shrinkage_factor(
    predictions: np.ndarray,
    targets: np.ndarray,
    shrinkage_grid: tuple[float, ...],
) -> float:
    predictions = np.asarray(predictions, dtype=float)
    targets = np.asarray(targets, dtype=float)
    mask = np.isfinite(predictions) & np.isfinite(targets)
    if mask.sum() == 0:
        return 1.0
    predictions = predictions[mask]
    targets = targets[mask]

    best_factor = float(shrinkage_grid[0])
    best_mae = float("inf")
    for factor in shrinkage_grid:
        mae = float(np.mean(np.abs((predictions * factor) - targets)))
        if mae < best_mae:
            best_mae = mae
            best_factor = float(factor)
    return best_factor


def pro_apply_magnitude_cap(predictions: np.ndarray, magnitude_cap: float) -> np.ndarray:
    predictions = np.asarray(predictions, dtype=float)
    if not np.isfinite(magnitude_cap):
        return predictions
    cap = max(float(magnitude_cap), 0.0)
    return np.sign(predictions) * np.minimum(np.abs(predictions), cap)


def pro_select_magnitude_cap(
    predictions: np.ndarray,
    targets: np.ndarray,
    cap_quantiles: tuple[float, ...],
    min_cap: float,
) -> float:
    predictions = np.asarray(predictions, dtype=float)
    targets = np.asarray(targets, dtype=float)
    mask = np.isfinite(predictions) & np.isfinite(targets)
    if mask.sum() == 0:
        return float("inf")

    predictions = predictions[mask]
    targets = targets[mask]
    abs_predictions = np.abs(predictions)
    candidates = [float(max(min_cap, 0.0))]
    candidates.extend(float(np.quantile(abs_predictions, quantile)) for quantile in cap_quantiles)
    candidates.append(float(abs_predictions.max()))
    candidates = sorted({candidate for candidate in candidates if np.isfinite(candidate)})

    best_cap = candidates[-1] if candidates else float("inf")
    best_rmse = float("inf")
    for cap in candidates:
        clipped = pro_apply_magnitude_cap(predictions, cap)
        rmse = float(np.sqrt(np.mean((clipped - targets) ** 2)))
        if rmse < best_rmse:
            best_rmse = rmse
            best_cap = float(cap)
    return best_cap


def _with_intercept(values: np.ndarray) -> np.ndarray:
    array = replace_non_finite(np.asarray(values, dtype=float))
    return np.column_stack([np.ones(len(array)), array])


def _ridge_fit(
    design: np.ndarray,
    target: np.ndarray,
    penalty: float,
    weights: np.ndarray,
) -> np.ndarray:
    safe_weights = np.clip(np.asarray(weights, dtype=float), 0.0, None)
    sqrt_weights = np.sqrt(safe_weights)
    weighted_design = design * sqrt_weights.reshape(-1, 1)
    weighted_target = target * sqrt_weights
    regularizer = np.eye(design.shape[1]) * penalty
    regularizer[0, 0] = 0.0
    lhs = weighted_design.T @ weighted_design + regularizer
    rhs = weighted_design.T @ weighted_target
    return np.linalg.solve(lhs, rhs)
