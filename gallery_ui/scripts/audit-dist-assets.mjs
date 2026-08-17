import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexHtmlPath = join(rootDir, "dist", "index.html");
const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, "utf8") : "";
const entryAssets = [...indexHtml.matchAll(/\/gallery\/assets\/(index-[^"]+\.(?:css|js))/g)].map((match) => `dist/assets/${match[1]}`);
const trackedSet = new Set(
  execFileSync("git", ["ls-files", "dist/assets/index-*.*"], {
    cwd: rootDir,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean),
);
const tracked = execFileSync("git", ["ls-files", "dist/assets/index-*.*"], {
  cwd: rootDir,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter((path) => /\.(css|js)$/.test(path))
  .map((path) => {
    const fullPath = join(rootDir, ...path.split("/"));
    return {
      path,
      name: basename(path),
      bytes: existsSync(fullPath) ? statSync(fullPath).size : 0,
      mtimeMs: existsSync(fullPath) ? statSync(fullPath).mtimeMs : 0,
      type: path.endsWith(".css") ? "css" : "js",
    };
  });

const totalBytes = tracked.reduce((sum, asset) => sum + asset.bytes, 0);
const latestByType = new Map();
for (const asset of tracked) {
  const current = latestByType.get(asset.type);
  if (!current || asset.mtimeMs > current.mtimeMs) {
    latestByType.set(asset.type, asset);
  }
}

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

console.log(`Tracked index assets: ${tracked.length} (${formatBytes(totalBytes)})`);
console.log(`Index entries: ${entryAssets.length ? entryAssets.map((asset) => basename(asset)).join(", ") : "none"}`);
for (const type of ["css", "js"]) {
  const assets = tracked.filter((asset) => asset.type === type);
  const latest = latestByType.get(type);
  console.log(`${type.toUpperCase()}: ${assets.length} file(s), latest ${latest ? latest.name : "none"}`);
}
for (const entryAsset of entryAssets) {
  const fullPath = join(rootDir, ...entryAsset.split("/"));
  const status = existsSync(fullPath) ? (trackedSet.has(entryAsset) ? "tracked" : "untracked") : "missing";
  console.log(`Entry ${basename(entryAsset)}: ${status}`);
}
