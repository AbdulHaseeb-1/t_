from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np

from src.prism import PRISMConfig
from src.prism.calibration_sweep import (
    CalibrationVariant,
    SweepWindow,
    default_calibration_variants,
    run_calibration_sweep,
    write_calibration_sweep_outputs,
)


def test_default_calibration_variants_keep_default_first():
    config = PRISMConfig()

    variants = default_calibration_variants(config)

    assert variants[0].variant_id == "default"
    assert variants[0].config == config
    assert "min_shrink_025" in {variant.variant_id for variant in variants}
    assert 0.0 not in next(
        variant.config.shrinkage_grid
        for variant in variants
        if variant.variant_id == "min_shrink_025"
    )


def test_run_calibration_sweep_returns_metrics_for_each_variant(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        d_model=4,
        max_selected_features=5,
        required_feature_columns=("close",),
        min_labeled_rows=30,
        max_labeled_rows=None,
        ensemble_size=2,
        max_granger_features=5,
        granger_max_rows=100,
    )
    variants = (
        CalibrationVariant("default", config, "default"),
        CalibrationVariant(
            "min_shrink",
            replace(config, shrinkage_grid=(0.25, 1.0)),
            "nonzero shrinkage",
        ),
    )

    report = run_calibration_sweep(
        market_frame,
        base_config=config,
        evaluation_windows=(SweepWindow("unit", start_index=35, step=20, max_windows=2),),
        variants=variants,
    )

    assert set(report.summary["variant_id"]) == {"default", "min_shrink"}
    assert set(report.summary["evaluation_id"]) == {"unit"}
    assert report.summary["n_windows"].tolist() == [2.0, 2.0]
    assert np.isfinite(report.summary["mae_improvement_vs_best_baseline"]).all()


def test_write_calibration_sweep_outputs_creates_csv_and_png(market_frame):
    config = PRISMConfig(
        feature_columns=("open", "high", "low", "close", "volume"),
        d_model=4,
        max_selected_features=5,
        required_feature_columns=("close",),
        min_labeled_rows=30,
        max_labeled_rows=None,
        ensemble_size=2,
        max_granger_features=5,
        granger_max_rows=100,
    )
    report = run_calibration_sweep(
        market_frame,
        base_config=config,
        evaluation_windows=(SweepWindow("unit", start_index=35, step=20, max_windows=2),),
        variants=(CalibrationVariant("default", config, "default"),),
    )

    paths = write_calibration_sweep_outputs(
        report,
        output_dir=Path("reports/test_calibration_sweep_outputs"),
    )

    assert paths["summary"].exists()
    assert paths["plot"].exists()
