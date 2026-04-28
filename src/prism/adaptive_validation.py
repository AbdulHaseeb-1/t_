from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.evaluation import calculate_backtest_metrics, walk_forward_backtest
from src.prism.regime_validation import build_regime_summary


DEFAULT_MODEL_CANDIDATES: tuple[tuple[str, int | None], ...] = (
    ("full_history", None),
    ("rolling_12000", 12_000),
    ("rolling_6000", 6_000),
)


@dataclass(frozen=True)
class ModelCandidate:
    model_id: str
    config: PRISMConfig


@dataclass(frozen=True)
class AdaptiveValidationReport:
    candidate_records: pd.DataFrame
    adaptive_records: pd.DataFrame
    model_summary: pd.DataFrame
    regime_summary: pd.DataFrame


def run_adaptive_model_validation(
    raw_frame: pd.DataFrame,
    base_config: PRISMConfig | None = None,
    *,
    start_index: int = 5000,
    step: int = 1000,
    max_windows: int | None = None,
    min_selection_windows: int = 8,
    default_model_id: str = "rolling_12000",
    candidates: tuple[ModelCandidate, ...] | None = None,
) -> AdaptiveValidationReport:
    cfg = base_config or PRISMConfig()
    candidate_configs = candidates or default_model_candidates(cfg)
    candidate_frames: list[pd.DataFrame] = []

    for candidate in candidate_configs:
        result = walk_forward_backtest(
            raw_frame,
            candidate.config,
            start_index=start_index,
            step=step,
            max_windows=max_windows,
        )
        frame = result.records.copy()
        frame["model_id"] = candidate.model_id
        candidate_frames.append(frame)

    candidate_records = pd.concat(candidate_frames, ignore_index=True)
    adaptive_records = build_adaptive_records(
        candidate_records,
        min_selection_windows=min_selection_windows,
        default_model_id=default_model_id,
    )
    model_summary = summarize_model_candidates(candidate_records, adaptive_records)
    regime_summary = build_regime_summary(adaptive_records)
    return AdaptiveValidationReport(
        candidate_records=candidate_records,
        adaptive_records=adaptive_records,
        model_summary=model_summary,
        regime_summary=regime_summary,
    )


def default_model_candidates(base_config: PRISMConfig) -> tuple[ModelCandidate, ...]:
    return tuple(
        ModelCandidate(
            model_id=model_id,
            config=replace(base_config, max_labeled_rows=max_labeled_rows),
        )
        for model_id, max_labeled_rows in DEFAULT_MODEL_CANDIDATES
    )


def build_adaptive_records(
    candidate_records: pd.DataFrame,
    *,
    min_selection_windows: int = 8,
    default_model_id: str = "rolling_12000",
) -> pd.DataFrame:
    if min_selection_windows <= 0:
        raise ValueError("min_selection_windows must be positive")
    if candidate_records.empty:
        raise ValueError("candidate_records must not be empty")
    required = {"model_id", "row_index", "prediction", "actual_return"}
    missing = sorted(required - set(candidate_records.columns))
    if missing:
        raise ValueError(f"candidate_records missing required columns: {missing}")

    model_ids = list(dict.fromkeys(candidate_records["model_id"].astype(str)))
    if default_model_id not in model_ids:
        default_model_id = model_ids[0]
    row_indices = _aligned_row_indices(candidate_records, model_ids)
    sorted_records = candidate_records.sort_values(["row_index", "model_id"]).reset_index(
        drop=True,
    )
    adaptive_rows: list[pd.Series] = []

    for position, row_index in enumerate(row_indices):
        if position < min_selection_windows:
            selected_model = default_model_id
            selection_reason = "insufficient_prior_windows"
            selection_mae = float("nan")
            selection_rmse = float("nan")
        else:
            prior = sorted_records.loc[sorted_records["row_index"].isin(row_indices[:position])]
            selected = select_model_from_prior(prior, model_ids)
            selected_model = str(selected["model_id"])
            selection_reason = "lowest_prior_mae"
            selection_mae = float(selected["mae"])
            selection_rmse = float(selected["rmse"])

        row = sorted_records.loc[
            (sorted_records["row_index"] == row_index)
            & (sorted_records["model_id"] == selected_model)
        ].iloc[0].copy()
        row["selected_model_id"] = selected_model
        row["model_selection_reason"] = selection_reason
        row["model_selection_training_windows"] = position
        row["model_selection_training_mae"] = selection_mae
        row["model_selection_training_rmse"] = selection_rmse
        adaptive_rows.append(row)

    return pd.DataFrame(adaptive_rows).reset_index(drop=True)


def select_model_from_prior(
    prior_records: pd.DataFrame,
    model_ids: list[str],
) -> dict[str, float | str]:
    if prior_records.empty:
        raise ValueError("prior_records must not be empty")

    candidates: list[dict[str, float | str]] = []
    for model_id in model_ids:
        subset = prior_records.loc[prior_records["model_id"] == model_id]
        if subset.empty:
            continue
        errors = subset["prediction"].to_numpy(dtype=float) - subset[
            "actual_return"
        ].to_numpy(dtype=float)
        candidates.append(
            {
                "model_id": model_id,
                "mae": float(np.mean(np.abs(errors))),
                "rmse": float(np.sqrt(np.mean(errors**2))),
                "directional_accuracy": float(
                    (
                        (subset["prediction"].to_numpy(dtype=float) >= 0.0)
                        == (subset["actual_return"].to_numpy(dtype=float) >= 0.0)
                    ).mean()
                ),
                "n_windows": float(len(subset)),
            }
        )
    if not candidates:
        raise ValueError("no model candidates available in prior_records")
    candidates.sort(
        key=lambda row: (
            float(row["mae"]),
            float(row["rmse"]),
            -float(row["directional_accuracy"]),
            str(row["model_id"]),
        )
    )
    return candidates[0]


def summarize_model_candidates(
    candidate_records: pd.DataFrame,
    adaptive_records: pd.DataFrame,
) -> pd.DataFrame:
    rows: list[dict[str, float | str]] = []
    for model_id, subset in candidate_records.groupby("model_id", sort=False):
        metrics = calculate_backtest_metrics(subset.reset_index(drop=True))
        rows.append(
            {
                "model_id": str(model_id),
                "selection_count": float(
                    (adaptive_records["selected_model_id"] == model_id).sum()
                ),
                "summary_type": "candidate",
                **metrics,
            }
        )
    adaptive_metrics = calculate_backtest_metrics(adaptive_records.reset_index(drop=True))
    rows.append(
        {
            "model_id": "adaptive_selector",
            "selection_count": float(len(adaptive_records)),
            "summary_type": "adaptive",
            **adaptive_metrics,
        }
    )
    return pd.DataFrame(rows)


def write_adaptive_validation_outputs(
    report: AdaptiveValidationReport,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    candidate_records_path = output_dir / "adaptive_candidate_records.csv"
    adaptive_records_path = output_dir / "adaptive_selected_records.csv"
    model_summary_path = output_dir / "adaptive_model_summary.csv"
    regime_summary_path = output_dir / "adaptive_regime_validation.csv"
    plot_path = output_dir / "adaptive_model_validation.png"

    report.candidate_records.to_csv(candidate_records_path, index=False)
    report.adaptive_records.to_csv(adaptive_records_path, index=False)
    report.model_summary.to_csv(model_summary_path, index=False)
    report.regime_summary.to_csv(regime_summary_path, index=False)
    write_adaptive_validation_plot(report.model_summary, plot_path)
    return {
        "candidate_records": candidate_records_path,
        "adaptive_records": adaptive_records_path,
        "model_summary": model_summary_path,
        "regime_summary": regime_summary_path,
        "plot": plot_path,
    }


def write_adaptive_validation_plot(summary: pd.DataFrame, plot_path: Path) -> Path:
    if summary.empty:
        raise ValueError("summary must not be empty")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plot_path.parent.mkdir(parents=True, exist_ok=True)
    labels = summary["model_id"].astype(str).str.replace("_", " ", regex=False)
    x_values = np.arange(len(summary))

    plt.style.use("seaborn-v0_8-whitegrid")
    figure, axes = plt.subplots(
        3,
        1,
        figsize=(13.5, 10.0),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")

    axes[0].bar(x_values, summary["mae_improvement_vs_best_baseline"], color="#4b7f8c")
    axes[0].axhline(0.0, color="#394247", linewidth=1.0)
    axes[0].set_title("MAE Edge", loc="left", fontweight="bold")
    axes[0].set_ylabel("MAE edge")

    axes[1].bar(x_values, summary["rmse_improvement_vs_best_baseline"], color="#766f9b")
    axes[1].axhline(0.0, color="#394247", linewidth=1.0)
    axes[1].set_title("RMSE Edge", loc="left", fontweight="bold")
    axes[1].set_ylabel("RMSE edge")

    axes[2].bar(x_values, summary["selection_count"], color="#6f8f52")
    axes[2].set_title("Adaptive Selection Count", loc="left", fontweight="bold")
    axes[2].set_ylabel("Selected windows")

    for axis in axes:
        axis.set_facecolor("#fffaf1")
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(True, alpha=0.35)

    axes[-1].set_xticks(x_values)
    axes[-1].set_xticklabels(labels, rotation=15, ha="right")
    axes[-1].set_xlabel("Model candidate")
    figure.suptitle(
        "PRISM Adaptive Model Validation",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    plt.close(figure)
    return plot_path


def _aligned_row_indices(candidate_records: pd.DataFrame, model_ids: list[str]) -> list[int]:
    expected: list[int] | None = None
    for model_id in model_ids:
        indices = (
            candidate_records.loc[candidate_records["model_id"] == model_id, "row_index"]
            .astype(int)
            .tolist()
        )
        if expected is None:
            expected = indices
        elif indices != expected:
            raise ValueError("candidate model records must share aligned row_index values")
    return expected or []
