# Astryd Sophia — Agent Instructions

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
- Frontend tests: `tests/test_ui.ts` (run via browser or Node — no test runner configured)
- Rust tests: `cargo test` in `src-tauri/`
- No Vitest/Jest configured; tests are manual `console.log` suites

## Gotchas
- **Vite port fixed at 1420** (see `vite.config.ts`); Tauri expects this
- **`src-tauri/target/` is gitignored** — run `cargo build` locally
- **No `.env`** — config via `tauri.conf.json` and `vite.config.ts`
- **Release profile**: LTO, strip, panic=abort (see `Cargo.toml`)
- **MCU firmware**: Loaded as hex string → `Uint8Array` in component `firmware` field