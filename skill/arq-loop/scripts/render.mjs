#!/usr/bin/env node
//
// Renderiza una plantilla de prompt reemplazando {{CLAVE}}.
//
// Uso:  node render.mjs <plantilla> <salida> CLAVE=valor CLAVE=@archivo CLAVE=
//
//   CLAVE=valor    reemplaza {{CLAVE}} por el texto literal
//   CLAVE=@ruta    reemplaza {{CLAVE}} por el contenido del archivo
//   CLAVE=         reemplaza {{CLAVE}} por vacío (placeholder opcional)
//
// Sale con código 65 si queda algún {{PLACEHOLDER}} sin valor: un prompt a medio
// renderizar no debe llegar a Codex.

import fs from "node:fs";
import path from "node:path";

const [template, output, ...pairs] = process.argv.slice(2);
if (!template || !output) {
  console.error("Uso: node render.mjs <plantilla> <salida> CLAVE=valor CLAVE=@archivo ...");
  process.exit(64);
}

let text = fs.readFileSync(template, "utf8");
for (const pair of pairs) {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    console.error(`Par inválido (se espera CLAVE=valor): ${pair}`);
    process.exit(64);
  }
  const key = pair.slice(0, eq);
  let value = pair.slice(eq + 1);
  if (value.startsWith("@")) value = fs.readFileSync(value.slice(1), "utf8").replace(/\n$/, "");
  text = text.split(`{{${key}}}`).join(value);
}

const missing = [...new Set(text.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
if (missing.length > 0) {
  console.error(`Placeholders sin valor: ${missing.join(", ")}`);
  process.exit(65);
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, text);
console.log(output);
