/**
 * A2A v1.0 error codes (spec Section 5.4) + JSON-RPC error envelope helpers.
 */

export const A2A_ERROR = {
  TaskNotFound: -32001,
  TaskNotCancelable: -32002,
  PushNotificationNotSupported: -32003,
  UnsupportedOperation: -32004,
  ContentTypeNotSupported: -32005,
  InvalidAgentResponse: -32006,
  ExtendedAgentCardNotConfigured: -32007,
  ExtensionSupportRequired: -32008,
  VersionNotSupported: -32009,
} as const;

export const JSON_RPC_ERROR = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export class JsonRpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export function taskNotFound(taskId: string): JsonRpcError {
  return new JsonRpcError(A2A_ERROR.TaskNotFound, `Task ${taskId} not found`, { taskId });
}

export function taskNotCancelable(taskId: string, currentState: string): JsonRpcError {
  return new JsonRpcError(
    A2A_ERROR.TaskNotCancelable,
    `Task ${taskId} is not cancelable in state ${currentState}`,
    { taskId, currentState }
  );
}

export function unsupportedOperation(detail: string, data?: unknown): JsonRpcError {
  return new JsonRpcError(A2A_ERROR.UnsupportedOperation, detail, data);
}

export function versionNotSupported(
  received: string | null | undefined,
  supportedVersions: readonly string[]
): JsonRpcError {
  const got = received === null || received === undefined || received === "" ? "(empty)" : received;
  return new JsonRpcError(
    A2A_ERROR.VersionNotSupported,
    `A2A protocol version ${got} is not supported. Send header "A2A-Version: ${supportedVersions[0]}".`,
    { received: received ?? null, supportedVersions: [...supportedVersions] }
  );
}

export function pushNotificationNotSupported(detail: string): JsonRpcError {
  return new JsonRpcError(A2A_ERROR.PushNotificationNotSupported, detail);
}

export function extendedCardNotConfigured(): JsonRpcError {
  return new JsonRpcError(
    A2A_ERROR.ExtendedAgentCardNotConfigured,
    "This agent does not have an extended Agent Card configured."
  );
}
