// tauri_bindings.ts — Reference Implementation v2.0
// Skill: tauri-ipc-bridge
// Covers: zod schema validation, typed invoke wrappers, event listener lifecycle,
//         binary ArrayBuffer decode, cancellation via stop_simulation.

import { invoke }   from "@tauri-apps/api/core";
import { listen }   from "@tauri-apps/api/event";
import { z }        from "zod";

// ─────────────────────────────────────────────────────────────
// Zod schemas — single source of truth for frontend types
// ─────────────────────────────────────────────────────────────

const ComponentDtoSchema = z.object({
    id:      z.string().min(1),
    kind:    z.enum(["R", "C", "L", "V", "I", "D"]),
    nodeA:   z.number().int().nonnegative(),
    nodeB:   z.number().int().nonnegative(),
    value:   z.number().finite(),
    nodePos: z.number().int().nonnegative().optional(),
    nodeNeg: z.number().int().nonnegative().optional(),
});

const SimulationRequestSchema = z.object({
    numNodes:          z.number().int().positive(),
    components:        z.array(ComponentDtoSchema),
    stopTime:          z.number().positive().finite(),
    maxStep:           z.number().positive().finite(),
    tol:               z.number().positive().finite(),
    initialConditions: z.array(z.number().finite()).optional(),
});

const AcSweepRequestSchema = z.object({
    numNodes:          z.number().int().positive(),
    components:        z.array(ComponentDtoSchema),
    freqStart:         z.number().positive().finite(),
    freqStop:          z.number().positive().finite(),
    pointsPerDecade:   z.number().int().positive(),
    outNode:           z.number().int().nonnegative(),
    inSourceId:        z.string().min(1),
});

// Inferred TypeScript types from the schemas
export type ComponentDto      = z.infer<typeof ComponentDtoSchema>;
export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;
export type AcSweepRequest    = z.infer<typeof AcSweepRequestSchema>;

// Response types (mirroring Rust structs)
export interface DcResultDto {
    nodeVoltages:   number[];
    sourcCurrents:  Record<string, number>;
    solveTimeMs:    number;
}

export interface TransientFrameDto {
    time:          number;
    nodeVoltages:  number[];
    step:          number;
}

export interface AcPointDto {
    frequency:  number;
    magnitude:  number;
    phaseDeg:   number;
}

// ─────────────────────────────────────────────────────────────
// Typed invoke wrappers
// ─────────────────────────────────────────────────────────────

/**
 * Run a DC operating-point analysis.
 * Validates the request with Zod before sending to Rust.
 * Returns the node voltages and source currents on success.
 */
export async function runDcAnalysis(raw: unknown): Promise<DcResultDto> {
    const request = SimulationRequestSchema.parse(raw); // throws ZodError on bad input
    return invoke<DcResultDto>("run_dc_analysis", { request });
}

/**
 * Start a transient analysis. Frames arrive via the returned observable.
 *
 * @param raw         Raw (unvalidated) SimulationRequest object
 * @param onFrame     Callback invoked for each 60-FPS transient frame
 * @param onFinished  Called when the simulation completes normally
 * @param onCancelled Called when the simulation is cancelled by the user
 * @returns           Async cleanup function — call on component unmount
 */
export async function startTransientAnalysis(
    raw:         unknown,
    onFrame:     (frame: TransientFrameDto) => void,
    onFinished:  () => void,
    onCancelled: () => void,
): Promise<() => void> {
    const request = SimulationRequestSchema.parse(raw);

    // Register event listeners BEFORE invoking the command to avoid race conditions
    const unlistenFrame     = await listen<TransientFrameDto>("sim-transient-frame", (e) => onFrame(e.payload));
    const unlistenFinished  = await listen<void>("sim-finished",   () => { cleanup(); onFinished();  });
    const unlistenCancelled = await listen<void>("sim-cancelled",  () => { cleanup(); onCancelled(); });

    function cleanup() {
        unlistenFrame();
        unlistenFinished();
        unlistenCancelled();
    }

    // Start the simulation (returns immediately; frames stream via events)
    await invoke("run_transient_analysis", { request });

    // Return a teardown function for the caller (e.g., useEffect cleanup)
    return cleanup;
}

/**
 * Stop the currently running simulation.
 */
export async function stopSimulation(): Promise<void> {
    return invoke("stop_simulation");
}

/**
 * Run an AC frequency sweep (blocking; returns all points at once).
 * For large sweeps (> 1 000 points), consider adding a streaming variant.
 */
export async function runAcSweep(raw: unknown): Promise<AcPointDto[]> {
    const request = AcSweepRequestSchema.parse(raw);
    return invoke<AcPointDto[]>("run_ac_sweep", { request });
}

// ─────────────────────────────────────────────────────────────
// Binary payload decoder (for high-throughput f32 streams)
// ─────────────────────────────────────────────────────────────

/**
 * Decode a raw ArrayBuffer of packed IEEE-754 float32 values
 * into a JavaScript number array.
 * Used when Rust emits binary voltage data instead of JSON.
 *
 * TypeScript usage:
 *   const unlisten = await listen<ArrayBuffer>("sim-transient-raw", (e) => {
 *       const voltages = decodeF32Payload(e.payload);
 *       updateChart(voltages);
 *   });
 */
export function decodeF32Payload(buffer: ArrayBuffer): number[] {
    const view = new Float32Array(buffer);
    return Array.from(view); // convert to plain number[] for React state etc.
}

// ─────────────────────────────────────────────────────────────
// React hook example
// ─────────────────────────────────────────────────────────────

/*
import { useEffect, useRef, useState, useCallback } from "react";
import { startTransientAnalysis, stopSimulation, TransientFrameDto } from "./tauri_bindings";

export function useTransientSim(request: unknown) {
    const [frames,   setFrames]   = useState<TransientFrameDto[]>([]);
    const [running,  setRunning]  = useState(false);
    const [error,    setError]    = useState<string | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    const start = useCallback(async () => {
        setFrames([]);
        setError(null);
        setRunning(true);
        try {
            cleanupRef.current = await startTransientAnalysis(
                request,
                (frame) => setFrames(prev => [...prev, frame]),
                ()      => setRunning(false),
                ()      => setRunning(false),
            );
        } catch (e) {
            setError(String(e));
            setRunning(false);
        }
    }, [request]);

    const stop = useCallback(async () => {
        await stopSimulation();
    }, []);

    // Always clean up listeners on unmount
    useEffect(() => () => { cleanupRef.current?.(); }, []);

    return { frames, running, error, start, stop };
}
*/

// ─────────────────────────────────────────────────────────────
// Type-safety contract checklist (from SKILL.md §E)
// ─────────────────────────────────────────────────────────────
//
//  ✅ TS interfaces mirror Rust structs (camelCase ↔ snake_case via serde)
//  ✅ Zod validates all request payloads before invoke()
//  ✅ Rust validate_sim_request() guards the solver entry point
//  ✅ All commands return Result<T, String> — no panics reach Tauri
//  ✅ unlisten() called via cleanup() on component unmount
//  ✅ CancellationToken reset in Rust before each new run
