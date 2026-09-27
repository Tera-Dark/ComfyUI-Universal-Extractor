import type { ImageRecipeLoraManager } from "../types/universal-gallery";

const WORKFLOW_CHANNEL_NAME = "universal-extractor-workflow";
const WORKFLOW_MESSAGE_TYPE = "universal-extractor:workflow-message";
const LORA_STACK_MESSAGE_TYPE = "universal-extractor:lora-stack-message";
const WORKFLOW_PROBE_TYPE = "universal-extractor:workflow-probe";
const WORKFLOW_ACK_TYPE = "universal-extractor:workflow-ack";
const WORKFLOW_DELIVERED_TYPE = "universal-extractor:workflow-delivered";
const LORA_STACK_DELIVERED_TYPE = "universal-extractor:lora-stack-delivered";
const EXISTING_COMFY_PROBE_TIMEOUT_MS = 900;
const WORKFLOW_DELIVERY_TIMEOUT_MS = 8000;

// v1.3 ComfyUI's bridge ignores payload.mode and replaces the text/list for
// BOTH buttons. It must never receive an append request from a newer gallery.
// Keep in sync with web/comfyui/top_menu_extension.js.
const LORA_STACK_PROTOCOL_VERSION = 2;

export type WorkflowPayload = {
  id: string;
  workflow: Record<string, unknown> | null;
  prompt: unknown;
  image: string;
  imageUrl: string | null;
  ts: number;
};

export type LoraStackApplyMode = "append" | "replace";

export type LoraStackPayload = {
  id: string;
  mode: LoraStackApplyMode;
  loraManager: ImageRecipeLoraManager;
  image: string;
  imageUrl: string | null;
  ts: number;
};

export type LoraStackSummary = {
  target: string;
  applied: number;
  added: number;
  updated: number;
  removed: number;
};

type WorkflowAck = {
  instanceId: string;
  visibilityState?: DocumentVisibilityState;
  focused?: boolean;
  loraStackProtocol?: number;
  ts?: number;
};

export type ChannelDeliveryResult = {
  delivered: boolean;
  ok: boolean;
  outdatedBridge?: boolean;
  error?: string;
  summary?: LoraStackSummary;
};

const readLoraStackSummary = (value: unknown): LoraStackSummary | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const info = value as Partial<LoraStackSummary>;
  const counts = [info.applied, info.added, info.updated, info.removed];
  if (typeof info.target !== "string" || !counts.every((count) => Number.isSafeInteger(count) && count! >= 0)) {
    return undefined;
  }
  return {
    target: info.target.slice(0, 120),
    applied: info.applied!,
    added: info.added!,
    updated: info.updated!,
    removed: info.removed!,
  };
};

const trySendPayloadToExistingComfyPage = (
  payload: WorkflowPayload | LoraStackPayload,
  messageType: string,
  deliveredType: string,
  requiresLoraStackProtocol = false,
) =>
  new Promise<ChannelDeliveryResult>((resolve) => {
    if (!("BroadcastChannel" in window)) {
      resolve({ delivered: false, ok: false });
      return;
    }

    let resolved = false;
    let targetInstanceId: string | null = null;
    const probeId = `${payload.id}-probe`;
    const channel = new BroadcastChannel(WORKFLOW_CHANNEL_NAME);
    const candidates: WorkflowAck[] = [];
    let deliveryTimer = 0;
    let probeTimer = 0;

    const cleanup = () => {
      window.clearTimeout(deliveryTimer);
      window.clearTimeout(probeTimer);
      channel.close();
    };

    const finish = (result: ChannelDeliveryResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    channel.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === WORKFLOW_ACK_TYPE && data.probeId === probeId && typeof data.instanceId === "string") {
        candidates.push(data as WorkflowAck);
        return;
      }
      // Only the probed instance can acknowledge a send. A background tab
      // must not make another tab's delivery look successful.
      if (data.type === deliveredType && data.payloadId === payload.id &&
          targetInstanceId && data.instanceId === targetInstanceId) {
        if (requiresLoraStackProtocol && data.loraStackProtocol !== LORA_STACK_PROTOCOL_VERSION) {
          finish({ delivered: true, ok: false, outdatedBridge: true });
          return;
        }
        const summary = readLoraStackSummary(data.summary);
        if (requiresLoraStackProtocol && data.ok !== false && !summary) {
          finish({ delivered: true, ok: false, outdatedBridge: true });
          return;
        }
        finish({
          delivered: true,
          ok: data.ok !== false,
          error: typeof data.error === "string" ? data.error : undefined,
          summary,
        });
      }
    });

    const selectTarget = () => {
      if (resolved) return;
      const target =
        candidates.find((candidate) => candidate.focused) ??
        candidates.find((candidate) => candidate.visibilityState === "visible") ??
        candidates[0];
      if (!target) {
        finish({ delivered: false, ok: false });
        return;
      }
      // Check the SELECTED instance, not "some compatible tab": silently
      // switching to a different graph would modify the wrong user's node.
      if (requiresLoraStackProtocol && target.loraStackProtocol !== LORA_STACK_PROTOCOL_VERSION) {
        finish({ delivered: false, ok: false, outdatedBridge: true });
        return;
      }
      targetInstanceId = target.instanceId;
      channel.postMessage({ type: messageType, targetInstanceId: target.instanceId, payload });
      deliveryTimer = window.setTimeout(() => finish({ delivered: false, ok: false }), WORKFLOW_DELIVERY_TIMEOUT_MS);
    };

    channel.postMessage({ type: WORKFLOW_PROBE_TYPE, probeId, payloadId: payload.id });
    probeTimer = window.setTimeout(selectTarget, EXISTING_COMFY_PROBE_TIMEOUT_MS);
  });

export const trySendWorkflowToExistingComfyPage = async (payload: WorkflowPayload) => {
  const result = await trySendPayloadToExistingComfyPage(payload, WORKFLOW_MESSAGE_TYPE, WORKFLOW_DELIVERED_TYPE);
  return result.delivered && result.ok;
};

export const trySendLoraStackToExistingComfyPage = (payload: LoraStackPayload) =>
  trySendPayloadToExistingComfyPage(payload, LORA_STACK_MESSAGE_TYPE, LORA_STACK_DELIVERED_TYPE, true);
