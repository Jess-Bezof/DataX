"""ADK FastAPI entrypoint for Cloud Run (see https://adk.dev/deploy/cloud-run/)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
import uvicorn
from fastapi import HTTPException, Request, Response
from google.adk.cli.fast_api import get_fast_api_app

logger = logging.getLogger(__name__)

_AGENT_ROOT = os.path.dirname(os.path.abspath(__file__))
_SESSION_URI = os.environ.get(
    "ADK_SESSION_URI",
    "sqlite+aiosqlite:///./sessions.db",
)
_ALLOW_ORIGINS = [
    o.strip()
    for o in os.environ.get("ADK_ALLOW_ORIGINS", "*").split(",")
    if o.strip()
]
_SERVE_WEB = os.environ.get("ADK_SERVE_WEB", "false").lower() in (
    "1",
    "true",
    "yes",
)
_ENABLE_A2A = os.environ.get("ADK_ENABLE_A2A", "false").lower() in (
    "1",
    "true",
    "yes",
)
_A2A_APP_NAME = os.environ.get("A2A_APP_NAME", "datax_adk").strip() or "datax_adk"

app = get_fast_api_app(
    agents_dir=_AGENT_ROOT,
    session_service_uri=_SESSION_URI,
    allow_origins=_ALLOW_ORIGINS,
    web=_SERVE_WEB,
    a2a=_ENABLE_A2A,
)


if _ENABLE_A2A:
    def _v1_agent_card() -> dict:
        """Return an A2A v1.0 agent card that DataX can parse via pickJsonRpcInterface.

        DataX reads card.supportedInterfaces[].protocolBinding == "JSONRPC" and
        card.supportedInterfaces[].protocolVersion == "1.0" to find the push target URL.
        ADK's built-in card serialisation (a2a-sdk 0.3.x) emits 0.3.x flat format, so we
        serve our own v1.0 card at the well-known paths instead.
        """
        base = (
            os.environ.get("CLOUD_RUN_URL", "").rstrip("/")
            or f"https://{os.environ.get('K_SERVICE', _A2A_APP_NAME)}.run.app"
        )
        return {
            "name": "DataX ADK Agent",
            "description": (
                "Buyer/seller agent for the DataX marketplace. "
                "Supports search, negotiation, payment confirmation, and deal payload retrieval."
            ),
            "version": "1.0.0",
            "supportedInterfaces": [
                {
                    "url": f"{base}/a2a/{_A2A_APP_NAME}",
                    "protocolBinding": "JSONRPC",
                    "protocolVersion": "1.0",
                }
            ],
            "capabilities": {"streaming": False, "pushNotifications": False},
            "skills": [],
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
        }

    @app.get("/.well-known/agent-card.json", include_in_schema=False)
    async def get_agent_card() -> dict:
        return _v1_agent_card()

    @app.get("/.well-known/agent.json", include_in_schema=False)
    async def get_agent_card_legacy() -> dict:
        return _v1_agent_card()

# ---------------------------------------------------------------------------
# Telegram webhook
# ---------------------------------------------------------------------------
_TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
_TELEGRAM_API = "https://api.telegram.org"
_ADK_APP = "datax_adk"
_DATAX_URL = os.environ.get("DATAX_URL", "https://data-xaidar.vercel.app").rstrip("/")
_DATAX_API_KEY = os.environ.get("DATAX_API_KEY", "").strip()
# Optional override for deal-update Telegram notifications; otherwise uses MongoDB via GET /api/agents/me.
_TELEGRAM_CHAT_ID_ENV = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

# In-memory map: telegram chat_id (str) → ADK session_id (str).
# Resets on container restart; acceptable for stateless Cloud Run.
_tg_sessions: dict[str, str] = {}
# Last Telegram chat id synced to DataX (avoids GET on every webhook when warm).
_telegram_chat_cache: str | None = None


async def _tg_send(chat_id: int | str, text: str) -> None:
    url = f"{_TELEGRAM_API}/bot{_TELEGRAM_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(url, json={"chat_id": chat_id, "text": text})


async def _adk_ensure_session(user_id: str) -> str:
    """Return existing ADK session id for this user, or create a new one."""
    if user_id in _tg_sessions:
        return _tg_sessions[user_id]
    port = os.environ.get("PORT", "8080")
    url = f"http://127.0.0.1:{port}/apps/{_ADK_APP}/users/{user_id}/sessions"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json={})
    resp.raise_for_status()
    session_id: str = resp.json()["id"]
    _tg_sessions[user_id] = session_id
    return session_id


async def _adk_run(user_id: str, session_id: str, text: str) -> str:
    """Send a message to the ADK agent and return the agent's reply text."""
    port = os.environ.get("PORT", "8080")
    url = f"http://127.0.0.1:{port}/run"
    payload: dict[str, Any] = {
        "appName": _ADK_APP,
        "userId": user_id,
        "sessionId": session_id,
        "newMessage": {"role": "user", "parts": [{"text": text}]},
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        return f"Agent error {resp.status_code}: {resp.text[:300]}"
    events = resp.json()
    # Extract the last text part from the last model event.
    for event in reversed(events):
        parts = (event.get("content") or {}).get("parts") or []
        for part in reversed(parts):
            if isinstance(part, dict) and part.get("text"):
                return part["text"]
    return "(Agent returned no text response.)"


async def _datax_patch_telegram_chat(chat_id: int | str) -> None:
    """Persist operator Telegram chat id on the DataX agent document (PATCH /api/agents/me)."""
    global _telegram_chat_cache
    if not _DATAX_API_KEY:
        return
    url = f"{_DATAX_URL}/api/agents/me"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.patch(
                url,
                headers={
                    "Authorization": f"Bearer {_DATAX_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"telegramChatId": str(chat_id)},
            )
        if r.status_code >= 400:
            logger.warning(
                "DataX PATCH telegramChatId failed: %s %s",
                r.status_code,
                r.text[:300],
            )
        else:
            _telegram_chat_cache = str(chat_id)
    except Exception as exc:
        logger.warning("DataX PATCH telegramChatId error: %s", exc)


async def _resolve_telegram_notify_chat_id() -> str | None:
    """Where to send deal-update summaries: TELEGRAM_CHAT_ID env, cache, or GET /api/agents/me."""
    global _telegram_chat_cache
    if _TELEGRAM_CHAT_ID_ENV:
        return _TELEGRAM_CHAT_ID_ENV
    if _telegram_chat_cache:
        return _telegram_chat_cache
    if not _DATAX_API_KEY:
        return None
    url = f"{_DATAX_URL}/api/agents/me"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {_DATAX_API_KEY}"})
        if r.status_code >= 400:
            logger.warning("DataX GET /api/agents/me failed: %s", r.status_code)
            return None
        data = r.json()
        tid = (data.get("telegramChatId") or "").strip()
        if tid:
            _telegram_chat_cache = tid
        return tid or None
    except Exception as exc:
        logger.warning("DataX GET /api/agents/me error: %s", exc)
        return None


if _TELEGRAM_TOKEN:
    @app.post("/telegram/webhook", include_in_schema=False)
    async def telegram_webhook(request: Request) -> Response:
        try:
            update = await request.json()
        except Exception:
            return Response(status_code=200)

        message = update.get("message") or update.get("edited_message")
        if not message:
            return Response(status_code=200)

        chat_id: int = message["chat"]["id"]
        text: str = (message.get("text") or "").strip()
        if not text:
            return Response(status_code=200)

        user_id = str(chat_id)
        try:
            session_id = await _adk_ensure_session(user_id)
            reply = await _adk_run(user_id, session_id, text)
        except Exception as exc:
            logger.exception("Telegram handler error: %s", exc)
            reply = f"Sorry, an error occurred: {exc}"
            # Reset session so next message starts fresh.
            _tg_sessions.pop(user_id, None)

        await _tg_send(chat_id, reply)
        await _datax_patch_telegram_chat(chat_id)
        return Response(status_code=200)
else:
    logger.warning(
        "TELEGRAM_BOT_TOKEN not set; /telegram/webhook endpoint is disabled."
    )


# ---------------------------------------------------------------------------
# DataX webhook endpoint
# ---------------------------------------------------------------------------
# DataX POSTs deal state change events here (set via PATCH /api/agents/me webhookUrl).
# The handler drives the ADK agent to act on the event and notifies you on Telegram.
#
# Optional env vars:
#   TELEGRAM_CHAT_ID — override destination for deal-update Telegram messages (else MongoDB telegramChatId)
#   DATAX_WEBHOOK_SECRET — if set, validate Authorization: Bearer header

_DATAX_WEBHOOK_SECRET = os.environ.get("DATAX_WEBHOOK_SECRET", "").strip()


@app.post("/datax/webhook", include_in_schema=False)
async def datax_webhook(request: Request) -> Response:
    # Optional secret validation.
    if _DATAX_WEBHOOK_SECRET:
        auth = request.headers.get("authorization", "")
        provided = auth.removeprefix("Bearer ").strip()
        if provided != _DATAX_WEBHOOK_SECRET:
            return Response(status_code=401)

    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=200)

    event = payload.get("event", "")
    deal_id = payload.get("dealId", "")
    status = payload.get("status", "")

    if event != "deal_updated" or not deal_id:
        return Response(status_code=200)

    role = payload.get("yourRole", "buyer")
    counter_amount = payload.get("counterAmount")
    counter_currency = payload.get("counterCurrency")
    agreed_amount = payload.get("agreedAmount")
    agreed_currency = payload.get("agreedCurrency")
    seller_wallet = payload.get("sellerCryptoWallet")

    parts = [f"DataX deal event received — dealId={deal_id}, status={status}, yourRole={role}."]
    if counter_amount and counter_currency:
        parts.append(f"Counter offer: {counter_amount} {counter_currency}.")
    if agreed_amount and agreed_currency:
        parts.append(f"Agreed amount: {agreed_amount} {agreed_currency}.")
    if seller_wallet:
        parts.append(f"Seller crypto wallet for payment: {seller_wallet}.")
    parts.append(
        "Act on this deal event immediately according to your policy. "
        "For seller_counter_pending: accept if reasonable, counter, or reject. "
        "For awaiting_payment: report wallet and amount — do NOT call buyer_mark_payment_sent without operator confirmation. "
        "For released: call get_deal_payload and summarise the dataset."
    )
    message_text = " ".join(parts)

    user_id = f"webhook_{deal_id}"
    reply = ""
    try:
        session_id = await _adk_ensure_session(user_id)
        reply = await _adk_run(user_id, session_id, message_text)
    except Exception as exc:
        logger.exception("DataX webhook ADK error for deal %s: %s", deal_id, exc)
        reply = f"Error processing deal event: {exc}"
        _tg_sessions.pop(user_id, None)

    # Forward to Telegram so the operator knows what the agent decided.
    notify_chat = await _resolve_telegram_notify_chat_id()
    if _TELEGRAM_TOKEN and notify_chat:
        short_deal = deal_id[:8]
        tg_msg = (
            f"📩 DataX deal update\n"
            f"Deal: {short_deal}...\n"
            f"Status: {status}\n"
            f"\n🤖 Agent: {reply[:800]}"
        )
        try:
            await _tg_send(notify_chat, tg_msg)
        except Exception as exc:
            logger.warning("Telegram notify failed for deal %s: %s", deal_id, exc)

    return Response(status_code=200)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
    )
