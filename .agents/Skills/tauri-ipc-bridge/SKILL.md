# Skill: Tauri IPC Bridge

## 1. Context and Objective
This skill equips the agent with high-performance communication capabilities in hybrid desktop architectures. It focuses on bridging the TypeScript GUI renderer thread with the Rust simulation engine via low-latency Inter-Process Communication (IPC).

---

## 2. Core Directives & Standards

### A. Compact Data Serialization
1. **Contiguous Layouts:** Flatten the JSON data payloads exchanged between frontend and backend. Avoid deeply nested structures that slow down serialization.
2. **Serde Configurations:** Use automatic casing mapping on Rust structures to bridge TypeScript (camelCase) with Rust (snake_case) effortlessly:
   ```rust
   #[derive(Serialize, Deserialize)]
   #[serde(rename_all = "camelCase")]
   pub struct Component { ... }
   ```
3. **Data Pre-allocations:** In high-speed data transfers, pre-allocate hash maps and vectors based on netlist sizes before serializing them back to the frontend.

### B. Asynchronous Execution & Non-blocking Loops
1. **Background Tasks:** Run all heavy numerical equations in asynchronous Rust threads. Never block the main Tauri process thread.
2. **Event Streaming:** For real-time simulation updates (such as Transient waves), do not rely on standard poll queries (request-response). Instead, leverage Tauri's event emission interface to stream data packets directly to the renderer at 60 FPS:
   ```rust
   // In Rust: emit simulation voltages step-by-step
   window.emit("sim-update-frame", voltage_data).unwrap();
   ```
3. **Task Cancellation:** Provide safe endpoints to abort or terminate running simulation loops on the backend immediately when the user clicks the "Stop" button in the GUI.

### C. Type-safe Synchronizations
1. **Matching Interfaces:** Ensure that TypeScript interfaces and Rust structs have identical properties, data types, and nullability flags.
2. **Robust Validation:** Validate incoming JSON objects in Rust before spawning MNA Solvers to prevent panic-inducing crashes due to corrupt payloads.
