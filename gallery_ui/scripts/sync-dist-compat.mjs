import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(rootDir, "dist", "assets");

const isIndexAsset = (name, extension) => name.startsWith("index-") && name.endsWith(extension);

const getLatestAsset = (extension) => {
  const candidates = readdirSync(assetsDir)
    .filter((name) => isIndexAsset(name, extension))
    .map((name) => {
      const path = join(assetsDir, name);
      return { path, name, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0] ?? null;
};

const getTrackedCompatAssets = (extension) => {
  try {
    return execFileSync("git", ["ls-files", `dist/assets/index-*${extension}`], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => join(rootDir, ...path.split("/")));
  } catch {
    return readdirSync(assetsDir)
      .filter((name) => isIndexAsset(name, extension))
      .map((name) => join(assetsDir, name));
  }
};

const syncAssetType = (extension) => {
  const latest = getLatestAsset(extension);
  if (!latest) {
    return;
  }

  let copied = 0;
  for (const target of getTrackedCompatAssets(extension)) {
    if (!existsSync(target) || resolve(target) === resolve(latest.path)) {
      continue;
    }
    copyFileSync(latest.path, target);
    copied += 1;
  }

  const relativeLatest = latest.path.replace(`${rootDir}${sep}`, "").replaceAll(sep, "/");
  console.log(`Synced ${relativeLatest} to ${copied} compatibility ${extension} file(s).`);
};

syncAssetType(".css");
syncAssetType(".js");
