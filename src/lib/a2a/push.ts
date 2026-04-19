/**
 * Push notification config CRUD (spec Sections 3.1.7 – 3.1.10 / 4.3).
 *
 * One config per (agentId, taskId, configId). Only the deal's buyer or seller
 * can register configs on that deal. DataX will POST A2A StreamResponse
 * payloads to the registered URL on every deal_updated event, alongside the
 * legacy webhookUrl fan-out.
 */

import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import type { A2APushNotificationConfig, A2ATaskPushNotificationConfig } from "./types";
import { JsonRpcError, JSON_RPC_ERROR } from "./errors";
import {
  assertAgentCanReadDeal,
  loadDeal,
} from "./handlers";
import type { HandlerContext } from "./handlers";
import type { A2APushConfigDoc } from "@/types/datax";

function requireObject(v: unknown, method: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, `Params for ${method} must be an object`);
  }
  return v as Record<string, unknown>;
}

function parseTaskPushConfig(
  params: Record<string, unknown>
): { taskId: string; config: A2APushNotificationConfig } {
  const outer =
    (params.taskPushNotificationConfig as Record<string, unknown> | undefined) ??
    params;
  const taskId =
    typeof outer.taskId === "string" ? outer.taskId.trim() : "";
  if (!taskId) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`taskId` is required");
  }
  const configRaw = (outer.pushNotificationConfig as Record<string, unknown> | undefined);
  if (!configRaw) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      "`pushNotificationConfig` is required"
    );
  }
  const url = typeof configRaw.url === "string" ? configRaw.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      "`pushNotificationConfig.url` must be an http(s) URL"
    );
  }
  const id =
    typeof configRaw.id === "string" && configRaw.id.trim()
      ? configRaw.id.trim().slice(0, 128)
      : randomUUID();
  const token =
    typeof configRaw.token === "string" && configRaw.token.trim()
      ? configRaw.token.trim().slice(0, 512)
      : undefined;
  return { taskId, config: { id, url, token } };
}

function docToConfig(doc: A2APushConfigDoc): A2ATaskPushNotificationConfig {
  return {
    taskId: doc.taskId,
    pushNotificationConfig: {
      id: doc.configId,
      url: doc.url,
      ...(doc.token ? { token: doc.token } : {}),
    },
  };
}

async function assertCanManagePushConfig(ctx: HandlerContext, taskId: string) {
  const deal = await loadDeal(ctx.db, taskId);
  assertAgentCanReadDeal(ctx.agent, deal);
}

/* --------------------- Create --------------------- */

export async function handleCreatePushConfig(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<A2ATaskPushNotificationConfig> {
  const params = requireObject(rawParams, "CreateTaskPushNotificationConfig");
  const { taskId, config } = parseTaskPushConfig(params);
  await assertCanManagePushConfig(ctx, taskId);

  const now = new Date();
  await ctx.db.collection<A2APushConfigDoc>("a2a_push_configs").updateOne(
    { agentId: ctx.agent._id, taskId, configId: config.id },
    {
      $set: {
        url: config.url,
        ...(config.token ? { token: config.token } : { token: undefined }),
        updatedAt: now,
      },
      $setOnInsert: {
        agentId: ctx.agent._id,
        taskId,
        configId: config.id,
        createdAt: now,
      },
    },
    { upsert: true }
  );
  return { taskId, pushNotificationConfig: config };
}

/* --------------------- Get --------------------- */

export async function handleGetPushConfig(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<A2ATaskPushNotificationConfig> {
  const params = requireObject(rawParams, "GetTaskPushNotificationConfig");
  const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
  const configId = typeof params.id === "string" ? params.id.trim() : "";
  if (!taskId || !configId) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      "`taskId` and `id` are required"
    );
  }
  await assertCanManagePushConfig(ctx, taskId);
  const doc = await ctx.db
    .collection<A2APushConfigDoc>("a2a_push_configs")
    .findOne({ agentId: ctx.agent._id, taskId, configId });
  if (!doc) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, `Push config ${configId} not found`);
  }
  return docToConfig(doc);
}

/* --------------------- List --------------------- */

export async function handleListPushConfigs(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<{ configs: A2ATaskPushNotificationConfig[]; nextPageToken: string }> {
  const params = requireObject(rawParams, "ListTaskPushNotificationConfigs");
  const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
  if (!taskId) {
    throw new JsonRpcError(JSON_RPC_ERROR.InvalidParams, "`taskId` is required");
  }
  await assertCanManagePushConfig(ctx, taskId);
  const docs = await ctx.db
    .collection<A2APushConfigDoc>("a2a_push_configs")
    .find({ agentId: ctx.agent._id, taskId })
    .sort({ createdAt: 1 })
    .toArray();
  return {
    configs: docs.map(docToConfig),
    nextPageToken: "",
  };
}

/* --------------------- Delete --------------------- */

export async function handleDeletePushConfig(
  ctx: HandlerContext,
  rawParams: unknown
): Promise<{ deleted: boolean }> {
  const params = requireObject(rawParams, "DeleteTaskPushNotificationConfig");
  const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
  const configId = typeof params.id === "string" ? params.id.trim() : "";
  if (!taskId || !configId) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.InvalidParams,
      "`taskId` and `id` are required"
    );
  }
  await assertCanManagePushConfig(ctx, taskId);
  const res = await ctx.db
    .collection<A2APushConfigDoc>("a2a_push_configs")
    .deleteOne({ agentId: ctx.agent._id, taskId, configId });
  return { deleted: res.deletedCount > 0 };
}

/* --------------------- Lookup (used by notify.ts) --------------------- */

export type A2APushTarget = {
  url: string;
  token?: string;
  configId: string;
};

/**
 * Return all push targets registered by the given agent for a given task.
 * Safe to call from within notifyDealParties.
 */
export async function listPushTargetsForAgentTask(
  db: import("mongodb").Db,
  agentId: ObjectId,
  taskId: string
): Promise<A2APushTarget[]> {
  const docs = await db
    .collection<A2APushConfigDoc>("a2a_push_configs")
    .find({ agentId, taskId })
    .toArray();
  return docs.map((d) => ({
    url: d.url,
    token: d.token,
    configId: d.configId,
  }));
}
