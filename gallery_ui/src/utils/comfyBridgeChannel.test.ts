import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  trySendLoraStackToExistingComfyPage,
  trySendWorkflowToExistingComfyPage,
  type LoraStackPayload,
} from "./comfyBridgeChannel";

class TestChannel {
  static instances: TestChannel[] = [];
  readonly posted: Record<string, unknown>[] = [];
  readonly listeners: ((event: { data: Record<string, unknown> }) => void)[] = [];
  readonly name: string;
  closed = false;
  constructor(name: string) {
    this.name = name;
    TestChannel.instances.push(this);
  }
  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
  }
  addEventListener(event: string, listener: (event: { data: Record<string, unknown> }) => void) {
    if (event === "message") this.listeners.push(listener);
  }
  emit(data: Record<string, unknown>) {
    this.listeners.forEach((listener) => listener({ data }));
  }
  close() {
    this.closed = true;
  }
}

const payload: LoraStackPayload = {
  id: "send-append",
  mode: "append",
  loraManager: { detected: true, raw_stack: "", loras: [
    { name: "new", strength_model: 0.8, strength_clip: 0.3, enabled: true },
  ] },
  image: "test.png",
  imageUrl: null,
  ts: 1,
};

const acknowledge = (channel: TestChannel, instanceId: string, extra: Record<string, unknown> = {}) => {
  channel.emit({ type: "universal-extractor:workflow-ack", probeId: `${payload.id}-probe`, instanceId, ...extra });
};

describe("ComfyUI LoRA bridge version handshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", TestChannel);
    TestChannel.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("blocks a v1.3 ComfyUI tab BEFORE sending an append (the old script ignored mode)", async () => {
    const pending = trySendLoraStackToExistingComfyPage(payload);
    const channel = TestChannel.instances[0];
    expect(channel.name).toBe("universal-extractor-workflow");
    acknowledge(channel, "stale-tab", { focused: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(await pending).toMatchObject({ delivered: false, ok: false, outdatedBridge: true });
    expect(channel.posted.map((item) => item.type)).toEqual(["universal-extractor:workflow-probe"]);
    expect(channel.closed).toBe(true);
  });

  it("never redirects a focused stale tab's request into a different live graph", async () => {
    const pending = trySendLoraStackToExistingComfyPage(payload);
    const channel = TestChannel.instances[0];
    acknowledge(channel, "stale-focused", { focused: true });
    acknowledge(channel, "another-graph", { focused: false, visibilityState: "visible", loraStackProtocol: 2 });
    await vi.advanceTimersByTimeAsync(900);
    expect((await pending).outdatedBridge).toBe(true);
    expect(channel.posted).toHaveLength(1);
  });

  it("delivers append/replace only to protocol-2 tabs and requires a structured receipt", async () => {
    for (const mode of ["append", "replace"] as const) {
      const outgoing = { ...payload, mode, id: `${payload.id}-${mode}` };
      const pending = trySendLoraStackToExistingComfyPage(outgoing);
      const channel = TestChannel.instances.at(-1)!;
      channel.emit({ type: "universal-extractor:workflow-ack", probeId: `${outgoing.id}-probe`,
        instanceId: "good-tab", focused: true, loraStackProtocol: 2 });
      await vi.advanceTimersByTimeAsync(900);
      expect(channel.posted).toHaveLength(2);
      expect(channel.posted[1]).toMatchObject({
        type: "universal-extractor:lora-stack-message", targetInstanceId: "good-tab", payload: { mode },
      });
      channel.emit({ type: "universal-extractor:lora-stack-delivered", payloadId: outgoing.id,
        instanceId: "good-tab", loraStackProtocol: 2, ok: true,
        summary: { target: "LoRA node", applied: 1, added: 1, updated: 0, removed: 0 },
      });
      expect(await pending).toMatchObject({ delivered: true, ok: true, summary: { target: "LoRA node" } });
    }
  });

  it("refuses a missing-version or missing-summary receipt, instead of claiming success", async () => {
    const pending = trySendLoraStackToExistingComfyPage(payload);
    const channel = TestChannel.instances[0];
    acknowledge(channel, "conflicted-tab", { focused: true, loraStackProtocol: 2 });
    await vi.advanceTimersByTimeAsync(900);
    channel.emit({ type: "universal-extractor:lora-stack-delivered", instanceId: "conflicted-tab",
      payloadId: payload.id, ok: true });
    expect(await pending).toMatchObject({ delivered: true, ok: false, outdatedBridge: true });
  });

  it("leaves the independent workflow handoff compatible with older receivers", async () => {
    const pending = trySendWorkflowToExistingComfyPage({
      id: payload.id, workflow: null, prompt: {}, image: "test.png", imageUrl: null, ts: 1,
    });
    const channel = TestChannel.instances[0];
    acknowledge(channel, "old-workflow-tab", { focused: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(channel.posted[1].type).toBe("universal-extractor:workflow-message");
    channel.emit({ type: "universal-extractor:workflow-delivered", payloadId: payload.id,
      instanceId: "old-workflow-tab", ok: true });
    expect(await pending).toBe(true);
  });
});
