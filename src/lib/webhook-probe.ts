/**
 * Webhook probe helper.
 *
 * Fires a test POST to a webhook URL and returns whether it responded with a
 * 2xx status within the timeout. Used by PATCH /api/agents/me to give
 * operators immediate feedback when they register a webhookUrl.
 *
 * The probe is non-blocking from the caller's perspective — the URL is saved
 * to the DB regardless of the probe outcome.
 */

export type WebhookProbeResult = {
  ok: boolean;
  /** HTTP status returned by the target (absent on network error). */
  statusCode?: number;
  /** Human-readable error string (absent on success). */
  error?: string;
  at: Date;
};

/** Sentinel A2A StreamResponse used as the probe payload. */
const PROBE_PAYLOAD = {
  statusUpdate: {
    taskId: "webhook-probe",
    contextId: "datax-health-check",
    status: {
      state: "TASK_STATE_SUBMITTED",
      message: {
        parts: [{ text: "DataX webhook probe — please respond 2xx to confirm receipt." }],
      },
    },
    metadata: { dataxWebhookTest: true },
  },
};

/**
 * Probe a webhook URL.
 *
 * @param url     The HTTPS URL to POST to.
 * @param secret  The bearer token DataX sends as Authorization header.
 * @param timeoutMs  Request timeout in ms (default 5000).
 */
export async function probeWebhookUrl(
  url: string,
  secret: string | undefined,
  timeoutMs = 5000
): Promise<WebhookProbeResult> {
  const at = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-DataX-Webhook-Test": "true",
    };
    if (secret?.trim()) {
      headers["Authorization"] = `Bearer ${secret.trim()}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(PROBE_PAYLOAD),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ok = res.status >= 200 && res.status < 300;
    if (!ok) {
      console.warn(`[webhook-probe] FAIL url=${url} status=${res.status}`);
    } else {
      console.log(`[webhook-probe] OK url=${url} status=${res.status}`);
    }

    return { ok, statusCode: res.status, at };
  } catch (e) {
    clearTimeout(timer);
    const error =
      e instanceof Error
        ? e.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : e.message
        : "Unknown error";
    console.warn(`[webhook-probe] FAIL url=${url} error=${error}`);
    return { ok: false, error, at };
  }
}
