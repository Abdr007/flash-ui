// Shared types for all tool result cards

export interface ToolPart {
  type: string;
  toolName: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available";
  input?: Record<string, unknown>;
  output?: ToolOutput;
}

export interface ToolOutput {
  status: "success" | "error" | "degraded";
  data: unknown;
  error?: string;
  request_id?: string;
  latency_ms?: number;
  warnings?: string[];
}

export type TxStatus = "preview" | "executing" | "signing" | "confirming" | "success" | "error";
