---
name: tauri-ipc-bridge
description: Use when working with Tauri IPC, TypeScript-Rust communication, event streaming, command serialization, or cancellable simulation tasks
---

# Skill: Tauri IPC Bridge
**Revision:** 2.0 — PhD-Grade Reference

---

## 1. Context and Objective

This skill equips the agent with high-performance communication patterns for hybrid desktop applications built on Tauri v2. It covers the design of the TypeScript ↔ Rust boundary: serialisation contracts, asynchronous command dispatch, real-time event streaming, back-pressure, and graceful task cancellation.

Canonical references:
> Tauri v2 Core API documentation — https://v2.tauri.app/reference/
> `serde` crate documentation — https://serde.rs/
> RFC 8259 — *The JavaScript Object Notation (JSON) Data Interchange Format*

---

## 2. Core Directives & Standards

---

### A. Serialisation Contract (TypeScript ↔ Rust)

#### A.1 Naming Convention Mapping

TypeScript uses `camelCase`; Rust uses `snake_case`. Bridge all structs with `serde`'s rename attribute to avoid manual translation:

```rust
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationRequest {
    pub num_nodes:         usize,
    pub components:        Vec<ComponentDto>,
    pub stop_time:         f64,
    pub max_step:          f64,
    pub initial_conditions: Option<Vec<f64>>,
}
```

The matching TypeScript interface **must** be kept in sync and treated as a **single source of truth**. Use `zod` schemas to validate at runtime on the frontend before invoking any Tauri command.

#### A.2 Payload Flatness and Size

- Avoid deeply nested structures. Each level of nesting adds JSON parser overhead and key redundancy.
- For large arrays of node voltages at each transient time step, do **not** embed them as nested JSON objects. Flatten them as a typed `Vec<f64>` and annotate with `#[serde(skip_serializing_if = "Vec::is_empty")]` for optional fields.
- Benchmark the serialisation cost of your largest expected payload (e.g., a 1 000-node netlist, 10 000-step transient). Serde JSON throughput is typically 300–600 MB/s; a 1 MB payload costs ~2–3 ms.

#### A.3 Binary Payloads for High-Throughput Streaming

For transient waveform data (e.g., 60 FPS × 4 bytes/sample × 100 nodes = 24 KB/frame), prefer raw binary payloads over JSON:

- In Rust: emit `Vec<u8>` via `window.emit(...)` using `bytemuck::cast_slice`.
- In TypeScript: receive as `ArrayBuffer`, parse with `Float32Array` or `Float64Array` views.

This eliminates JSON tokenisation cost entirely (~10× throughput improvement for dense numerical data).

---

### B. Tauri Commands — Async Patterns

#### B.1 Command Registration

Every command that may block for more than 1 ms **must** be `async`:

```rust
#[tauri::command]
pub async fn run_dc_analysis(
    request: SimulationRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DcResult, String> {
    // Spawn the solver on a Tokio blocking thread to avoid starving the async runtime
    tokio::task::spawn_blocking(move || {
        solve_dc_circuit(&request)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

> **Tokio runtime note:** Tauri v2 uses Tokio under the hood. CPU-bound work must be dispatched via `spawn_blocking` — not `.await` directly — to avoid blocking the Tokio thread pool and starving I/O tasks.

#### B.2 State Management

Shared mutable state (e.g., a running simulation handle) must use `Mutex` or `RwLock` behind `tauri::State`:

```rust
pub struct AppState {
    pub sim_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
```

Never use `Arc<Mutex<T>>` globally — Tauri's `State` provides the `Arc` wrapper automatically and ensures it is initialised before any command runs.

#### B.3 Input Validation Before Solver Dispatch

Validate every incoming command payload on the Rust side before spawning a solver. A corrupt payload reaching the MNA kernel will cause a panic (index out of bounds):

```rust
fn validate_request(req: &SimulationRequest) -> Result<(), String> {
    if req.num_nodes == 0 {
        return Err("num_nodes must be ≥ 1".into());
    }
    if req.stop_time <= 0.0 || req.stop_time.is_nan() {
        return Err("stop_time must be a positive finite number".into());
    }
    for (i, comp) in req.components.iter().enumerate() {
        comp.validate().map_err(|e| format!("Component[{i}]: {e}"))?;
    }
    Ok(())
}
```

Return structured `Result<T, String>` (not `panic!`). Tauri serialises the `Err` variant and delivers it to the TypeScript `.catch()` handler.

---

### C. Real-Time Event Streaming

#### C.1 Stream Architecture

For Transient simulation, use a producer/consumer model:

```
Rust solver thread  →  [channel: mpsc]  →  Rust emitter task  →  [Tauri event]  →  TypeScript listener
```

Decouple solver speed from emission rate:

```rust
// Solver produces at its own rate
let (tx, mut rx) = tokio::sync::mpsc::channel::<TransientFrame>(256);

// Emitter consumes and emits at 60 FPS (throttled)
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_millis(16)); // ~60 FPS
    loop {
        interval.tick().await;
        // Drain all pending frames; emit only the latest
        let mut latest = None;
        while let Ok(frame) = rx.try_recv() { latest = Some(frame); }
        if let Some(frame) = latest {
            window.emit("sim-transient-frame", frame).unwrap();
        }
    }
});
```

The channel capacity of 256 acts as a bounded buffer. If the solver produces faster than the UI consumes, the `tx.send(...)` call back-pressures the solver (blocks until space is available), preventing unbounded memory growth.

#### C.2 TypeScript Listener Registration

```typescript
import { listen } from "@tauri-apps/api/event";

const unlisten = await listen<TransientFrame>("sim-transient-frame", (event) => {
    updateWaveformChart(event.payload);
});

// IMPORTANT: Call unlisten() when the component unmounts to prevent listener leaks
onDestroy(() => unlisten());
```

#### C.3 Event Naming Convention

Use `kebab-case` with a namespace prefix: `sim-dc-result`, `sim-transient-frame`, `sim-error`, `sim-progress`. Avoid generic names like `"update"` that collide across features.

---

### D. Cancellation Protocol

#### D.1 Cancellation Token

Use a `CancellationToken` (from the `tokio-util` crate) to signal a running simulation to stop:

```rust
use tokio_util::sync::CancellationToken;

// Stored in AppState
pub struct AppState {
    pub cancel_token: Mutex<CancellationToken>,
}

#[tauri::command]
pub async fn stop_simulation(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let token = state.cancel_token.lock().await;
    token.cancel(); // Signal all tasks watching this token
    Ok(())
}
```

Inside the solver loop:

```rust
loop {
    if cancel_token.is_cancelled() { break; }
    // ... integrate one time step ...
}
```

#### D.2 Cancellation Guarantees

- The solver must check the token **at least once per time step** (not per NR iteration) to avoid multi-second hangs on stiff circuits.
- After cancellation, emit a final `"sim-cancelled"` event so the TypeScript layer can reset the UI.
- Discard the old `CancellationToken` and create a new one before the next `run_*` command. Do not reuse cancelled tokens.

---

### E. Type-Safety Contract Checklist

Before shipping a new command:

| Check | Description |
|---|---|
| TS interface mirrors Rust struct | Every field name, type, and nullability matches |
| `zod` validation on TS side | Runtime parse before `invoke()` |
| `validate_request` on Rust side | Reject malformed payloads before solver |
| `Result<T, String>` return type | No panics escape to Tauri runtime |
| `unlisten()` called on teardown | No ghost listeners accumulating in frontend |
| Cancellation token reset before new run | No stale cancel state from previous run |

---

### F. Failure Modes and Diagnostics

| Symptom | Root Cause | Remedy |
|---|---|---|
| UI freezes during simulation | Blocking work on async thread | Use `spawn_blocking` for CPU-bound solvers |
| Memory grows without bound | Unbounded MPSC channel | Cap channel with `mpsc::channel(N)` |
| Ghost events after component unmount | Missing `unlisten()` | Always call `unlisten` in `onDestroy` / cleanup |
| Panic reaching Tauri runtime | `unwrap()` on bad input | Validate all fields; return `Err(String)` |
| Stale cancel state | Reusing a cancelled token | Create fresh `CancellationToken` per run |
| JSON parse error in TypeScript | TS/Rust struct mismatch | Enforce via `zod` + integration test |
