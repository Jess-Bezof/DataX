/**
 * A2A protocol version negotiation constants.
 *
 * Target spec: A2A v1.0 (https://a2a-protocol.org/v1.0.0/specification).
 * See Section 3.2.6 (standard service parameters) and Section 3.6 (versioning).
 *
 * We intentionally do NOT honor the spec's "empty == 0.3" default. Any request
 * without an A2A-Version header (or with any value other than "1.0") is rejected
 * with VersionNotSupportedError (-32009). Adding "0.3" to SUPPORTED_VERSIONS is
 * the minimal change when an external partner that can't upgrade appears.
 */

export const CURRENT_VERSION = "1.0" as const;
export const SUPPORTED_VERSIONS = ["1.0"] as const;
export const VERSION_HEADER = "A2A-Version";
export const VERSION_QUERY_PARAM = "A2A-Version";

export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

export function isSupportedVersion(v: string | null | undefined): v is SupportedVersion {
  if (!v) return false;
  return (SUPPORTED_VERSIONS as readonly string[]).includes(v);
}
