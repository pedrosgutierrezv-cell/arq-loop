#!/usr/bin/env node
//
// Mide cuantos tokens gasta arq-loop por goal, intento, flujo y modelo.
//
// Uso:  node usage.mjs [--spec <dir>] [--write] [--json] [--since AAAA-MM-DD]
//
//   --spec <dir>   limita el reporte a una feature (p. ej. specs/001-mi-feature)
//   --write        reemplaza la seccion "Consumo de tokens" de <spec>/goals/STATUS.md
//                  e imprime una sola linea (para no inflar el contexto de Claude)
//   --json         imprime los datos crudos en JSON
//   --since        ignora actividad anterior a esa fecha (UTC)
//
// Fuentes (solo lectura):
//   Claude: ~/.claude/projects/<repo>/*.jsonl y <sesion>/subagents/*.jsonl
//   Codex:  $CODEX_HOME/sessions/**/rollout-*.jsonl (originator "Claude Code")
//
// Atribucion: cada llamada de Claude se asigna a la siguiente invocacion de
// codex.sh de su sesion. Asi, el trabajo previo a "validate-G-03-2" cuenta como
// "implementar G-03 intento 2", incluido leer el veredicto anterior. Lo que viene
// despues del ultimo codex.sh queda como "abierto". Cada corrida de Codex se une
// a su invocacion por hora de inicio.
//
// Los USD son equivalentes a precio de API (los planes de suscripcion miden uso,
// no dolares). Si cambian los precios, actualiza PRICES.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

// USD por millon de tokens.
const PRICES = {
  claude: {
    // entrada, escritura 5m, escritura 1h, lectura de cache, salida
    "claude-opus-5-5": [4, 5, 8, 0.2, 20],
    "claude-opus-5": [5, 6.25, 10, 0.5, 25],
    "claude-sonnet-5": [2, 2.5, 4, 0.2, 10],
    // PROVISIONAL: sin precio publicado al 2026-09-28; se usa el de Sonnet 5.
    "claude-sonnet-5-5": [2, 2.5, 4, 0.2, 10],
    "claude-haiku-4-5": [1, 1.25, 2, 0.1, 5],
    "claude-fable-5-1": [10, 12.5, 20, 0.25, 50],
  },
  codex: {
    // entrada sin cache, entrada en cache, salida (incluye razonamiento)
    "gpt-5.6-sol": [4, 0.4, 20],
    "gpt-6-sol": [2, 0.2, 10],
    "gpt-6-luna": [0.1, 0.01, 0.5],
  },
};

// ---------- argumentos ----------
const args = process.argv.slice(2);
const opt = { spec: null, write: false, json: false, since: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--spec") opt.spec = args[++i];
  else if (a === "--write") opt.write = true;
  else if (a === "--json") opt.json = true;
  else if (a === "--since") opt.since = args[++i];
  else {
    console.error(`Argumento desconocido: ${a}`);
    process.exit(64);
  }
}

let repoRoot = process.cwd();
try {
  repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {}
const claudeDir = path.join(os.homedir(), ".claude", "projects", repoRoot.replace(/[^a-zA-Z0-9]/g, "-"));
const codexDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
const sinceTs = opt.since ? `${opt.since}T00:00:00` : "";

// ---------- utilidades ----------
// Raiz de specs: la linea "Raíz de specs: `<dir>`" del perfil, o "specs".
function specsRoot(repoRoot) {
  for (const p of [path.join(repoRoot, ".claude", "arq-loop.project.md"), path.join(repoRoot, ".claude", "skills", "arq-loop", "project.md")]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/Ra[ií]z de specs:\s*`([^`<>]+)`/);
    if (m) return m[1].replace(/\/+$/, "");
  }
  return "specs";
}

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function walk(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

const fmt = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n);
const usd = (n) => (n == null ? "—" : n.toFixed(2));
const normModel = (m) => (m || "?").replace(/-\d{8}$/, "");

const unpriced = new Set();
const PROVISIONAL = new Set(["claude-sonnet-5-5"]);
function claudeCost(model, u) {
  const p = PRICES.claude[normModel(model)];
  if (!p) {
    unpriced.add(normModel(model));
    return null;
  }
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens ?? 0;
  const w1 = cc.ephemeral_1h_input_tokens ?? (cc.ephemeral_5m_input_tokens == null ? u.cache_creation_input_tokens || 0 : 0);
  return (
    ((u.input_tokens || 0) * p[0] + w5 * p[1] + w1 * p[2] + (u.cache_read_input_tokens || 0) * p[3] + (u.output_tokens || 0) * p[4]) /
    1e6
  );
}

function codexCost(model, t) {
  const p = PRICES.codex[model];
  if (!p) {
    unpriced.add(model);
    return null;
  }
  return ((t.input - t.cached) * p[0] + t.cached * p[1] + t.output * p[2]) / 1e6;
}

// Nombre del prompt -> ronda. Acepta plan-all-1, validate-G-01-2, revise-G01-1.
function parseLabel(label) {
  const m = label.match(/^(plan|validate|revise)-(.+)-(\d+)$/);
  if (!m) return { op: "otro", goal: "—", attempt: null };
  let goal = m[2];
  const g = goal.match(/^G-?(\d+)$/i);
  goal = g ? `G-${g[1].padStart(2, "0")}` : "—";
  return { op: m[1], goal, attempt: Number(m[3]) };
}

// ---------- Claude ----------
const sessions = [];
if (fs.existsSync(claudeDir)) {
  for (const name of fs.readdirSync(claudeDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -6);
    const files = [path.join(claudeDir, name), ...walk(path.join(claudeDir, id, "subagents"), (p) => p.endsWith(".jsonl"))];
    const calls = new Map();
    const launches = [];
    const splits = [];
    let arqStart = null;
    for (const file of files) {
      let agentType = null;
      const metaFile = file.replace(/\.jsonl$/, ".meta.json");
      if (file.includes(`${path.sep}subagents${path.sep}`) && fs.existsSync(metaFile)) {
        try {
          agentType = JSON.parse(fs.readFileSync(metaFile, "utf8")).agentType || null;
        } catch {}
      }
      for (const d of readJsonl(file)) {
        const ts = d.timestamp || "";
        if (d.type === "user" && !d.isMeta) {
          const c = d.message?.content;
          const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b.text || "").join(" ") : "";
          if (text.includes("<command-name>/arq-loop</command-name>") && (!arqStart || ts < arqStart)) arqStart = ts;
        }
        if (d.type !== "assistant") continue;
        const m = d.message || {};
        if (m.usage && m.model && m.model !== "<synthetic>") {
          calls.set(m.id || d.requestId || `${file}:${ts}`, { ts, model: m.model, usage: m.usage, sidechain: !!d.isSidechain, agentType });
        }
        for (const b of m.content || []) {
          if (b.type !== "tool_use" || b.name !== "Bash") continue;
          const cmd = String(b.input?.command || "");
          for (const mm of cmd.matchAll(/codex\.sh((?:\s+[^\s;&|]+){3,4})/g)) {
            const toks = mm[1].trim().split(/\s+/);
            const prompt = toks.find((t) => t.endsWith(".md") && !t.endsWith(".out.md"));
            if (!prompt || parseLabel(path.basename(prompt, ".md")).op === "otro") continue;
            const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
            launches.push({
              ts,
              session: id,
              label: path.basename(prompt, ".md"),
              effortArg: toks.find((t) => efforts.includes(t)) || null,
            });
          }
          for (const mm of cmd.matchAll(/split\.mjs\s+[^\s;&|]+\s+([^\s;&|]+)/g)) {
            const dir = mm[1].replace(/\/+$/, "");
            if (dir.endsWith("/goals") || dir === "goals") splits.push({ ts, feature: path.basename(path.dirname(dir)) });
          }
        }
      }
    }
    if (!launches.length && !arqStart) continue;
    launches.sort((a, b) => a.ts.localeCompare(b.ts));
    splits.sort((a, b) => a.ts.localeCompare(b.ts));
    sessions.push({ id, calls: [...calls.values()].sort((a, b) => a.ts.localeCompare(b.ts)), launches, splits, arqStart });
  }
}

// ---------- Codex ----------
const codexRuns = [];
for (const file of walk(codexDir, (p) => /rollout-.*\.jsonl$/.test(p))) {
  const rows = readJsonl(file);
  const meta = rows.find((r) => r.type === "session_meta")?.payload;
  if (!meta || meta.originator !== "Claude Code" || meta.cwd !== repoRoot) continue;
  if (sinceTs && (meta.timestamp || "") < sinceTs) continue;
  let ctx = {};
  let info = null;
  let rate = null;
  let tools = 0;
  let complete = false;
  for (const r of rows) {
    const p = r.payload || {};
    if (r.type === "turn_context") ctx = p;
    else if (r.type === "response_item" && (p.type === "custom_tool_call" || p.type === "function_call")) tools++;
    else if (r.type === "event_msg" && p.type === "token_count") {
      if (p.info) info = p.info;
      if (p.rate_limits?.primary) rate = p.rate_limits.primary;
    } else if (r.type === "event_msg" && p.type === "task_complete") complete = true;
  }
  const t = info?.total_token_usage || {};
  codexRuns.push({
    start: meta.timestamp,
    model: ctx.model || "?",
    effort: ctx.effort || "?",
    tools,
    complete,
    tokens: {
      input: t.input_tokens || 0,
      cached: t.cached_input_tokens || 0,
      output: t.output_tokens || 0,
      reasoning: t.reasoning_output_tokens || 0,
    },
    window: rate ? { used: rate.used_percent, resets: rate.resets_at } : null,
  });
}
codexRuns.sort((a, b) => a.start.localeCompare(b.start));
// Delta de la ventana de 5 h respecto de la corrida anterior en la misma ventana.
for (let i = 0; i < codexRuns.length; i++) {
  const cur = codexRuns[i].window;
  const prev = codexRuns[i - 1]?.window;
  if (cur && prev && prev.resets === cur.resets) cur.delta = cur.used - prev.used;
}

// ---------- rondas ----------
const rounds = [];
const used = new Set();
const allLaunches = sessions.flatMap((s) => s.launches).sort((a, b) => a.ts.localeCompare(b.ts));
const seen = {};

function featureOf(s, ts) {
  const after = s.splits.find((x) => x.ts >= ts);
  const before = [...s.splits].reverse().find((x) => x.ts < ts);
  return (after || before)?.feature || "?";
}

for (const s of sessions) {
  const keyed = s.launches.map((l) => {
    const n = (seen[l.label] = (seen[l.label] || 0) + 1);
    const r = {
      ...parseLabel(l.label),
      label: l.label,
      rerun: n > 1,
      ts: l.ts,
      session: s.id,
      feature: featureOf(s, l.ts),
      claude: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, models: {} },
      codex: null,
    };
    rounds.push(r);
    return r;
  });
  let tail = null;
  const start = s.arqStart || s.launches[0]?.ts || "";
  for (const c of s.calls) {
    if (c.ts < start || (sinceTs && c.ts < sinceTs)) continue;
    let r = keyed.find((k) => k.ts >= c.ts);
    if (!r) {
      if (!tail) {
        const last = keyed[keyed.length - 1];
        tail = {
          op: "abierto",
          goal: "—",
          attempt: null,
          label: last ? `abierto tras ${last.label}` : "abierto",
          ts: c.ts,
          session: s.id,
          feature: last ? last.feature : featureOf(s, c.ts),
          claude: { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, models: {} },
          codex: null,
        };
        rounds.push(tail);
      }
      r = tail;
    }
    const u = c.usage;
    const cost = claudeCost(c.model, u) || 0;
    const a = r.claude;
    a.calls++;
    a.input += u.input_tokens || 0;
    a.cacheWrite += u.cache_creation_input_tokens || 0;
    a.cacheRead += u.cache_read_input_tokens || 0;
    a.output += u.output_tokens || 0;
    a.usd += cost;
    const mk = normModel(c.model) + (c.sidechain ? " (subagente)" : "");
    if (c.agentType && c.agentType.startsWith("arq-implementer")) {
      const v = (a.implementers ||= {});
      const k = `${c.agentType} · ${normModel(c.model)}`;
      (v[k] ||= { calls: 0, usd: 0 }).calls++;
      v[k].usd += cost;
    }
    a.models[mk] = (a.models[mk] || 0) + cost;
  }
}

// Unir cada invocacion con la primera corrida de Codex que arranca despues.
for (const r of rounds.filter((x) => x.op !== "abierto").sort((a, b) => a.ts.localeCompare(b.ts))) {
  const t0 = Date.parse(r.ts);
  const run = codexRuns.find((c, i) => !used.has(i) && Date.parse(c.start) >= t0 - 10e3 && Date.parse(c.start) <= t0 + 15 * 60e3);
  if (run) {
    used.add(codexRuns.indexOf(run));
    r.codex = { ...run, usd: codexCost(run.model, run.tokens) };
  }
}

// Veredicto de cada validate, leido de GOALS_DIR/G-XX.verdict-N.md. Si una
// invocacion se relanzo, el veredicto pertenece solo a la ultima.
const lastOfLabel = {};
for (const r of rounds) if (r.op === "validate" && (!lastOfLabel[r.label] || r.ts > lastOfLabel[r.label].ts)) lastOfLabel[r.label] = r;
for (const r of Object.values(lastOfLabel)) {
  const f = path.join(repoRoot, specsRoot(repoRoot), r.feature, "goals", `${r.goal}.verdict-${r.attempt}.md`);
  if (!fs.existsSync(f)) continue;
  const head = fs.readFileSync(f, "utf8").slice(0, 600);
  const v = head.match(/^veredicto:\s*(PASS|FAIL)\b/m);
  if (v) r.verdict = v[1];
}

let view = rounds.filter((r) => !sinceTs || r.ts >= sinceTs);
let specDir = opt.spec ? path.resolve(repoRoot, opt.spec) : null;
if (!specDir) {
  const features = [...new Set(view.map((r) => r.feature).filter((f) => f !== "?"))];
  if (opt.write && features.length === 1) specDir = path.join(repoRoot, specsRoot(repoRoot), features[0]);
}
if (specDir) {
  const feat = path.basename(specDir);
  view = view.filter((r) => r.feature === feat);
}
view.sort((a, b) => a.ts.localeCompare(b.ts));

// ---------- reporte ----------
function roundName(r) {
  if (r.op === "validate") return `${r.goal} · intento ${r.attempt}${r.rerun ? " (relanzado)" : ""}`;
  if (r.op === "revise") return `revise ${r.goal}${r.rerun ? " (relanzado)" : ""}`;
  if (r.op === "plan") return `plan${r.rerun ? " (relanzado)" : ""}`;
  return r.label;
}

function flowOf(r) {
  return { validate: "implementar", revise: "preparar revise", plan: "preparar plan" }[r.op] || "abierto";
}

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);

function report() {
  const L = [];
  const totC = sum(view, (r) => r.claude.usd);
  const totX = sum(view, (r) => r.codex?.usd);
  L.push(`Actualizado: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`node .claude/skills/arq-loop/scripts/usage.mjs\``);
  L.push("");
  L.push(`Total: Claude $${usd(totC)} + Codex $${usd(totX)} = **$${usd(totC + totX)}** (USD equivalentes a precio de API).`);
  L.push("");
  L.push("| Ronda | Claude: llamadas | Claude: lect. caché | Claude: salida | Claude USD | Codex: modelo · effort | Codex: herram. | Codex: entrada | Codex USD | Ventana 5 h | Veredicto |");
  L.push("|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|");
  for (const r of view) {
    const c = r.claude;
    const x = r.codex;
    const win = x?.window ? (x.window.delta != null ? `+${x.window.delta} (${x.window.used}%)` : `${x.window.used}%`) : "—";
    L.push(
      `| ${roundName(r)} | ${c.calls} | ${fmt(c.cacheRead)} | ${fmt(c.output)} | ${usd(c.usd)} | ${x ? `${x.model} · ${x.effort}` : "—"} | ${x ? x.tools : "—"} | ${x ? fmt(x.tokens.input) : "—"} | ${x ? usd(x.usd) : "—"} | ${win} | ${r.verdict || "—"} |`,
    );
  }
  // Por goal
  const goals = {};
  for (const r of view) {
    if (r.goal === "—") continue;
    const g = (goals[r.goal] ||= { validates: 0, claude: 0, codex: 0 });
    if (r.op === "validate") g.validates++;
    g.claude += r.claude.usd;
    g.codex += r.codex?.usd || 0;
  }
  if (Object.keys(goals).length) {
    L.push("", "| Goal | Validates | Claude USD | Codex USD | Total |", "|---|---:|---:|---:|---:|");
    for (const [k, g] of Object.entries(goals).sort()) L.push(`| ${k} | ${g.validates} | ${usd(g.claude)} | ${usd(g.codex)} | ${usd(g.claude + g.codex)} |`);
  }
  // Veredictos por modelo validador
  const byModel = {};
  for (const r of view) {
    if (r.op !== "validate" || !r.codex || !r.verdict) continue;
    const k = `${r.codex.model} · ${r.codex.effort}`;
    const m = (byModel[k] ||= { n: 0, fail: 0, usd: 0 });
    m.n++;
    if (r.verdict === "FAIL") m.fail++;
    m.usd += r.codex.usd || 0;
  }
  if (Object.keys(byModel).length) {
    L.push("", "| Validador | Validates | FAIL | % FAIL | USD por validate |", "|---|---:|---:|---:|---:|");
    for (const [k, m] of Object.entries(byModel)) L.push(`| ${k} | ${m.n} | ${m.fail} | ${Math.round((m.fail / m.n) * 100)}% | ${usd(m.usd / m.n)} |`);
  }
  // Variantes del implementador (A/B de effort). Cada ronda cuenta para la
  // variante que hizo la mayoria de sus llamadas.
  const variants = {};
  for (const r of view) {
    const v = r.claude.implementers;
    if (!v || r.op !== "validate") continue;
    const [k] = Object.entries(v).sort((a, b) => b[1].calls - a[1].calls)[0];
    const s = (variants[k] ||= { n: 0, calls: 0, usd: 0, fail: 0, judged: 0 });
    s.n++;
    s.calls += Object.values(v).reduce((x, y) => x + y.calls, 0);
    s.usd += Object.values(v).reduce((x, y) => x + y.usd, 0);
    if (r.verdict) {
      s.judged++;
      if (r.verdict === "FAIL") s.fail++;
    }
  }
  if (Object.keys(variants).length) {
    L.push("", "| Implementador | Intentos | Llamadas promedio | USD promedio | % FAIL |", "|---|---:|---:|---:|---:|");
    for (const [k, s] of Object.entries(variants)) L.push(`| ${k} | ${s.n} | ${Math.round(s.calls / s.n)} | ${usd(s.usd / s.n)} | ${s.judged ? Math.round((s.fail / s.judged) * 100) + "%" : "—"} |`);
  }
  // Por flujo y modelo
  const flows = {};
  for (const r of view) {
    for (const [m, v] of Object.entries(r.claude.models)) {
      const k = `Claude · ${flowOf(r)} · ${m}`;
      flows[k] = (flows[k] || 0) + v;
    }
    if (r.codex) {
      const k = `Codex · ${r.op} · ${r.codex.model} ${r.codex.effort}`;
      flows[k] = (flows[k] || 0) + (r.codex.usd || 0);
    }
  }
  L.push("", "| Flujo · modelo | USD | % |", "|---|---:|---:|");
  const tot = totC + totX || 1;
  for (const [k, v] of Object.entries(flows).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${usd(v)} | ${Math.round((v / tot) * 100)}% |`);
  const provisional = [...new Set(view.flatMap((r) => Object.keys(r.claude.models)))].filter((m) => PROVISIONAL.has(m.replace(" (subagente)", "")));
  if (provisional.length) L.push("", `Precio provisional (igual a Sonnet 5, sin precio publicado): ${[...new Set(provisional.map((m) => m.replace(" (subagente)", "")))].join(", ")}.`);
  if (unpriced.size) L.push("", `Sin precio en PRICES (contados como $0): ${[...unpriced].join(", ")}. Agrégalos para que el total sea correcto.`);
  const unmatched = view.filter((r) => r.op !== "abierto" && !r.codex).length;
  if (unmatched) L.push("", `${unmatched} invocación(es) de codex.sh sin corrida de Codex asociada (error o límite de uso antes de arrancar).`);
  return L.join("\n");
}

if (opt.json) {
  console.log(JSON.stringify({ repoRoot, rounds: view }, null, 2));
  process.exit(0);
}

const md = report();
if (!opt.write) {
  console.log(md);
  process.exit(0);
}

if (!specDir) {
  console.error("No pude resolver la spec. Usa --spec <dir>.");
  process.exit(65);
}
if (!view.length) {
  console.error(`No hay rondas de arq-loop para ${path.basename(specDir)}; no se modifica STATUS.md.`);
  process.exit(66);
}
const statusPath = path.join(specDir, "goals", "STATUS.md");
if (!fs.existsSync(statusPath)) {
  console.error(`No existe ${statusPath}.`);
  process.exit(65);
}
const START = "<!-- arq-usage:start -->";
const END = "<!-- arq-usage:end -->";
const block = `${START}\n${md}\n${END}`;
let status = fs.readFileSync(statusPath, "utf8");
if (status.includes(START) && status.includes(END)) {
  status = status.slice(0, status.indexOf(START)) + block + status.slice(status.indexOf(END) + END.length);
} else {
  status = `${status.replace(/\s*$/, "")}\n\n## Consumo de tokens\n\n${block}\n`;
}
fs.writeFileSync(statusPath, status);
const totC = sum(view, (r) => r.claude.usd);
const totX = sum(view, (r) => r.codex?.usd);
console.log(`Consumo actualizado en ${path.relative(repoRoot, statusPath)}: Claude $${usd(totC)} + Codex $${usd(totX)} = $${usd(totC + totX)} en ${view.length} rondas.`);
