from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from src.features.feature_engineering import calculate_all_features
from src.prism.cau_dagma import CausalStructureModule
from src.prism.config import PRISMConfig
from src.prism.fus_reasoning import ReasoningFusionHead
from src.prism.mod_router import ModalityRouter
from src.prism.numpy_utils import safe_corrcoef
from src.prism.pro_calibration import ProbabilisticCalibrationModule
from src.prism.sym_rule_induction import SymbolicRuleInducer
from src.prism.tem_dependencies import TemporalDependencyModule
from src.prism.types import PRISMOutput
from src.utils.validation import validate_ohlcv_frame


class PRISMPipeline:
    """End-to-end minimal PRISM pipeline for deterministic tests."""

    def __init__(self, config: PRISMConfig | None = None) -> None:
        self.config = config or PRISMConfig()
        self.mod_router = ModalityRouter(self.config)
        self.cau_module = CausalStructureModule(self.config)
        self.tem_module = TemporalDependencyModule(self.config)
        self.sym_module = SymbolicRuleInducer(self.config)
        self.pro_module = ProbabilisticCalibrationModule(self.config)
        self.fus_module = ReasoningFusionHead(self.config)

    def run(self, raw_frame: pd.DataFrame) -> PRISMOutput:
        frame, feature_names, target_returns = prepare_prism_frame(
            raw_frame,
            self.config,
        )
        if len(frame) < 30:
            raise ValueError("PRISM requires at least 30 usable rows")
        labeled_indices = np.flatnonzero(np.isfinite(target_returns))
        if len(labeled_indices) < self.config.min_labeled_rows:
            raise ValueError(
                "PRISM requires at least "
                f"{self.config.min_labeled_rows} finite historical target labels"
            )
        fit_labeled_indices = labeled_indices
        if (
            self.config.max_labeled_rows is not None
            and len(fit_labeled_indices) > self.config.max_labeled_rows
        ):
            fit_labeled_indices = fit_labeled_indices[-self.config.max_labeled_rows :]

        train_size = int(len(fit_labeled_indices) * self.config.train_fraction)
        train_size = min(max(10, train_size), len(fit_labeled_indices) - 5)
        train_indices = fit_labeled_indices[:train_size]
        calibration_indices = fit_labeled_indices[train_size:]
        model_frame = impute_feature_frame(frame, feature_names, train_indices)
        selected_feature_names, feature_scores = select_feature_names(
            model_frame,
            feature_names,
            target_returns,
            train_indices,
            self.config,
        )
        model_frame = model_frame.loc[:, selected_feature_names].copy()

        encoding = self.mod_router.encode(
            model_frame,
            selected_feature_names,
            fit_indices=train_indices,
        )
        causal_graph = self.cau_module.infer_with_target(
            model_frame,
            selected_feature_names,
            target_returns,
            target_name=self.config.causal_target_feature,
            fit_indices=train_indices,
        )
        temporal = self.tem_module.analyze(
            model_frame,
            selected_feature_names,
            encoding.values,
        )
        rules = self.sym_module.induce(
            model_frame,
            selected_feature_names,
            target_returns,
            causal_graph,
            fit_indices=train_indices,
        )

        x_train = encoding.values[train_indices]
        y_train = target_returns[train_indices]
        x_calibration = encoding.values[calibration_indices]
        y_calibration = target_returns[calibration_indices]

        self.pro_module.fit(x_train, y_train)
        self.pro_module.calibrate(x_calibration, y_calibration)
        probabilistic = self.pro_module.predict_one(encoding.values[-1])
        probabilistic = replace(
            probabilistic,
            metadata={
                **probabilistic.metadata,
                "labeled_rows": int(len(labeled_indices)),
                "fit_labeled_rows": int(len(fit_labeled_indices)),
                "fit_labeled_start_row": int(fit_labeled_indices[0]),
                "fit_labeled_end_row": int(fit_labeled_indices[-1]),
                "max_labeled_rows": (
                    int(self.config.max_labeled_rows)
                    if self.config.max_labeled_rows is not None
                    else None
                ),
                "train_rows": int(len(train_indices)),
                "preprocessing_fit_rows": int(encoding.diagnostics["fitted_rows"]),
                "preprocessing_strategy": encoding.diagnostics["fit_strategy"],
                "available_feature_count": int(len(feature_names)),
                "selected_feature_count": int(len(selected_feature_names)),
                "selected_features": list(selected_feature_names),
                "feature_selection_scores": feature_scores,
                "feature_selection_strategy": "train_only_target_association",
                "causal_fit_rows": int(len(train_indices)),
                "rule_fit_rows": int(len(train_indices)),
                "prediction_row": int(len(frame) - 1),
                "leakage_guard": (
                    "latest row is used for inference only; finite training rows "
                    "fit preprocessing, causal graph, rules, model, and calibration"
                ),
            },
        )

        return self.fus_module.fuse(
            frame=model_frame,
            rules=rules,
            causal_graph=causal_graph,
            temporal=temporal,
            probabilistic=probabilistic,
        )


def run_prism(raw_frame: pd.DataFrame, config: PRISMConfig | None = None) -> PRISMOutput:
    return PRISMPipeline(config).run(raw_frame)


def prepare_prism_frame(
    raw_frame: pd.DataFrame,
    config: PRISMConfig,
) -> tuple[pd.DataFrame, tuple[str, ...], np.ndarray]:
    validated_frame = validate_ohlcv_frame(raw_frame)
    engineered = calculate_all_features(validated_frame)
    engineered = engineered.replace([np.inf, -np.inf], np.nan)

    available_features = tuple(
        column for column in config.feature_columns if column in engineered.columns
    )
    if not available_features:
        raise ValueError("No configured feature columns are present in input data")

    target_returns = (
        engineered["close"].shift(-config.prediction_horizon) / engineered["close"] - 1.0
    )
    working = engineered.loc[:, available_features].copy()
    feature_frame = working.reset_index(drop=True)

    for column in available_features:
        feature_frame[column] = pd.to_numeric(feature_frame[column], errors="coerce")

    return (
        feature_frame.reset_index(drop=True),
        available_features,
        target_returns.reset_index(drop=True).to_numpy(dtype=float),
    )


def impute_feature_frame(
    frame: pd.DataFrame,
    feature_names: tuple[str, ...],
    fit_indices: np.ndarray,
) -> pd.DataFrame:
    result = frame.copy()
    fit_indices = np.asarray(fit_indices, dtype=int)
    if len(fit_indices) == 0:
        raise ValueError("fit_indices must not be empty")

    for column in feature_names:
        values = pd.to_numeric(result[column], errors="coerce")
        values = values.replace([np.inf, -np.inf], np.nan)
        fit_values = values.iloc[fit_indices]
        finite_fit_values = fit_values[np.isfinite(fit_values.to_numpy(dtype=float))]
        fill_value = float(finite_fit_values.median()) if len(finite_fit_values) else 0.0
        result[column] = values.fillna(fill_value)

    return result


def select_feature_names(
    frame: pd.DataFrame,
    feature_names: tuple[str, ...],
    target_returns: np.ndarray,
    fit_indices: np.ndarray,
    config: PRISMConfig,
) -> tuple[tuple[str, ...], dict[str, float]]:
    max_features = config.max_selected_features
    if max_features is None or max_features >= len(feature_names):
        return feature_names, {
            feature: _feature_target_score(frame[feature], target_returns, fit_indices)
            for feature in feature_names
        }

    fit_indices = np.asarray(fit_indices, dtype=int)
    if len(fit_indices) == 0:
        raise ValueError("fit_indices must not be empty")

    scores = {
        feature: _feature_target_score(frame[feature], target_returns, fit_indices)
        for feature in feature_names
    }
    required = [
        feature
        for feature in config.required_feature_columns
        if feature in feature_names
    ]
    ranked = sorted(
        feature_names,
        key=lambda feature: (-scores[feature], feature_names.index(feature)),
    )
    selected: list[str] = []
    for feature in (*required, *ranked):
        if feature not in selected:
            selected.append(feature)
        if len(selected) >= max_features:
            break

    selected_set = set(selected)
    ordered_selection = tuple(feature for feature in feature_names if feature in selected_set)
    return ordered_selection, {feature: scores[feature] for feature in ordered_selection}


def _feature_target_score(
    values: pd.Series,
    target_returns: np.ndarray,
    fit_indices: np.ndarray,
) -> float:
    x = pd.to_numeric(values.iloc[fit_indices], errors="coerce").to_numpy(dtype=float)
    y = np.asarray(target_returns, dtype=float)[fit_indices]
    mask = np.isfinite(x) & np.isfinite(y)
    if mask.sum() < 10:
        return 0.0

    x = x[mask]
    y = y[mask]
    corr_score = abs(safe_corrcoef(x, y))
    threshold = float(np.median(x))
    upper = y[x > threshold]
    lower = y[x <= threshold]
    if len(upper) == 0 or len(lower) == 0:
        split_score = 0.0
    else:
        scale = float(np.std(y)) + 1e-12
        split_score = abs(float(upper.mean() - lower.mean())) / scale
    return float(corr_score + 0.05 * split_score)
