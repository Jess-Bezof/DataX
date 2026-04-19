/**
 * A2A v1.0 data model types (JSON serialization).
 *
 * Names and enum values follow the ProtoJSON convention from spec Section 5.5:
 * camelCase JSON fields, SCREAMING_SNAKE_CASE enum strings. Only the subset
 * DataX actually emits / accepts is typed here.
 */

export type TaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_AUTH_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_REJECTED";

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
];

export type A2ARole = "ROLE_UNSPECIFIED" | "ROLE_USER" | "ROLE_AGENT";

export type A2APart = {
  text?: string;
  data?: unknown;
  url?: string;
  raw?: string;
  mediaType?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
};

export type A2AMessage = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: A2ARole;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
};

export type A2AArtifact = {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
};

export type A2ATaskStatus = {
  state: TaskState;
  message?: A2AMessage;
  timestamp?: string;
};

export type A2ATask = {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
};

export type A2ATaskStatusUpdateEvent = {
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
};

export type A2ATaskArtifactUpdateEvent = {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
};

/** StreamResponse (spec Section 3.2.3) — oneOf wrapper for streaming + push payloads. */
export type A2AStreamResponse =
  | { task: A2ATask }
  | { message: A2AMessage }
  | { statusUpdate: A2ATaskStatusUpdateEvent }
  | { artifactUpdate: A2ATaskArtifactUpdateEvent };

export type A2AAgentCardSignature = {
  protected: string;
  signature: string;
  header?: Record<string, unknown>;
};

export type A2AAgentInterface = {
  url: string;
  protocolBinding: "JSONRPC" | "GRPC" | "HTTP+JSON" | string;
  protocolVersion: string;
  tenant?: string;
};

export type A2AAgentExtension = {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
};

export type A2AAgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  extendedAgentCard?: boolean;
  extensions?: A2AAgentExtension[];
};

export type A2AAgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  securityRequirements?: Array<Record<string, string[]>>;
};

export type A2AAgentProvider = {
  organization: string;
  url: string;
};

export type A2ASecurityScheme =
  | {
      httpAuthSecurityScheme: {
        scheme: string;
        bearerFormat?: string;
        description?: string;
      };
    }
  | {
      apiKeySecurityScheme: {
        name: string;
        location: "query" | "header" | "cookie";
        description?: string;
      };
    };

export type A2AAgentCard = {
  name: string;
  description: string;
  version: string;
  provider?: A2AAgentProvider;
  supportedInterfaces: A2AAgentInterface[];
  capabilities: A2AAgentCapabilities;
  securitySchemes?: Record<string, A2ASecurityScheme>;
  securityRequirements?: Array<Record<string, string[]>>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  documentationUrl?: string;
  iconUrl?: string;
  signatures?: A2AAgentCardSignature[];
  /** Free-form extensions field used by DataX-specific metadata (e.g. reputation). */
  metadata?: Record<string, unknown>;
};

/** Push notification config registered via CreateTaskPushNotificationConfig. */
export type A2APushNotificationConfig = {
  id: string;
  url: string;
  token?: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
};

export type A2ATaskPushNotificationConfig = {
  taskId: string;
  pushNotificationConfig: A2APushNotificationConfig;
};
