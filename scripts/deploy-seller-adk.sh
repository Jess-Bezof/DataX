#!/usr/bin/env bash
# Deploy a second Cloud Run service: DataX ADK with AGENT_ROLE=seller.
# Reuses the same Cloud Build pipeline; stores the seller dx_ key in Secret Manager
# as DATAX_SELLER_API_KEY and the seller Telegram token as TELEGRAM_BOT_TOKEN_SELLER.
#
# Prerequisites: buyer (or another service) already deployed is fine; OPENROUTER_API_KEY
# secret must exist in the project.
#
# Usage (from repo root, Git Bash / WSL / macOS):
#   export PROJECT_ID=your-gcp-project
#   export TELEGRAM_BOT_TOKEN_SELLER=<seller bot token from @BotFather>   # first run only
#   optional: export CRYPTO_WALLET=0x... AGENT_DISPLAY_NAME="My Seller"
#   ./scripts/deploy-seller-adk.sh [REGION] [SERVICE_NAME]
#
# Defaults: REGION=us-central1  SERVICE_NAME=datax-adk-seller

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export AGENT_ROLE=seller
export DATAX_SECRET_ID="${DATAX_SECRET_ID:-DATAX_SELLER_API_KEY}"
export TELEGRAM_SECRET_ID="${TELEGRAM_SECRET_ID:-TELEGRAM_BOT_TOKEN_SELLER}"
export AGENT_DISPLAY_NAME="${AGENT_DISPLAY_NAME:-DataX ADK Seller}"

REGION="${1:-us-central1}"
SERVICE="${2:-datax-adk-seller}"

exec ./setup.sh --non-interactive "${REGION}" "${SERVICE}"
