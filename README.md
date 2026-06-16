# Finance Bot

Telegram bot for recording expenses into [Sure](https://github.com/we-promise/sure) — a web-based personal finance system.

## Features

- Add expenses via a multi-step wizard (description, amount, date, category, account)
- View account balances and total net balance
- Optional category selection (toggle with `/toggle_categories`)
- API keys are encrypted at rest (AES-256-CBC)

## Requirements

- Node.js 20+
- A running [Sure](https://github.com/we-promise/sure) instance with API access
- Telegram bot token (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable             | Description                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather                                                                                                               |
| `API_BASE_URL`       | Sure API base URL (e.g. `http://192.168.18.24:3000/api/v1`)                                                                             |
| `ENCRYPTION_KEY`     | 64-character hex key for encrypting API keys (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |

Install and run:

```bash
npm install
npm start
```

Or with Docker:

```bash
docker-compose up -d
```

## Commands

| Command              | Action                                                 |
| -------------------- | ------------------------------------------------------ |
| `/start`             | Welcome message                                        |
| `/reset`             | Set or change your Sure API key                        |
| `/create`            | Create a new expense                                   |
| `/balance`           | View account balances                                  |
| `/delete`            | Remove your stored API key                             |
| `/toggle_categories` | Enable/disable category prompt during expense creation |
| `/new`               | (Deprecated — use `/create`)                           |

## Development

```bash
npm run dev
```

Uses nodemon to auto-restart on file changes.
