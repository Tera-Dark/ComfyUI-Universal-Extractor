import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));
let count = 0;
const verify = (name) => {
  const fullPath = resolve(dist, name);
  if (!fullPath.startsWith(resolve(dist) + "/") && !fullPath.startsWith(resolve(dist) + "\\")) {
    throw new Error(`Asset escapes dist: ${name}`);
  }
  if (!existsSync(fullPath)) throw new Error(`Missing built asset: ${name}`);
  count++;
};
for (const item of Object.values(manifest)) {
  verify(item.file);
  for (const name of [...(item.css || []), ...(item.assets || [])]) verify(name);
  for (const name of [...(item.imports || []), ...(item.dynamicImports || [])]) {
    if (!manifest[name]) throw new Error(`Unresolved chunk: ${name}`);
  }
}
const html = readFileSync(join(dist, "index.html"), "utf8");
const entries = [...html.matchAll(/(?:src|href)="\/gallery\/([^"?#]+)"/g)];
if (!entries.length) throw new Error("No index assets found");
for (const [, name] of entries) verify(name);
console.log(`Verified ${count} asset references; no hashed compatibility files were rewritten.`);
