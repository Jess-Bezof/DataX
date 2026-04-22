#!/usr/bin/env bash
# One-time / repeat Cloud setup for the DataX ADK agent, then deploy via Cloud Build.
#
# Interactive (default): prompts for project, region, OpenRouter key, agent options, etc.
#
# Usage:
#   chmod +x setup.sh   # once
#   gcloud auth login
#   ./setup.sh
#
# Non-interactive (CI / automation): set env vars and pass --non-interactive
#   export OPENROUTER_API_KEY=sk-or-v1-...
#   export PROJECT_ID=my-gcp-project   # optional if gcloud default is set
#   ./setup.sh --non-interactive [REGION] [SERVICE_NAME]
#
# Environment (optional overrides; also used in non-interactive mode):
#   PROJECT_ID / GOOGLE_CLOUD_PROJECT  GCP project (non-interactive fallback)
#   OPENROUTER_API_KEY                 creates Secret if missing (non-interactive or after prompt)
#   AGENT_ROLE, AGENT_DISPLAY_NAME, CRYPTO_WALLET, DATAX_URL, DATAX_ADK_MODEL
#   SETUP_NON_INTERACTIVE=1            same as --non-interactive
#
# Requires: gcloud CLI, bash (Git Bash or WSL on Windows).

set -euo pipefail

NON_INTERACTIVE=false
POSITIONAL_REGION=""
POSITIONAL_SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive|-y)
      NON_INTERACTIVE=true
      shift
      ;;
    -h|--help)
      sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "${POSITIONAL_REGION}" ]]; then
        POSITIONAL_REGION="$1"
      elif [[ -z "${POSITIONAL_SERVICE}" ]]; then
        POSITIONAL_SERVICE="$1"
      else
        echo "Unknown argument: $1 (try --help)"
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ "${SETUP_NON_INTERACTIVE:-}" == "1" ]]; then
  NON_INTERACTIVE=true
fi

# Defaults (non-interactive & base defaults for prompts)
REGION="${POSITIONAL_REGION:-us-central1}"
SERVICE_NAME="${POSITIONAL_SERVICE:-datax-adk-agent}"
AGENT_ROLE="${AGENT_ROLE:-buyer}"
AGENT_DISPLAY_NAME="${AGENT_DISPLAY_NAME:-DataX ADK Agent}"
CRYPTO_WALLET="${CRYPTO_WALLET:-}"
DATAX_URL="${DATAX_URL:-}"
DATAX_ADK_MODEL="${DATAX_ADK_MODEL:-}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

DEFAULT_MODEL="openrouter/openai/gpt-4o-mini"
DEFAULT_DATAX_URL="https://data-xaidar.vercel.app"

if [[ "${NON_INTERACTIVE}" != "true" ]]; then
  echo ""
  echo "=== DataX ADK agent — Cloud setup ==="
  echo ""

  _cur_proj="$(gcloud config get-value project 2>/dev/null || true)"
  [[ "${_cur_proj}" == "(unset)" || -z "${_cur_proj}" ]] && _cur_proj=""

  read -r -p "Google Cloud project ID${_cur_proj:+ [${_cur_proj}]}: " _in_proj
  if [[ -z "${_in_proj}" ]]; then
    PROJECT_ID="${_cur_proj}"
  else
    PROJECT_ID="${_in_proj}"
  fi
  if [[ -z "${PROJECT_ID}" ]]; then
    echo "Project ID is required."
    exit 1
  fi

  read -r -p "Set as default gcloud project? [Y/n]: " _setdef
  if [[ -z "${_setdef}" || "${_setdef}" =~ ^[Yy] ]]; then
    gcloud config set project "${PROJECT_ID}"
  fi

  if ! gcloud secrets describe OPENROUTER_API_KEY --project="${PROJECT_ID}" &>/dev/null; then
    if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
      read -r -s -p "OpenRouter API key (sk-or-v1-..., input hidden): " OPENROUTER_API_KEY
      echo ""
      if [[ -z "${OPENROUTER_API_KEY}" ]]; then
        echo "OpenRouter API key is required when secret OPENROUTER_API_KEY does not exist yet."
        exit 1
      fi
    fi
  fi

  if ! gcloud secrets describe TELEGRAM_BOT_TOKEN --project="${PROJECT_ID}" &>/dev/null; then
    if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
      read -r -s -p "Telegram bot token (from @BotFather, leave blank to skip): " TELEGRAM_BOT_TOKEN
      echo ""
    fi
  fi

  read -r -p "Deploy region [${REGION}]: " _in_reg
  [[ -n "${_in_reg}" ]] && REGION="${_in_reg}"

  read -r -p "Cloud Run service name [${SERVICE_NAME}]: " _in_svc
  [[ -n "${_in_svc}" ]] && SERVICE_NAME="${_in_svc}"

  read -r -p "Agent role on DataX (buyer/seller) [${AGENT_ROLE}]: " _in_role
  if [[ -n "${_in_role}" ]]; then
    AGENT_ROLE="${_in_role}"
  fi
  AGENT_ROLE="$(printf '%s' "${AGENT_ROLE}" | tr '[:upper:]' '[:lower:]')"

  read -r -p "Agent display name on DataX [${AGENT_DISPLAY_NAME}]: " _in_disp
  if [[ -n "${_in_disp}" ]]; then
    AGENT_DISPLAY_NAME="${_in_disp}"
  fi

  if [[ "${AGENT_ROLE}" == "seller" ]]; then
    read -r -p "Seller crypto payout wallet (0x...) [${CRYPTO_WALLET:-none}]: " _in_wallet
    if [[ -n "${_in_wallet}" ]]; then
      CRYPTO_WALLET="${_in_wallet}"
    fi
  fi

  read -r -p "DataX base URL [${DEFAULT_DATAX_URL}]: " _in_datx
  if [[ -n "${_in_datx}" ]]; then
    DATAX_URL="${_in_datx}"
  else
    DATAX_URL="${DEFAULT_DATAX_URL}"
  fi

  _model_default="${DATAX_ADK_MODEL:-${DEFAULT_MODEL}}"
  read -r -p "LLM model (LiteLLM id) [${_model_default}]: " _in_model
  if [[ -n "${_in_model}" ]]; then
    DATAX_ADK_MODEL="${_in_model}"
  else
    DATAX_ADK_MODEL="${_model_default}"
  fi

  echo ""
  echo "Summary: project=${PROJECT_ID} region=${REGION} service=${SERVICE_NAME}"
  echo "         role=${AGENT_ROLE} displayName=${AGENT_DISPLAY_NAME}"
  echo "         dataxUrl=${DATAX_URL} model=${DATAX_ADK_MODEL}"
  echo ""
  read -r -p "Continue with APIs, IAM, and Cloud Build? [Y/n]: " _go
  if [[ -n "${_go}" && ! "${_go}" =~ ^[Yy] ]]; then
    echo "Aborted."
    exit 1
  fi
else
  # Non-interactive: resolve project
  PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  if [[ -z "${PROJECT_ID}" ]]; then
    PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
    [[ "${PROJECT_ID}" == "(unset)" ]] && PROJECT_ID=""
  fi
  if [[ -z "${PROJECT_ID}" ]]; then
    echo "Non-interactive mode: set PROJECT_ID or GOOGLE_CLOUD_PROJECT, or gcloud config set project"
    exit 1
  fi
  if [[ -z "${DATAX_ADK_MODEL}" ]]; then
    DATAX_ADK_MODEL="${DEFAULT_MODEL}"
  fi
  if [[ -z "${DATAX_URL}" ]]; then
    DATAX_URL="${DEFAULT_DATAX_URL}"
  fi
fi

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
CR_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo ""
echo "Project: ${PROJECT_ID} (${PROJECT_NUMBER})"
echo "Region:  ${REGION}  Service: ${SERVICE_NAME}  Role: ${AGENT_ROLE}"
echo ""

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}"

if ! gcloud artifacts repositories describe cloud-run-source-deploy \
  --location="${REGION}" \
  --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating Artifact Registry repository cloud-run-source-deploy..."
  gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Cloud Run images" \
    --project="${PROJECT_ID}"
fi

echo "Granting Cloud Build service account Secret Manager admin..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.admin" \
  --condition=None

if gcloud secrets describe OPENROUTER_API_KEY --project="${PROJECT_ID}" &>/dev/null; then
  echo "Secret OPENROUTER_API_KEY already exists."
else
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "Missing Secret Manager secret OPENROUTER_API_KEY and OPENROUTER_API_KEY env is unset."
    exit 1
  fi
  echo "Creating secret OPENROUTER_API_KEY (value not printed)..."
  echo -n "${OPENROUTER_API_KEY}" | gcloud secrets create OPENROUTER_API_KEY \
    --project="${PROJECT_ID}" \
    --data-file=-
  gcloud secrets add-iam-policy-binding OPENROUTER_API_KEY \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${CR_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None
fi

if gcloud secrets describe TELEGRAM_BOT_TOKEN --project="${PROJECT_ID}" &>/dev/null; then
  echo "Secret TELEGRAM_BOT_TOKEN already exists."
elif [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "Creating secret TELEGRAM_BOT_TOKEN (value not printed)..."
  echo -n "${TELEGRAM_BOT_TOKEN}" | gcloud secrets create TELEGRAM_BOT_TOKEN \
    --project="${PROJECT_ID}" \
    --data-file=-
  gcloud secrets add-iam-policy-binding TELEGRAM_BOT_TOKEN \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${CR_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None
else
  echo "Skipping TELEGRAM_BOT_TOKEN secret (not provided; Telegram bot will be disabled)."
fi

SUBST="_REGION=${REGION},_SERVICE_NAME=${SERVICE_NAME},_PROJECT_NUMBER=${PROJECT_NUMBER}"
SUBST+=",_AGENT_ROLE=${AGENT_ROLE},_AGENT_DISPLAY_NAME=${AGENT_DISPLAY_NAME}"
SUBST+=",_CRYPTO_WALLET=${CRYPTO_WALLET}"
SUBST+=",_DATAX_URL=${DATAX_URL}"
SUBST+=",_DATAX_ADK_MODEL=${DATAX_ADK_MODEL}"

echo "Starting Cloud Build (bootstrap + image + deploy)..."
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="${SUBST}" \
  --project="${PROJECT_ID}" \
  .

echo ""
echo "Done. When the build finishes, get the URL with:"
echo "  gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)'"
echo ""
echo "Cloud Run requires authentication. Grant yourself invoker (replace YOUR_EMAIL), then use"
echo "  gcloud auth print-identity-token  with  Authorization: Bearer  on each request:"
echo "  gcloud run services add-iam-policy-binding ${SERVICE_NAME} --region=${REGION} \\"
echo "    --member=\"user:YOUR_EMAIL\" --role=\"roles/run.invoker\""
echo "(See docs/DEPLOY-CLOUD-RUN.md — Cloud Run access.)"
