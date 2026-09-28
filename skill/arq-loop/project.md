# Perfil del proyecto para arq-loop

> Reemplaza cada sección con datos reales de tu proyecto. Codex recibe este
> archivo completo en cada prompt; Claude usa "Verificación" en cada goal.

## Contexto
<Nombre del producto>: <qué es en una o dos líneas>. Stack: <lenguajes,
frameworks, plataformas objetivo>.

## Leer antes de diseñar
- `README.md`
- `<ruta al documento de estado actual del proyecto>`
- `<ruta a decisiones de arquitectura, p. ej. docs/DECISIONS.md>`
- `<ruta al diseño canónico o guía de UI, si aplica>`
- El código existente en `<src/>` y `<tests/>` que toque la solicitud.
  (`context-pack.mjs` arma el mapa del módulo con las rutas de esta sección
  que terminan en `/`.)

## Restricciones
- <Plataforma y versiones mínimas>.
- <Presupuestos de rendimiento, memoria o tamaño>.
- <Reglas de diseño: qué fuente manda cuando hay conflicto>.
- <Seguridad, privacidad, dependencias prohibidas>.

## Verificación
Comandos exactos, ejecutables desde la raíz del repo:
- Tests: `<p. ej. npm test -- --ci>`
- Build: `<p. ej. npm run build>`
- Lint / tipos: `<p. ej. npm run lint && npx tsc --noEmit>`

## Herramientas
Opcional. Scripts del proyecto que resuelven en una sola llamada lo que el
implementador haría en varias. Cada llamada relee todo su contexto, así que
esto baja el costo. Ejemplos:
- `scripts/test.sh <filtro>`: corre tests con el entorno listo e imprime
  `$ comando`, `exit=`, un resumen y la cola del log.
- `scripts/api.sh <símbolo>`: firmas públicas de una dependencia.

## Pasos manuales
Opcional. Lo que requiere a una persona: un dispositivo físico, una cuenta de
prueba, un servicio externo. `run` avisa una sola vez al inicio qué goals lo
necesitan y corre el comando de comprobación. Lo que dependa de esto se
entrega como "pendiente de prueba manual".

| Recurso | Qué debe dejar listo el usuario | Comprobación |
|---|---|---|
| `<dispositivo>` | `<conectado y con depuración activa>` | `<comando que lo verifica>` |

## Pre-check
Reglas para `scripts/precheck.mjs`: si el diff del goal toca una ruta, se
re-ejecuta su comando antes de llamar a Codex. Una fila por regla; el glob y
el comando van entre comillas invertidas.

| Si el diff toca | Comando |
|---|---|
| `src/**` | `<p. ej. npm test -- --ci>` |

## Specs
Raíz de specs: `specs` (si no usas spec-kit, por ejemplo `docs/arq`).

## Registro de decisiones
`<ruta, p. ej. docs/DECISIONS.md>`. El validador indica cuándo actualizarlo.
