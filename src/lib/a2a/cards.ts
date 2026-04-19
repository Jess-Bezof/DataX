/**
 * Agent Card builders (A2A v1.0 Section 4.4.1).
 *
 * Two variants per subject:
 *   - Public card: served unauthenticated; advertises capabilities + skills.
 *   - Extended card: served only to authenticated callers; includes private
 *     fields (counterparty contact info, wallet, reputation details).
 *
 * Both variants share the same signing key; signatures are added by cards
 * only after composition is complete so tests / callers can inspect the
 * unsigned body easily.
 */

import type { Db } from "mongodb";
import type { AgentDoc } from "@/types/datax";
import type {
  A2AAgentCard,
  A2AAgentSkill,
  A2AAgentInterface,
  A2AAgentCapabilities,
} from "./types";
import { CURRENT_VERSION } from "./version";
import { getSseStreamTtlSeconds } from "./env";
import { signAgentCard } from "./signing";
import { computeAgentReputation, type AgentReputation } from "./reputation";

const DATAX_VERSION = "1.0.0";
const STREAM_TTL_EXT = "https://datax.local/ext/stream-ttl/v1";

const BEARER_SECURITY_SCHEMES = {
  datax: {
    httpAuthSecurityScheme: {
      scheme: "Bearer",
      bearerFormat: "DataX dx_ API key",
      description: "A dx_-prefixed API key obtained from POST /api/agents.",
    },
  },
} as const;

const BEARER_SECURITY_REQUIREMENT = [{ datax: [] as string[] }];

const MARKETPLACE_SKILLS: A2AAgentSkill[] = [
  {
    id: "browse-listings",
    name: "Browse listings",
    description:
      "Search DataX marketplace listings by free-text query and optional region.",
    tags: ["search", "discovery"],
    examples: ['{"action":"search","query":"retail SKU velocity","region":"US"}'],
    outputModes: ["application/json"],
  },
  {
    id: "propose-deal",
    name: "Propose a deal",
    description:
      "Start a new deal for a specific listing, optionally with a price proposal.",
    tags: ["deal", "negotiation"],
    examples: [
      '{"action":"propose","listingId":"<id>","proposedAmount":"10","proposedCurrency":"USDC"}',
    ],
  },
  {
    id: "negotiate",
    name: "Accept / reject / counter an offer",
    description:
      "Progress an existing deal. Send accept, reject, counter, buyer-sent, or seller-received actions with the task id set to the deal id.",
    tags: ["deal", "negotiation"],
  },
  {
    id: "deliver-dataset",
    name: "Deliver dataset",
    description:
      "Seller confirms payment received and DataX releases the full payload to the buyer as an Artifact on the task.",
    tags: ["delivery", "dataset"],
  },
];

const SELLER_SKILLS: A2AAgentSkill[] = MARKETPLACE_SKILLS.filter(
  (s) => s.id !== "browse-listings"
);

function streamTtlExtension(): A2AAgentCapabilities["extensions"] {
  return [
    {
      uri: STREAM_TTL_EXT,
      description:
        "Expected SSE stream TTL in seconds before the server rotates the connection. Clients should reconnect on the `close` event.",
      params: { seconds: getSseStreamTtlSeconds() },
      required: false,
    },
  ];
}

function baseCapabilities(): A2AAgentCapabilities {
  return {
    streaming: true,
    pushNotifications: true,
    extendedAgentCard: true,
    extensions: streamTtlExtension(),
  };
}

function a2aInterfaces(baseUrl: string): A2AAgentInterface[] {
  return [
    {
      url: `${baseUrl}/api/a2a`,
      protocolBinding: "JSONRPC",
      protocolVersion: CURRENT_VERSION,
    },
  ];
}

function commonDefaults(): Pick<
  A2AAgentCard,
  "defaultInputModes" | "defaultOutputModes" | "securitySchemes" | "securityRequirements"
> {
  return {
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    securitySchemes: BEARER_SECURITY_SCHEMES,
    securityRequirements: BEARER_SECURITY_REQUIREMENT,
  };
}

function jkuUrl(baseUrl: string): string {
  return `${baseUrl}/.well-known/jwks.json`;
}

/* --------------------- Marketplace cards --------------------- */

export function marketplacePublicCard(baseUrl: string): A2AAgentCard {
  return {
    name: "DataX Marketplace",
    description:
      "Discover data listings, propose deals, negotiate, and deliver datasets via A2A.",
    version: DATAX_VERSION,
    provider: { organization: "DataX", url: baseUrl },
    supportedInterfaces: a2aInterfaces(baseUrl),
    capabilities: baseCapabilities(),
    skills: MARKETPLACE_SKILLS,
    documentationUrl: `${baseUrl}/agent-docs/a2a`,
    ...commonDefaults(),
  };
}

export async function signedMarketplacePublicCard(
  baseUrl: string
): Promise<A2AAgentCard> {
  return signAgentCard(marketplacePublicCard(baseUrl), jkuUrl(baseUrl));
}

export function marketplaceExtendedCard(
  baseUrl: string,
  caller: AgentDoc
): A2AAgentCard {
  const base = marketplacePublicCard(baseUrl);
  return {
    ...base,
    description: `${base.description} Authenticated card for ${caller.displayName}.`,
    metadata: {
      ...(base.metadata ?? {}),
      dataxCaller: {
        agentId: caller._id.toHexString(),
        role: caller.role,
        displayName: caller.displayName,
      },
    },
  };
}

export async function signedMarketplaceExtendedCard(
  baseUrl: string,
  caller: AgentDoc
): Promise<A2AAgentCard> {
  return signAgentCard(marketplaceExtendedCard(baseUrl, caller), jkuUrl(baseUrl));
}

/* --------------------- Per-seller cards --------------------- */

function publicReputationMetadata(rep: AgentReputation): Record<string, unknown> {
  return {
    averageStars: rep.averageStars,
    totalRatings: rep.totalRatings,
    totalDealsCompleted: rep.totalDealsCompleted,
    ...(rep.averageDealCompletionMinutes !== undefined
      ? { averageDealCompletionMinutes: rep.averageDealCompletionMinutes }
      : {}),
  };
}

function extendedReputationMetadata(rep: AgentReputation): Record<string, unknown> {
  return {
    ...publicReputationMetadata(rep),
    starDistribution: rep.starDistribution,
  };
}

export async function sellerPublicCard(
  db: Db,
  seller: AgentDoc,
  baseUrl: string
): Promise<A2AAgentCard> {
  const rep = await computeAgentReputation(db, seller._id, seller.role);
  const sellerId = seller._id.toHexString();
  return {
    name: seller.displayName,
    description: `Seller agent on DataX (${seller.role}). Exposes DataX deal flow over A2A.`,
    version: DATAX_VERSION,
    provider: { organization: "DataX", url: baseUrl },
    supportedInterfaces: a2aInterfaces(baseUrl),
    capabilities: baseCapabilities(),
    skills: SELLER_SKILLS,
    documentationUrl: `${baseUrl}/agent-docs/a2a`,
    ...commonDefaults(),
    metadata: {
      dataxAgentId: sellerId,
      role: seller.role,
      reputation: publicReputationMetadata(rep),
    },
  };
}

export async function signedSellerPublicCard(
  db: Db,
  seller: AgentDoc,
  baseUrl: string
): Promise<A2AAgentCard> {
  const card = await sellerPublicCard(db, seller, baseUrl);
  return signAgentCard(card, jkuUrl(baseUrl));
}

/**
 * Per-seller extended card. Includes seller's cryptoWallet and contact info
 * only when the caller has at least one prior or active deal with them.
 */
export async function sellerExtendedCard(
  db: Db,
  seller: AgentDoc,
  caller: AgentDoc,
  baseUrl: string
): Promise<A2AAgentCard> {
  const rep = await computeAgentReputation(db, seller._id, seller.role);
  const sellerId = seller._id.toHexString();

  // Is the caller a counterparty? Search the deals collection for any deal
  // that ties seller + caller together (any status).
  const isCounterparty =
    caller._id.equals(seller._id) ||
    (await db.collection("deals").findOne({
      sellerAgentId: seller._id,
      buyerAgentId: caller._id,
    })) != null;

  const metadata: Record<string, unknown> = {
    dataxAgentId: sellerId,
    role: seller.role,
    reputation: extendedReputationMetadata(rep),
    dataxCaller: {
      agentId: caller._id.toHexString(),
      role: caller.role,
      displayName: caller.displayName,
    },
  };

  if (isCounterparty) {
    metadata.privateContact = {
      cryptoWallet: seller.cryptoWallet?.trim() ?? null,
      contactMethod: seller.contactMethod,
      contactValue: seller.contactValue,
      contactNote: seller.contactNote ?? null,
    };
  }

  return {
    name: seller.displayName,
    description: isCounterparty
      ? `Seller agent on DataX. Extended view for counterparty ${caller.displayName}.`
      : `Seller agent on DataX. Authenticated view — counterparty contact info is hidden because you have no prior deal.`,
    version: DATAX_VERSION,
    provider: { organization: "DataX", url: baseUrl },
    supportedInterfaces: a2aInterfaces(baseUrl),
    capabilities: baseCapabilities(),
    skills: SELLER_SKILLS,
    documentationUrl: `${baseUrl}/agent-docs/a2a`,
    ...commonDefaults(),
    metadata,
  };
}

export async function signedSellerExtendedCard(
  db: Db,
  seller: AgentDoc,
  caller: AgentDoc,
  baseUrl: string
): Promise<A2AAgentCard> {
  const card = await sellerExtendedCard(db, seller, caller, baseUrl);
  return signAgentCard(card, jkuUrl(baseUrl));
}
