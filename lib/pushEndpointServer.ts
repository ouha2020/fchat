import { createHash } from "node:crypto";

export interface PushEndpointSummary {
  endpointHost: string;
  endpointFingerprint: string;
}

export function summarizePushEndpoint(endpoint: string | null | undefined): PushEndpointSummary {
  const raw = endpoint ?? "";
  let endpointHost = "unknown";
  try {
    endpointHost = new URL(raw).hostname || "unknown";
  } catch {
    endpointHost = "unknown";
  }

  return {
    endpointHost,
    endpointFingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 12),
  };
}
