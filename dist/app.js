const KEYS = {
  resources: "papercase:resources:v1",
  activePaper: "papercase:active-paper:v1",
  model: "papercase:model:v1",
  modelKey: "papercase:model-key:v1",
  roles: "papercase:roles:v1"
};

const DEFAULT_ROLES = {
  reader: "Reader",
  navigator: "Navigator",
  reviewer: "Reviewer",
  instruction: "Explain the paper in its original order. Distinguish quoted evidence, inference, and outside context. The human reader controls their own words, actions, beliefs, and choices. When a conclusion is weak, use the reviewer role to ask for evidence instead of inventing certainty."
};

const elements = Object.fromEntries([
  "paper-import", "paper-select", "import-status", "progress-summary", "section-count", "section-map", "reader", "empty-state", "paper-view", "paper-title", "paper-title-translation", "paper-authors", "publication-type", "publication-source", "publication-date", "publication-record", "publication-identifier", "publication-links", "metadata-warning", "reader-progress", "chapter-title", "chapter-title-en", "section-number", "guide-badge", "guide-copy", "paper-location", "paper-flow", "previous-section", "next-section", "discussion", "discussion-reader", "discussion-guide", "chat-context", "chat-thread", "chat-form", "chat-input", "chat-status", "open-settings", "settings-dialog", "settings-form", "model-endpoint", "model-id", "model-key", "role-reader", "role-navigator", "role-reviewer", "role-instruction", "clear-settings", "settings-status", "navigator-name", "reviewer-name", "reader-name"
].map(id => [id, document.getElementById(id)]));

let resources = loadJson(localStorage, KEYS.resources, {});
let activePaperId = localStorage.getItem(KEYS.activePaper) || Object.keys(resources)[0] || "";
let paper = resources[activePaperId] || null;
let chapterIndex = 0;
let activePairId = null;
let chatPending = false;

function loadJson(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatText(value) {
  const math = [];
  let text = String(value ?? "")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, source) => { const token = `MATHBLOCK${math.length}TOKEN`; math.push({ token, source, display: true }); return token; })
    .replace(/\$([^$]+)\$/g, (_, source) => { const token = `MATHBLOCK${math.length}TOKEN`; math.push({ token, source, display: false }); return token; });
  text = escapeHtml(text)
    .replace(/\\(?:textbf|bf)\{([^{}]*)\}/g, "<strong>$1</strong>")
    .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, "<em>$1</em>")
    .replace(/\\(?:citep|citet|cite)\{([^{}]+)\}/g, "<span class=\"citation\">[$1]</span>")
    .replace(/\\(?:eqref|ref)\{([^{}]+)\}/g, "<span class=\"citation\">§$1</span>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  for (const entry of math) {
    let rendered = `<code>${escapeHtml(entry.source)}</code>`;
    try {
      if (window.katex) rendered = window.katex.renderToString(entry.source, { displayMode: entry.display, throwOnError: false, strict: "ignore", trust: false });
    } catch { /* readable source fallback */ }
    text = text.replace(entry.token, rendered);
  }
  return text;
}

const PUBLICATION_TYPE_LABELS = {
  preprint: "PREPRINT · 预印本",
  journal: "JOURNAL · 期刊",
  conference: "CONFERENCE · 会议",
  workshop: "WORKSHOP · 研讨会",
  "book-chapter": "BOOK CHAPTER · 书籍章节",
  thesis: "THESIS · 学位论文",
  report: "REPORT · 报告",
  other: "OTHER · 其他"
};

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function authorLine(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value || "").trim();
}

function publicationInfo() {
  const value = paper?.publication || {};
  return {
    type: value.type || "",
    date: value.date || (paper?.year ? String(paper.year) : ""),
    dateProvided: Boolean(value.date),
    source: value.source || value.venue || "",
    venue: value.venue || "",
    sourceUrl: safeHttpUrl(value.sourceUrl),
    doi: String(value.doi || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim(),
    arxivId: String(value.arxivId || "").trim(),
    volume: String(value.volume || "").trim(),
    issue: String(value.issue || "").trim(),
    pages: String(value.pages || "").trim()
  };
}

function validatePaper(candidate) {
  if (!candidate || candidate.version !== 1) throw new Error("Resource version must be 1.");
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(candidate.id || "")) throw new Error("Resource ID must use lowercase letters, numbers, and hyphens.");
  if (typeof candidate.title !== "string" || !candidate.title.trim()) throw new Error("Paper title is missing.");
  if (!Array.isArray(candidate.body) || !candidate.body.length) throw new Error("At least one body section is required.");
  const ids = new Set();
  for (const chapter of [...candidate.body, ...(candidate.appendices || [])]) {
    if (!chapter?.id || !chapter.titleEn || !Array.isArray(chapter.items)) throw new Error("Every section needs id, titleEn, and items.");
    for (const item of chapter.items) {
      if (!item?.id || ids.has(item.id)) throw new Error(`Missing or duplicate item ID: ${item?.id || "unknown"}`);
      ids.add(item.id);
      if (item.type === "pair" && (typeof item.en !== "string" || typeof item.zh !== "string")) throw new Error(`Invalid bilingual pair: ${item.id}`);
      if (item.type === "equation" && typeof item.tex !== "string") throw new Error(`Invalid equation: ${item.id}`);
      if (item.type === "asset" && typeof item.src !== "string") throw new Error(`Invalid asset: ${item.id}`);
      if (!["pair", "equation", "asset"].includes(item.type)) throw new Error(`Unsupported item type: ${item.type}`);
    }
  }
  return structuredClone(candidate);
}

function stateKey(suffix) { return paper ? `papercase:${paper.id}:${suffix}:v1` : ""; }
function readingState() { return loadJson(localStorage, stateKey("reading"), { current: 0, completed: [] }); }
function chatState() { return loadJson(localStorage, stateKey("chat"), {}); }
function roles() { return { ...DEFAULT_ROLES, ...loadJson(localStorage, KEYS.roles, {}) }; }
function modelConfig() { return loadJson(localStorage, KEYS.model, { endpoint: "", model: "" }); }
function allChapters() { return paper ? [...paper.body, ...(paper.appendices || [])] : []; }
function currentChapter() { return allChapters()[chapterIndex]; }
function sectionTag(chapter) { return chapter.sectionNumber ? `§ ${chapter.sectionNumber}` : "Unnumbered"; }

function persistReading(next) {
  localStorage.setItem(stateKey("reading"), JSON.stringify(next));
}

async function importPaper(file) {
  if (!file) return;
  elements["import-status"].textContent = "Checking resource…";
  try {
    const next = validatePaper(JSON.parse(await file.text()));
    resources[next.id] = next;
    localStorage.setItem(KEYS.resources, JSON.stringify(resources));
    activePaperId = next.id;
    localStorage.setItem(KEYS.activePaper, activePaperId);
    paper = next;
    chapterIndex = 0;
    activePairId = null;
    elements["import-status"].textContent = `Imported “${next.title}”.`;
    render();
  } catch (error) {
    elements["import-status"].textContent = error instanceof Error ? error.message : "Import failed.";
  }
}

async function loadLocalLibrary() {
  try {
    const response = await fetch("./papers/library.json", { cache: "no-store" });
    if (!response.ok) return 0;
    const manifest = await response.json();
    const entries = Array.isArray(manifest) ? manifest : manifest.resources;
    if (!Array.isArray(entries)) return 0;
    let loaded = 0;
    for (const entry of entries) {
      try {
        const resource = typeof entry === "string"
          ? await fetch(new URL(entry, response.url), { cache: "no-store" }).then(result => {
              if (!result.ok) throw new Error(`HTTP ${result.status}`);
              return result.json();
            })
          : entry;
        const next = validatePaper(resource);
        resources[next.id] = next;
        loaded += 1;
      } catch (error) {
        console.warn("PaperCase skipped a local resource:", error);
      }
    }
    if (loaded) {
      localStorage.setItem(KEYS.resources, JSON.stringify(resources));
      if (!resources[activePaperId]) activePaperId = Object.keys(resources)[0];
      localStorage.setItem(KEYS.activePaper, activePaperId);
      paper = resources[activePaperId] || null;
      elements["import-status"].textContent = `Loaded ${loaded} paper${loaded === 1 ? "" : "s"} from the local archive.`;
    }
    return loaded;
  } catch { return 0; }
}

function renderLibrary() {
  const entries = Object.values(resources);
  elements["paper-select"].innerHTML = entries.length
    ? entries.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === activePaperId ? "selected" : ""}>${escapeHtml(item.titleZh || item.title)}</option>`).join("")
    : `<option value="">No paper loaded</option>`;
}

function renderRoles() {
  const value = roles();
  for (const [id, text] of [["navigator-name", value.navigator], ["reviewer-name", value.reviewer], ["reader-name", value.reader], ["discussion-reader", value.reader], ["discussion-guide", value.navigator], ["guide-badge", value.navigator]]) elements[id].textContent = text;
}

function renderMap() {
  const chapters = allChapters();
  const read = readingState();
  elements["section-count"].textContent = `${paper?.body.length || 0} body sections`;
  elements["section-map"].innerHTML = chapters.map((chapter, index) => `<li><button class="section-button ${index === chapterIndex ? "active" : ""}" type="button" data-section="${index}"><span class="number">${escapeHtml(chapter.sectionNumber || "—")}</span><span><strong>${escapeHtml(chapter.titleZh || chapter.titleEn)}</strong><small>${sectionTag(chapter)} · ${read.completed.includes(chapter.id) ? "read" : `${chapter.items.filter(item => item.type === "pair").length} pairs`}</small></span></button></li>`).join("");
  elements["section-map"].querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => openChapter(Number(button.dataset.section))));
}

function renderMetadata() {
  const publication = publicationInfo();
  const typeLabel = PUBLICATION_TYPE_LABELS[publication.type] || "TYPE NOT SUPPLIED · 类型未提供";
  const authors = authorLine(paper.authors);
  const details = [
    publication.volume && `Vol. ${publication.volume}`,
    publication.issue && `No. ${publication.issue}`,
    publication.pages && `pp. ${publication.pages}`
  ].filter(Boolean).join(" · ");
  const identifiers = [publication.doi && `DOI ${publication.doi}`, publication.arxivId && `arXiv:${publication.arxivId}`].filter(Boolean);
  const links = [];
  if (publication.sourceUrl) links.push(`<a href="${escapeHtml(publication.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source record ↗</a>`);
  if (publication.doi) links.push(`<a href="${escapeHtml(`https://doi.org/${publication.doi}`)}" target="_blank" rel="noopener noreferrer">Open DOI ↗</a>`);
  if (publication.arxivId) links.push(`<a href="${escapeHtml(`https://arxiv.org/abs/${publication.arxivId}`)}" target="_blank" rel="noopener noreferrer">Open arXiv ↗</a>`);

  elements["paper-title"].textContent = paper.title;
  elements["paper-title-translation"].textContent = paper.titleZh || "";
  elements["paper-title-translation"].hidden = !paper.titleZh;
  elements["paper-authors"].textContent = authors || "Authors not supplied · 作者未提供";
  elements["publication-type"].textContent = typeLabel;
  elements["publication-type"].dataset.type = publication.type || "missing";
  elements["publication-source"].textContent = publication.source || "Not supplied · 未提供";
  elements["publication-date"].textContent = publication.date || "Not supplied · 未提供";
  elements["publication-record"].textContent = [typeLabel, details].filter(Boolean).join(" · ");
  elements["publication-identifier"].textContent = identifiers.join(" · ") || "Not supplied · 未提供";
  elements["publication-links"].innerHTML = links.join("");
  const missing = [];
  if (!publication.type) missing.push("publication type");
  if (!publication.dateProvided) missing.push("publication date");
  if (!publication.source) missing.push("source");
  elements["metadata-warning"].hidden = missing.length === 0;
  elements["metadata-warning"].textContent = missing.length ? `This resource is missing ${missing.join(", ")}. Ask the resource-generating agent to update its publication metadata.` : "";
}

function pairMarkup(item, chapter, order) {
  return `<section class="pair" id="${escapeHtml(item.id)}"><div class="pair-marker"><span>¶ ${String(order).padStart(3, "0")}</span><button class="ask-button" type="button" data-pair="${escapeHtml(item.id)}">Discuss this passage</button></div><article class="language original"><header><strong>ORIGINAL</strong><span>${sectionTag(chapter)}</span></header><p lang="en">${formatText(item.en)}</p></article><article class="language translation"><header><strong>TRANSLATION</strong></header><p>${formatText(item.zh)}</p></article></section>`;
}

function itemMarkup(item, chapter, order) {
  if (item.type === "pair") return pairMarkup(item, chapter, order);
  if (item.type === "equation") {
    let rendered = `<code>${escapeHtml(item.tex)}</code>`;
    try { if (window.katex) rendered = window.katex.renderToString(item.tex, { displayMode: true, throwOnError: false, strict: "ignore", trust: false }); } catch { /* source fallback */ }
    return `<section class="equation">${rendered}</section>`;
  }
  return `<figure class="asset"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(`${item.kind || "Asset"} ${item.number || ""}: ${item.captionZh || item.captionEn || ""}`)}" loading="lazy"><figcaption><strong>${escapeHtml(`${item.kind || "Asset"} ${item.number || ""}`)}</strong><span>${formatText(item.captionZh || "")}</span><span lang="en">${formatText(item.captionEn || "")}</span></figcaption></figure>`;
}

function renderPaper() {
  elements["empty-state"].hidden = Boolean(paper);
  elements["paper-view"].hidden = !paper;
  elements.discussion.hidden = !paper;
  if (!paper) {
    elements["progress-summary"].textContent = "No paper loaded";
    elements["section-map"].innerHTML = "";
    return;
  }
  const chapters = allChapters();
  const read = readingState();
  chapterIndex = Math.min(Math.max(chapterIndex, 0), chapters.length - 1);
  const chapter = currentChapter();
  const bodyIndex = paper.body.findIndex(item => item.id === chapter.id);
  const isBody = bodyIndex >= 0;
  renderMetadata();
  elements["reader-progress"].textContent = `${isBody ? `BODY ${String(bodyIndex + 1).padStart(2, "0")} / ${paper.body.length}` : "APPENDIX"} · PAPER ${sectionTag(chapter)}`;
  elements["chapter-title"].textContent = chapter.titleZh || chapter.titleEn;
  elements["chapter-title-en"].textContent = `${chapter.sectionNumber ? `${chapter.sectionNumber} ` : ""}${chapter.titleEn}`;
  elements["section-number"].textContent = chapter.sectionNumber || "—";
  elements["guide-copy"].textContent = `${roles().navigator} keeps the source order visible. Discussion is optional and never blocks the next section.`;
  elements["paper-location"].innerHTML = `<span>PAPER LOCATION · ${sectionTag(chapter)}</span><strong lang="en">${escapeHtml(`${chapter.sectionNumber ? `${chapter.sectionNumber} ` : ""}${chapter.titleEn}`)}</strong><small>${escapeHtml(chapter.titleZh || "")}</small>`;
  let pairOrder = 0;
  for (const prior of chapters.slice(0, chapterIndex)) pairOrder += prior.items.filter(item => item.type === "pair").length;
  elements["paper-flow"].innerHTML = chapter.items.map(item => itemMarkup(item, chapter, item.type === "pair" ? ++pairOrder : pairOrder)).join("");
  elements["paper-flow"].querySelectorAll("[data-pair]").forEach(button => button.addEventListener("click", () => selectPair(button.dataset.pair)));
  elements["previous-section"].disabled = chapterIndex === 0;
  elements["next-section"].textContent = chapterIndex === chapters.length - 1 ? "Mark read" : (read.completed.includes(chapter.id) ? "Continue" : "Mark read and continue");
  const completedBody = paper.body.filter(item => read.completed.includes(item.id)).length;
  elements["progress-summary"].textContent = `${completedBody} / ${paper.body.length} body sections read`;
  if (!activePairId || !chapter.items.some(item => item.id === activePairId)) activePairId = chapter.items.find(item => item.type === "pair")?.id || null;
  renderChat();
}

function findPair(id) {
  for (const chapter of allChapters()) {
    const item = chapter.items.find(entry => entry.type === "pair" && entry.id === id);
    if (item) return { item, chapter };
  }
  return null;
}

function renderChat() {
  const found = findPair(activePairId);
  if (!found) {
    elements["chat-context"].textContent = "This section has no bilingual passage.";
    elements["chat-thread"].innerHTML = "";
    return;
  }
  const { item, chapter } = found;
  elements["chat-context"].innerHTML = `<strong>${sectionTag(chapter)} · ${escapeHtml(chapter.titleEn)}</strong><br>${formatText(item.zh.slice(0, 180))}${item.zh.length > 180 ? "…" : ""}`;
  const messages = chatState()[item.id] || [];
  const roleNames = roles();
  elements["chat-thread"].innerHTML = messages.length ? messages.map(message => `<article class="message ${message.role === "assistant" ? "assistant" : "user"}"><strong>${escapeHtml(message.role === "assistant" ? roleNames.navigator : roleNames.reader)}</strong>${formatText(message.content)}</article>`).join("") : `<p class="boundary">No discussion for this passage yet.</p>`;
  elements["chat-thread"].scrollTop = elements["chat-thread"].scrollHeight;
  const config = modelConfig();
  elements["chat-status"].textContent = chatPending ? "Waiting for model…" : (config.endpoint && config.model ? `${config.model} · settings stored locally` : "Configure a model to enable discussion.");
}

function selectPair(id) {
  activePairId = id;
  renderChat();
  elements.discussion.scrollIntoView({ behavior: "smooth", block: "start" });
  elements["chat-input"].focus({ preventScroll: true });
}

function openChapter(index) {
  chapterIndex = index;
  activePairId = null;
  const read = readingState();
  read.current = index;
  persistReading(read);
  render();
  elements.reader.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fullPaperContext() {
  const publication = publicationInfo();
  const metadata = [`TITLE: ${paper.title}`, paper.titleZh && `TITLE_ZH: ${paper.titleZh}`, authorLine(paper.authors) && `AUTHORS: ${authorLine(paper.authors)}`, publication.type && `PUBLICATION_TYPE: ${publication.type}`, publication.date && `PUBLICATION_DATE: ${publication.date}`, publication.source && `SOURCE: ${publication.source}`, publication.doi && `DOI: ${publication.doi}`, publication.arxivId && `ARXIV: ${publication.arxivId}`].filter(Boolean).join("\n");
  return `${metadata}\n\n${allChapters().map(chapter => [`[${sectionTag(chapter)} ${chapter.titleEn}]`, ...chapter.items.map(item => item.type === "pair" ? `EN: ${item.en}\nZH: ${item.zh}` : item.type === "equation" ? `EQUATION: ${item.tex}` : `${item.kind || "Asset"} ${item.number || ""}: ${item.captionEn || ""} / ${item.captionZh || ""}`)].join("\n")).join("\n\n")}`;
}

async function sendChat(question) {
  const found = findPair(activePairId);
  const config = modelConfig();
  if (!found || !config.endpoint || !config.model) throw new Error("Open Settings and configure a model first.");
  const store = chatState();
  const history = store[found.item.id] || [];
  history.push({ role: "user", content: question });
  store[found.item.id] = history;
  localStorage.setItem(stateKey("chat"), JSON.stringify(store));
  renderChat();
  const roleNames = roles();
  const messages = [
    { role: "system", content: `${roleNames.instruction}\nYou are the ${roleNames.navigator}. A secondary ${roleNames.reviewer} role may challenge unsupported claims. Never role-play the human ${roleNames.reader}.\n\nFULL PAPER:\n${fullPaperContext()}` },
    ...history
  ];
  const response = await fetch("/api/model/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...config, apiKey: sessionStorage.getItem(KEYS.modelKey) || "" }, messages }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Model request failed with HTTP ${response.status}`);
  history.push({ role: "assistant", content: data.reply });
  store[found.item.id] = history;
  localStorage.setItem(stateKey("chat"), JSON.stringify(store));
}

function openSettings() {
  const config = modelConfig();
  const roleNames = roles();
  elements["model-endpoint"].value = config.endpoint || "";
  elements["model-id"].value = config.model || "";
  elements["model-key"].value = sessionStorage.getItem(KEYS.modelKey) || "";
  elements["role-reader"].value = roleNames.reader;
  elements["role-navigator"].value = roleNames.navigator;
  elements["role-reviewer"].value = roleNames.reviewer;
  elements["role-instruction"].value = roleNames.instruction;
  elements["settings-status"].textContent = "";
  elements["settings-dialog"].showModal();
}

function saveSettings(event) {
  event.preventDefault();
  localStorage.setItem(KEYS.model, JSON.stringify({ endpoint: elements["model-endpoint"].value.trim(), model: elements["model-id"].value.trim() }));
  const key = elements["model-key"].value.trim();
  if (key) sessionStorage.setItem(KEYS.modelKey, key); else sessionStorage.removeItem(KEYS.modelKey);
  localStorage.setItem(KEYS.roles, JSON.stringify({ reader: elements["role-reader"].value.trim() || DEFAULT_ROLES.reader, navigator: elements["role-navigator"].value.trim() || DEFAULT_ROLES.navigator, reviewer: elements["role-reviewer"].value.trim() || DEFAULT_ROLES.reviewer, instruction: elements["role-instruction"].value.trim() || DEFAULT_ROLES.instruction }));
  elements["settings-status"].textContent = "Saved in this browser.";
  render();
}

function render() {
  renderLibrary();
  renderRoles();
  if (paper) chapterIndex = Math.min(readingState().current || chapterIndex, allChapters().length - 1);
  renderMap();
  renderPaper();
}

elements["paper-import"].addEventListener("change", event => importPaper(event.target.files?.[0]));
document.querySelectorAll(".mirror-import").forEach(input => input.addEventListener("change", event => importPaper(event.target.files?.[0])));
elements["paper-select"].addEventListener("change", () => { activePaperId = elements["paper-select"].value; localStorage.setItem(KEYS.activePaper, activePaperId); paper = resources[activePaperId] || null; chapterIndex = 0; activePairId = null; render(); });
elements["previous-section"].addEventListener("click", () => { if (chapterIndex > 0) openChapter(chapterIndex - 1); });
elements["next-section"].addEventListener("click", () => { const read = readingState(); const id = currentChapter().id; if (!read.completed.includes(id)) read.completed.push(id); read.current = Math.min(chapterIndex + 1, allChapters().length - 1); persistReading(read); if (chapterIndex < allChapters().length - 1) chapterIndex += 1; activePairId = null; render(); });
elements["chat-form"].addEventListener("submit", async event => { event.preventDefault(); const question = elements["chat-input"].value.trim(); if (!question || chatPending) return; elements["chat-input"].value = ""; chatPending = true; renderChat(); try { await sendChat(question); } catch (error) { elements["chat-status"].textContent = error instanceof Error ? error.message : "Discussion failed."; } finally { chatPending = false; renderChat(); } });
elements["open-settings"].addEventListener("click", openSettings);
elements["settings-form"].addEventListener("submit", saveSettings);
elements["clear-settings"].addEventListener("click", () => { localStorage.removeItem(KEYS.model); sessionStorage.removeItem(KEYS.modelKey); elements["model-endpoint"].value = ""; elements["model-id"].value = ""; elements["model-key"].value = ""; elements["settings-status"].textContent = "Model settings cleared."; render(); });

async function initialize() {
  await loadLocalLibrary();
  render();
}

initialize();
