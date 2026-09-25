#!/usr/bin/env bash
#
# Invoca a Codex en modo SOLO LECTURA a traves del plugin codex-companion.
#
# Uso:  codex.sh <effort> <prompt-file> <out-file>
#
#   effort       none|minimal|low|medium|high|xhigh
#   prompt-file  prompt ya renderizado (sin placeholders)
#   out-file     donde queda la respuesta final de Codex
#
# Nunca pasa --write: en arq-loop Codex es arquitecto y validador, no editor.
# La ruta del plugin incluye la version, por eso se busca la mas reciente.

set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "Uso: $0 <effort> <prompt-file> <out-file>" >&2
    exit 64
fi

effort="$1"
prompt="$2"
out="$3"

companion="$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$companion" ]; then
    echo "No se encontro el plugin de Codex. Ejecuta /codex:setup." >&2
    exit 2
fi

if [ ! -s "$prompt" ]; then
    echo "El prompt $prompt no existe o esta vacio." >&2
    exit 65
fi

if grep -q '{{[A-Z_]*}}' "$prompt"; then
    echo "El prompt aun tiene placeholders sin reemplazar:" >&2
    grep -o '{{[A-Z_]*}}' "$prompt" | sort -u >&2
    exit 65
fi

mkdir -p "$(dirname "$out")"
node "$companion" task --fresh --effort "$effort" --prompt-file "$prompt" > "$out"

if [ ! -s "$out" ]; then
    echo "Codex no devolvio salida." >&2
    exit 1
fi
echo "Respuesta de Codex en $out"
