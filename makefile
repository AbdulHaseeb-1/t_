PYTHON=python
BTC_DATA=data/raw/binance_BTCUSDT_1h.csv
BTC_5M_DATA=data/raw/binance_BTCUSDT_5m.csv
BTC_15M_DATA=data/raw/binance_BTCUSDT_15m.csv
BTC_FEATURES=data/processed/binance_BTCUSDT_1h_engineered.csv

.PHONY: install test run run-btc validate validate-btc validate-btc-5m validate-btc-15m engineer engineer-btc data-btc data-btc-5m data-btc-15m backtest backtest-btc regime-btc adaptive-btc calibration-sweep-btc directional-btc paper-trade-btc paper-trade-btc-full paper-trade-btc-5m-full paper-trade-btc-15m-full paper-trade-btc-15m-2y features-btc-15m-plot clean

install:
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m pytest -q

run:
	$(PYTHON) -m src.main

run-btc:
	$(PYTHON) -m src.main --data-path $(BTC_DATA)

validate:
	$(PYTHON) -m src.utils.validation

validate-btc:
	$(PYTHON) -m src.utils.validation --data-path $(BTC_DATA)

validate-btc-5m:
	$(PYTHON) -m src.utils.validation --data-path $(BTC_5M_DATA)

validate-btc-15m:
	$(PYTHON) -m src.utils.validation --data-path $(BTC_15M_DATA)

engineer:
	$(PYTHON) -m src.features.feature_engineering

engineer-btc:
	$(PYTHON) -m src.features.feature_engineering --data-path $(BTC_DATA) --output-path $(BTC_FEATURES)

data-btc:
	$(PYTHON) -m src.data.binance_download --symbol BTCUSDT --interval 1h --start-date 2021-01-01 --output-path $(BTC_DATA)

data-btc-5m:
	$(PYTHON) -m src.data.binance_download --symbol BTCUSDT --interval 5m --start-date 2021-01-01 --output-path $(BTC_5M_DATA)

data-btc-15m:
	$(PYTHON) -m src.data.binance_download --symbol BTCUSDT --interval 15m --start-date 2021-01-01 --output-path $(BTC_15M_DATA)

backtest:
	$(PYTHON) -m src.backtest.prism_backtest

backtest-btc:
	$(PYTHON) -m src.backtest.prism_backtest --data-path $(BTC_DATA) --start-index 5000 --step 100 --max-windows 24 --label btc_rolling_12000_feature_selection_12

regime-btc:
	$(PYTHON) -m src.backtest.regime_validation --data-path $(BTC_DATA) --start-index 5000 --step 1000

adaptive-btc:
	$(PYTHON) -m src.backtest.adaptive_validation --data-path $(BTC_DATA) --start-index 5000 --step 1000

calibration-sweep-btc:
	$(PYTHON) -m src.backtest.calibration_sweep --data-path $(BTC_DATA)

directional-btc:
	$(PYTHON) -m src.backtest.directional_accuracy --data-path $(BTC_DATA)

paper-trade-btc:
	$(PYTHON) -m src.backtest.directional_paper_trading --data-path $(BTC_DATA)

paper-trade-btc-full:
	$(PYTHON) -m src.backtest.directional_paper_trading --data-path $(BTC_DATA) --full-history

paper-trade-btc-5m-full:
	$(PYTHON) -m src.backtest.directional_paper_trading --data-path $(BTC_5M_DATA) --full-history --output-dir reports/btc_5m

paper-trade-btc-15m-full:
	$(PYTHON) -m src.backtest.directional_paper_trading --data-path $(BTC_15M_DATA) --full-history --output-dir reports/btc_15m

paper-trade-btc-15m-2y:
	$(PYTHON) -m src.backtest.directional_paper_trading --data-path $(BTC_15M_DATA) --full-history --last-years 2 --output-dir reports/btc_15m_2y

features-btc-15m-plot:
	$(PYTHON) -m src.features.feature_visualization --data-path $(BTC_15M_DATA) --output-path reports/btc_15m/feature_visualization.png --title "BTCUSDT 15m Feature Overview"

clean:
	$(PYTHON) -c "from pathlib import Path; import shutil; [shutil.rmtree(p) for p in Path('.').rglob('__pycache__') if p.is_dir()]"
