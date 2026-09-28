#!/usr/bin/env node
//
// Genera las variantes del implementador desde .claude/agents/arq-implementer.md,
// para que todas compartan exactamente las mismas reglas.
//
// Uso:  node sync-agents.mjs [--dir <carpeta>]          escribe las variantes
//       node sync-agents.mjs [--dir <carpeta>] --check  sale con 1 si alguna quedo desactualizada
//
//   --dir  carpeta de los agentes; por defecto <raiz del repo>/.claude/agents
//
// La herramienta Agent no permite elegir el effort en cada invocacion, asi que
// cada effort necesita su propio agente. Edita solo arq-implementer.md y vuelve
// a correr este script.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const dirArg = process.argv.indexOf("--dir");
const dir = dirArg > 0 ? path.resolve(process.argv[dirArg + 1]) : path.join(repoRoot, ".claude", "agents");
const source = path.join(dir, "arq-implementer.md");
const VARIANTS = [{ suffix: "medium", effort: "medium" }];

const text = fs.readFileSync(source, "utf8");
if (!/^effort: \w+$/m.test(text) || !/^name: arq-implementer$/m.test(text)) {
  console.error("arq-implementer.md debe tener las líneas 'name: arq-implementer' y 'effort: <nivel>'.");
  process.exit(65);
}

let stale = 0;
for (const v of VARIANTS) {
  const name = `arq-implementer-${v.suffix}`;
  const out = text
    .replace(/^name: arq-implementer$/m, `name: ${name}`)
    .replace(/^description: (.*)$/m, `description: Variante con effort ${v.effort} de arq-implementer (A/B de costo). $1`)
    .replace(/^effort: \w+$/m, `effort: ${v.effort}`)
    .replace(/^---\n/, `---\n# Generado por .claude/skills/arq-loop/scripts/sync-agents.mjs desde arq-implementer.md. No editar.\n`);
  const target = path.join(dir, `${name}.md`);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (current !== out) {
      console.error(`${name}.md está desactualizado. Corre: node .claude/skills/arq-loop/scripts/sync-agents.mjs`);
      stale++;
    }
  } else if (current !== out) {
    fs.writeFileSync(target, out);
    console.log(`Actualizado ${path.relative(repoRoot, target)}`);
  }
}
if (stale) process.exit(1);
if (process.argv.includes("--check")) console.log("Variantes del implementador al día.");
