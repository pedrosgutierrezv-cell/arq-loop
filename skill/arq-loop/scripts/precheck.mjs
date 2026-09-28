#!/usr/bin/env node
//
// Pre-check determinista de una entrega, antes de gastar un validate de Codex.
//
// Uso:  node precheck.mjs --goal G-03 --attempt 2 [--spec <dir>] [--base <sha>]
//                         [--pack <archivo.md>] [--no-commands] [--allow-pending]
//
//   --goal / --attempt  goal e intento de la entrega (G-XX.delivery-N.md)
//   --spec              directorio de la spec; por defecto, el unico con goals/STATUS.md
//   --base              commit base; por defecto, commit_base de la entrega o STATUS.md
//   --pack              escribe el paquete de evidencia para el prompt de validate
//   --no-commands       no re-ejecuta los comandos del perfil (reintento tras
//                       corregir solo docs o evidencia)
//   --allow-pending     un criterio "no verificado" o "pendiente" es aviso, no falla
//                       (solo cuando el usuario ya acepto dejarlo pendiente)
//
// Sale con 0 si todo pasa y con 1 si algo falla. No escribe en el repo: los logs
// de los comandos van al paquete, asi el arbol sigue limpio y HEAD no cambia.
//
// Controles:
//   C1 arbol limpio            C5 archivos de Codex intactos
//   C2 entrega coherente       C6 logs reproducibles ($ comando + exit=)
//   C3 criterios cubiertos     C7 referencias de la entrega existen
//   C4 git diff --check rango  C8 datos sensibles en lineas agregadas
//   C9 comandos del perfil segun las rutas del diff (seccion "Pre-check")

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = { goal: null, attempt: null, spec: null, base: null, pack: null, commands: true, allowPending: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--goal") opt.goal = args[++i];
  else if (a === "--attempt") opt.attempt = Number(args[++i]);
  else if (a === "--spec") opt.spec = args[++i];
  else if (a === "--base") opt.base = args[++i];
  else if (a === "--pack") opt.pack = args[++i];
  else if (a === "--no-commands") opt.commands = false;
  else if (a === "--allow-pending") opt.allowPending = true;
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}
if (!/^G-\d+$/.test(opt.goal || "") || !(opt.attempt >= 1)) {
  console.error("Uso: node precheck.mjs --goal G-XX --attempt N [--spec <dir>] [--pack <archivo>]");
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

// ---------- rutas ----------
function resolveSpec() {
  if (opt.spec) return path.resolve(opt.spec);
  const root = path.join(repoRoot, specsRoot(repoRoot));
  const found = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "goals", "STATUS.md")))
    : [];
  if (found.length !== 1) {
    console.error(`No pude resolver la spec (${found.length} candidatas). Usa --spec <dir>.`);
    process.exit(65);
  }
  return path.join(root, found[0]);
}
const specDir = resolveSpec();
const goalsDir = path.join(specDir, "goals");
const rel = (p) => path.relative(repoRoot, p);
const G = opt.goal;
const N = opt.attempt;
const goalFile = path.join(goalsDir, `${G}.md`);
const deliveryFile = path.join(goalsDir, `${G}.delivery-${N}.md`);
const evidenceDir = path.join(goalsDir, "evidence", G);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const frontmatter = (text) => {
  const m = (text || "").match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

const goalText = read(goalFile);
if (!goalText) {
  console.error(`No existe ${rel(goalFile)}.`);
  process.exit(65);
}
const deliveryText = read(deliveryFile);
const deliveryFm = frontmatter(deliveryText);

function baseFromStatus() {
  const status = read(path.join(goalsDir, "STATUS.md")) || "";
  const row = status.split("\n").find((l) => l.startsWith(`| ${G} |`));
  if (!row) return null;
  const cells = row.split("|").map((c) => c.trim());
  // | Goal | Titulo | Nivel | Depende | Estado | Intentos | Commit base | Commit entrega |
  return cells[7] || null;
}
const BASE = opt.base || (/^[0-9a-f]{7,40}$/.test(deliveryFm.commit_base || "") ? deliveryFm.commit_base : null) || baseFromStatus();
const HEAD = sh("git rev-parse HEAD");
if (!BASE) {
  console.error("No encontré el commit base (entrega ni STATUS.md). Usa --base <sha>.");
  process.exit(65);
}

// ---------- controles ----------
const checks = [];
const add = (id, name, ok, detail = "", level = ok ? "OK" : "FALLA") => checks.push({ id, name, ok, level, detail });

const changed = sh(`git diff --name-only ${BASE}..${HEAD}`).split("\n").filter(Boolean);

// C1
const dirty = sh("git status --porcelain");
add("C1", "Árbol limpio", !dirty, dirty ? `Hay cambios sin commitear; Codex valida ${HEAD.slice(0, 7)}, no el working tree.` : "");

// C2
{
  const problems = [];
  if (!deliveryText) problems.push(`falta ${rel(deliveryFile)}`);
  else {
    if (deliveryFm.goal !== G) problems.push(`frontmatter goal=${deliveryFm.goal || "?"}`);
    if (String(deliveryFm.intento) !== String(N)) problems.push(`frontmatter intento=${deliveryFm.intento || "?"}`);
    if (deliveryFm.commit_base && !BASE.startsWith(deliveryFm.commit_base) && !deliveryFm.commit_base.startsWith(BASE))
      problems.push(`commit_base ${deliveryFm.commit_base} no coincide con ${BASE}`);
    if (!changed.includes(rel(deliveryFile))) problems.push("la entrega no está commiteada en el rango");
  }
  add("C2", "Entrega coherente", problems.length === 0, problems.join("; "));
}

// C3
const goalCAs = [...goalText.matchAll(/^\|\s*(CA-\d+)\s*\|/gm)].map((m) => m[1]);
{
  const rows = Object.fromEntries(
    [...(deliveryText || "").matchAll(/^\|\s*(CA-\d+)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => [m[1], m[2].toLowerCase()]),
  );
  const missing = goalCAs.filter((c) => !rows[c]);
  const pending = goalCAs.filter((c) => rows[c] && !/^cumple\b/.test(rows[c]));
  const detail = [
    missing.length ? `sin fila en la entrega: ${missing.join(", ")}` : "",
    pending.length ? `no declarados "cumple": ${pending.map((c) => `${c} (${rows[c]})`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (missing.length) add("C3", "Criterios cubiertos", false, detail);
  else if (pending.length && opt.allowPending) add("C3", "Criterios cubiertos", true, `${detail}. Codex los marcará FAIL.`, "AVISO");
  else if (pending.length) add("C3", "Criterios cubiertos", false, `${detail}. Codex marca FAIL todo criterio no cumplido; completa o usa --allow-pending si el usuario aceptó dejarlo pendiente.`);
  else add("C3", "Criterios cubiertos", true, `${goalCAs.length} criterios en "cumple"`);
}

// C4
{
  const r = spawnSync("git", ["diff", "--check", `${BASE}..${HEAD}`], { encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter((l) => /^\S+:\d+:/.test(l));
  add("C4", `git diff --check ${BASE.slice(0, 7)}..${HEAD.slice(0, 7)}`, r.status === 0, r.status === 0 ? "" : `${lines.length} problema(s): ${lines.slice(0, 5).join(" · ")}${lines.length > 5 ? " …" : ""}`);
}

// C5
{
  const codexFiles = changed.filter((f) => f.startsWith(rel(goalsDir) + "/") && /\/(G-\d+\.md|G-\d+\.verdict-\d+\.md)$/.test(f));
  // Codex escribe estos archivos y llegan en commits "docs(...): veredicto ..." o
  // "docs(...): revisión del plan ...". Cualquier otro commit solo puede
  // normalizar espacios o el EOF.
  const codexCommit = /^docs\([^)]+\): (veredicto|revisi[oó]n del plan)/;
  const edited = [];
  for (const f of codexFiles) {
    for (const row of sh(`git log --format=%H%x09%s ${BASE}..${HEAD} -- "${f}"`).split("\n").filter(Boolean)) {
      const [sha, subject] = row.split("\t");
      if (codexCommit.test(subject)) continue;
      const parent = spawnSync("git", ["rev-parse", "--verify", "-q", `${sha}^`], { encoding: "utf8" }).stdout.trim();
      const d = parent ? sh(`git diff -w --ignore-blank-lines ${parent}..${sha} -- "${f}"`) : "x";
      if (d) edited.push(`${path.basename(f)} en ${sha.slice(0, 7)}`);
    }
  }
  add("C5", "Archivos de Codex intactos", edited.length === 0, edited.length ? `cambios de contenido fuera de un commit de veredicto o revisión: ${edited.join(", ")}` : "");
}

// C6
const evidenceLogs = changed.filter((f) => f.startsWith(rel(evidenceDir) + "/") && f.endsWith(".log") && fs.existsSync(f));
const logInfo = [];
{
  const noCmd = [];
  const noExit = [];
  for (const f of evidenceLogs) {
    const head = fs.readFileSync(f, "utf8").split("\n").slice(0, 6);
    const cmd = head[0]?.startsWith("$ ") ? head[0].slice(2) : null;
    const exit = head.map((l) => l.match(/^exit=(\d+)/)).find(Boolean)?.[1];
    logInfo.push({ file: path.basename(f), cmd, exit });
    if (!cmd) noCmd.push(path.basename(f));
    else if (exit == null) noExit.push(path.basename(f));
  }
  if (noCmd.length) add("C6", "Logs reproducibles", false, `sin "$ comando" en la línea 1: ${noCmd.join(", ")}`);
  else if (noExit.length) add("C6", "Logs reproducibles", true, `sin "exit=" en las primeras líneas: ${noExit.join(", ")}`, "AVISO");
  else add("C6", "Logs reproducibles", true, `${evidenceLogs.length} log(s) del rango`);
}

// C7
{
  const refs = [...(deliveryText || "").matchAll(/`([^`\s]+\.(?:log|png|txt|xml|json))(?::[\d,-]+)?`/g)].map((m) => m[1]);
  const matchesGlob = (dir, pattern) => {
    if (!fs.existsSync(dir)) return false;
    const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return fs.readdirSync(dir).some((n) => re.test(n));
  };
  const missing = [...new Set(refs)].filter((r) => {
    if (r.includes("*")) {
      const dirs = [path.dirname(r), path.join(goalsDir, path.dirname(r)), evidenceDir];
      return !dirs.some((d) => matchesGlob(path.resolve(d), path.basename(r)));
    }
    const candidates = [r, path.join(goalsDir, r), path.join(evidenceDir, r), path.join(evidenceDir, path.basename(r))];
    return !candidates.some((c) => fs.existsSync(c));
  });
  add("C7", "Referencias de la entrega existen", missing.length === 0, missing.length ? `no existen: ${missing.join(", ")}` : `${new Set(refs).size} referencia(s)`);
}

// C8 (solo se informa el tipo de hallazgo y la ubicacion, nunca el valor)
{
  const patterns = [
    ["clave de API (sk-, sb_, AKIA, ghp_, xox)", /\b(sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|sb_(secret|publishable)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/],
    ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["service_role", /service_role\s*[:=]\s*\S{12,}/i],
    ["password asignado", /pass(word)?\s*[:=]\s*["']?[^\s"']{4,}/i],
    ["IP privada", /\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ];
  const hits = [];
  const forbidden = changed.filter((f) => /(^|\/)\.env(\.|$)|(^|\/)local\.properties$/.test(f));
  for (const f of forbidden) hits.push(`${f}: archivo prohibido`);
  let file = null;
  let line = 0;
  const diff = sh(`git diff -U0 --no-color ${BASE}..${HEAD}`);
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) file = l.slice(6);
    else if (l.startsWith("@@")) line = Number(l.match(/\+(\d+)/)?.[1] || 0) - 1;
    else if (l.startsWith("+")) {
      line++;
      for (const [name, re] of patterns) if (re.test(l)) hits.push(`${file}:${line} (${name})`);
    }
  }
  add("C8", "Sin datos sensibles", hits.length === 0, hits.length ? hits.slice(0, 8).join(" · ") + (hits.length > 8 ? " …" : "") : "");
}

// C9
const profilePath = [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")].find(fs.existsSync);
const commandRuns = [];
{
  const profile = read(profilePath) || "";
  const section = profile.split(/^## /m).find((s) => s.startsWith("Pre-check")) || "";
  const rules = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => ({ glob: m[1], cmd: m[2] }));
  const toRe = (g) =>
    new RegExp(
      "^" +
        g
          .split("**")
          .map((p) => p.split("*").map((q) => q.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
          .join(".*") +
        "$",
    );
  const due = [];
  for (const r of rules) if (changed.some((f) => toRe(r.glob).test(f)) && !due.includes(r.cmd)) due.push(r.cmd);
  if (!section) add("C9", "Comandos del perfil", true, 'el perfil no tiene sección "Pre-check"', "AVISO");
  else if (!due.length) add("C9", "Comandos del perfil", true, "ninguna regla aplica a las rutas del diff");
  else if (!opt.commands) add("C9", "Comandos del perfil", true, `omitidos por --no-commands: ${due.length}`, "AVISO");
  else {
    for (const cmd of due) {
      const t0 = Date.now();
      const r = spawnSync("bash", ["-c", cmd], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      const out = `${r.stdout || ""}${r.stderr || ""}`.replace(/[ \t]+$/gm, "").trimEnd().split("\n");
      commandRuns.push({ cmd, exit: r.status, secs: Math.round((Date.now() - t0) / 1000), tail: out.slice(-15) });
    }
    const failed = commandRuns.filter((c) => c.exit !== 0);
    add("C9", "Comandos del perfil", failed.length === 0, commandRuns.map((c) => `exit=${c.exit} en ${c.secs}s: ${c.cmd.slice(0, 70)}`).join(" · "));
  }
}

// ---------- salida ----------
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.level.padEnd(5)} ${c.id} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
console.log(failed.length ? `Pre-check ${G} intento ${N}: ${failed.length} falla(s). No llames a Codex hasta corregirlas.` : `Pre-check ${G} intento ${N}: OK.`);

if (opt.pack) {
  const P = [];
  P.push(`Generado por \`precheck.mjs\` sobre \`${BASE.slice(0, 7)}..${HEAD.slice(0, 7)}\`. Todo lo de esta sección es salida de comandos deterministas.`);
  P.push("", "### Resultado del pre-check", "| Control | Resultado | Detalle |", "|---|---|---|");
  for (const c of checks) P.push(`| ${c.id} ${c.name} | ${c.level} | ${(c.detail || "—").replace(/\|/g, "\\|")} |`);
  P.push("", "### Archivos cambiados", "```", sh(`git diff --stat=120 ${BASE}..${HEAD}`).split("\n").slice(-80).join("\n"), "```");
  if (logInfo.length) {
    P.push("", `### Logs de evidencia de ${G} en el rango`, "| Log | Comando (línea 1) | exit |", "|---|---|---|");
    if (logInfo.length > 40) P.push(`Se muestran los últimos 40 de ${logInfo.length}; el resto está en \`${rel(evidenceDir)}/\`.`);
    for (const l of logInfo.slice(-40)) P.push(`| \`${l.file}\` | \`${(l.cmd || "?").slice(0, 110).replace(/\|/g, "\\|")}\` | ${l.exit ?? "?"} |`);
  }
  for (const c of commandRuns) {
    P.push("", `### Re-ejecución: \`${c.cmd.slice(0, 90)}\``, `exit=${c.exit} · ${c.secs}s · últimas líneas:`, "```", ...c.tail, "```");
  }
  if (N > 1) {
    const prevFile = path.join(goalsDir, `${G}.verdict-${N - 1}.md`);
    const prev = read(prevFile);
    if (prev) {
      const prevHead = frontmatter(prev).commit_validado;
      const rows = [...prev.matchAll(/^\|\s*(CA-\d+)\s*\|\s*(PASS|FAIL)\s*\|/gm)];
      const pass = rows.filter((r) => r[2] === "PASS").map((r) => r[1]);
      const fail = rows.filter((r) => r[2] === "FAIL").map((r) => r[1]);
      let since = [];
      if (prevHead && spawnSync("git", ["cat-file", "-e", prevHead]).status === 0) {
        since = sh(`git diff --name-only ${prevHead}..${HEAD}`).split("\n").filter(Boolean);
      }
      P.push(
        "",
        "### Revalidación incremental",
        `- Veredicto anterior: \`${rel(prevFile)}\` sobre \`${(prevHead || "?").slice(0, 7)}\`.`,
        `- PASS en el intento anterior: ${pass.join(", ") || "ninguno"}.`,
        `- FAIL en el intento anterior: ${fail.join(", ") || "ninguno"}.`,
        `- Archivos cambiados desde el veredicto anterior (${since.length}):`,
        ...since.slice(0, 60).map((f) => `  - \`${f}\``),
      );
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(opt.pack)), { recursive: true });
  fs.writeFileSync(opt.pack, P.join("\n") + "\n");
  console.log(`Paquete de evidencia en ${opt.pack}`);
}

process.exit(failed.length ? 1 : 0);
