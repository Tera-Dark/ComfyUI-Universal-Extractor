import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../web/comfyui/top_menu_extension.js", import.meta.url), "utf8")
  .replace('import { app } from "../../scripts/app.js";', "const app = globalThis.__app;")
  .replace('import { api } from "../../scripts/api.js";', "const api = globalThis.__api;");

test("desktop completion relays validated folder hints once without BroadcastChannel", async () => {
  const handlers = new Map();
  const posts = [];
  let extension;
  const window = {
    __COMFYUI_FRONTEND_VERSION__: "1.33.9",
    location: { origin: "http://comfy.local", href: "http://comfy.local/" },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    localStorage: { getItem() { return null; } }, addEventListener() {},
  };
  runInNewContext(source, {
    __app: { registerExtension(value) { extension = value; } },
    __api: { addEventListener(name, handler) { handlers.set(name, handler); }, async fetchApi(url, init) {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, async json() { return { event: { version: 1, type: "outputs-changed", prompt_id: "desktop" } }; } };
    } },
    window, document: { getElementById() { return {}; }, querySelectorAll() { return []; }, addEventListener() {} },
    setTimeout, console, MutationObserver: class { observe() {} },
  });
  await new Promise(setImmediate);
  await extension.setup();
  handlers.get("executed")({ detail: { prompt_id: "desktop", output: { images: [{ filename: "a.png", type: "output", subfolder: "today" }] } } });
  assert.equal(posts.length, 0);
  handlers.get("execution_success")({ detail: { prompt_id: "desktop" } });
  handlers.get("executing")({ detail: { prompt_id: "desktop", node: null } });
  await new Promise(setImmediate);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/universal_gallery/api/sync-notifications");
  assert.deepEqual(posts[0].body, { version: 1, prompt_id: "desktop", outputs: [{ type: "output", subfolder: "today" }] });
});

test("execution terminal events emit once per prompt, without per-node refreshes or graph writes", async () => {
  const handlers = new Map();
  const messages = [];
  let extension;
  class Channel {
    constructor(name) { this.name = name; }
    postMessage(value) { messages.push({ channel: this.name, ...value }); }
    close() {}
  }
  const window = {
    __COMFYUI_FRONTEND_VERSION__: "1.33.9", BroadcastChannel: Channel,
    location: { origin: "http://comfy.local", href: "http://comfy.local/" },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    localStorage: { getItem() { return null; } }, addEventListener() {},
  };
  runInNewContext(source, {
    __app: { registerExtension(value) { extension = value; } },
    __api: { addEventListener(name, handler) { handlers.set(name, handler); } },
    window, document: { getElementById() { return {}; }, querySelectorAll() { return []; }, addEventListener() {} },
    BroadcastChannel: Channel, setTimeout, console,
    MutationObserver: class { observe() {} },
  });
  await new Promise(setImmediate);
  await extension.setup();
  const emit = (name, detail) => handlers.get(name)?.({ detail });
  emit("executing", { prompt_id: "round-1", node: "7" });
  emit("executed", { prompt_id: "round-1", output: { images: ["a", "b"] } });
  assert.equal(messages.length, 0);
  emit("execution_success", { prompt_id: "round-1" });
  emit("executing", { prompt_id: "round-1", node: null });
  assert.equal(messages.length, 1);
  emit("executing", { prompt_id: "round-2", node: null });
  emit("execution_error", { prompt_id: "round-3" });
  emit("execution_interrupted", { prompt_id: "round-4" });
  emit("execution_success", { prompt_id: "x".repeat(201) });
  emit("execution_success", {});
  assert.deepEqual(messages.map((item) => item.prompt_id), ["round-1", "round-2", "round-3", "round-4"]);
  emit("execution_start", { prompt_id: "legacy-null" });
  emit("executing", null);
  assert.equal(messages.at(-1).prompt_id, "legacy-null");
  assert.ok(messages.every((item) => item.channel === "universal-extractor-gallery-events" && item.version === 1));
});
