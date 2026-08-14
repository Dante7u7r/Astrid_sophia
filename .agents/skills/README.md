# Astryd Sophia Skills — v2.2
**Engineering reference package**

Nine domain-specific skill definitions and reference implementations for the Astryd Sophia electronic simulation desktop application (Tauri + TypeScript + Rust).

---

## Package structure

```
Astryd_Sophia_Skills/
├── README.md                          ← this file
│
├── canvas-vector-render/
│   ├── SKILL.md                       ← viewport affine math, culling, grid, hit-test
│   └── examples/
│       └── canvas_orchestrator.ts     ← full CanvasOrchestrator with inertial pan
│
├── electronic-simulation-physics/
│   ├── SKILL.md                       ← MNA, NR+pnjlim, AC, transient integration
│   └── examples/
│       └── mna_solver.rs              ← DC, AC, NR diode, transient BE + LTE
│
├── rust-math-performance/
│   ├── SKILL.md                       ← allocation discipline, CSC, rayon, SIMD
│   └── examples/
│       └── perf_kernels.rs            ← NrWorkspace, CSC, parallel AC sweep, benchmarks
│
├── tauri-ipc-bridge/
│   ├── SKILL.md                       ← IPC contract, streaming, cancellation
│   └── examples/
│       ├── tauri_bridge.rs            ← Rust: commands, mpsc emitter, CancellationToken
│       └── tauri_bindings.ts          ← TypeScript: zod, invoke wrappers, React hook
│
├── premium-web-aesthetics/
│   ├── SKILL.md                       ← tokens, glassmorphism, GPU animation, WCAG
│   └── examples/
│       ├── design_system.css          ← full CSS design token system + components
│       └── ui_demo.html               ← live component gallery (open in browser)
│
├── schematic-topology-routing/
│   ├── SKILL.md                       ← topology graph, Manhattan routing, DSU netlist, ERC
│   └── examples/
│       └── graph_netlist_router.ts    ← TopologyGraph: BFS router, DSU extractor, ERC, Tauri IPC
│
├── spice-macromodeling-parser/
│   ├── SKILL.md                       ← SPICE tokenizer, subckt expansion, PARAMS resolution
│   └── examples/
│       └── subcircuit_expander.rs     ← lexer, hierarchical flattener, ParamContext, MNA output
│
├── realtime-cosimulation-runtime/
    ├── SKILL.md                       ← solver thread, lock-step MCU sync, 60 FPS telemetry, hot mutation
    └── examples/
        └── runtime_orchestrator.rs    ← native thread loop, MPSC drain, binary telemetry, cancel flag
│
└── circuit-sim-ux/
    ├── SKILL.md                       ← 4-domain UX skill: canvas/wiring, sim feedback, inspector, selection
    ├── references/
    │   ├── canvas-wiring.md           ← snap-to-grid (GRID_STEP_PX=20), net model, ortho routing, pan/zoom
    │   ├── simulation-feedback.md     ← SimulationFrame contract, HSL voltage scale, current animation, ERC feedback
    │   ├── component-inspector.md     ← SPICE suffix parser (M-vs-Meg trap), real-time validation, batch edit
    │   └── selection-history-shortcuts.md  ← rubber-band select, Command pattern undo/redo, EDA keymap
    └── assets/components/
        ├── net-graph.ts               ← DSU union-find, PinRef/NetWireRef, rebuildFromScratch, getVoltageKey
        ├── wire-router.ts             ← orthogonal Manhattan routing, obstacle avoidance, Z-shape fallback
        ├── voltage-color-scale.ts     ← HSL hue map, colorForNet(netId, frame, range), auto-range from frame
        ├── current-flow-animation.tsx ← rAF particle system, speed ∝ |I|, direction from sign, threshold gate
        ├── spice-value-parser.ts      ← suffix table (T/G/Meg/k/m/u/n/p/f), M-vs-Meg guard, 18 self-tests
        ├── transient-stream.ts        ← sim-frame-update listener, dispose() lifecycle, currentForWire()
        ├── simulation-error.ts        ← Result<T,String> classifier, 4 error kinds, componentId extraction
        ├── command-history.ts         ← Command pattern, beginGroup/endGroup drag aggregation, batch move
        └── INTEGRATION-EXAMPLE.tsx   ← end-to-end: streaming → NetGraph → colorForNet → CurrentFlowAnimation
```

---

## What changed from v2.1

| Skill | Key additions |
|---|---|
| **circuit-sim-ux** | New skill. EDA-grade UX reference for schematic editors benchmarked against LTspice/KiCad/Multisim. 4 reference docs + 9 TypeScript/React implementation files. DSU `NetGraph` with `rebuildFromScratch` + `getVoltageKey` bridging TS net naming to Rust `HashMap<String,f64>` keys. `SimulationFrame` streaming via `sim-frame-update` Tauri event with `dispose()` lifecycle guard. `Result<T,String>` → structured error classifier with 4 kinds and component-id extraction. HSL voltage colour scale with `colorForNet()`, rAF current-flow particle animation, SPICE suffix parser with M-vs-Meg guard (18 self-tests), Command-pattern undo/redo with drag aggregation via `beginGroup`/`endGroup`. All 9 source files compile clean under `strict` mode against `@tauri-apps/api` v2 real types. |

---

## What changed from v2.0

| Skill | Key additions |
|---|---|
| **schematic-topology-routing** | New skill. Canvas ↔ logical graph separation, 4-step Manhattan pipeline (snap → L-shape → BFS → collapse), DSU with path compression + forced GND root, 4-rule ERC (floating pin, short circuit, no GND, island) |
| **spice-macromodeling-parser** | New skill. State-machine tokenizer for `.lib`/`.mod` files, recursive hierarchical subcircuit flattener, `ParamContext` with 3-layer inheritance (defaults → subckt → instance), `M` vs `Meg` trap documented |
| **realtime-cosimulation-runtime** | New skill. Native solver thread with `Arc<AtomicBool>` cancel, lock-step MCU sync algorithm, compact binary telemetry (10× smaller than JSON), safe hot-mutation via MPSC drain between integration steps |

---

## What changed from v1.0

| Skill | Key improvements |
|---|---|
| **canvas-vector-render** | Added zoom-to-pointer derivation, inertial pan, DPI handling, hit-testing, wire batcher, junction classifier |
| **electronic-simulation-physics** | Added MNA block matrix notation, full component stamp table, VCCS, AC complex formulation, TR/BE switching, LTE adaptive step, solvability conditions |
| **rust-math-performance** | Added `NrWorkspace` pre-allocation pattern, CSC sparse matrix, condition number estimator, Roofline model guidance, criterion benchmark stubs |
| **tauri-ipc-bridge** | Added `spawn_blocking` rationale, bounded MPSC with back-pressure, binary payload path, `CancellationToken`, `zod` validation layer, React hook |
| **premium-web-aesthetics** | Added three-tier token system, WCAG 2.2 contrast math, semantic easing table, `prefers-reduced-motion` block, focus rings, DPR canvas correction |

---

## How to use these skills

Each `SKILL.md` begins with a `description:` front-matter field. The agent reads the description to decide which skill to load before generating code or answering questions in that domain. Examples in `examples/` are design references only: do not copy them or treat them as an API contract before checking the current Astryd Sophia source, types, tests and `AGENTS.md`.

---

## Language and runtime targets

| Layer | Language | Runtime |
|---|---|---|
| Simulation engine | Rust 1.78+ | Tokio async, rayon thread pool |
| Desktop bridge | Tauri v2 | WebView2 (Windows) / WebKit (macOS, Linux) |
| UI renderer | TypeScript 5.x | Vite + Vanilla TypeScript + Canvas 2D |
| Styling | CSS3 | Modern browsers (Chrome 120+, Safari 17+, Firefox 124+) |
