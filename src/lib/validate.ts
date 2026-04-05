import {
  CONTACT_METHODS,
  type AgentRole,
  type ContactMethod,
} from "@/types/datax";

export function parseAgentRole(v: unknown): AgentRole {
  if (v === "seller" || v === "buyer") return v;
  throw new Error("Invalid role: expected seller or buyer");
}

export function parseContactMethod(v: unknown): ContactMethod {
  if (
    typeof v === "string" &&
    (CONTACT_METHODS as readonly string[]).includes(v)
  ) {
    return v as ContactMethod;
  }
  throw new Error(`Invalid contactMethod: use one of ${CONTACT_METHODS.join(", ")}`);
}

export function nonEmptyString(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Invalid ${field}`);
  }
  const t = v.trim();
  if (t.length > max) throw new Error(`${field} is too long (max ${max})`);
  return t;
}

export function optionalString(v: unknown, max = 300): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw new Error("Invalid optional string");
  const t = v.trim();
  if (t.length > max) throw new Error(`Note is too long (max ${max})`);
  return t || undefined;
}

/** Optional crypto wallet at registration; empty clears on PATCH */
export function parseCryptoWalletField(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw new Error("Invalid cryptoWallet");
  const t = v.trim();
  if (t.length > 500) throw new Error("cryptoWallet is too long (max 500)");
  return t || undefined;
}

/** Default: platform-only. Optional backup if both method + value provided. */
export function parseAgentContact(body: Record<string, unknown>): {
  contactMethod: ContactMethod;
  contactValue: string;
  contactNote?: string;
} {
  const m = body.contactMethod;
  const v = body.contactValue;
  const hasM = typeof m === "string" && m.trim().length > 0;
  const hasV = typeof v === "string" && v.trim().length > 0;
  if (!hasM && !hasV) {
    return {
      contactMethod: "platform",
      contactValue: "in_app",
      contactNote: optionalString(body.contactNote, 300),
    };
  }
  if (hasM !== hasV) {
    throw new Error(
      "Provide both contactMethod and contactValue, or omit both for platform-only."
    );
  }
  return {
    contactMethod: parseContactMethod(m),
    contactValue: nonEmptyString(v, "contactValue", 500),
    contactNote: optionalString(body.contactNote, 300),
  };
}
