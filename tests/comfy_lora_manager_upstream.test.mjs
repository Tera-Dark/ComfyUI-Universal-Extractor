// Optional integration test. Set LORA_MANAGER_SOURCE to an installed checkout of
// https://github.com/willmiao/ComfyUI-Lora-Manager (tested against 0a262cb).
// Reads upstream sources at runtime; does NOT vendor its GPL-licensed code.
// node --test tests/comfy_lora_manager_upstream.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const upstream = process.env.LORA_MANAGER_SOURCE || path.join(root, "../.cache/ComfyUI-Lora-Manager");
const base = path.join(upstream, "web/comfyui");
const available = ["utils.js", "lora_syntax_utils.js", "loras_widget.js", "lora_stacker.js", "lora_loader.js"]
    .every((name) => existsSync(path.join(base, name)));
if (process.env.LORA_MANAGER_SOURCE && !available) {
    throw new Error(`LORA_MANAGER_SOURCE lacks the real upstream web/comfyui sources: ${upstream}`);
}
const copy = (value) => JSON.parse(JSON.stringify(value));

// Evaluate ORIGINAL upstream functions and extension callbacks in the same
// JS realm as our bridge. Only ESM imports/exports are replaced with test app
// bindings; mergeLoras, the 80ms debounce, and the actual widget setter body
// are loaded verbatim from the checkout (no hand-maintained simulation).
const evalUpstream = (context, file) => {
    const code = readFileSync(path.join(base, file), "utf8")
        .replace(/^import\s+(?:[\s\S]*?)\s+from\s+["'][^"']+["'];\s*$/gm, "")
        .replace(/^export\s+(?=(const|let|function|class)\b)/gm, "");
    const prefix = file === "utils.js"
        ? "const {app, AutoComplete, lmUrl} = globalThis;"
        : file === "lora_syntax_utils.js"
            ? "const {LORA_PATTERN} = globalThis.__LMutils;"
            : `const {app} = globalThis;
               const {getActiveLorasFromNode, updateConnectedTriggerWords, updateDownstreamLoaders,
                   chainCallback, mergeLoras, getWidgetByName, getWidgetSerializedValue,
                   collectActiveLorasFromChain, interceptModeChange} = globalThis.__LMutils;
               const {applyLoraValuesToText, debounce} = globalThis.__LMsyntax;`;
    const suffix = file === "utils.js"
        ? "globalThis.__LMutils = {LORA_PATTERN, getActiveLorasFromNode, updateConnectedTriggerWords, updateDownstreamLoaders, chainCallback, mergeLoras, getWidgetByName, getWidgetSerializedValue, collectActiveLorasFromChain, interceptModeChange};"
        : file === "lora_syntax_utils.js"
            ? "globalThis.__LMsyntax = {applyLoraValuesToText, debounce};"
            : "";
    vm.runInContext(`(function(){${prefix}\n${code}\n${suffix}\n})()`, context, { filename: `upstream/${file}` });
};

async function createHarness(type, initial, initialText, options = {}) {
    const extensions = [];
    const messages = [];
    const channels = [];
    const listeners = new Set();
    const storage = new Map();
    class Channel {
        constructor() { channels.push(this); }
        postMessage(message) {
            messages.push(message);
            for (const listener of listeners) listener(message);
        }
        close() {}
    }
    const document = {
        querySelectorAll: () => [], getElementById: () => ({}),
        visibilityState: "visible", hasFocus: () => true, addEventListener() {},
    };
    const window = {
        __COMFYUI_FRONTEND_VERSION__: "1.33.9",
        location: { origin: "http://comfy.local", href: "http://comfy.local/" },
        sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        localStorage: { getItem: () => null },
        setTimeout, BroadcastChannel: Channel, addEventListener() {},
    };
    const app = {
        registerExtension(extension) { extensions.push(extension); },
        graph: { _nodes: [], setDirtyCanvas() {} },
        canvas: { selected_nodes: {}, setDirty() {}, draw() {} },
    };
    const context = vm.createContext({
        app, __app: app, window, document, BroadcastChannel: Channel, setTimeout, clearTimeout,
        MutationObserver: class { observe() {} }, console, fetch: () => { throw new Error("No external graph nodes allowed"); },
        AutoComplete: class {}, lmUrl: (url) => url,
    });
    evalUpstream(context, "utils.js");
    evalUpstream(context, "lora_syntax_utils.js");
    evalUpstream(context, type === "Lora Stacker (LoraManager)" ? "lora_stacker.js" : "lora_loader.js");

    // Run the ORIGINAL setValue body in a genuine list getter/setter wrapper.
    const upstreamWidget = readFileSync(path.join(base, "loras_widget.js"), "utf8");
    const setter = upstreamWidget.match(/setValue: function\(v\) \{([\s\S]*?)\n    \},\n    hideOnZoom:/);
    assert.ok(setter, "Upstream DOM widget setter was located");
    const makeList = vm.runInContext(`(function (original, fireCallback) {
        let widgetValue = [];
        let selectedLora = null;
        const widget = { name: "loras", __dragActive: false };
        const renderLoras = (value) => {
            widget.rendered = value.map((item) => ({...item}));
        };
        const setValue = function(v) {${setter[1]}
        };
        Object.defineProperty(widget, "value", {
            get() { return widgetValue.map((lora) => ({...lora, selected: lora.name === selectedLora})); },
            set(v) { setValue(v); if (fireCallback) widget.callback?.(widget.value); },
        });
        widget.value = original;
        widget.select = (name) => { selectedLora = name; };
        return widget;
    })`, context);
    const list = makeList(initial, options.fireCallbackOnSet ?? false);
    const inputEl = { value: initialText };
    const text = { name: "text", inputEl };
    Object.defineProperty(text, "value", {
        get() { return inputEl.value; },
        set(value) {
            inputEl.value = value;
            if (options.fireCallbackOnSet) text.callback?.(inputEl.value);
        },
    });
    const NodeType = class {
        constructor() {
            this.id = 19;
            this.title = "LoRA堆（默认）";
            this.comfyClass = type;
            this.widgets = [text, list];
            this.inputs = [];
            this.graph = app.graph;
        }
        addInput(name, type, extra) { this.inputs.push({ name, type, ...extra }); }
        setDirtyCanvas() {}
    };
    NodeType.comfyClass = type;
    const upstreamExtension = extensions.find((value) => value.name === (type.includes("Stacker") ? "LoraManager.LoraStacker" : "LoraManager.LoraLoader"));
    assert.ok(upstreamExtension, "Loaded genuine upstream node extension");
    await upstreamExtension.beforeRegisterNodeDef(NodeType, {}, app);
    const node = new NodeType();
    app.graph._nodes = [node];
    app.canvas.selected_nodes = { [node.id]: node };
    await node.onNodeCreated();
    assert.equal(node.lorasWidget, list, "Upstream bound the actual list widget");
    assert.equal(node.inputWidget, text, "Upstream bound the actual text widget");

    const bridgeCode = readFileSync(process.env.BRIDGE_SOURCE || path.join(root, "web/comfyui/top_menu_extension.js"), "utf8")
        .replace('import { app } from "../../scripts/app.js";', "const app = globalThis.__app;");
    vm.runInContext(bridgeCode, context, { filename: "top_menu_extension.js" });
    await new Promise((resolve) => setImmediate(resolve));
    const bridge = extensions.find((value) => value.name.includes("Universal"));
    assert.ok(bridge, "Bridge extension registered");
    await bridge.setup();
    assert.equal(channels.length, 1);
    const channel = channels[0];
    const send = (mode, loras, id = `test-${Math.random()}`) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`No delivery acknowledgement for ${id}`)), 2400);
        const listener = (message) => {
            if (message.type !== "universal-extractor:lora-stack-delivered" || message.payloadId !== id) return;
            clearTimeout(timeout);
            listeners.delete(listener);
            resolve(message);
        };
        listeners.add(listener);
        const payload = { id, mode, loraManager: { detected: true, loras } };
        const instanceId = storage.get("universal-extractor:comfy-instance-id");
        channel.onmessage({data: {
            type: "universal-extractor:lora-stack-message", targetInstanceId: instanceId, payload,
        }});
    });
    return { node, text, list, send, channel, messages };
}

const incoming = (name, strength_model, strength_clip) => ({
    name, strength_model, strength_clip, enabled: true,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

for (const type of ["Lora Stacker (LoraManager)", "Lora Loader (LoraManager)"]) {
    for (const fireCallbackOnSet of [false, true]) {
        test(`real upstream ${type}, frontend setter callback=${fireCallbackOnSet}: append retains every old LoRA and folds all CLIP rows`, { skip: !available }, async () => {
            const old = [
                { name: "old", strength: 0.75, clipStrength: 0.25, active: true, expanded: true },
                { name: "same", strength: 0.4, clipStrength: 0.4, active: true, expanded: true },
                { name: "inactive", strength: 0.7, clipStrength: 0.3, active: false, expanded: true },
            ];
            const { node, list, send } = await createHarness(type, old,
                "prefix <lora:old:0.75:0.25> <lora:same:0.4> <lora:unsaved:0.1:0.8> suffix", { fireCallbackOnSet });
            list.select("old");
            const answer = await send("append", [incoming("same", 0.9, 0), incoming("fresh", 1.2, 0.4)]);
            await settle();
            assert.equal(answer.ok, true, answer.error);
            const names = node.lorasWidget.value.map((value) => value.name);
            assert.deepEqual(copy(names), ["old", "same", "inactive", "unsaved", "fresh"]);
            assert.match(node.inputWidget.value, /<lora:old:0\.75:0\.25>/);
            assert.match(node.inputWidget.value, /<lora:same:0\.90:0\.00>/);
            assert.match(node.inputWidget.value, /<lora:unsaved:0\.10:0\.80>/);
            assert.match(node.inputWidget.value, /<lora:fresh:1\.20:0\.40>/);
            assert.deepEqual(copy(node.lorasWidget.value.map((item) => item.expanded)), [false, false, false, false, false]);
            assert.equal(Number(node.lorasWidget.value[1].clipStrength), 0);
            assert.equal(node.lorasWidget.value[0].selected, true);
            assert.equal(node.lorasWidget.value[2].active, false);
        });
    }
}

for (const type of ["Lora Stacker (LoraManager)", "Lora Loader (LoraManager)"]) {
    test(`real upstream ${type}: replace discards only the target's old entries, keeping independent CLIP`, { skip: !available }, async () => {
        const old = [
            { name: "old", strength: 0.5, clipStrength: 0.2, active: true, expanded: true },
            { name: "inactive", strength: 0.9, clipStrength: 0.9, active: false, expanded: false },
        ];
        const { node, send } = await createHarness(type, old, "note <lora:old:0.5:0.2> tail");
        const result = await send("replace", [incoming("brand-new", 1.1, 0)]);
        await settle();
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(copy(node.lorasWidget.value.map((entry) => entry.name)), ["brand-new"]);
        assert.equal(node.lorasWidget.value[0].expanded, false);
        assert.equal(Number(node.lorasWidget.value[0].clipStrength), 0);
        assert.match(node.inputWidget.value, /note/);
        assert.match(node.inputWidget.value, /tail/);
        assert.match(node.inputWidget.value, /<lora:brand-new:1\.10:0\.00>/);
        assert.doesNotMatch(node.inputWidget.value, /<lora:old:/);
    });
}
