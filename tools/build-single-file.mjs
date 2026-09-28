#!/usr/bin/env node
//
// Regenera arq-loop-skill.md: el encabezado de tools/single-file-header.md mas
// cada archivo de la skill y de los agentes, embebido entre marcadores que el
// comando awk de instalacion sabe extraer.
//
// Uso:  node tools/build-single-file.mjs [--check]
//
//   --check  sale con 1 si arq-loop-skill.md no coincide con los archivos
//
// Las rutas son relativas a la carpeta de la skill; los agentes usan
// ../../agents/ para quedar en .claude/agents/ al extraerlos.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "skill", "arq-loop");
const out = path.join(root, "arq-loop-skill.md");

const FILES = [
  "SKILL.md",
  "project.md",
  "prompts/plan.md",
  "prompts/revise.md",
  "prompts/validate.md",
  "scripts/codex.sh",
  "scripts/render.mjs",
  "scripts/split.mjs",
  "scripts/precheck.mjs",
  "scripts/context-pack.mjs",
  "scripts/usage.mjs",
  "scripts/sync-agents.mjs",
  "templates/goal.md",
  "templates/delivery.md",
  "templates/STATUS.md",
  "../../agents/arq-orchestrator.md",
  "../../agents/arq-implementer.md",
  "../../agents/arq-implementer-medium.md",
];

const lang = (f) => (f.endsWith(".md") ? "markdown" : f.endsWith(".sh") ? "bash" : "javascript");
const source = (f) => (f.startsWith("../../agents/") ? path.join(root, "agents", path.basename(f)) : path.join(skill, f));

const parts = [fs.readFileSync(path.join(root, "tools", "single-file-header.md"), "utf8").replace(/\s*$/, "\n")];
for (const f of FILES) {
  const body = fs.readFileSync(source(f), "utf8");
  if (/^~~~~/m.test(body)) {
    console.error(`${f} contiene una línea que empieza con ~~~~ y rompería la extracción.`);
    process.exit(65);
  }
  parts.push(`\n<!-- arq-loop:file ${f} -->\n~~~~${lang(f)}\n${body.replace(/\n?$/, "\n")}~~~~\n`);
}
const text = parts.join("");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error("arq-loop-skill.md está desactualizado. Corre: node tools/build-single-file.mjs");
    process.exit(1);
  }
  console.log("arq-loop-skill.md al día.");
} else {
  fs.writeFileSync(out, text);
  console.log(`arq-loop-skill.md regenerado con ${FILES.length} archivos.`);
}
