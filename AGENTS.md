# Biaani — Agent Instructions

Never tell me what I want to hear. If the answer conflicts with my assumptions, say so directly. Do not soften, omit, or reframe uncomfortable truths to avoid friction.

No placebo responses. Do not produce output that looks helpful but contains no real information or decision-relevant content. Every response must either answer the question, admit it can't, or ask a specific clarifying question.

Distinguish what you know from what you're guessing. Label uncertainty explicitly: "I don't know", "I'm not sure but...", "this is speculation". Never present a guess as a fact.

If I'm wrong, tell me I'm wrong. Do not validate incorrect premises to avoid conflict. Correct me and explain why, even if I sound confident.

No unsolicited validation. Do not open or close responses with praise for my questions, ideas, or work unless I ask for feedback. Compliments I didn't request are noise.

Omission is a form of lying. If relevant information contradicts or complicates my request, include it. Do not cherry-pick only the parts that support what I seem to want.

If you can't help with something, say it plainly. Do not generate filler, vague advice, or redirection that wastes my time. "I can't help with this" is always better than a non-answer.

No epistemic cowardice. Do not hedge every statement into meaninglessness to avoid taking a position. When evidence or reasoning points somewhere, say where it points.

## Project Overview
A Tauri + Vanilla TypeScript electronic circuit simulator with SPICE-level analysis (DC, AC, Transient, Sensitivity, PSS, STB). Frontend handles schematic editing, canvas rendering, and TypeScript fallback solvers. Backend (Rust) provides high-performance MNA solvers via Tauri IPC.

## Architecture
- **Frontend** (`src/`): TypeScript + Vite + Canvas 2D rendering
  - `main.ts` — Entry point, UI wiring, simulation orchestration
  - `canvas_orchestrator.ts` — Schematic editor (drag, wire, viewport, hit-testing)
  - `simulation/` — MCU runtime (8051, AVR), SPICE bridge, co-simulation
  - `ui/` — Panels (oscilloscope, telemetry, MCU debug, settings, actuators, audio)
  - `styles.css` + `components.css` — Premium dark-mode design system (CSS custom properties)
- **Backend** (`src-tauri/src/`): Rust + Tauri 2
  - `solver.rs` — Core MNA (DC, AC, Transient, Monte Carlo, FFT, IMD, Noise, Sensitivity, PSS, STB)
  - `sparse_parallel.rs`, `krylov.rs`, `dual3.rs` — Sparse linear algebra, GMRES, dual-number AD
  - `lib.rs` — Tauri command exports (18 commands)

## Commands
```bash
# Frontend
npm run dev          # Vite dev server (port 1420)
npm run build        # tsc + vite build (required before tauri build)
npm run preview      # Preview production build

# Tauri
npm run tauri        # Tauri CLI (dev, build, etc.)
npm run empaquetar   # tauri build (release bundle)

# Rust (run from src-tauri/)
cargo check          # Type-check only
cargo clippy -- -D warnings  # Lint (CI runs this)
cargo test           # Unit/integration tests
```

## CI Pipeline (`.github/workflows/ci.yml`)
1. **Frontend**: `npm ci` → `npm run build` (TypeScript + Vite)
2. **Backend**: Install Linux deps → `cargo check` → `cargo clippy -D warnings` → `cargo test`

## Key Conventions
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `strict: true`
- **Spanish UI**: All user-facing strings in Spanish (errors, logs, labels)
- **ERC (Electrical Rule Check)**: Runs before every simulation; aborts on errors (missing GND, shorted sources, floating pins)
- **Co-simulation**: Rust solver handles analog; TypeScript MCU runtime steps digital (8051/AVR) each timestep
- **Tabs/Workspaces**: Multi-tab schematic support with per-tab transient/AC results
- **Viewport**: Canvas uses world coords (grid 20px), zoom 0.3–3.0, pan via offset
- **Netlist extraction**: DSU (Disjoint Set Union) on pins → electrical nodes; ground = node "0"

## Rust Solver Capabilities (tauri commands)
- `run_dc_simulation`, `run_transient_simulation`, `run_ac_sweep`, `run_dc_sweep`
- `run_sensitivity_analysis`, `run_pss_simulation`, `run_stability_analysis`
- `run_monte_carlo_transient`, `run_fft_analysis`, `run_imd_analysis`, `run_noise_sweep`
- `solve_dc_thermal`, `parse_spice_netlist`, `evaluate_measures`, `expand_transmission_line`

## Testing
- Frontend tests: `npm test` (ejecuta Vitest con Happy-DOM en 177+ archivos de prueba)
- Rust tests: `cargo test` en `src-tauri/`

## Registro de Anti-patrones y Errores Recurrentes (Lecciones Aprendidas)
1. **Serialización Numérica JS vs DOM HTML (`<select>` y atributos):**
   - En JavaScript, números $< 10^{-6}$ (e.g. `1e-8`) se convierten en notación exponencial `"1e-8"` al llamar `.toString()`.
   - Si el HTML tiene `<option value="0.00000001">`, la asignación `select.value = val.toString()` falla silenciosamente.
   - *Regla:* Sincronizar siempre los atributos `value` con la salida exacta de `.toString()` y usar funciones de coincidencia numérica tolerante (`syncTimeDivSelect`).

2. **Formateo de Unidades de Ingeniería y Evitar Doble Sufijo:**
   - Prohibido concatenar variables intermedias que ya contengan prefijos de magnitud (e.g., `freqStr` con `"k"` + `freqUnit` `"kHz"` $\rightarrow$ `"1.00kkHz"`).
   - Usar siempre funciones puras y unificadas de formateo (`formatOscilloscopeTime`, `formatSpiceValue`) con rangos limpios (`Hz`, `kHz`, `MHz`, `GHz` / `ns`, `µs`, `ms`, `s`).

3. **Compatibilidad con Entornos Headless y Tests (`Happy-DOM`):**
   - En entornos de prueba headless, `getClientRects()` devuelve listas vacías y los contextos 2D de canvas son nulos por defecto.
   - *Regla:* No depender exclusivamente de `getClientRects().length > 0` en comprobaciones de visibilidad (`isCanvasVisible`) y mantener siempre mocks de `getContext("2d")` en `beforeEach`.

4. **Propagación Completa al Extender Rangos Físicos:**
   - Al ampliar un rango en un instrumento (e.g. base de tiempo horizontal a nanosegundos o segundos), auditar y adaptar inmediatamente:
     - Métricas DSP y detección de cruces por disparo.
     - Etiquetas de cursores en pantalla ($\Delta t$, $1/\Delta t$).
     - Tarjetas de lectura digital / telemetría.
     - Tests unitarios que cubran los extremos del nuevo rango.

## Gotchas
- **Vite port fixed at 1420** (see `vite.config.ts`); Tauri expects this
- **`src-tauri/target/` is gitignored** — run `cargo build` locally
- **No `.env`** — config via `tauri.conf.json` and `vite.config.ts`
- **Release profile**: LTO, strip, panic=abort (see `Cargo.toml`)
- **MCU firmware**: Loaded as hex string → `Uint8Array` in component `firmware` field