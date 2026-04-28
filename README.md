# PRISM Prototype

Deterministic PRISM research prototype for market-return prediction, reasoning traces, conformal uncertainty, and cost-aware trade gating.

## BTC/Binance Workflow

```powershell
make data-btc
make validate-btc
make engineer-btc
make run-btc
make backtest-btc
make paper-trade-btc
make paper-trade-btc-full
make data-btc-15m
make paper-trade-btc-15m-full
make paper-trade-btc-15m-2y
make features-btc-15m-plot
make data-btc-5m
make paper-trade-btc-5m-full
```

Default BTC dataset:

- `data/raw/binance_BTCUSDT_1h.csv`
- `data/raw/binance_BTCUSDT_15m.csv`
- `data/raw/binance_BTCUSDT_5m.csv`
- `data/processed/binance_BTCUSDT_1h_engineered.csv`

BTCUSDT is used as the Binance spot BTC/USD proxy.

## Quality Gates

```powershell
make test
make validate
```

The backtest appends metrics to `reports/backtest_history.csv` and regenerates `reports/backtest_history.png`.
The paper-trading report writes a concise trading summary to `reports/directional_paper_summary.csv`.
Use `make paper-trade-btc-full` for a full-period walk-forward paper test from the earliest usable BTC row to the latest predictable row.
