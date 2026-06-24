# Astryd Sophia Skills — v2.0
**PhD-Grade Reference Package**

Five domain-specific skill definitions and reference implementations for the Astryd Sophia electronic simulation desktop application (Tauri + TypeScript + Rust).

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
└── premium-web-aesthetics/
    ├── SKILL.md                       ← tokens, glassmorphism, GPU animation, WCAG
    └── examples/
        ├── design_system.css          ← full CSS design token system + components
        └── ui_demo.html               ← live component gallery (open in browser)
```

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

Each `SKILL.md` begins with a `description:` front-matter field. The agent reads the description to decide which skill to load before generating code or answering questions in that domain. The examples in `examples/` serve as authoritative reference implementations — copy and adapt them rather than starting from scratch.

---

## Language and runtime targets

| Layer | Language | Runtime |
|---|---|---|
| Simulation engine | Rust 1.78+ | Tokio async, rayon thread pool |
| Desktop bridge | Tauri v2 | WebView2 (Windows) / WebKit (macOS, Linux) |
| UI renderer | TypeScript 5.x | Vite + React 18 (or Svelte) |
| Styling | CSS3 | Modern browsers (Chrome 120+, Safari 17+, Firefox 124+) |
