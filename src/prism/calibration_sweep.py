from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

from src.prism.config import PRISMConfig
from src.prism.evaluation import walk_forward_backtest


@dataclass(frozen=True)
class SweepWindow:
    evaluation_id: str
    start_index: int = 5000
    step: int = 1000
    max_windows: int | None = None


@dataclass(frozen=True)
class CalibrationVariant:
    variant_id: str
    config: PRISMConfig
    description: str


@dataclass(frozen=True)
class CalibrationSweepReport:
    summary: pd.DataFrame


def default_calibration_variants(
    base_config: PRISMConfig,
) -> tuple[CalibrationVariant, ...]:
    return (
        CalibrationVariant(
            "default",
            base_config,
            "Current split-conformal calibration with zero shrinkage allowed.",
        ),
        CalibrationVariant(
            "no_zero_shrink",
            replace(
                base_config,
                shrinkage_grid=(0.1, 0.2, 0.35, 0.5, 0.75, 1.0),
            ),
            "Prevents the ridge signal from being completely shrunk to zero.",
        ),
        CalibrationVariant(
            "min_shrink_025",
            replace(base_config, shrinkage_grid=(0.25, 0.5, 0.75, 1.0)),
            "Requires at least 25% of the ridge signal after calibration.",
        ),
        CalibrationVariant(
            "no_tiny_cap",
            replace(
                base_config,
                magnitude_cap_quantiles=(0.5, 0.75, 1.0),
                min_magnitude_cap=2e-5,
            ),
            "Prevents the magnitude cap from collapsing to tiny forecasts.",
        ),
        CalibrationVariant(
            "no_zero_no_tiny_cap",
            replace(
                base_config,
                shrinkage_grid=(0.1, 0.2, 0.35, 0.5, 0.75, 1.0),
                magnitude_cap_quantiles=(0.5, 0.75, 1.0),
                min_magnitude_cap=2e-5,
            ),
            "Combines nonzero shrinkage with a less aggressive magnitude cap.",
        ),
        CalibrationVariant(
            "raw_ridge_no_clip",
            replace(
                base_config,
                shrinkage_grid=(1.0,),
                magnitude_cap_quantiles=(1.0,),
                min_magnitude_cap=1e9,
            ),
            "Keeps the raw ridge ensemble signal with effectively no shrink/cap.",
        ),
    )


def run_calibration_sweep(
    raw_frame: pd.DataFrame,
    base_config: PRISMConfig | None = None,
    *,
    evaluation_windows: tuple[SweepWindow, ...] | None = None,
    variants: tuple[CalibrationVariant, ...] | None = None,
) -> CalibrationSweepReport:
    cfg = base_config or PRISMConfig()
    windows = evaluation_windows or (
        SweepWindow("broad_regime", start_index=5000, step=1000),
        SweepWindow("dense_recent", start_index=5000, step=100, max_windows=24),
    )
    candidate_variants = variants or default_calibration_variants(cfg)
    rows: list[dict[str, float | int | str | None]] = []

    for window in windows:
        if window.step <= 0:
            raise ValueError("SweepWindow.step must be positive")
        if window.max_windows is not None and window.max_windows <= 0:
            raise ValueError("SweepWindow.max_windows must be positive when provided")
        for variant in candidate_variants:
            result = walk_forward_backtest(
                raw_frame,
                variant.config,
                start_index=window.start_index,
                step=window.step,
                max_windows=window.max_windows,
            )
            rows.append(
                {
                    "evaluation_id": window.evaluation_id,
                    "start_index": int(window.start_index),
                    "step": int(window.step),
                    "max_windows": (
                        int(window.max_windows)
                        if window.max_windows is not None
                        else None
                    ),
                    "variant_id": variant.variant_id,
                    "description": variant.description,
                    "shrinkage_grid": repr(variant.config.shrinkage_grid),
                    "magnitude_cap_quantiles": repr(
                        variant.config.magnitude_cap_quantiles,
                    ),
                    "min_magnitude_cap": float(variant.config.min_magnitude_cap),
                    **result.metrics,
                }
            )

    return CalibrationSweepReport(summary=pd.DataFrame(rows))


def write_calibration_sweep_outputs(
    report: CalibrationSweepReport,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "calibration_sweep_summary.csv"
    plot_path = output_dir / "calibration_sweep.png"
    report.summary.to_csv(summary_path, index=False)
    write_calibration_sweep_plot(report.summary, plot_path)
    return {"summary": summary_path, "plot": plot_path}


def write_calibration_sweep_plot(summary: pd.DataFrame, plot_path: Path) -> Path:
    if summary.empty:
        raise ValueError("summary must not be empty")

    required = {
        "evaluation_id",
        "variant_id",
        "mae_improvement_vs_best_baseline",
        "rmse_improvement_vs_best_baseline",
        "directional_accuracy",
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
        figsize=(15.0, 11.5),
        sharex=True,
        constrained_layout=True,
    )
    figure.patch.set_facecolor("#f8f3ea")
    metrics = (
        ("mae_improvement_vs_best_baseline", "MAE Edge"),
        ("rmse_improvement_vs_best_baseline", "RMSE Edge"),
        ("directional_accuracy", "Directional Accuracy"),
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
        if metric != "directional_accuracy":
            axis.axhline(0.0, color="#394247", linewidth=1.0)
        else:
            axis.set_ylim(0.0, 1.05)
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
    axes[-1].set_xlabel("Calibration variant")
    figure.suptitle(
        "PRISM Calibration Sweep",
        x=0.01,
        y=1.02,
        ha="left",
        fontsize=18,
        fontweight="bold",
    )
    figure.savefig(plot_path, dpi=180, bbox_inches="tight")
    plt.close(figure)
    return plot_path


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
