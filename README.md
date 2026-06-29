# Astrid Sophia (Phase 37 Milestone)

**Interactive real-time mixed-signal circuit simulator — 60 FPS continuous transient engine (Rust) + reactive vector canvas (TypeScript).**

Astrid Sophia combines SPICE-level Modified Nodal Analysis (MNA) with cycle-accurate microcontroller co-simulation (8051, AVR), advanced parametric analysis (PVT, S-Parameter extraction), and a premium dark-mode schematic editor in a single Tauri v2 desktop application.

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
| Periodic steady-state | Shooting method for steady-state envelope (PSS) |
| Stability analysis | Pole-zero extraction, phase margin, gain margin (STB) |

20+ device models: resistor, capacitor, inductor, diode (Shockley), LED, BJT NPN/PNP (Ebers-Moll + Early), NMOS/PMOS (Level 1 + subthreshold), op-amp (macro-model with tanh saturation), transformer, switch (Ron/Roff with hysteresis), transmission line (RLCG Pi-segment cascade), lamp thermal model, relay electromechanical, buzzer piezoelectric, optocoupler (CTR), BSIM3v3/BSIM4 (gate leakage, DIBL, short-channel).

### Real-Time Co-Simulation (Mixed-Signal)

```
  SIMULATION TIMESTEP (dt = 1 us)
  +-------------------+---------------------------+-----------+
  |   MNA SOLVER      |   MCU RUNTIMES           |  AUDIO /  |
  |   (Rust)          |   (8051 12 MHz /         |  ACTUATOR |
  |                   |    AVR 16 MHz)           |  UPDATE   |
  |                   |                           |           |
  |  Solve A.x = b    |  Execute cycles          |  Buzzer   |
  |  Stamp companion  |  Dispatch analog IRQs    |  Lamp     |
  |  models           |  Read GPIO from nodes    |  Relay    |
  |                   |  Write GPIO to MNA       |  LED      |
  +-------------------+---------------------------+-----------+
          |                       |                      |
          +-----------------------+----------------------+
                                  |
                                  v
                    ON_FRAME_RECEIVED (60 FPS)
                    -> Canvas heatmaps + oscilloscope
                    -> Actuator interpolation
                    -> Telemetry broadcast
```

- **Cycle accuracy**: 8051 — 12 cycles/µs; AVR — 16 cycles/µs, matching real silicon.
- **Interrupt injection**: Analog threshold crossings (`rising`/`falling`/`either`) dispatched as hardware interrupts (e.g., INT0 at vector 0x02).
- **GPIO coupling**: Digital pin states converted to Thevenin/Norton companion sources, stamped into the MNA matrix each timestep.

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
  mcu-runtime.ts             Cycle-accurate virtual MCU runtime (fetch-decode-execute)
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
  mcu_debug_panel.ts          MCU register viewer, firmware upload (.hex), step/run/reset
```

### `src/` — Application root

```
src/
  main.ts                     Entry point (2,624 lines after 7 refactoring passes)
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

# Run unit tests (12 tests: DSU, Gaussian elimination, DC solver)
npm test

# Run integration tests (end-to-end simulation flow)
npm run test:integration

# Watch mode for TDD
npm run test:watch

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

### CI Pipeline (`.github/workflows/ci.yml`)

1. **Frontend**: `npm ci` -> `npm run build` (TypeScript strict + Vite)
2. **Backend**: `cargo check` -> `cargo clippy -D warnings` -> `cargo test` (90+ Rust tests)
3. **Static analysis**: CodeQL security and maintainability scanning

Every simulation run is guarded by an **Electrical Rule Check (ERC)**:
- Missing ground reference (node "0")
- Shorted voltage sources (both terminals on the same node)
- Parallel voltage sources (conflicting constraints)
- Floating pins / orphaned components

---

## Performance Targets

| Metric | Target | Current |
|---|---|---|
| Canvas framerate | 60 FPS | 60 FPS |
| Transient timestep | 1-100 us adaptive | 1 us fixed |
| Interactive latency | < 16 ms | < 10 ms |
| MCU 8051 co-simulation | 12 cycles/us | 12 cycles/us |
| MCU AVR co-simulation | 16 cycles/us | 16 cycles/us |
| Test suite runtime | < 1 s | 410 ms |
| Production bundle (gzip) | < 200 kB | 43 kB |

---

## License

Astrid Sophia is distributed under the MIT License. See `LICENSE` for details.

---

*Phase 37 Milestone — June 2026*
