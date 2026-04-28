from __future__ import annotations

import numpy as np
import pytest

from src.prism.config import PRISMConfig
from src.prism.mod_router import ModalityRouter


@pytest.mark.parametrize("modality", ["tabular", "temporal", "graph", "hybrid"])
def test_l0_router_outputs_stable_d_model_for_all_modalities(market_frame, modality):
    feature_names = ("open", "high", "low", "close", "volume")
    config = PRISMConfig(
        modality=modality,
        d_model=6,
        feature_columns=feature_names,
        temporal_window=8,
    )

    encoding = ModalityRouter(config).encode(market_frame, feature_names)

    assert encoding.values.shape == (len(market_frame), 6)
    assert encoding.feature_names == feature_names
    assert encoding.modality == modality
    assert np.isfinite(encoding.values).all()
    assert encoding.diagnostics == {
        "rows": len(market_frame),
        "input_features": len(feature_names),
        "d_model": 6,
        "fitted_rows": len(market_frame),
        "fit_strategy": "train_indices",
    }


@pytest.mark.parametrize("modality", ["tabular", "temporal", "graph", "hybrid"])
def test_l0_fitted_encoding_does_not_change_when_holdout_row_changes(
    market_frame,
    modality,
):
    feature_names = ("open", "high", "low", "close", "volume")
    config = PRISMConfig(
        modality=modality,
        d_model=6,
        feature_columns=feature_names,
        temporal_window=8,
    )
    fit_indices = np.arange(0, 120)
    baseline = market_frame.copy()
    shifted_holdout = market_frame.copy()
    shifted_holdout.loc[150:, "close"] = shifted_holdout.loc[150:, "close"] + 10.0
    router = ModalityRouter(config)

    baseline_encoding = router.encode(baseline, feature_names, fit_indices=fit_indices)
    shifted_encoding = router.encode(shifted_holdout, feature_names, fit_indices=fit_indices)

    np.testing.assert_allclose(
        baseline_encoding.values[:120],
        shifted_encoding.values[:120],
        atol=1e-12,
    )
    assert baseline_encoding.diagnostics["fitted_rows"] == len(fit_indices)


def test_l0_rejects_unknown_modality():
    with pytest.raises(ValueError, match="Unsupported modality"):
        PRISMConfig(modality="image")  # type: ignore[arg-type]
