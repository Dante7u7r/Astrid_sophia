# Astrid Sophia (Phase 37 Milestone)

**Interactive circuit simulator — Rust MNA engine + reactive vector canvas (TypeScript).**

Astrid Sophia combines Modified Nodal Analysis (MNA), a Tauri v2 desktop schematic editor and several advanced analysis prototypes. It is currently intended for closed educational/research pilots, not for safety-critical or sign-off engineering work.

---

## Core Engine Capabilities

### Analytic MNA Solver (Rust)

| Feature | Implementation |
|---|---|
| Matrix layout | Hybrid dense / sparse (CSC) with supernodal elimination |
| Nonlinear iteration | Damped Newton-Raphson with backtracking line search and KCL residual |
| Transient integration | Backward Euler + Trapezoidal (TRAP) 2nd-order with adaptive timestep (LTE) |
| AC analysis | Small-signal frequency sweep with complex admittance Jacobian |
| DC operating point | Automatic initial guess + pseudo-transient (PTA) |
| Sensitivity | ∂V/∂R, ∂V/∂C parametric sensitivity with worst-case limits |
| Periodic steady-state | Experimental shooting method; external validation and closure criteria are still incomplete |
| Pole/zero analysis | Experimental reduced-order extraction; **does not calculate loop gain, phase margin or gain margin** |

20+ device models: resistor, capacitor, inductor, diode (Shockley), LED, BJT NPN/PNP (Ebers-Moll + Early), NMOS/PMOS (Level 1 + subthreshold), op-amp (macro-model with tanh saturation), transformer, switch (Ron/Roff with hysteresis), transmission line (RLCG Pi-segment cascade), lamp thermal model, relay electromechanical, buzzer piezoelectric and optocoupler (CTR). BSIM3v3/BSIM4 support is partial and experimental. A versioned BSIM3 NMOS characterization against ngspice currently shows 97.9%–99.3% drain-current error, so it must not be used for physical prediction.

### MCU Scaffold (Not Simulable)

- **MCU status**: 8051/AVR components are rejected by ERC before simulation. The remaining runtime is an inspection scaffold, not a firmware executor; the UI can validate/load HEX or BIN and display a partial disassembly only.
- **Board models**: Arduino Uno, ESP32 and Raspberry Pi Pico are high-level analog/functional models. They do not execute real firmware.
- **Mixed-signal hooks**: threshold events and GPIO coupling infrastructure exist, but they are not equivalent to validated hardware emulation.

### Advanced Parametric Analysis

| Analysis | Description |
|---|---|
| **PVT** | Process-Voltage-Temperature corner sweep (Commercial, Industrial, Automotive) |
| **SPAR** | S-Parameter extraction with Touchstone .sNp export (MA/RI format, Z0 reference) |
| **Monte Carlo** | Statistical transient simulation with component tolerance distributions |
| **FFT / IMD** | Spectral analysis (Cooley-Tukey radix-2) and intermodulation distortion (IM2, IM3, IP3) |
| **Noise** | Thermal, shot, flicker (1/f) noise spectral density sweep |
| **.measure** | Evaluator for DELAY, RISETIME, FALLTIME, PEAK, AVG, RMS, PP |

---

## Modular Architecture

### `src/simulation/` — Pure functional modules

```
simulation/
  netlist_extractor.ts       Pure netlist extraction via DSU
  fallback_solver.ts         Algebraic transient solver (Gaussian elimination, partial pivoting)
  simulation_runner.ts       Async simulation lifecycle coordinator with IoC callbacks
  simulation_dispatcher.ts   Tauri v2 IPC orchestrator + Electrical Rule Check (ERC)
  circuit_state_manager.ts   Centralized reactive immutable state container
  mcu-types.ts               MCU architecture definitions (8051, AVR, ARM Cortex-M0)
  mcu-runtime.ts             Experimental MCU timing/runtime scaffold
  mcu-8051.ts                STANDARD_8051_DEFINITION
  mcu-avr.ts                 ATMEGA328P_DEFINITIONS
  mcu-spice-bridge.ts        Mixed-signal GPIO bridge (digital state encoding 0,1,X,Z)
  tauri_mock.ts              Safe IPC wrapper with browser fallback mocks
  index.ts                   Barrel export
```

**Zero circular dependencies**: every module receives data through explicit function parameters. Global state lives exclusively in `circuit_state_manager.ts` via controlled getters and semantic mutators.

### `src/ui/` — Presentation layer

```
ui/
  oscilloscope_panel.ts       Dual-channel virtual oscilloscope (AC Bode / transient)
  simulation_controls.ts      Analysis mode selector (DC / AC / TRAN / SENS / PSS / STB / PVT / SPAR)
  telemetry_panel.ts          Real-time CPU/memory telemetry (Tauri IPC)
  settings_modal.ts           Simulation parameters (dt, tolerance, max iterations)
  actuator_helpers.ts         Actuator model parsers (lamp thermal, relay, buzzer)
  audio_orchestrator.ts       Web Audio API PWM synthesis
  mcu_debug_panel.ts          Inspector HEX/BIN y desensamblado; no ejecuta la ISA
```

### `src/` — Application root

```
src/
  main.ts                     Entry point and desktop composition root
  canvas_orchestrator.ts      Canvas 2D schematic editor (viewport, hit-testing, wire routing)
  styles.css                  Premium dark-mode design system
  components.css              Component-specific styling
```

---

## Quality Assurance & Tooling

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend bundler | Vite | ^6.0 |
| Language | TypeScript | ~5.6 (strict) |
| Desktop shell | Tauri | ^2 |
| Testing | Vitest | ^4 |
| Backend | Rust | edition 2021 |

### Commands

```bash
# Install dependencies
npm install

# Launch development server (Vite on port 1420)
npm run dev

# Run frontend unit/integration tests
npm test

# Run tests with the enforced coverage floor
npm run test:coverage

# Run integration tests (end-to-end simulation flow)
npm run test:integration

# Run the versioned Phase 4 scientific matrix
npm run validate:scientific

# Watch mode for TDD
npm run test:watch

# Automated desktop/mobile UI audit
npm run audit:ui

# Production build (tsc + Vite)
npm run build

# Build Tauri desktop bundle
npm run empaquetar

# Cross-platform build scripts (recommended)
./build.sh          # Linux/macOS
build.bat           # Windows
./build.sh --clean  # Clean build
./build.sh --debug  # Debug build

# Rust checks (from src-tauri/)
cargo check
cargo clippy -- -D warnings
cargo test
```

The visual audit mode is restricted to development and the dedicated Vite `audit`
build mode. Its stages, isolation steps, and query parameters are documented in
[`docs/ui-audit.md`](docs/ui-audit.md).

### CI Pipeline (`.github/workflows/ci.yml`)

1. **Frontend**: reproducible `npm ci`, production dependency audit, strict build and coverage floor
2. **Backend**: pinned Rust toolchain, `cargo check`, formatting, Clippy and tests with the lockfile enforced
3. **Scientific matrix**: 13 versioned cases / 46 observations, including four live ngspice correlations
4. **Windows desktop**: instrumented Tauri build and the native WDIO E2E suite
5. **Static analysis**: CodeQL for JavaScript/TypeScript and Rust

Every simulation run is guarded by an **Electrical Rule Check (ERC)**:
- Missing ground reference (node "0")
- Shorted voltage sources (both terminals on the same node)
- Parallel voltage sources (conflicting constraints)
- Floating pins / orphaned components
- Unsupported component contracts, invalid pin counts and oversized node/component sets

---

## Performance Targets

| Metric | Target | Current |
|---|---|---|
| Canvas framerate | 60 FPS | 60 FPS |
| Transient timestep | 1-100 us adaptive | 1 us fixed |
| Interactive latency | < 16 ms | < 10 ms |
| MCU firmware execution | Complete ISA + peripherals | Not implemented; simulation is blocked |
| Scientific reference suite | Documented external comparisons | 13 cases / 46 observations; live ngspice DC, AC, transient and ideal-diode correlation |
| Production bundle (gzip) | < 200 kB | ~346 kB measured |

---

## License

Proprietary software. All rights are reserved; see [`LICENSE`](LICENSE). No
permission to copy, modify or redistribute is granted without prior written
authorization from the copyright holder.

---

*Phase 37 Milestone — June 2026*
