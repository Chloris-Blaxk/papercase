# PaperCase

PaperCase is a local-first browser framework for reading bilingual research papers in order without losing the feel of a conventional paper. It keeps the paper's publication record, section numbers, and headings visible, aligns original paragraphs with translations, places figures and equations inline, tracks reading progress, and optionally adds a model-powered discussion panel.

This repository contains **only the browser framework**. It does not include papers, translations, figures, personal character settings, API keys, or model-provider accounts.

## Start locally

Requires Node.js 20 or newer.

```bash
npm start
```

Then open <http://127.0.0.1:4317/>. On macOS, you can also double-click `start-papercase.command`; it waits for the server and opens the default browser automatically.

## Add a paper

Ask your agent to generate a PaperCase-compatible resource file for the paper you are allowed to use. Give the agent [`paper-resource.schema.json`](./paper-resource.schema.json) and, if useful, [`examples/paper.template.json`](./examples/paper.template.json). Then import the generated JSON from PaperCase's library screen.

PaperCase intentionally does not prescribe how resources are generated. The framework only defines the loadable format and browser experience. Users and their agents are responsible for source access, generation, translation quality, and permissions.

Paper resources imported through the browser stay in that browser's local storage. Files placed under `dist/papers/` are ignored by Git by default.

For a persistent local library, place resource files under `dist/papers/` and create an ignored `dist/papers/library.json` manifest:

```json
{
  "resources": [
    "./example-paper/paper-resource.json"
  ]
}
```

PaperCase loads this manifest at startup and refreshes matching browser-local resources by stable paper ID. Reading progress and discussions remain separate and are preserved. The manifest and its papers are excluded from Git, so this local archive is not published with the framework.

## Optional model discussion

Open **Settings → Model** in the browser and enter:

- a full OpenAI-compatible chat-completions endpoint;
- a model ID;
- an optional API key.

No provider, endpoint, model, or credential is bundled with this repository. Endpoint and model settings are stored in browser local storage. The API key is stored only for the current browser tab in session storage. Requests pass through the local PaperCase server and the credential is not written to disk.

The default role templates are deliberately generic:

- **Reader** — the human-controlled participant;
- **Navigator** — explains the current passage in paper order;
- **Reviewer** — challenges unsupported conclusions and asks for evidence.

Their display names and instructions can be changed in Settings.

## Resource shape

A resource contains paper metadata, ordered body sections, optional appendices, and section items of type `pair`, `equation`, or `asset`. Section numbers are strings so formats such as `3.2.1`, `A.3`, or an unnumbered `null` remain faithful to the source.

The `publication` record is required for newly generated resources. It identifies whether the item is a preprint, journal article, conference paper, workshop paper, book chapter, thesis, report, or another publication type. It also records the publication or first-public-release date and the source venue. DOI, arXiv ID, volume, issue, pages, and a source URL are optional. Older browser-stored resources still open, but the reader displays a visible warning when type, date, or source is missing.

The JSON Schema is the format contract. The template contains synthetic placeholder text only; it is not a paper resource.

## Privacy and publishing

- Do not commit paper PDFs, extracted text, translations, figures, or private notes unless you have the right and intention to publish them.
- Do not commit API keys or `.env` files.
- Imported reading progress, role settings, paper data, and discussions remain browser-local.
- Review generated resource packs before importing or distributing them.

## Development

```bash
npm run check
```

PaperCase is dependency-free at runtime. KaTeX is loaded from jsDelivr when available; formulas fall back to readable source text when it is unavailable.

## License

MIT
