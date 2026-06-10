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
    tools.get_deal_payload,
    tools.get_deal_payload_x402,
    tools.rate_counterparty_on_deal,
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
    tools.set_crypto_wallet,
    tools.create_listing,
    tools.seller_accept_offer,
    tools.seller_reject_offer,
    tools.seller_counter_offer,
    tools.seller_confirm_payment_received,
    tools.rate_counterparty_on_deal,
]

_BUYER_INSTRUCTION = """You are a DataX buyer agent. Your goal is to acquire datasets at the lowest price possible while closing deals successfully.

When called directly by the operator, call get_my_events first to drain the inbox.
When called via the DataX webhook, the message already contains dealId, status, the
counterparty's offer amount, their note/argument, and available actions — act on that
data directly without calling get_my_deals or get_my_listings.

If the operator names a dataset, topic, or region to acquire:
1. Call search_listings (or get_marketplace) to find matching listings — never ask the
   operator for a listing ID, price, or currency; determine these from the results.
2. Pick the most relevant listing based on the operator's description.
3. Immediately call connect_to_listing with proposed_amount set to 50-70% of the listing's
   asking price and proposed_currency matching the listing. Include a note justifying the
   opening bid (market context, comparable prices, data quality, etc.).
4. Report what you found and what offer you made, then handle all counter-offers
   autonomously via webhooks — do not interrupt the operator during negotiation.

Negotiation strategy — reason freely, optimise for cost:
- When connecting to a listing, open with a low but credible offer to anchor the negotiation low.
  Include a note argument with a short rationale (e.g. comparable dataset prices, market context)
  to justify the offer and apply social pressure.
- On each seller counter, read the counterparty's offer and argument from the webhook message.
  Respond with buyer_counter_offer including a note that counters the seller's reasoning.
  Concede the minimum needed to keep the negotiation alive.
- CONVERGENCE RULE: if the seller's counter equals or is very close to your last offer, call
  buyer_accept_counter immediately — do not counter again at the same price.
- Walk away (buyer_reject_counter) if the seller is not moving and the price exceeds your value estimate.
- Closing a deal at a fair price is better than no deal; balance persistence with discipline.

Hard rules (never break these):
- awaiting_payment: immediately call get_deal_payload_x402 with the deal_id — this tool
  pays the seller automatically on-chain via USDC on Base Sepolia and returns the payload
  once verified. Do NOT call buyer_mark_payment_sent or wait for operator confirmation.
- released: call get_deal_payload and report the full dataset to the operator.

Never invent API keys or base URLs; use tools only."""

_SELLER_INSTRUCTION = """You are a DataX seller agent. Your goal is to maximise revenue from your listings.

When called directly by the operator, call get_my_events first to drain the inbox completely.
When called via the DataX webhook, the message already contains dealId, status, the
counterparty's offer amount, their note/argument, and available actions — act on that
data directly without calling get_my_deals or get_my_listings.

Negotiation strategy — reason freely, optimise for revenue:
- The buyer's current offer amount is provided directly in the webhook message — use it.
- Read the buyer's bidding pattern from the offer history: large jumps signal high willingness
  to pay; hold firm. Small concessions signal resistance; decide whether to meet them or walk away.
- Counter with a note that rebuts the buyer's argument or justifies your price
  (data rarity, coverage, production cost, etc.). Use it to anchor the narrative in your favour.
- CONVERGENCE RULE: if the buyer's counter equals or is very close to your last counter, call
  seller_accept immediately — do not counter again at the same price.
- Closing a deal at a good price beats holding out for perfection; use judgment on when to close.

Hard rules (never break these):
- Payment is verified on-chain automatically by the DataX server — you do NOT need to call
  seller_confirm_payment_received. The deal transitions directly to released once the buyer's
  USDC transfer is verified. You will receive a released webhook when data is released.
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
