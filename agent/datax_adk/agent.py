"""DataX marketplace agent for Google ADK (buyer or seller via AGENT_ROLE)."""

from __future__ import annotations

import os

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

from . import tools

_ROLE = os.environ.get("AGENT_ROLE", "buyer").strip().lower()
# Default: OpenRouter via ADK → LiteLLM (`provider/model`). Override with DATAX_ADK_MODEL.
_MODEL = os.environ.get("DATAX_ADK_MODEL", "openrouter/openai/gpt-4o-mini")

_BUYER_TOOLS = [
    tools.get_marketplace,
    tools.list_listings,
    tools.search_listings,
    tools.get_my_events,
    tools.get_delivery_health,
    tools.get_my_deals,
    tools.get_agent_reputation,
    tools.connect_to_listing,
    tools.buyer_accept_counter,
    tools.buyer_reject_counter,
    tools.buyer_counter_offer,
    tools.buyer_mark_payment_sent,
    tools.get_deal_payload,
    tools.rate_counterparty_on_deal,
    tools.register_a2a_push,
    tools.register_webhook,
    tools.patch_my_profile,
]

_SELLER_TOOLS = [
    tools.get_marketplace,
    tools.list_listings,
    tools.search_listings,
    tools.get_my_events,
    tools.get_delivery_health,
    tools.get_my_deals,
    tools.get_my_listings,
    tools.get_agent_reputation,
    tools.patch_my_profile,
    tools.register_a2a_push,
    tools.create_listing,
    tools.seller_accept_offer,
    tools.seller_reject_offer,
    tools.seller_counter_offer,
    tools.seller_confirm_payment_received,
    tools.rate_counterparty_on_deal,
]

_BUYER_INSTRUCTION = """You are a DataX buyer agent connected to the marketplace via REST.

On first start:
1. Call register_webhook with the Cloud Run webhook URL (append /datax/webhook to the
   CLOUD_RUN_URL environment variable value) so DataX POSTs deal events directly to this agent.
2. Also call register_a2a_push with the Cloud Run base URL for A2A protocol support.

When called directly by the operator, call get_my_events first to drain the inbox.
When called via the DataX webhook (deal event payload provided in the message), act on the
event immediately using the deal status, amounts, and next steps provided.

Suggested policy:
- seller_counter_pending: accept if counter ≤ 120% of your initial offer or listing price; otherwise counter or reject.
- awaiting_payment: report wallet address and amount to the operator; call buyer_mark_payment_sent ONLY after operator confirms payment was sent.
- released: call get_deal_payload and report the full dataset to the operator.
- Before connecting, check get_agent_reputation; prefer sellers with averageStars >= 4 and totalRatings >= 3.
- After completion, rate_counterparty_on_deal (5 stars on success, 1 star after 48h stuck).

Never invent API keys or base URLs; use tools only."""

_SELLER_INSTRUCTION = """You are a DataX seller agent connected to the marketplace via REST and A2A.

On first start, ensure patch_my_profile has set a cryptoWallet, and call register_a2a_push
with the Cloud Run service base URL so DataX can push deal events directly to this agent.

When handling explicit operator requests, call get_my_events first; drain the inbox completely.

Suggested policy:
- offer_pending / buyer_counter_pending: accept when price meets your minimum; otherwise seller_counter_offer or seller_reject_offer.
- buyer_marked_sent: call seller_confirm_payment_received to release the payload.
- Rate buyers after released when appropriate.

For new inventory use create_listing with a JSON string matching the API (regions and columns must be JSON arrays).

Never invent secrets; use tools only."""

if _ROLE == "seller":
    root_agent = Agent(
        name="datax_seller",
        model=LiteLlm(model=_MODEL),
        description="DataX seller agent: listings, negotiation, and release.",
        instruction=_SELLER_INSTRUCTION,
        tools=_SELLER_TOOLS,
    )
else:
    root_agent = Agent(
        name="datax_buyer",
        model=LiteLlm(model=_MODEL),
        description="DataX buyer agent: search, deals, payment, and payload retrieval.",
        instruction=_BUYER_INSTRUCTION,
        tools=_BUYER_TOOLS,
    )
