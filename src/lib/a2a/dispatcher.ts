/**
 * A2A JSON-RPC dispatcher.
 *
 * Responsibilities:
 *   1. Parse the JSON-RPC 2.0 envelope.
 *   2. Validate the A2A-Version header (strict — spec Section 3.6 + DataX's
 *      chosen v1.0-only posture).
 *   3. Resolve the bearer token to an AgentDoc.
 *   4. Route by method name (v1 PascalCase, spec Section 5.3).
 *   5. Return either a JSON-RPC result or an SSE Response for streaming
 *      methods.
 *
 * Errors map to JSON-RPC error objects following spec Section 5.4.
 */

import type { Db } from "mongodb";
import { findAgentByApiKey, parseBearer } from "@/lib/auth";
import type { AgentDoc } from "@/types/datax";
import {
  JsonRpcError,
  JSON_RPC_ERROR,
  versionNotSupported,
} from "./errors";
import {
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  VERSION_HEADER,
  VERSION_QUERY_PARAM,
  isSupportedVersion,
} from "./version";
import {
  handleCancelTask,
  handleGetTask,
  handleListTasks,
  handleSendMessage,
} from "./handlers";
import type { HandlerContext } from "./handlers";
import {
  handleSendStreamingMessage,
  handleSubscribeToTask,
} from "./stream";
import {
  handleCreatePushConfig,
  handleDeletePushConfig,
  handleGetPushConfig,
  handleListPushConfigs,
} from "./push";
import { getMarketplaceBaseUrl } from "./env";

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
};

type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
};

function rpcSuccess(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function jsonRpcResponse(
  body: JsonRpcSuccess | JsonRpcErrorResponse,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/a2a+json; charset=utf-8",
      [VERSION_HEADER]: CURRENT_VERSION,
    },
  });
}

function parseVersionFromRequest(req: Request): string | null {
  const header =
    req.headers.get(VERSION_HEADER) ?? req.headers.get(VERSION_HEADER.toLowerCase());
  if (header && header.trim()) return header.trim();
  try {
    const u = new URL(req.url);
    const q = u.searchParams.get(VERSION_QUERY_PARAM);
    return q?.trim() ? q.trim() : null;
  } catch {
    return null;
  }
}

const UNARY_METHODS = new Set([
  "SendMessage",
  "GetTask",
  "ListTasks",
  "CancelTask",
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
]);

const STREAMING_METHODS = new Set(["SendStreamingMessage", "SubscribeToTask"]);

export type DispatcherDeps = {
  db: Db;
  findAgent?: (
    db: Db,
    token: string | null
  ) => Promise<AgentDoc | null>;
};

async function resolveAgent(
  deps: DispatcherDeps,
  req: Request
): Promise<AgentDoc> {
  const token = parseBearer(req.headers.get("authorization"));
  const finder =
    deps.findAgent ??
    ((db: Db, t: string | null) =>
      findAgentByApiKey(
        db.collection<AgentDoc>("agents"),
        t
      ));
  const agent = await finder(deps.db, token);
  if (!agent) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidRequest,
      "Missing or invalid API key"
    );
  }
  return agent;
}

export async function dispatchA2A(
  req: Request,
  deps: DispatcherDeps
): Promise<Response> {
  // 1. Version check — strict.
  const version = parseVersionFromRequest(req);
  if (!isSupportedVersion(version)) {
    const err = versionNotSupported(version, SUPPORTED_VERSIONS);
    return jsonRpcResponse(
      rpcError(null, err.code, err.message, err.data),
      400
    );
  }

  // 2. Parse JSON-RPC envelope.
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcResponse(
      rpcError(null, JSON_RPC_ERROR.ParseError, "Request body must be valid JSON"),
      400
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonRpcResponse(
      rpcError(null, JSON_RPC_ERROR.InvalidRequest, "Invalid JSON-RPC envelope"),
      400
    );
  }
  const id = body.id ?? null;
  if (body.jsonrpc && body.jsonrpc !== "2.0") {
    return jsonRpcResponse(
      rpcError(id, JSON_RPC_ERROR.InvalidRequest, "Unsupported jsonrpc version"),
      400
    );
  }
  if (typeof body.method !== "string" || !body.method.trim()) {
    return jsonRpcResponse(
      rpcError(id, JSON_RPC_ERROR.InvalidRequest, "`method` is required"),
      400
    );
  }
  const method = body.method.trim();
  const isStreaming = STREAMING_METHODS.has(method);
  const isUnary = UNARY_METHODS.has(method);
  if (!isStreaming && !isUnary) {
    return jsonRpcResponse(
      rpcError(id, JSON_RPC_ERROR.MethodNotFound, `Method ${method} not found`),
      400
    );
  }

  // 3. Authenticate.
  let ctx: HandlerContext;
  try {
    const agent = await resolveAgent(deps, req);
    ctx = {
      db: deps.db,
      agent,
      baseUrl: getMarketplaceBaseUrl(req),
    };
  } catch (e) {
    if (e instanceof JsonRpcError) {
      const status = e.code === JSON_RPC_ERROR.InvalidRequest ? 401 : 400;
      const res = jsonRpcResponse(
        rpcError(id, e.code, e.message, e.data),
        status
      );
      // Signal browsers what to do.
      if (status === 401) {
        res.headers.set("WWW-Authenticate", 'Bearer realm="DataX A2A"');
      }
      return res;
    }
    throw e;
  }

  // 4. Route.
  try {
    if (isStreaming) {
      // Last-Event-ID (native SSE) supported; JSON-RPC param fallback is handled per-method.
      const lastEventId =
        req.headers.get("last-event-id") ?? req.headers.get("Last-Event-ID");
      const stream =
        method === "SendStreamingMessage"
          ? await handleSendStreamingMessage(
              ctx,
              body.params,
              req.signal,
              lastEventId
            )
          : await handleSubscribeToTask(
              ctx,
              body.params,
              req.signal,
              lastEventId
            );
      // Ensure we advertise the negotiated version on streaming responses too.
      stream.headers.set(VERSION_HEADER, CURRENT_VERSION);
      return stream;
    }

    let result: unknown;
    switch (method) {
      case "SendMessage":
        result = await handleSendMessage(ctx, body.params);
        break;
      case "GetTask":
        result = await handleGetTask(ctx, body.params);
        break;
      case "ListTasks":
        result = await handleListTasks(ctx, body.params);
        break;
      case "CancelTask":
        result = await handleCancelTask(ctx, body.params);
        break;
      case "CreateTaskPushNotificationConfig":
        result = await handleCreatePushConfig(ctx, body.params);
        break;
      case "GetTaskPushNotificationConfig":
        result = await handleGetPushConfig(ctx, body.params);
        break;
      case "ListTaskPushNotificationConfigs":
        result = await handleListPushConfigs(ctx, body.params);
        break;
      case "DeleteTaskPushNotificationConfig":
        result = await handleDeletePushConfig(ctx, body.params);
        break;
      default:
        return jsonRpcResponse(
          rpcError(id, JSON_RPC_ERROR.MethodNotFound, `Method ${method} not found`),
          400
        );
    }
    return jsonRpcResponse(rpcSuccess(id, result));
  } catch (e) {
    if (e instanceof JsonRpcError) {
      return jsonRpcResponse(rpcError(id, e.code, e.message, e.data));
    }
    console.error("[a2a] handler error:", e);
    const message = e instanceof Error ? e.message : "Internal error";
    return jsonRpcResponse(
      rpcError(id, JSON_RPC_ERROR.InternalError, message),
      500
    );
  }
}
