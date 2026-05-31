# Bitunix Exchange

Self-hostable multi-user grid trading bot for Bitunix Futures, adapted
from GRVT Grid. It includes a real-time web dashboard, encrypted API
credentials, backtesting, and optional Telegram alerts.

Create a Bitunix account here if you need one:
[https://www.bitunix.com/register?inviteCode=xmba1f](https://www.bitunix.com/register?inviteCode=xmba1f)

## Use It

### Option 1: Hosted instance

Use the hosted bot at [bots.prosperollc.com](https://bots.prosperollc.com).
Create an account, paste your Bitunix API credentials, configure a grid,
and the bot trades through your Bitunix Futures account.

The server stores API credentials encrypted at rest with AES-256-GCM.
Because the bot must decrypt credentials in memory to place orders, the
server operator technically has access to the keys. If you need zero
third-party access, self-host your own copy.

### Option 2: Self-host

See [docs/INSTALL.md](docs/INSTALL.md) for the full setup. Quick version:

```bash
git clone https://github.com/joseluis9197/Bitunix-Exchange.git
cd Bitunix-Exchange
npm install
npm run build

# generate the encryption master key (32 random bytes, file 0600)
sudo mkdir -p /etc/grvt-grid
sudo sh -c 'head -c 32 /dev/urandom > /etc/grvt-grid/master.key'
sudo chmod 600 /etc/grvt-grid/master.key

# copy and fill the example env
cp packages/bot/.env.example packages/bot/.env

# run the bot
node packages/bot/dist/dashboard/server.js
```

## What It Does

- Grid trading on Bitunix Futures with configurable range, grid count,
  leverage, compounding, stop-loss, take-profit, safeguard pauses,
  auto-shift, and backtesting.
- Per-bot virtual grid so the bot keeps an active window of orders
  around current price and shifts as price moves.
- Multi-user, multi-bot operation with isolated encrypted exchange
  credentials per user.
- Real-time dashboard with equity, per-bot stats, fills, position, PnL,
  alerts, and WebSocket updates.
- Optional Telegram alerts for fills, drawdowns, liquidation proximity,
  and daily summaries.

## Architecture

```text
packages/
  bot/         Engine + REST API + WebSocket server (Node, TypeScript)
  dashboard/   SPA frontend (Vite + React + Tailwind + Recharts)
  notifier/    Standalone Telegram alerts worker
scripts/       Backup + admin utilities
docs/          Install, rollback, operational notes
```

Data lives in SQLite at `data/grid_bot.db`. User passwords are
bcrypt-hashed, and exchange API credentials are encrypted with a master
key stored on disk. See [SECURITY.md](SECURITY.md).

## Status

Bitunix integration is active and tested against the bot suite. This
fork keeps the original AGPL license and publishes the Bitunix changes
openly.

## Contributing

Run the checks from the repo root:

```bash
npm run test --workspace=@grvt-grid/bot
npm run build
```

PRs that add features should include tests; PRs that fix bugs should
include a regression test.

## License

[AGPL-3.0-or-later](LICENSE). You are free to use, modify, and
self-host this code. If you modify it and run it as a network service,
you must publish your modifications under the same license.

## Security

Vulnerability reports: do not open a public GitHub issue. See
[SECURITY.md](SECURITY.md) for the reporting process and full threat
model.
