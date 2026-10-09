import fs from "node:fs";

const paper = JSON.parse(fs.readFileSync(new URL("../examples/paper.template.json", import.meta.url)));
if (paper.version !== 1 || !paper.id || !paper.title || !Array.isArray(paper.body)) throw new Error("Invalid template metadata");
for (const chapter of [...paper.body, ...(paper.appendices || [])]) {
  if (!chapter.id || !chapter.titleEn || !Array.isArray(chapter.items)) throw new Error(`Invalid chapter ${chapter.id || "unknown"}`);
  for (const item of chapter.items) {
    if (!item.id || !["pair", "equation", "asset"].includes(item.type)) throw new Error(`Invalid item ${item.id || "unknown"}`);
    if (item.type === "pair" && (typeof item.en !== "string" || typeof item.zh !== "string")) throw new Error(`Invalid pair ${item.id}`);
    if (item.type === "equation" && typeof item.tex !== "string") throw new Error(`Invalid equation ${item.id}`);
    if (item.type === "asset" && typeof item.src !== "string") throw new Error(`Invalid asset ${item.id}`);
  }
}
console.log("Template resource is valid.");
