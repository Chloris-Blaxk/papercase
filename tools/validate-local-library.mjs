import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");
const manifestPath = path.join(distRoot, "papers", "library.json");
if (!fs.existsSync(manifestPath)) {
  console.log("No local paper library found; skipping local-library validation.");
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entries = Array.isArray(manifest) ? manifest : manifest.resources;
if (!Array.isArray(entries) || !entries.length) throw new Error("Local library manifest must contain resources.");

const ids = new Set();
for (const entry of entries) {
  if (typeof entry !== "string") throw new Error("Local library entries must be relative resource paths.");
  const resourcePath = path.resolve(path.dirname(manifestPath), entry);
  if (!resourcePath.startsWith(`${path.dirname(manifestPath)}${path.sep}`)) throw new Error(`Resource escapes papers directory: ${entry}`);
  const paper = JSON.parse(fs.readFileSync(resourcePath, "utf8"));
  if (paper.version !== 1 || !paper.id || !paper.title || !Array.isArray(paper.body) || !paper.body.length) throw new Error(`Invalid resource: ${entry}`);
  if (ids.has(paper.id)) throw new Error(`Duplicate paper ID: ${paper.id}`);
  ids.add(paper.id);
  if (!paper.publication?.type || !paper.publication?.date || !paper.publication?.source) throw new Error(`Missing publication metadata: ${paper.id}`);
  const itemIds = new Set();
  for (const chapter of [...paper.body, ...(paper.appendices || [])]) {
    if (!chapter.id || !chapter.titleEn || !Array.isArray(chapter.items)) throw new Error(`Invalid chapter in ${paper.id}`);
    for (const item of chapter.items) {
      if (!item.id || itemIds.has(item.id)) throw new Error(`Missing or duplicate item ID in ${paper.id}: ${item.id || "unknown"}`);
      itemIds.add(item.id);
      if (!['pair', 'equation', 'asset'].includes(item.type)) throw new Error(`Unsupported item type in ${paper.id}: ${item.type}`);
      if (item.type === "pair" && (typeof item.en !== "string" || typeof item.zh !== "string")) throw new Error(`Invalid pair in ${paper.id}: ${item.id}`);
      if (item.type === "equation" && typeof item.tex !== "string") throw new Error(`Invalid equation in ${paper.id}: ${item.id}`);
      if (item.type === "asset") {
        if (typeof item.src !== "string") throw new Error(`Invalid asset in ${paper.id}: ${item.id}`);
        const assetPath = path.resolve(distRoot, item.src.replace(/^\.\//, ""));
        if (!assetPath.startsWith(`${distRoot}${path.sep}`) || !fs.existsSync(assetPath)) throw new Error(`Missing asset in ${paper.id}: ${item.src}`);
      }
    }
  }
}

console.log(`Local paper library is valid (${ids.size} resources).`);
