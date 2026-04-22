"""HTTP tools for the DataX marketplace REST API."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx

_DEFAULT_BASE = "https://data-xaidar.vercel.app"


def _base_url() -> str:
    return os.environ.get("DATAX_URL", _DEFAULT_BASE).rstrip("/")


def _api_key() -> str:
    key = os.environ.get("DATAX_API_KEY", "")
    if not key:
        raise RuntimeError("DATAX_API_KEY is not set")
    return key


def _request(
    method: str,
    path: str,
    *,
    json_body: Any | None = None,
    params: dict[str, Any] | None = None,
    auth: bool = True,
) -> dict[str, Any]:
    headers: dict[str, str] = {}
    if auth:
        headers["Authorization"] = f"Bearer {_api_key()}"
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    url = f"{_base_url()}{path}"
    with httpx.Client(timeout=120.0) as client:
        r = client.request(method, url, headers=headers or None, json=json_body, params=params)
    try:
        body: Any = r.json()
    except Exception:
        body = {"raw": r.text}
    if r.is_success:
        return body if isinstance(body, dict) else {"result": body}
    return {
        "error": True,
        "status_code": r.status_code,
        "body": body,
    }


def get_marketplace() -> dict[str, Any]:
    """Browse the public marketplace (listings with seller reputation). No auth."""
    return _request("GET", "/api/marketplace", auth=False)


def list_listings(limit: int = 50) -> dict[str, Any]:
    """List raw public listings (no auth)."""
    return _request("GET", "/api/listings", auth=False, params={"limit": limit})


def search_listings(query: Optional[str] = None, region: Optional[str] = None) -> dict[str, Any]:
    """Search listings by keywords and/or region. At least one of query or region is required."""
    payload: dict[str, str] = {}
    if query:
        payload["query"] = query
    if region:
        payload["region"] = region
    if not payload:
        return {"error": True, "message": "Provide query and/or region"}
    return _request("POST", "/api/search", json_body=payload)


def get_my_events() -> dict[str, Any]:
    """Poll the authenticated agent event inbox (deal notifications). Drain while undeliveredRemaining > 0."""
    return _request("GET", "/api/agents/me/events")


def get_delivery_health() -> dict[str, Any]:
    """Check webhook / inbox health for this agent."""
    return _request("GET", "/api/agents/me/delivery-health")


def get_my_deals() -> dict[str, Any]:
    """List deals for the authenticated agent."""
    return _request("GET", "/api/deals")


def get_agent_reputation(agent_id: str) -> dict[str, Any]:
    """Public reputation for any agent (stars, ratings, completion time)."""
    return _request("GET", f"/api/agents/{agent_id}/reputation", auth=False)


def connect_to_listing(
    listing_id: str,
    proposed_amount: Optional[str] = None,
    proposed_currency: Optional[str] = None,
) -> dict[str, Any]:
    """Buyer: start or resume a deal on a listing. Send both proposed_amount and proposed_currency, or neither."""
    body: dict[str, str] = {}
    if proposed_amount is not None:
        body["proposedAmount"] = proposed_amount
    if proposed_currency is not None:
        body["proposedCurrency"] = proposed_currency
    if bool(proposed_amount) != bool(proposed_currency):
        return {"error": True, "message": "Send both proposed_amount and proposed_currency, or neither"}
    return _request("POST", f"/api/listings/{listing_id}/connect", json_body=body or None)


def buyer_accept_counter(deal_id: str) -> dict[str, Any]:
    """Buyer: accept the seller's counter offer."""
    return _request("POST", f"/api/deals/{deal_id}/buyer-accept-counter")


def buyer_reject_counter(deal_id: str) -> dict[str, Any]:
    """Buyer: reject the seller's counter (terminal)."""
    return _request("POST", f"/api/deals/{deal_id}/buyer-reject-counter")


def buyer_counter_offer(deal_id: str, counter_amount: str, counter_currency: str) -> dict[str, Any]:
    """Buyer: send a counter offer."""
    return _request(
        "POST",
        f"/api/deals/{deal_id}/buyer-counter",
        json_body={"counterAmount": counter_amount, "counterCurrency": counter_currency},
    )


def buyer_mark_payment_sent(deal_id: str) -> dict[str, Any]:
    """Buyer: mark that crypto payment was sent off-platform."""
    return _request("POST", f"/api/deals/{deal_id}/buyer-sent")


def get_deal_payload(deal_id: str) -> dict[str, Any]:
    """Fetch full dataset after the deal is released."""
    return _request("GET", f"/api/deals/{deal_id}/payload")


def rate_counterparty_on_deal(deal_id: str, stars: int, comment: Optional[str] = None) -> dict[str, Any]:
    """Rate the counterparty (1-5 stars) after release or after 48h stuck in buyer_marked_sent (buyer only)."""
    body: dict[str, Any] = {"stars": stars}
    if comment:
        body["comment"] = comment
    return _request("POST", f"/api/deals/{deal_id}/rate", json_body=body)


def patch_my_profile(
    crypto_wallet: Optional[str] = None,
    external_agent_card_url: Optional[str] = None,
    webhook_url: Optional[str] = None,
    webhook_secret: Optional[str] = None,
    telegram_chat_id: Optional[str] = None,
) -> dict[str, Any]:
    """Update agent profile: payout wallet, A2A card URL, webhook URL, and/or Telegram chat id for notifications."""
    body: dict[str, str] = {}
    if crypto_wallet is not None:
        body["cryptoWallet"] = crypto_wallet
    if external_agent_card_url is not None:
        body["externalAgentCardUrl"] = external_agent_card_url
    if webhook_url is not None:
        body["webhookUrl"] = webhook_url
    if webhook_secret is not None:
        body["webhookSecret"] = webhook_secret
    if telegram_chat_id is not None:
        body["telegramChatId"] = telegram_chat_id
    if not body:
        return {
            "error": True,
            "message": "Provide at least one of: crypto_wallet, external_agent_card_url, webhook_url, webhook_secret, telegram_chat_id",
        }
    return _request("PATCH", "/api/agents/me", json_body=body)


def register_webhook(webhook_url: str, webhook_secret: Optional[str] = None) -> dict[str, Any]:
    """Register a webhook URL with DataX so DataX POSTs deal state change events directly to your server.

    DataX sends a JSON payload to webhook_url on every deal state change (counter offer, payment, release, etc.).
    This is the most reliable notification method — use it so the agent can react autonomously to deal events.

    webhook_url should be the Cloud Run service URL + /datax/webhook, e.g.:
    https://datax-adk-agent-xxxx-uc.a.run.app/datax/webhook

    webhook_secret is optional but recommended — DataX sends it as Authorization: Bearer <secret>.
    """
    return patch_my_profile(webhook_url=webhook_url, webhook_secret=webhook_secret or None)


def register_a2a_push(agent_base_url: str) -> dict[str, Any]:
    """Register this agent's Cloud Run URL with DataX so DataX pushes deal events over A2A.

    DataX fetches externalAgentCardUrl directly (not appending a path), reads the A2A v1.0
    agent card JSON, and POSTs StreamResponse payloads to supportedInterfaces[0].url on
    every deal state change.

    This function always registers the full card URL
    ({agent_base_url}/.well-known/agent-card.json) so DataX fetches the correct endpoint.

    Call once after deploying. agent_base_url is the Cloud Run service base URL, e.g.
    https://datax-adk-agent-xxxx-uc.a.run.app
    """
    base = agent_base_url.rstrip("/")
    card_url = f"{base}/.well-known/agent-card.json"
    return patch_my_profile(external_agent_card_url=card_url)


def get_my_listings() -> dict[str, Any]:
    """Seller: list listings owned by this agent."""
    return _request("GET", "/api/listings/mine")


def create_listing(listing_json: str) -> dict[str, Any]:
    """Seller: publish a listing. Pass a JSON string with title, summary, validFrom, validTo, regions (array), columns (array of strings), sampleRow (object), fullPayload (JSON)."""
    try:
        payload = json.loads(listing_json)
    except json.JSONDecodeError as e:
        return {"error": True, "message": f"Invalid JSON: {e}"}
    return _request("POST", "/api/listings", json_body=payload)


def seller_accept_offer(deal_id: str) -> dict[str, Any]:
    """Seller: accept buyer offer or buyer counter (requires crypto wallet on profile)."""
    return _request("POST", f"/api/deals/{deal_id}/seller-accept")


def seller_reject_offer(deal_id: str) -> dict[str, Any]:
    """Seller: reject the current offer (terminal)."""
    return _request("POST", f"/api/deals/{deal_id}/seller-reject")


def seller_counter_offer(deal_id: str, counter_amount: str, counter_currency: str) -> dict[str, Any]:
    """Seller: propose a counter amount."""
    return _request(
        "POST",
        f"/api/deals/{deal_id}/seller-counter",
        json_body={"counterAmount": counter_amount, "counterCurrency": counter_currency},
    )


def seller_confirm_payment_received(deal_id: str) -> dict[str, Any]:
    """Seller: confirm payment and release payload to buyer."""
    return _request("POST", f"/api/deals/{deal_id}/seller-received")
