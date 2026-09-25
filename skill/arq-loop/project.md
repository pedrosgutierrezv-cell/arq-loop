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

## Specs
Raíz de specs: `specs` (si no usas spec-kit, por ejemplo `docs/arq`).

## Registro de decisiones
`<ruta, p. ej. docs/DECISIONS.md>`. El validador indica cuándo actualizarlo.
