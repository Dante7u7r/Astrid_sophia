# Modo de auditoria UI

El modo de auditoria visual existe solo para desarrollo y pruebas automatizadas. Permite
inicializar partes concretas de la interfaz y aislar pasos del arranque cuando se investiga
una regresion.

## Ejecucion recomendada

```powershell
npm.cmd run audit:ui
```

Este comando:

1. Compila con `vite build --mode audit`.
2. Inicia un `vite preview` aislado en `127.0.0.1:4174`.
3. Ejecuta Playwright en escritorio y movil.
4. Guarda capturas y metricas en `visual-audit-results/`.
5. Genera una segunda build de produccion y comprueba que los query params se ignoren.
6. Falla ante overflow, canvas vacio, errores JavaScript o interacciones rotas.

## Parametros

La activacion exige `audit=1`.

```text
?audit=1&auditStage=canvas&auditStep=full
```

Etapas admitidas:

| `auditStage` | Inicializacion |
| --- | --- |
| `static` | DOM base, sin subsistemas interactivos |
| `oscilloscope` | Interfaz del osciloscopio |
| `canvas` | Osciloscopio y editor del esquema |
| `tabs` | Flujo completo hasta archivos y pestanas |

Pasos admitidos:

| `auditStep` | Efecto |
| --- | --- |
| `full` | No omite ningun paso |
| `skip-render` | Omite todo el render del esquema |
| `skip-canvas-render` | Omite solo `CanvasOrchestrator.render()` |
| `skip-osc-render` | Omite solo el render del osciloscopio |
| `orchestrator` | Detiene el arranque tras crear el orquestador |
| `resize` | Detiene el arranque tras dimensionar el canvas |
| `layout` | Detiene el arranque tras crear el layout |
| `input` | Detiene el arranque tras registrar entradas del canvas |
| `drop` | Detiene el arranque tras registrar drag and drop |

Los valores desconocidos se normalizan a `static` y `full`.

## Restriccion de produccion

Una compilacion normal (`npm run build` o Tauri release) usa el modo `production`.
En ese modo, `?audit=1` se ignora aunque aparezca en la URL. Solo se permite activar
la auditoria cuando Vite esta en desarrollo o cuando la compilacion usa expresamente
`--mode audit`.

La resolucion y validacion de parametros vive en
`src/testing/visual_audit_config.ts`; el codigo de aplicacion no debe leer directamente
`audit`, `auditStage` ni `auditStep`.
