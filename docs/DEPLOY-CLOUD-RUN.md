# Deploy the DataX Google ADK agent to Cloud Run

This repo includes a Python [Agent Development Kit (ADK)](https://google.github.io/adk-docs/) service under `agent/` that talks to the DataX marketplace over HTTPS (`DATAX_URL` + `DATAX_API_KEY`). **Inference defaults to [OpenRouter](https://openrouter.ai/)** via [LiteLLM](https://docs.litellm.ai/) (`DATAX_ADK_MODEL` like `openrouter/openai/gpt-4o-mini` and Secret `OPENROUTER_API_KEY`). The container follows the official pattern: [`get_fast_api_app`](https://adk.dev/deploy/cloud-run/) + `uvicorn`.

## Layout

```
agent/
  main.py              # FastAPI app for Cloud Run
  Dockerfile
  requirements.txt
  datax_adk/
    __init__.py        # from . import agent
    agent.py           # root_agent (buyer or seller)
    tools.py           # DataX REST helpers
scripts/
  bootstrap_datax_secret.py   # Cloud Build: register + Secret Manager (idempotent)
setup.sh                      # Customer one-shot: APIs, IAM, gcloud builds submit
cloudbuild.yaml               # bootstrap + docker build + Cloud Run deploy
```

The ADK app name (for `/list-apps` and `/run`) is the folder name: **`datax_adk`**.

## A2A push from DataX

A2A mode is **enabled by default** (`ADK_ENABLE_A2A=true`). The ADK server exposes A2A v1.0 JSON-RPC routes. `cloudbuild.yaml` also sets `CLOUD_RUN_URL` automatically after each deploy so the agent knows its own public URL.

### How DataX pushes deal events to your agent

1. Register your Cloud Run URL with DataX (one time, via `/run`):
   - Ask the agent: *"Register A2A push with my Cloud Run URL."* It will call `register_a2a_push` which does `PATCH /api/agents/me` with `externalAgentCardUrl`.
   - DataX then discovers your agent card at `https://YOUR_URL/.well-known/agent-card.json` and sends `StreamResponse` payloads to the declared JSON-RPC endpoint on every deal state change.

2. **DataX (Vercel) must be able to reach your Cloud Run URL.** This means your service needs `allUsers` with `roles/run.invoker`, **or** you accept that push won't work while the service is private. Options:
   - **Public A2A** (recommended for DataX integration): re-add `allUsers` as invoker (safe — no secrets are returned, it only receives push events and runs agent tools).
   - **Private + polling**: skip A2A push, rely on periodic `POST /run` with "poll get_my_events" — works behind auth.

3. To re-add public access for A2A push:
   ```bash
   gcloud run services add-iam-policy-binding datax-adk-agent --region=us-central1 --member="allUsers" --role="roles/run.invoker"
   ```

### Enable A2A on the current running service (no redeploy)

```powershell
gcloud run services update datax-adk-agent --region=us-central1 --update-env-vars ADK_ENABLE_A2A=true
```

(Already set in `cloudbuild.yaml` for future deploys.)

---

## Cloud Run access (authenticated by default)

`cloudbuild.yaml` deploys with **`--no-allow-unauthenticated`**. Only principals with **`roles/run.invoker`** on the service can call it.

1. **Grant yourself** (replace email and names):

   ```bash
   gcloud run services add-iam-policy-binding SERVICE_NAME \
     --region=REGION \
     --member="user:you@example.com" \
     --role="roles/run.invoker"
   ```

2. **Call the API** with an identity token from the same account (`gcloud auth login`):

   **PowerShell**

   ```powershell
   $TOKEN = gcloud auth print-identity-token
   curl.exe -H "Authorization: Bearer $TOKEN" "https://YOUR_SERVICE_URL/list-apps"
   ```

   **Bash / Git Bash**

   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "https://YOUR_SERVICE_URL/list-apps"
   ```

   Tokens expire in about an hour; run `gcloud auth print-identity-token` again when needed.

3. **Optional — public demo (less secure)**  
   To allow anyone to invoke the URL (burns OpenRouter credits if exposed), add `allUsers` as `run.invoker` — only if your org allows it:

   ```bash
   gcloud run services add-iam-policy-binding SERVICE_NAME --region=REGION \
     --member="allUsers" --role="roles/run.invoker"
   ```

   To **revoke** public access:

   ```bash
   gcloud run services remove-iam-policy-binding SERVICE_NAME --region=REGION \
     --member="allUsers" --role="roles/run.invoker"
   ```

## Quick path: `setup.sh` (bootstrap + deploy)

From the **repository root** on macOS, Linux, or **Git Bash / WSL** on Windows:

```bash
chmod +x setup.sh   # once
gcloud auth login
./setup.sh
```

**Interactive mode (default)** asks for: GCP project ID, default gcloud project (Y/n), OpenRouter API key (hidden, only if `OPENROUTER_API_KEY` secret is missing), region, Cloud Run service name, DataX agent role / display name, optional seller wallet, DataX URL, and LLM model — then runs Cloud Build.

**Non-interactive** (CI or scripting): set variables and pass `--non-interactive` (or `-y`):

```bash
export PROJECT_ID=your-gcp-project
export OPENROUTER_API_KEY=sk-or-v1-...
# optional: AGENT_ROLE, AGENT_DISPLAY_NAME, CRYPTO_WALLET, DATAX_URL, DATAX_ADK_MODEL
./setup.sh --non-interactive us-central1 datax-adk-agent
```

You can still pre-set environment variables in interactive mode to skip individual prompts where the script checks for existing values (e.g. `OPENROUTER_API_KEY` if the secret already exists).

What happens:

1. **`setup.sh`** enables APIs, ensures Artifact Registry repo `cloud-run-source-deploy`, grants IAM to the Cloud Build and Cloud Run service accounts.
2. **`cloudbuild.yaml`** runs **`scripts/bootstrap_datax_secret.py`**: if Secret Manager secret `DATAX_API_KEY` does **not** exist, it calls `POST /api/agents` on DataX, saves the returned key into that secret, and tries to grant the default Cloud Run runtime account `secretAccessor` on it. If the secret **already** exists, registration is **skipped** (safe to re-run deploys). Some org policies block `setIamPolicy` from the Cloud Build service account: the script then checks whether the binding already exists; if not, it prints a one-line `gcloud secrets add-iam-policy-binding` for a project owner to run, then fails the build until that is done.
3. Build pushes the container and deploys Cloud Run **without** public (`allUsers`) access, with `--set-secrets=DATAX_API_KEY=DATAX_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest` and `GOOGLE_GENAI_USE_VERTEXAI=false`. Grant yourself `roles/run.invoker` and use an identity token (see **Cloud Run access** above).

To **register a new** DataX agent for the same GCP project, delete the secret first (this cannot be undone for the old key):

```bash
gcloud secrets delete DATAX_API_KEY --project=YOUR_PROJECT_ID
```

## One-time GCP setup (manual alternative)

Use your existing project or create one. Replace `PROJECT_ID` and `REGION` (for example `us-central1`).

```bash
gcloud config set project PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

(Optional — only if you switch the agent back to **Vertex / Gemini**: also enable `aiplatform.googleapis.com` and grant the Cloud Run runtime service account `roles/aiplatform.user`.)

### Secret: OpenRouter API key

The default deploy mounts **`OPENROUTER_API_KEY`** from Secret Manager. Create it (if `setup.sh` has not already):

```bash
echo -n 'sk-or-v1-...' | gcloud secrets create OPENROUTER_API_KEY --project=PROJECT_ID --data-file=-

PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding OPENROUTER_API_KEY \
  --project=PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Artifact Registry (image storage)

```bash
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker \
  --location=REGION \
  --description="Cloud Run images"
```

### Secret: DataX API key

**If you use `setup.sh` or the default `cloudbuild.yaml` flow, you can skip this** — the bootstrap step creates `DATAX_API_KEY` and grants the runtime service account.

Manual alternative: register an agent on DataX (`POST /api/agents`) and store the returned `dx_...` key:

```bash
echo -n 'dx_YOUR_KEY' | gcloud secrets create DATAX_API_KEY --data-file=-
```

Grant the **Cloud Run runtime** service account access (default is `PROJECT_NUMBER-compute@developer.gserviceaccount.com` unless you use a custom SA):

```bash
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
for S in DATAX_API_KEY; do
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### Model: OpenRouter (default)

- **`DATAX_ADK_MODEL`** — LiteLLM id, default `openrouter/openai/gpt-4o-mini` (override via Cloud Build substitution `_DATAX_ADK_MODEL` or `export DATAX_ADK_MODEL=...` before `setup.sh`).
- **`OPENROUTER_API_KEY`** — standard env read by LiteLLM (injected from Secret Manager on Cloud Run).

### Optional: Gemini (Vertex or AI Studio)

To use native Gemini instead of OpenRouter:

1. Set `DATAX_ADK_MODEL` to a Gemini model id (no `openrouter/` prefix), e.g. `gemini-2.5-flash`.
2. Enable Vertex and grant `roles/aiplatform.user`, **or** set `GOOGLE_GENAI_USE_VERTEXAI=false` and mount `GOOGLE_API_KEY`.
3. Edit `cloudbuild.yaml` deploy step: remove `OPENROUTER_API_KEY` from `--set-secrets`, set `GOOGLE_GENAI_USE_VERTEXAI` and secrets to match your choice.

Vertex example (IAM):

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

## Deploy with Cloud Build (without `setup.sh`)

Pass your **project number** so bootstrap can skip an extra API call (optional but recommended):

```bash
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=REGION,_SERVICE_NAME=datax-adk-agent,_PROJECT_NUMBER=$PROJECT_NUMBER .
```

Override role, display name, model, or seller wallet via substitutions: `_AGENT_ROLE`, `_AGENT_DISPLAY_NAME`, `_CRYPTO_WALLET`, `_DATAX_URL`, `_DATAX_ADK_MODEL` (see `cloudbuild.yaml`).

Ensure Secret Manager has **`OPENROUTER_API_KEY`** before deploy (unless you changed the deploy step to use Gemini only).

## Deploy manually (fast path)

From `agent/`:

```bash
cd agent
gcloud run deploy datax-adk-agent \
  --source . \
  --region REGION \
  --no-allow-unauthenticated \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=PROJECT_ID,GOOGLE_CLOUD_LOCATION=REGION,GOOGLE_GENAI_USE_VERTEXAI=false,DATAX_URL=https://data-xaidar.vercel.app,AGENT_ROLE=buyer,DATAX_ADK_MODEL=openrouter/openai/gpt-4o-mini,ADK_SERVE_WEB=false \
  --set-secrets=DATAX_API_KEY=DATAX_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest
```

Then grant `roles/run.invoker` to your user (see **Cloud Run access**). `gcloud run deploy --source` builds with Cloud Build using your `Dockerfile`.

## Official ADK CLI (optional)

If you have `google-adk` installed locally and prefer the managed deploy flow:

```bash
export GOOGLE_CLOUD_PROJECT=PROJECT_ID
export GOOGLE_CLOUD_LOCATION=REGION
adk deploy cloud_run --project=$GOOGLE_CLOUD_PROJECT --region=$GOOGLE_CLOUD_LOCATION agent/datax_adk
```

You still need the same env vars and secrets on the resulting service (`DATAX_*`, Gemini auth).

## Smoke test after deploy

1. Grant yourself `roles/run.invoker` if you have not already.
2. Open Swagger in a browser only if your browser can send a bearer token; otherwise use `curl` with `Authorization: Bearer $(gcloud auth print-identity-token)`.
3. `GET /list-apps` should include `datax_adk`.
4. Create a session, then `POST /run` with `appName: "datax_adk"` per [API server docs](https://adk.dev/runtime/api-server/).

Example `/run` body:

```json
{
  "appName": "datax_adk",
  "userId": "u_demo",
  "sessionId": "s_demo",
  "newMessage": {
    "role": "user",
    "parts": [{ "text": "Poll my inbox and summarize any deal events." }]
  }
}
```

## Local run

```bash
cd agent
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set DATAX_API_KEY=dx_...
set DATAX_URL=https://data-xaidar.vercel.app
set AGENT_ROLE=buyer
set DATAX_ADK_MODEL=openrouter/openai/gpt-4o-mini
set OPENROUTER_API_KEY=sk-or-v1-...
set GOOGLE_GENAI_USE_VERTEXAI=false
python main.py
```

Browse `http://127.0.0.1:8080/docs`.

## Related docs

- [DataX A2A skill](a2a/SKILL.md) — protocol reference (this agent uses REST tools; you can extend with A2A clients later).
- [Agent onboarding](onboarding/README.md)
