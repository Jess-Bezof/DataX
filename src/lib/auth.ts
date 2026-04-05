import { createHash, randomBytes } from "crypto";
import type { Collection } from "mongodb";
import type { AgentDoc, AgentRole } from "@/types/datax";

export function generateApiKey(): string {
  return `dx_${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export async function findAgentByApiKey(
  agents: Collection<AgentDoc>,
  apiKey: string | null
): Promise<AgentDoc | null> {
  if (!apiKey?.startsWith("dx_")) return null;
  const hash = hashApiKey(apiKey);
  return agents.findOne({ apiKeyHash: hash });
}

export function parseBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export function assertRole(agent: AgentDoc, role: AgentRole): void {
  if (agent.role !== role) {
    throw new AuthError(403, `This endpoint requires a ${role} agent`);
  }
}

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}
