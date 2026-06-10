/**
 * X402-inspired payment utilities for DataX.
 *
 * Flow:
 *  1. GET /api/deals/{id}/payload with deal in awaiting_payment
 *     → 402 with X-Payment-Requirements header
 *  2. Buyer sends USDC transfer on Base Sepolia, gets tx hash
 *  3. Retry GET /api/deals/{id}/payload with X-Payment: {"txHash":"0x..."}
 *     → server verifies on-chain → deal transitions to released → payload returned
 */

import {
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  type Hash,
} from "viem";
import { baseSepolia } from "viem/chains";

/** USDC contract address on Base Sepolia */
export const USDC_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const USDC_DECIMALS = 6;

const ERC20_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function getPublicClient() {
  const key = process.env.ALCHEMY_API_KEY;
  const transport = key
    ? http(`https://base-sepolia.g.alchemy.com/v2/${key}`)
    : http("https://sepolia.base.org");
  return createPublicClient({ chain: baseSepolia, transport });
}

/** Convert a USDC string amount (e.g. "50") to atomic units bigint */
export function usdcToAtomic(amount: string): bigint {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

/** Build the X-Payment-Requirements JSON for a deal */
export function buildPaymentRequirements({
  dealId,
  agreedAmount,
  sellerWallet,
  resourceUrl,
}: {
  dealId: string;
  agreedAmount: string;
  sellerWallet: string;
  resourceUrl: string;
}) {
  return {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: usdcToAtomic(agreedAmount).toString(),
    resource: resourceUrl,
    description: `DataX deal ${dealId} — dataset payload`,
    mimeType: "application/json",
    payTo: sellerWallet,
    maxTimeoutSeconds: 600,
    asset: USDC_ADDRESS,
    extra: { dealId, agreedAmount, currency: "USDC" },
  };
}

/**
 * Verify an on-chain USDC transfer.
 * Returns ok:true if a confirmed Transfer to expectedTo with value >= minAmount is found.
 */
export async function verifyPayment({
  txHash,
  expectedTo,
  minAmount,
}: {
  txHash: string;
  expectedTo: string;
  minAmount: bigint;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getPublicClient();
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });

    if (!receipt) return { ok: false, error: "Transaction not found" };
    if (receipt.status !== "success")
      return { ok: false, error: "Transaction reverted" };

    // Only look at logs from the USDC contract
    const usdcLogs = receipt.logs.filter(
      (l) => l.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
    );

    const events = parseEventLogs({
      abi: ERC20_ABI,
      logs: usdcLogs,
      eventName: "Transfer",
    });

    for (const ev of events) {
      const toMatch =
        ev.args.to.toLowerCase() === expectedTo.toLowerCase();
      const amountMatch = ev.args.value >= minAmount;
      if (toMatch && amountMatch) return { ok: true };
    }

    return {
      ok: false,
      error: `No USDC Transfer to ${expectedTo} with amount ≥ ${minAmount} found`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Verification error: ${msg}` };
  }
}
