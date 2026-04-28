from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

from src.features.feature_engineering import calculate_all_features
from src.prism.config import PRISMConfig
from src.prism.evaluation import calculate_backtest_metrics
from src.prism.numpy_utils import EPSILON, safe_corrcoef, sigmoid
from src.utils.validation import validate_ohlcv_frame


DirectionalTargetMode = Literal["return", "class"]


@dataclass(frozen=True)
class DirectionalWindow:
    evaluation_id: str
    start_index: int = 5000
    step: int = 1000
    max_windows: int | None = None


@dataclass(frozen=True)
class DirectionalVariant:
    variant_id: str
    training_window: int | None
    max_features: int
    ridge_penalty: float
    target_mode: DirectionalTargetMode = "return"
    recency_weight: bool = False
    description: str = ""


@dataclass(frozen=True)
class DirectionalAccuracyReport:
    candidate_records: pd.DataFrame
    selected_records: pd.DataFrame
    summary: pd.DataFrame


@dataclass(frozen=True)
class DirectionalSignal:
    prediction: float
    probability: float
    direction: str
    selected_variant_id: str
    selector_reason: str
    selector_training_windows: int
    selector_lookback: int
    selector_training_directional_accuracy: float | None
    selector_training_mae: float | None
    selected_features: tuple[str, ...]
    candidate_signals: tuple[dict[str, float | int | str], ...]
    note: str = "Research sidecar only; not used by PRISM trade execution."

    def to_dict(self) -> dict[str, object]:
        return {
            "prediction": self.prediction,
            "probability": self.probability,
            "direction": self.direction,
            "selected_variant_id": self.selected_variant_id,
            "selector_reason": self.selector_reason,
            "selector_training_windows": self.selector_training_windows,
            "selector_lookback": self.selector_lookback,
            "selector_training_directional_accuracy": (
                self.selector_training_directional_accuracy
            ),
            "selector_training_mae": self.selector_training_mae,
            "selected_features": list(self.selected_features),
            "candidate_signals": list(self.candidate_signals),
            "note": self.note,
        }


def default_directional_variants() -> tuple[DirectionalVariant, ...]:
    return (
        DirectionalVariant(
            "short_recency_18",
            training_window=1500,
            max_features=18,
            ridge_penalty=1e-4,
            target_mode="return",
            recency_weight=True,
            description="Short rolling return model with recency weighting.",
        ),
        DirectionalVariant(
            "short_recency_12",
            training_window=1500,
            max_features=12,
            ridge_penalty=1e-4,
            target_mode="return",
            recency_weight=True,
            description="More compact short rolling return model.",
        ),
        DirectionalVariant(
            "medium_wide_32",
            training_window=6000,
            max_features=32,
            ridge_penalty=0.1,
            target_mode="return",
            recency_weight=False,
            description="Medium rolling return model with a wider feature set.",
        ),
        DirectionalVariant(
            "long_recency_32",
            training_window=24_000,
            max_features=32,
            ridge_penalty=10.0,
            target_mode="return",
            recency_weight=True,
            description="Longer context return model with stronger ridge penalty.",
        ),
        DirectionalVariant(
            "short_classifier_24",
            training_window=1500,
            max_features=24,
            ridge_penalty=1.0,
            target_mode="class",
            recency_weight=False,
            description="Direction classifier trained on +/-1 outcomes.",
        ),
        DirectionalVariant(
            "stable_core_8",
            training_window=12_000,
            max_features=8,
            ridge_penalty=1e-4,
            target_mode="return",
            recency_weight=False,
            description="Compact longer-context return model.",
        ),
    )


def run_directional_accuracy_validation(
    raw_frame: pd.DataFrame,
    config: PRISMConfig | None = None,
    *,
    evaluation_windows: tuple[DirectionalWindow, ...] | None = None,
    variants: tuple[DirectionalVariant, ...] | None = None,
    selector_lookback: int = 8,
    min_selection_windows: int = 8,
    default_variant_id: str = "long_recency_32",
) -> DirectionalAccuracyReport:
    cfg = config or PRISMConfig()
    windows = evaluation_windows or (
        DirectionalWindow("broad_regime", start_index=5000, step=1000),
        DirectionalWindow("dense_recent", start_index=5000, step=100, max_windows=240),
    )
    candidate_variants = variants or default_directional_variants()
    context = _prepare_directional_context(raw_frame, cfg)
    candidate_frames: list[pd.DataFrame] = []
    selected_frames: list[pd.DataFrame] = []

    for window in windows:
        indices = _window_row_indices(
            len(context.frame),
            cfg.prediction_horizon,
            window,
        )
        candidates = _build_candidate_records(context, indices, candidate_variants)
        candidates["evaluation_id"] = window.evaluation_id
        selected = build_prior_directional_selection(
            candidates,
            selector_lookback=selector_lookback,
            min_selection_windows=min_selection_windows,
            default_variant_id=default_variant_id,
        )
        candidate_frames.append(candidates)
        selected_frames.append(selected)

    candidate_records = pd.concat(candidate_frames, ignore_index=True)
    selected_records = pd.concat(selected_frames, ignore_index=True)
    summary = summarize_directional_accuracy(candidate_records, selected_records)
    return DirectionalAccuracyReport(
        candidate_records=candidate_records,
        selected_records=selected_records,
        summary=summary,
    )


def build_prior_directional_selection(
    candidate_records: pd.DataFrame,
    *,
    selector_lookback: int = 12,
    min_selection_windows: int = 12,
    default_variant_id: str = "long_recency_32",
) -> pd.DataFrame:
    if selector_lookback <= 0:
        raise ValueError("selector_lookback must be positive")
    if min_selection_windows <= 0:
        raise ValueError("min_selection_windows must be positive")
    required = {"evaluation_id", "variant_id", "row_index", "prediction", "actual_return"}
    missing = sorted(required - set(candidate_records.columns))
    if missing:
        raise ValueError(f"candidate_records missing required columns: {missing}")

    selected_frames = []
    for evaluation_id, group in candidate_records.groupby("evaluation_id", sort=False):
        variant_ids = list(dict.fromkeys(group["variant_id"].astype(str)))
        default_id = default_variant_id if default_variant_id in variant_ids else variant_ids[0]
        row_indices = _aligned_row_indices(group, variant_ids)
        ordered = group.sort_values(["row_index", "variant_id"]).reset_index(drop=True)
        selected_rows: list[pd.Series] = []

        for position, row_index in enumerate(row_indices):
            if position < min_selection_windows:
                selected_variant = default_id
                reason = "insufficient_prior_windows"
                training_accuracy = float("nan")
                training_mae = float("nan")
            else:
                prior_indices = row_indices[:position][-selector_lookback:]
                prior = ordered.loc[ordered["row_index"].isin(prior_indices)]
                selection = select_directional_variant_from_prior(prior, variant_ids)
                selected_variant = str(selection["variant_id"])
                reason = "highest_prior_directional_accuracy"
                training_accuracy = float(selection["directional_accuracy"])
                training_mae = float(selection["mae"])

            row = ordered.loc[
                (ordered["row_index"] == row_index)
                & (ordered["variant_id"] == selected_variant)
            ].iloc[0].copy()
            row["selected_variant_id"] = selected_variant
            row["selector_reason"] = reason
            row["selector_training_windows"] = position
            row["selector_lookback"] = selector_lookback
            row["selector_training_directional_accuracy"] = training_accuracy
            row["selector_training_mae"] = training_mae
            row["evaluation_id"] = evaluation_id
            selected_rows.append(row)

        selected_frames.append(pd.DataFrame(selected_rows))

    return pd.concat(selected_frames, ignore_index=True)


def predict_latest_directional_signal(
    raw_frame: pd.DataFrame,
    config: PRISMConfig | None = None,
    *,
    variants: tuple[DirectionalVariant, ...] | None = None,
    selector_start_index: int = 5000,
    selector_step: int = 1000,
    selector_lookback: int = 8,
    min_selection_windows: int = 8,
    default_variant_id: str = "long_recency_32",
) -> DirectionalSignal:
    if selector_step <= 0:
        raise ValueError("selector_step must be positive")
    if selector_lookback <= 0:
        raise ValueError("selector_lookback must be positive")
    if min_selection_windows <= 0:
        raise ValueError("min_selection_windows must be positive")

    cfg = config or PRISMConfig()
    candidate_variants = variants or default_directional_variants()
    context = _prepare_directional_context(raw_frame, cfg)
    prediction_row = len(context.frame) - 1
    last_validated_row = prediction_row - cfg.prediction_horizon
    if last_validated_row < 30:
        raise ValueError("not enough rows for directional sidecar selection")

    start_index = min(max(selector_start_index, 30), last_validated_row)
    row_indices = list(range(start_index, last_validated_row + 1, selector_step))
    if not row_indices:
        row_indices = [last_validated_row]

    candidate_records = _build_candidate_records(
        context,
        row_indices,
        candidate_variants,
    )
    candidate_records["evaluation_id"] = "live_selector_history"
    variant_ids = [variant.variant_id for variant in candidate_variants]
    default_id = default_variant_id if default_variant_id in variant_ids else variant_ids[0]

    if len(row_indices) < min_selection_windows:
        selected_variant_id = default_id
        selector_reason = "insufficient_prior_windows"
        selector_accuracy: float | None = None
        selector_mae: float | None = None
    else:
        prior_indices = row_indices[-selector_lookback:]
        prior = candidate_records.loc[candidate_records["row_index"].isin(prior_indices)]
        selected = select_directional_variant_from_prior(prior, variant_ids)
        selected_variant_id = str(selected["variant_id"])
        selector_reason = "highest_prior_directional_accuracy"
        selector_accuracy = float(selected["directional_accuracy"])
        selector_mae = float(selected["mae"])

    candidate_signal_rows = []
    selected_prediction = 0.0
    selected_probability = 0.5
    selected_features: tuple[str, ...] = tuple()
    for variant in candidate_variants:
        prediction, probability, features = _predict_directional_variant(
            context,
            prediction_row,
            variant,
        )
        signal_row = {
            "variant_id": variant.variant_id,
            "prediction": float(prediction),
            "probability": float(probability),
            "direction": _direction_label(prediction),
            "selected_feature_count": int(len(features)),
        }
        candidate_signal_rows.append(signal_row)
        if variant.variant_id == selected_variant_id:
            selected_prediction = float(prediction)
            selected_probability = float(probability)
            selected_features = features

    return DirectionalSignal(
        prediction=selected_prediction,
        probability=selected_probability,
        direction=_direction_label(selected_prediction),
        selected_variant_id=selected_variant_id,
        selector_reason=selector_reason,
        selector_training_windows=len(row_indices),
        selector_lookback=selector_lookback,
        selector_training_directional_accuracy=selector_accuracy,
        selector_training_mae=selector_mae,
        selected_features=selected_features,
        candidate_signals=tuple(candidate_signal_rows),
    )


def select_directional_variant_from_prior(
    prior_records: pd.DataFrame,
    variant_ids: list[str],
) -> dict[str, float | str]:
    if prior_records.empty:
        raise ValueError("prior_records must not be empty")
    candidates: list[dict[str, float | str]] = []
    for variant_id in variant_ids:
        subset = prior_records.loc[prior_records["variant_id"] == variant_id]
        if subset.empty:
            continue
        predictions = subset["prediction"].to_numpy(dtype=float)
        actual = subset["actual_return"].to_numpy(dtype=float)
        errors = predictions - actual
        candidates.append(
            {
                "variant_id": variant_id,
                "directional_accuracy": float(((predictions >= 0.0) == (actual >= 0.0)).mean()),
                "mae": float(np.mean(np.abs(errors))),
                "rmse": float(np.sqrt(np.mean(errors**2))),
            }
        )
    if not candidates:
        raise ValueError("no directional variants available in prior_records")
    candidates.sort(
        key=lambda row: (
            -float(row["directional_accuracy"]),
            float(row["mae"]),
            float(row["rmse"]),
            str(row["variant_id"]),
        )
    )
    return candidates[0]


def summarize_directional_accuracy(
    candidate_records: pd.DataFrame,
    selected_records: pd.DataFrame,
) -> pd.DataFrame:
    rows: list[dict[str, float | str]] = []
    for (evaluation_id, variant_id), subset in candidate_records.groupby(
        ["evaluation_id", "variant_id"],
        sort=False,
    ):
        metrics = calculate_backtest_metrics(subset.reset_index(drop=True))
        selection_count = float(
            (
                (selected_records["evaluation_id"] == evaluation_id)
                & (selected_records["selected_variant_id"] == variant_id)
            ).sum()
        )
        rows.append(
            {
                "evaluation_id": str(evaluation_id),
                "variant_id": str(variant_id),
                "summary_type": "candidate",
                "selection_count": selection_count,
                **metrics,
            }
        )

    for evaluation_id, subset in selected_records.groupby("evaluation_id", sort=False):
        metrics = calculate_backtest_metrics(subset.reset_index(drop=True))
        rows.append(
            {
                "evaluation_id": str(evaluation_id),
                "variant_id": "prior_direction_selector",
                "summary_type": "selector",
                "selection_count": float(len(subset)),
                **metrics,
            }
        )
    return pd.DataFrame(rows)


def write_directional_accuracy_outputs(
    report: DirectionalAccuracyReport,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    candidate_path = output_dir / "directional_candidate_records.csv"
    selected_path = output_dir / "directional_selected_records.csv"
    summary_path = output_dir / "directional_accuracy_summary.csv"
    plot_path = output_dir / "directional_accuracy.png"
    report.candidate_records.to_csv(candidate_path, index=False)
    report.selected_records.to_csv(selected_path, index=False)
    report.summary.to_csv(summary_path, index=False)
    write_directional_accuracy_plot(report.summary, plot_path)
    return {
        "candidate_records": candidate_path,
        "selected_records": selected_path,
        "summary": summary_path,
        "plot": plot_path,
    }


def write_directional_accuracy_plot(summary: pd.DataFrame, plot_path: Path) -> Path:
    if summary.empty:
        raise ValueError("summary must not be empty")
    required = {
        "evaluation_id",
        "variant_id",
        "directional_accuracy",
        "mae_improvement_vs_best_baseline",
        "selection_count",
    }
    missing = sorted(required - set(summary.columns))
    if missing:
        raise ValueError(f"summary missing required columns: {missing}")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plot_path.parent.mkdir(parents=True, exist_ok=True)
    variants = list(dict.fromkeys(summary["variant_id"].astype(str)))
    evaluations = list(dict.fromkeys(summary["evaluation_id"].astype(str)))
    x_values = np.arange(len(variants), dtype=float)
    bar_width = 0.78 / max(len(evaluations), 1)

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        1,
        figsize=(15.5, 11.5),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")
    metrics = (
        ("directional_accuracy", "Directional Accuracy"),
        ("mae_improvement_vs_best_baseline", "MAE Edge"),
        ("selection_count", "Selector Count"),
    )
    colors = ("#4b7f8c", "#b36b3f", "#766f9b", "#6f8f52")

    for axis, (metric, title) in zip(axes, metrics, strict=True):
        for eval_index, evaluation_id in enumerate(evaluations):
            offset = (eval_index - (len(evaluations) - 1) / 2.0) * bar_width
            values = _metric_values_for_variants(
                summary,
                variants,
                evaluation_id,
                metric,
            )
            axis.bar(
                x_values + offset,
                values,
                width=bar_width,
                label=evaluation_id.replace("_", " "),
                color=colors[eval_index % len(colors)],
            )
        if metric == "directional_accuracy":
            axis.axhline(0.60, color="#394247", linestyle="--", linewidth=1.2)
            axis.set_ylim(0.0, 1.05)
        elif metric == "mae_improvement_vs_best_baseline":
            axis.axhline(0.0, color="#394247", linewidth=1.0)
        axis.set_title(title, loc="left", fontweight="bold")
        axis.set_ylabel(title)
        axis.set_facecolor("#fffaf1")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.35)

    axes[0].legend(loc="best", frameon=True)
    axes[-1].set_xticks(x_values)
    axes[-1].set_xticklabels(
        [variant.replace("_", " ") for variant in variants],
        rotation=15,
        ha="right",
    )
    axes[-1].set_xlabel("Direction-first variant")
    figure.suptitle(
        "PRISM Direction-First Accuracy Validation",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    plt.close(figure)
    return plot_path


@dataclass(frozen=True)
class _DirectionalContext:
    frame: pd.DataFrame
    feature_names: tuple[str, ...]
    target_returns: np.ndarray
    close: np.ndarray


def _prepare_directional_context(
    raw_frame: pd.DataFrame,
    config: PRISMConfig,
) -> _DirectionalContext:
    validated = validate_ohlcv_frame(raw_frame)
    engineered = calculate_all_features(validated).replace([np.inf, -np.inf], np.nan)
    feature_names = tuple(
        column for column in config.feature_columns if column in engineered.columns
    )
    if not feature_names:
        raise ValueError("No configured feature columns are present in input data")
    target_returns = (
        engineered["close"].shift(-config.prediction_horizon) / engineered["close"] - 1.0
    )
    return _DirectionalContext(
        frame=engineered.reset_index(drop=True),
        feature_names=feature_names,
        target_returns=target_returns.reset_index(drop=True).to_numpy(dtype=float),
        close=engineered["close"].to_numpy(dtype=float),
    )


def _window_row_indices(
    n_rows: int,
    prediction_horizon: int,
    window: DirectionalWindow,
) -> list[int]:
    if window.step <= 0:
        raise ValueError("DirectionalWindow.step must be positive")
    if window.max_windows is not None and window.max_windows <= 0:
        raise ValueError("DirectionalWindow.max_windows must be positive when provided")
    last_predictable_index = n_rows - prediction_horizon - 1
    if window.start_index > last_predictable_index:
        raise ValueError("start_index leaves no predictable rows")
    indices = list(range(window.start_index, last_predictable_index + 1, window.step))
    if indices[-1] != last_predictable_index:
        indices.append(last_predictable_index)
    if window.max_windows is not None:
        indices = indices[-window.max_windows :]
    return indices


def _build_candidate_records(
    context: _DirectionalContext,
    row_indices: list[int],
    variants: tuple[DirectionalVariant, ...],
) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for variant in variants:
        rows = []
        for row_index in row_indices:
            prediction, probability, selected_features = _predict_directional_variant(
                context,
                row_index,
                variant,
            )
            actual_return = float(
                context.close[row_index + 1] / context.close[row_index] - 1.0
            )
            persistence_prediction = (
                float(context.close[row_index] / context.close[row_index - 1] - 1.0)
                if row_index > 0
                else 0.0
            )
            rows.append(
                {
                    "variant_id": variant.variant_id,
                    "row_index": int(row_index),
                    "datetime": context.frame.loc[row_index, "datetime"],
                    "prediction": prediction,
                    "probability": probability,
                    "actual_return": actual_return,
                    "zero_prediction": 0.0,
                    "persistence_prediction": persistence_prediction,
                    "lower_bound": prediction - 0.01,
                    "upper_bound": prediction + 0.01,
                    "interval_hit": True,
                    "direction_hit": bool((prediction >= 0.0) == (actual_return >= 0.0)),
                    "zero_direction_hit": bool(actual_return >= 0.0),
                    "persistence_direction_hit": bool(
                        (persistence_prediction >= 0.0) == (actual_return >= 0.0)
                    ),
                    "trade_signal": 0,
                    "trade_side": "flat",
                    "trade_reason": "directional_research_no_trade",
                    "trade_edge_after_cost": 0.0,
                    "trade_probability_edge": abs(probability - 0.5),
                    "trade_interval_crosses_zero": True,
                    "gross_strategy_return": 0.0,
                    "strategy_cost": 0.0,
                    "strategy_return": 0.0,
                    "selected_features": "|".join(selected_features),
                    "selected_feature_count": int(len(selected_features)),
                    "training_window": (
                        int(variant.training_window)
                        if variant.training_window is not None
                        else None
                    ),
                    "max_features": int(variant.max_features),
                    "ridge_penalty": float(variant.ridge_penalty),
                    "target_mode": variant.target_mode,
                    "recency_weight": bool(variant.recency_weight),
                }
            )
        frames.append(pd.DataFrame(rows))
    return pd.concat(frames, ignore_index=True)


def _predict_directional_variant(
    context: _DirectionalContext,
    row_index: int,
    variant: DirectionalVariant,
) -> tuple[float, float, tuple[str, ...]]:
    labeled_indices = np.flatnonzero(np.isfinite(context.target_returns[:row_index]))
    if variant.training_window is not None and len(labeled_indices) > variant.training_window:
        labeled_indices = labeled_indices[-variant.training_window :]
    if len(labeled_indices) < 30:
        return 0.0, 0.5, tuple()

    y_returns = context.target_returns[labeled_indices]
    y_class = np.where(y_returns >= 0.0, 1.0, -1.0)
    selected = _select_directional_features(
        context,
        labeled_indices,
        y_returns,
        y_class,
        variant,
    )
    x_train = context.frame.loc[labeled_indices, selected].to_numpy(dtype=float)
    x_row = context.frame.loc[[row_index], selected].to_numpy(dtype=float)
    x_train, x_row = _impute_and_standardize(x_train, x_row)
    y_target = y_class if variant.target_mode == "class" else y_returns
    weights = (
        np.linspace(0.2, 1.0, len(y_target), dtype=float)
        if variant.recency_weight
        else np.ones(len(y_target), dtype=float)
    )
    coefficients = _weighted_ridge_with_intercept(
        x_train,
        y_target,
        variant.ridge_penalty,
        weights,
    )
    design_row = np.r_[1.0, x_row[0]]
    raw_score = float(design_row @ coefficients)

    if variant.target_mode == "class":
        magnitude = max(float(np.nanmedian(np.abs(y_returns))), EPSILON)
        prediction = float(np.sign(raw_score) * magnitude)
        train_scores = np.column_stack([np.ones(len(x_train)), x_train]) @ coefficients
        probability_scale = max(float(np.std(train_scores)), EPSILON)
        probability = float(sigmoid(raw_score / probability_scale))
    else:
        prediction = raw_score
        probability_scale = max(float(np.nanstd(y_returns)), EPSILON)
        probability = float(sigmoid(prediction / probability_scale))
    return prediction, probability, selected


def _select_directional_features(
    context: _DirectionalContext,
    labeled_indices: np.ndarray,
    y_returns: np.ndarray,
    y_class: np.ndarray,
    variant: DirectionalVariant,
) -> tuple[str, ...]:
    scores: list[tuple[float, str]] = []
    for feature in context.feature_names:
        values = pd.to_numeric(
            context.frame.loc[labeled_indices, feature],
            errors="coerce",
        ).to_numpy(dtype=float)
        mask = np.isfinite(values) & np.isfinite(y_returns)
        if mask.sum() < 30:
            score = 0.0
        else:
            target = y_class[mask] if variant.target_mode == "class" else y_returns[mask]
            score = abs(safe_corrcoef(values[mask], target))
            threshold = float(np.nanmedian(values[mask]))
            upper = y_class[mask][values[mask] > threshold]
            lower = y_class[mask][values[mask] <= threshold]
            if len(upper) > 0 and len(lower) > 0:
                score += 0.05 * abs(float(upper.mean() - lower.mean()))
        scores.append((float(score), feature))

    selected: list[str] = []
    for feature in ("close", "returns", "log_return"):
        if feature in context.feature_names and feature not in selected:
            selected.append(feature)
    for _, feature in sorted(scores, key=lambda row: (-row[0], row[1])):
        if feature not in selected:
            selected.append(feature)
        if len(selected) >= variant.max_features:
            break
    return tuple(selected)


def _impute_and_standardize(
    x_train: np.ndarray,
    x_row: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    train = np.asarray(x_train, dtype=float)
    row = np.asarray(x_row, dtype=float)
    medians = np.array(
        [
            float(np.median(column[np.isfinite(column)]))
            if np.isfinite(column).any()
            else 0.0
            for column in train.T
        ],
        dtype=float,
    )
    train = np.where(np.isfinite(train), train, medians)
    row = np.where(np.isfinite(row), row, medians)
    mean = train.mean(axis=0)
    std = train.std(axis=0)
    std = np.where(std > EPSILON, std, 1.0)
    return (train - mean) / std, (row - mean) / std


def _weighted_ridge_with_intercept(
    x_values: np.ndarray,
    target: np.ndarray,
    penalty: float,
    weights: np.ndarray,
) -> np.ndarray:
    design = np.column_stack([np.ones(len(x_values)), x_values])
    safe_weights = np.clip(np.asarray(weights, dtype=float), 0.0, None)
    sqrt_weights = np.sqrt(safe_weights)
    weighted_design = design * sqrt_weights.reshape(-1, 1)
    weighted_target = np.asarray(target, dtype=float) * sqrt_weights
    regularizer = np.eye(design.shape[1]) * max(float(penalty), 0.0)
    regularizer[0, 0] = 0.0
    lhs = weighted_design.T @ weighted_design + regularizer
    rhs = weighted_design.T @ weighted_target
    return np.linalg.pinv(lhs) @ rhs


def _aligned_row_indices(candidate_records: pd.DataFrame, variant_ids: list[str]) -> list[int]:
    expected: list[int] | None = None
    for variant_id in variant_ids:
        indices = (
            candidate_records.loc[
                candidate_records["variant_id"] == variant_id,
                "row_index",
            ]
            .astype(int)
            .tolist()
        )
        if expected is None:
            expected = indices
        elif indices != expected:
            raise ValueError("directional variant records must share aligned row_index values")
    return expected or []


def _metric_values_for_variants(
    summary: pd.DataFrame,
    variants: list[str],
    evaluation_id: str,
    metric: str,
) -> list[float]:
    subset = summary.loc[summary["evaluation_id"].astype(str) == evaluation_id]
    by_variant = subset.set_index(subset["variant_id"].astype(str))
    values: list[float] = []
    for variant in variants:
        if variant not in by_variant.index:
            values.append(float("nan"))
        else:
            values.append(float(by_variant.loc[variant, metric]))
    return values


def _direction_label(prediction: float) -> str:
    if prediction > 0.0:
        return "up"
    if prediction < 0.0:
        return "down"
    return "flat"
