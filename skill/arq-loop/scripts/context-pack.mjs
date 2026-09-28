#!/usr/bin/env node
//
// Paquete de contexto para el implementador: le entrega de una vez lo que
// antes descubria con decenas de ls/find/rg/sed, cada uno en una llamada que
// releia todo su contexto.
//
// Uso:  node context-pack.mjs --goal G-XX [--attempt N] [--spec <dir>] --out <archivo.md>
//
// Contenido:
//   1. Archivos que el goal nombra (entre comillas invertidas en cualquier
//      seccion), resueltos contra git ls-files, con lineas, tamano aproximado
//      en tokens, esquema de simbolos e imports agrupados por paquete.
//   2. Mapa del modulo: una linea por archivo de las raices de codigo del
//      perfil (las rutas terminadas en "/" de "Leer antes de diseñar").
//   3. Desde el intento 2, las ubicaciones archivo:linea citadas en el
//      veredicto anterior.
// No escribe en el repo.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = { goal: null, attempt: 1, spec: null, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--goal") opt.goal = args[++i];
  else if (a === "--attempt") opt.attempt = Number(args[++i]);
  else if (a === "--spec") opt.spec = args[++i];
  else if (a === "--out") opt.out = args[++i];
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}
if (!/^G-\d+$/.test(opt.goal || "") || !opt.out) {
  console.error("Uso: node context-pack.mjs --goal G-XX [--attempt N] [--spec <dir>] --out <archivo.md>");
  process.exit(64);
}

// Raiz de specs: la linea "Raíz de specs: `<dir>`" del perfil, o "specs".
function specsRoot(repoRoot) {
  for (const p of [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/Ra[ií]z de specs:\s*`([^`<>]+)`/);
    if (m) return m[1].replace(/\/+$/, "");
  }
  return "specs";
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const repoRoot = sh("git rev-parse --show-toplevel");
process.chdir(repoRoot);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

let specDir = opt.spec ? path.resolve(opt.spec) : null;
if (!specDir) {
  const root = path.join(repoRoot, specsRoot(repoRoot));
  const found = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "goals", "STATUS.md"))) : [];
  if (found.length !== 1) {
    console.error(`No pude resolver la spec (${found.length} candidatas). Usa --spec <dir>.`);
    process.exit(65);
  }
  specDir = path.join(root, found[0]);
}
const goalsDir = path.join(specDir, "goals");
const goalText = read(path.join(goalsDir, `${opt.goal}.md`));
if (!goalText) {
  console.error(`No existe ${opt.goal}.md en ${path.relative(repoRoot, goalsDir)}.`);
  process.exit(65);
}

const files = sh("git ls-files").split("\n").filter(Boolean);
const byBase = new Map();
for (const f of files) {
  for (const key of [path.basename(f), path.basename(f).replace(/\.[^.]+$/, "")]) {
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(f);
  }
}
const approxTokens = (text) => Math.round(text.length / 3.6);

// ---------- 1. archivos que nombra el goal ----------
const section = (name) => (goalText.split(/^## /m).find((s) => s.startsWith(name)) || "");
const fm = (goalText.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
const named = new Map(); // ruta -> secciones donde aparece
function addRef(ref, where) {
  const clean = ref.replace(/[:#].*$/, "").replace(/\(\)$/, "");
  let hits = [];
  if (files.includes(clean)) hits = [clean];
  else if (byBase.has(clean)) hits = byBase.get(clean);
  hits = hits.filter((h) => !h.includes("/goals/"));
  if (hits.length === 0 || hits.length > 4) return;
  for (const h of hits) {
    if (!named.has(h)) named.set(h, new Set());
    named.get(h).add(where);
  }
}
for (const name of ["Alcance", "Contexto", "Restricciones", "Criterios de aceptación", "Fuera de alcance"]) {
  for (const m of section(name).matchAll(/`([^`\s]+)`/g)) addRef(m[1], name);
}
const specRef = fm.match(/^spec:\s*(\S+)/m)?.[1];
if (specRef) addRef(specRef, "spec");

const KT_DECL =
  /^(\s*)(?:(?:private|internal|public|protected|override|data|sealed|enum|abstract|open|inline|suspend|operator|const|lateinit|annotation|value)\s+)*(fun|class|object|interface|val|var|typealias)\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)/;

// Declaraciones por lenguaje: [indentacion, tipo, nombre].
const DECL = [
  [/\.(ts|tsx|js|jsx|mjs|cjs)$/, /^(\s*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let)\s+(\w+)/],
  [/\.py$/, /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/],
  [/\.go$/, /^()(func|type)\s+(?:\([^)]*\)\s*)?(\w+)/],
  [/\.(java|cs)$/, /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|async)\s+)*(class|interface|enum|record|struct)\s+(\w+)/],
  [/\.swift$/, /^(\s*)(?:(?:public|private|internal|fileprivate|open|static|final)\s+)*(func|class|struct|enum|protocol|extension)\s+(\w+)/],
  [/\.rs$/, /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|mod)\s+(\w+)/],
];

function outline(file, maxIndent, limit) {
  const text = read(file) || "";
  const lines = text.split("\n");
  const out = [];
  const generic = DECL.find(([ext]) => ext.test(file));
  if (generic && !/\.(kt|kts)$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const m = lines[i].match(generic[1]);
      if (!m || m[1].length > maxIndent) continue;
      if ((m[2] === "const" || m[2] === "let") && m[1].length > 0) continue;
      out.push(`${i + 1}: ${m[2]} ${m[3]}`);
    }
  } else if (/\.(kt|kts)$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      const m = lines[i].match(KT_DECL);
      if (!m || m[1].length > maxIndent) continue;
      if ((m[2] === "val" || m[2] === "var") && m[1].length > 0) continue; // variables locales o miembros: ruido
      const prev = lines.slice(Math.max(0, i - 3), i).join(" ");
      const tags = [prev.includes("@Composable") && "@Composable", prev.includes("@Preview") && "@Preview", prev.includes("@Test") && "@Test"].filter(Boolean);
      out.push(`${i + 1}: ${m[2]} ${m[3]}${tags.length ? ` ${tags.join(" ")}` : ""}`);
    }
  } else if (/\.md$/.test(file)) {
    for (let i = 0; i < lines.length && out.length < limit; i++) if (/^#{1,3} /.test(lines[i])) out.push(`${i + 1}: ${lines[i]}`);
  }
  return { text, lines: lines.length, out };
}

function importGroups(text) {
  const groups = {};
  for (const m of text.matchAll(/^import\s+([\w.]+)/gm)) {
    const key = m[1].split(".").slice(0, 4).join(".");  // Kotlin/Java
    groups[key] = (groups[key] || 0) + 1;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} (${n})`)
    .join(", ");
}

const P = [];
P.push(`# Paquete de contexto · ${opt.goal} · intento ${opt.attempt}`);
P.push("", "Generado por `context-pack.mjs` desde el goal y `git ls-files`. Úsalo en vez de listar o buscar archivos uno por uno.");
P.push("", "## Archivos que nombra el goal");
if (!named.size) P.push("El goal no nombra archivos concretos; parte del mapa del módulo.");
for (const [file, where] of named) {
  const o = outline(file, 4, 40);
  P.push("", `### \`${file}\``, `${o.lines} líneas · ~${approxTokens(o.text)} tokens · citado en: ${[...where].join(", ")}`);
  const imp = /\.(kt|kts)$/.test(file) ? importGroups(o.text) : "";
  if (imp) P.push(`Imports: ${imp}`);
  if (o.out.length) P.push("```", ...o.out, "```");
}

// ---------- 2. mapa del modulo ----------
const profile = read(path.join(repoRoot, ".claude", "arq-loop.project.md")) || read(path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")) || "";
const readFirst = profile.split(/^## /m).find((s) => s.startsWith("Leer antes de diseñar")) || "";
const roots = [...readFirst.matchAll(/`([^`{}<>\s]+\/)`/g)].map((m) => m[1]);
const codeExt = /\.(kt|kts|java|ts|tsx|js|mjs|sql|py|swift|go|rs)$/;
const mapped = files.filter((f) => roots.some((r) => f.startsWith(r)) && codeExt.test(f));
P.push("", "## Mapa del módulo", roots.length ? `Raíces del perfil: ${roots.map((r) => `\`${r}\``).join(", ")}. Formato: ruta · líneas · símbolos de primer nivel.` : "El perfil no declara raíces de código terminadas en \"/\".");
if (mapped.length) {
  P.push("```");
  let prevDir = null;
  for (const f of mapped) {
    const dir = path.dirname(f);
    if (dir !== prevDir) {
      P.push(`${dir}/`);
      prevDir = dir;
    }
    const o = outline(f, 0, 8);
    const names = o.out.map((l) => l.split(" ").slice(2).join(" ").replace(/ @\w+/g, "")).filter(Boolean);
    P.push(`  ${path.basename(f)} · ${o.lines} · ${names.join(", ")}${o.out.length === 8 ? ", …" : ""}`);
  }
  P.push("```");
}

// ---------- 3. veredicto anterior ----------
if (opt.attempt > 1) {
  const prev = read(path.join(goalsDir, `${opt.goal}.verdict-${opt.attempt - 1}.md`));
  if (prev) {
    const locs = [...new Set([...prev.matchAll(/`([\w./-]+\.\w+):([\d,\- ]+)`/g)].map((m) => `${m[1]}:${m[2].trim()}`))];
    P.push("", `## Ubicaciones citadas en ${opt.goal}.verdict-${opt.attempt - 1}.md`, ...(locs.length ? locs.map((l) => `- \`${l}\``) : ["Ninguna con archivo:línea."]));
  }
}

const out = P.join("\n") + "\n";
fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
fs.writeFileSync(opt.out, out);
console.log(`Paquete de contexto en ${opt.out}: ${named.size} archivo(s) del goal, ${mapped.length} en el mapa, ~${approxTokens(out)} tokens.`);
