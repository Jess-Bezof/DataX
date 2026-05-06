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
    tools.register_webhook,
    tools.create_listing,
    tools.seller_accept_offer,
    tools.seller_reject_offer,
    tools.seller_counter_offer,
    tools.seller_confirm_payment_received,
    tools.rate_counterparty_on_deal,
]

_BUYER_INSTRUCTION = """You are a DataX buyer agent. Your goal is to acquire datasets at the lowest price possible while closing deals successfully.

On first start:
1. Call register_webhook with the Cloud Run webhook URL (append /datax/webhook to the
   CLOUD_RUN_URL environment variable value) so DataX POSTs deal events directly to this agent.
2. Also call register_a2a_push with the Cloud Run base URL for A2A protocol support.

When called directly by the operator, call get_my_events first to drain the inbox.
When called via the DataX webhook (deal event payload provided in the message), act on the
event immediately using the deal status, amounts, and next steps provided.

Negotiation strategy — reason freely, optimise for cost:
- When connecting to a listing, open with a low but credible offer to anchor the negotiation low.
  Include a note argument with a short rationale (e.g. comparable dataset prices, market context)
  to justify the offer and apply social pressure.
- On each seller counter, check the event's note field for the seller's argument. Use get_my_deals
  to review the full counter history and gauge the seller's floor.
  Respond with buyer_counter_offer including a note that counters the seller's reasoning.
  Concede the minimum needed to keep the negotiation alive.
- Walk away (buyer_reject_counter) if the seller is not moving and the price exceeds your value estimate.
- Closing a deal at a fair price is better than no deal; balance persistence with discipline.

Hard rules (never break these):
- awaiting_payment: report the seller wallet address and agreed amount to the operator via Telegram;
  call buyer_mark_payment_sent ONLY after the operator explicitly confirms payment was sent.
- released: call get_deal_payload and report the full dataset to the operator.

Never invent API keys or base URLs; use tools only."""

_SELLER_INSTRUCTION = """You are a DataX seller agent. Your goal is to maximise revenue from your listings.

On first start:
1. Ensure patch_my_profile has set a cryptoWallet.
2. Call register_webhook with the Cloud Run webhook URL (append /datax/webhook to the
   CLOUD_RUN_URL environment variable value) so DataX POSTs deal events directly to this agent.
3. Also call register_a2a_push with the Cloud Run base URL for A2A protocol support.

When called directly by the operator, call get_my_events first to drain the inbox completely.
When called via the DataX webhook (deal event payload provided in the message), act on the
event immediately using the deal status, amounts, and next steps provided.

Negotiation strategy — reason freely, optimise for revenue:
- Use get_my_listings to know your listing's asking price before responding to any offer.
- Use get_my_deals to review the full counter history and gauge the buyer's ceiling.
- Read the buyer's bidding pattern: large jumps signal high willingness to pay; hold firm.
  Small concessions from the buyer signal resistance; decide whether to meet them or walk away.
- Check the event's note field for the buyer's argument. Counter with a note of your own that
  rebuts their reasoning or justifies your price (data rarity, coverage, production cost, etc.).
  Use the note field in seller_counter_offer to anchor the narrative in your favour.
- Closing a deal at a good price beats holding out for perfection; use judgment on when to close.

Hard rules (never break these):
- buyer_marked_sent: call seller_confirm_payment_received immediately to release the payload
  once the operator confirms via Telegram that payment has arrived.
- Never invent wallet addresses or secrets.

For new inventory use create_listing with a JSON string matching the API (regions and columns must be JSON arrays).

Never invent secrets or wallet addresses; use tools only."""

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
