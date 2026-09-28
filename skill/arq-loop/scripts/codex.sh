#!/usr/bin/env bash
#
# Invoca a Codex en modo SOLO LECTURA a traves del plugin codex-companion.
#
# Uso:  codex.sh <model> <effort> <prompt-file> <out-file>
#
#   model        modelo de Codex, p. ej. gpt-6-sol o gpt-6-luna (ver SKILL.md,
#                "Modelo y esfuerzo por flujo")
#   effort       none|minimal|low|medium|high|xhigh
#   prompt-file  prompt ya renderizado (sin placeholders)
#   out-file     donde queda la respuesta final de Codex
#
# El modelo es obligatorio: sin el, Codex usaria el de ~/.codex/config.toml y
# el costo dependeria de una configuracion global que el skill no controla.
# Nunca pasa --write: en arq-loop Codex es arquitecto y validador, no editor.
# La ruta del plugin incluye la version, por eso se busca la mas reciente.

set -euo pipefail

efforts="none minimal low medium high xhigh"

if [ "$#" -eq 3 ] && [[ " $efforts " == *" $1 "* ]]; then
    echo "Uso antiguo sin modelo. Ahora es: $0 <model> <effort> <prompt-file> <out-file>" >&2
    exit 64
fi
if [ "$#" -ne 4 ]; then
    echo "Uso: $0 <model> <effort> <prompt-file> <out-file>" >&2
    exit 64
fi

model="$1"
effort="$2"
prompt="$3"
out="$4"

if [[ " $efforts " != *" $effort "* ]]; then
    echo "Effort no valido: $effort. Usa uno de: $efforts" >&2
    exit 64
fi

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
node "$companion" task --fresh --model "$model" --effort "$effort" --prompt-file "$prompt" > "$out"

if [ ! -s "$out" ]; then
    echo "Codex no devolvio salida." >&2
    exit 1
fi
echo "Respuesta de Codex ($model · $effort) en $out"
