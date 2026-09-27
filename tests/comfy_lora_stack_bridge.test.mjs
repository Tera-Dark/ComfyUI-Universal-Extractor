// Run with: node --test tests/comfy_lora_stack_bridge.test.mjs
// Exercise the actual ComfyUI extension (including the async channel receipt)
// against the observable setter/callback behavior of ComfyUI-Lora-Manager.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../web/comfyui/top_menu_extension.js", import.meta.url)), "utf8")
    .replace('import { app } from "../../scripts/app.js";', "const app = globalThis.__app;");
const copy = (value) => JSON.parse(JSON.stringify(value));
const incoming = (name, model = 0.8, clip = model) => ({
    name, strength_model: model, strength_clip: clip, enabled: true,
});

async function harness(nodes, selectedNodes = []) {
    const sent = [];
    const listeners = new Set();
    const channels = [];
    let extension;
    class TestChannel {
        constructor() { channels.push(this); }
        postMessage(message) {
            sent.push(message);
            for (const listener of listeners) listener(message);
        }
        close() {}
    }
    const storage = new Map();
    const window = {
        __COMFYUI_FRONTEND_VERSION__: "1.33.9",
        location: { origin: "http://comfy.local", href: "http://comfy.local/" },
        sessionStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
        },
        localStorage: { getItem: () => null },
        BroadcastChannel: TestChannel,
        setTimeout,
        addEventListener() {},
    };
    const document = {
        getElementById: () => ({}),
        querySelectorAll: () => [],
        visibilityState: "visible",
        hasFocus: () => true,
        addEventListener() {},
    };
    const app = {
        registerExtension: (value) => { extension = value; },
        graph: { _nodes: nodes, setDirtyCanvas() {} },
        canvas: { selected_nodes: Object.fromEntries(selectedNodes.map((node, index) => [index, node])), setDirty() {}, draw() {} },
    };
    runInNewContext(source, {
        __app: app, window, document, BroadcastChannel: TestChannel,
        MutationObserver: class { observe() {} },
        setTimeout, console,
    }, { filename: "top_menu_extension.js" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(extension, "extension registered");
    await extension.setup();
    assert.equal(channels.length, 1);
    assert.equal(sent.length, 0);
    window.bridge = channels[0];
    const instanceId = storage.get("universal-extractor:comfy-instance-id");
    const send = (mode, loras, id = `test-${Math.random()}`) => {
        const payload = { id, mode, loraManager: { detected: true, loras } };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                listeners.delete(listener);
                reject(new Error(`No async response for ${id}`));
            }, 1800);
            const listener = (message) => {
                if (message.type !== "universal-extractor:lora-stack-delivered" || message.payloadId !== id) return;
                clearTimeout(timer);
                listeners.delete(listener);
                resolve(message);
            };
            listeners.add(listener);
            // Send an addressed channel message as the gallery does. The
            // extension must not acknowledge before its async sync settles.
            window.bridge.onmessage({ data: {
                type: "universal-extractor:lora-stack-message", targetInstanceId: instanceId, payload,
            } });
        });
    };
    return { send, sent, listeners, instanceId, window, nodes };
}

function createNode(title, initial = [], initialText = "", options = {}) {
    let loras = copy(initial);
    const textWidget = { name: "text", value: initialText };
    const lorasWidget = { name: "loras" };
    let writeCount = 0;
    Object.defineProperty(lorasWidget, "value", {
        get: () => copy(loras),
        set: (value) => {
            writeCount++;
            const unique = value.reduce((acc, entry) => [...acc.filter((item) => item.name !== entry.name), entry], []);
            loras = copy(unique.map((entry) => ({
                ...entry,
                // Mirror upstream's `clipStrength || strength` setter.
                clipStrength: entry.clipStrength || entry.strength,
                expanded: Object.hasOwn(entry, "expanded") ? entry.expanded : Number(entry.clipStrength) !== Number(entry.strength),
                locked: Object.hasOwn(entry, "locked") ? entry.locked : false,
            })));
            if (options.forceExpanded) loras.forEach((entry) => { entry.expanded = true; });
            if (options.loseClipStrength) loras.forEach((entry) => { entry.clipStrength = null; });
        },
    });
    textWidget.callback = (value) => {
        // Upstream's text callback uses mergeLoras, which drops metadata such
        // as `locked`; the bridge must restore it when appending.
        const tags = [...value.matchAll(/<lora:([^:>]+):([^:>]+)(?::([^:>]+))?>/gi)];
        const previous = lorasWidget.value;
        lorasWidget.value = tags.map((match) => {
            const old = previous.find((item) => item.name === match[1]);
            return {
                name: match[1], strength: old?.strength ?? Number(match[2]),
                clipStrength: old?.clipStrength ?? Number(match[3] ?? match[2]),
                active: old?.active ?? true,
                expanded: old?.expanded ?? false,
                selected: !!old?.selected,
            };
        });
    };
    lorasWidget.callback = (value) => {
        if (options.throwOnListCallback) throw new Error("list callback failed");
        // Upstream schedules a reverse text synchronization via debounce.
        setTimeout(() => {
            const byName = new Map(value.filter((entry) => entry.name).map((entry) => [entry.name, entry]));
            const syntax = (entry) => `<lora:${entry.name}:${entry.strength}${Number(entry.clipStrength) === Number(entry.strength) ? "" : `:${entry.clipStrength}`}>`;
            const seen = new Set();
            const kept = textWidget.value.replace(/<lora:([^:>]+):([^:>]+)(?::([^:>]+))?>/gi, (_, name) => {
                const entry = byName.get(name);
                if (!entry) return "";
                seen.add(name);
                return syntax(entry);
            }).trim();
            const missing = [...byName.values()].filter((entry) => !seen.has(entry.name)).map(syntax).join(" ");
            textWidget.value = [kept, missing].filter(Boolean).join(" ");
        }, 25);
    };
    return {
        title, comfyClass: "Lora Loader (LoraManager)", widgets: [textWidget, lorasWidget],
        get text() { return textWidget.value; },
        get loras() { return lorasWidget.value; },
        get writes() { return writeCount; },
        setDirtyCanvas() {},
    };
}

test("append targets just the selected compatible node, deduplicates, preserves disabled/locked entries and folds distinct CLIP including zero", async () => {
    const first = createNode("First", [
        { name: "stay", strength: 0.4, clipStrength: 0.4, active: true, expanded: true },
    ], "prompt <lora:stay:0.4>");
    const selected = createNode("Selected", [
        { name: "old", strength: 0.7, clipStrength: 0.2, active: true, expanded: true, locked: true, selected: true },
        { name: "disabled", strength: 1, clipStrength: 1, active: false, expanded: false, locked: true },
    ], "prompt <lora:old:0.7:0.2> extra <lora:unsaved:0.3>");
    const { send } = await harness([first, selected], [selected]);
    const result = await send("append", [incoming("old", 1.2, 0), incoming("new", 0.8, 0.5), incoming("new", 0.9, 0.6)]);
    assert.equal(result.ok, true);
    assert.deepEqual(copy(result.summary), { target: "Selected", applied: 2, added: 1, updated: 1, removed: 0 });
    assert.equal(first.loras[0].strength, 0.4);
    assert.deepEqual(selected.loras.map(({ name }) => name), ["old", "disabled", "unsaved", "new"]);
    assert.equal(selected.loras[0].strength, 1.2);
    assert.equal(Number(selected.loras[0].clipStrength), 0, "zero CLIP survives upstream's falsy setter");
    assert.equal(selected.loras[0].expanded, false);
    assert.equal(selected.loras[0].locked, true);
    assert.equal(selected.loras[0].selected, true);
    assert.equal(selected.loras[1].active, false);
    assert.equal(selected.loras[1].locked, true);
    assert.equal(selected.loras[3].expanded, false);
    assert.equal(selected.loras[3].clipStrength, 0.6);
    assert.match(selected.text, /<lora:old:1\.2:0>/);
    assert.match(selected.text, /<lora:new:0\.9:0\.6>/);
    assert.match(selected.text, /extra/);
});

test("replace removes only the target node's old LoRAs, retaining unrelated text and nodes", async () => {
    const first = createNode("First", [{ name: "other", strength: 0.8, clipStrength: 0.8, active: true }], "note <lora:other:0.8>");
    const second = createNode("Second", [{ name: "obsolete", strength: 1, clipStrength: 1, active: true }], "hello <lora:obsolete:1> world");
    const { send } = await harness([first, second], [second]);
    const ack = await send("replace", [incoming("fresh", 0.75, 0.25)]);
    assert.equal(ack.ok, true);
    assert.deepEqual(copy(ack.summary), { target: "Second", applied: 1, added: 1, updated: 0, removed: 1 });
    assert.deepEqual(second.loras.map((item) => item.name), ["fresh"]);
    assert.equal(second.loras[0].expanded, false);
    assert.equal(second.loras[0].clipStrength, 0.25);
    assert.match(second.text, /hello/);
    assert.match(second.text, /world/);
    assert.doesNotMatch(second.text, /obsolete/);
    assert.deepEqual(first.loras.map((item) => item.name), ["other"]);
});

test("text-only and properties-only stack nodes preserve non-LoRA text in both modes", async () => {
    const textWidget = { name: "text", value: "prompt <lora:old:0.4> suffix", callback() {} };
    const textOnly = { title: "Text-only Lora Stacker", type: "Lora Stacker", widgets: [textWidget] };
    const textBridge = await harness([textOnly]);
    assert.equal((await textBridge.send("append", [incoming("new", .8, .3)])).ok, true);
    assert.match(textWidget.value, /<lora:old:0\.4>/);
    assert.match(textWidget.value, /<lora:new:0\.8:0\.3>/);
    assert.match(textWidget.value, /prompt/);
    assert.match(textWidget.value, /suffix/);
    assert.equal((await textBridge.send("replace", [incoming("new", .6)])).ok, true);
    assert.doesNotMatch(textWidget.value, /<lora:old:/);
    assert.match(textWidget.value, /prompt/);
    assert.match(textWidget.value, /suffix/);

    const propertyOnly = { type: "Lora Stacker", properties: {
        loras: [{ name: "old", strength: .4, clipStrength: .4, active: false, locked: true }],
        lora_syntax: "before <lora:old:0.4> after",
    } };
    const propertyBridge = await harness([propertyOnly]);
    assert.equal((await propertyBridge.send("append", [incoming("new")])).ok, true);
    assert.equal(propertyOnly.properties.loras[0].active, false);
    assert.equal(propertyOnly.properties.loras[0].locked, true);
    assert.match(propertyOnly.properties.lora_syntax, /before/);
    assert.match(propertyOnly.properties.lora_syntax, /<lora:new:0\.8>/);
    assert.equal((await propertyBridge.send("replace", [incoming("third")])).ok, true);
    assert.deepEqual(copy(propertyOnly.properties.loras.map((entry) => entry.name)), ["third"]);
    assert.doesNotMatch(propertyOnly.properties.lora_syntax, /<lora:old:/);
    assert.match(propertyOnly.properties.lora_syntax, /after/);
});

test("when no compatible node is selected, the first compatible node is targeted", async () => {
    const first = createNode("First");
    const second = createNode("Second");
    const nonLora = { title: "Other", type: "KSampler", widgets: [{ name: "steps", value: 30 }] };
    const { send } = await harness([nonLora, first, second], [nonLora]);
    const ack = await send("append", [incoming("fresh")]);
    assert.equal(ack.summary.target, "First");
    assert.equal(first.loras.length, 1);
    assert.equal(second.loras.length, 0);
    assert.equal(nonLora.widgets[0].value, 30);
});

test("invalid/empty requests reject without touching the graph; incompatible nodes reject", async () => {
    const node = createNode("First", [{ name: "old", strength: 1, clipStrength: 1 }], "<lora:old:1>");
    const { send } = await harness([node]);
    for (const [mode, list] of [
        ["unknown", [incoming("new")]],
        ["replace", []],
        ["replace", [{ ...incoming("new"), strength_clip: "NaN" }]],
        ["replace", [incoming("bad:name")]],
        ["append", [{ ...incoming("new"), enabled: false }]],
    ]) {
        const before = copy(node.loras);
        const ack = await send(mode, list);
        assert.equal(ack.ok, false);
        assert.deepEqual(node.loras, before);
    }
    const emptyGraph = await harness([{ type: "KSampler", widgets: [] }]);
    assert.match((await emptyGraph.send("replace", [incoming("new")])).error, /No writable/);
});

test("callback failures restore widgets as they were before the text callback mutated them", async () => {
    const node = createNode("Broken", [
        { name: "old", strength: 0.7, clipStrength: 0.3, active: true, expanded: true, locked: true },
    ], "description <lora:old:0.7:0.3>", { throwOnListCallback: true });
    const before = node.loras;
    const text = node.text;
    const { send } = await harness([node]);
    const ack = await send("replace", [incoming("new")]);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /list callback failed/);
    assert.deepEqual(node.loras, before);
    assert.equal(node.text, text);
});

test("a text-only widget that silently ignores writes cannot acknowledge success", async () => {
    const readOnly = { name: "text", get value() { return "prompt"; }, set value(_ignored) {} };
    const node = { type: "Lora Stacker", widgets: [readOnly] };
    const { send } = await harness([node]);
    const ack = await send("append", [incoming("new", .8, .2)]);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /did not retain/);
    assert.equal(readOnly.value, "prompt");
});

test("never acknowledges success if a third-party setter refuses to keep incoming rows folded", async () => {
    const node = createNode("Rejecting", [], "", { forceExpanded: true });
    const { send } = await harness([node]);
    const ack = await send("append", [incoming("new", 1, 0.5)]);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /rejected/);
});

test("a third-party setter dropping zero CLIP to null cannot acknowledge success", async () => {
    const node = createNode("Rejecting clip", [], "", { loseClipStrength: true });
    const { send } = await harness([node]);
    const ack = await send("append", [incoming("new", 1, 0)]);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /rejected/);
});

test("duplicate payload ids wait for the same async operation and do not write the stack twice", async () => {
    const node = createNode("First");
    const { send, sent, instanceId, window } = await harness([node]);
    const id = "one-id";
    const firstAck = send("append", [incoming("new")], id);
    window.bridge.onmessage({ data: {
        type: "universal-extractor:lora-stack-message", targetInstanceId: instanceId,
        payload: { id, mode: "append", loraManager: { detected: true, loras: [incoming("new")] } },
    } });
    assert.equal(sent.length, 0, "no early acknowledgement while callbacks are still pending");
    assert.equal((await firstAck).ok, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.filter((message) => message.payloadId === id).length, 2);
    assert.equal(node.loras.length, 1);
    // The list setter may be called once by the text merge and once by the
    // bridge; a duplicate channel message must not add another pair of writes.
    assert.equal(node.writes, 2);
    await send("append", [incoming("another")], "later-id");
    const writesBeforeRetry = node.writes;
    const previousAck = await send("append", [incoming("wrong")], id);
    assert.equal(previousAck.summary.applied, 1);
    assert.equal(node.writes, writesBeforeRetry, "retrying an older id does not change the node");
    assert.deepEqual(node.loras.map((entry) => entry.name), ["new", "another"]);
});

test("LoRA stack capability is advertised on probe and receipt to block stale ComfyUI tabs", async () => {
    const node = createNode("Selected", [], "");
    const { send, sent, window } = await harness([node], [node]);
    window.bridge.onmessage({ data: {
        type: "universal-extractor:workflow-probe", probeId: "capability-probe", payloadId: "capability-send",
    } });
    const reply = sent.find((message) => message.type === "universal-extractor:workflow-ack" &&
        message.probeId === "capability-probe");
    assert.equal(reply?.loraStackProtocol, 2);
    const receipt = await send("append", [incoming("new")]);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.loraStackProtocol, 2);
    assert.deepEqual(node.loras.map((item) => item.name), ["new"]);
});
