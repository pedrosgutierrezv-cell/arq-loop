#!/usr/bin/env node
//
// Materializa los archivos que Codex devuelve en su respuesta.
//
// Uso:  node split.mjs <codex-output> <goals-dir>
//
// Codex corre en solo lectura, asi que entrega cada archivo entre marcadores:
//
//   <<<FILE G-01.md>>>
//   ...contenido...
//   <<<END>>>
//
// Las rutas son relativas a <goals-dir> y no pueden salir de el. Se copian
// tal cual: Claude no reescribe lo que decide el arquitecto.
//
// Regla dura: un goal (G-NN.md) no puede superar MAX_GOAL_CHARS caracteres,
// porque sobre 4000 Claude no lo ejecuta. Si alguno se pasa no se escribe
// ningun archivo y sale con codigo 3, para que Codex lo reescriba.

import fs from "node:fs";
import path from "node:path";

const [outputFile, goalsDir] = process.argv.slice(2);
if (!outputFile || !goalsDir) {
  console.error("Uso: node split.mjs <codex-output> <goals-dir>");
  process.exit(64);
}

const text = fs.readFileSync(outputFile, "utf8");
const root = path.resolve(goalsDir);
const MAX_GOAL_CHARS = 3990;
const GOAL_NAME = /^G-\d+\.md$/;
const pattern = /^<<<FILE ([^>\n]+)>>>\n([\s\S]*?)^<<<END>>>$/gm;

const files = [];
for (const [, rawName, body] of text.matchAll(pattern)) {
  const name = rawName.trim();
  const target = path.resolve(root, name);
  if (target !== root && !target.startsWith(root + path.sep)) {
    console.error(`Ruta rechazada, sale de ${goalsDir}: ${name}`);
    process.exit(65);
  }
  const content = body.endsWith("\n") ? body : body + "\n";
  files.push({ name, target, content });
}

if (files.length === 0) {
  console.error("La respuesta de Codex no contiene bloques <<<FILE ...>>>.");
  process.exit(1);
}

// Caracteres, no bytes: las tildes cuentan como uno.
const tooLong = files
  .filter(({ name }) => GOAL_NAME.test(path.basename(name)))
  .map(({ name, content }) => ({ name, length: [...content].length }))
  .filter(({ length }) => length > MAX_GOAL_CHARS);

if (tooLong.length > 0) {
  console.error(`Goals sobre el limite de ${MAX_GOAL_CHARS} caracteres; no se escribio ningun archivo:`);
  for (const { name, length } of tooLong) {
    console.error(`  ${name}: ${length} caracteres (sobra ${length - MAX_GOAL_CHARS})`);
  }
  process.exit(3);
}

for (const { target, content } of files) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
console.log(files.map(({ target }) => path.relative(process.cwd(), target)).join("\n"));
