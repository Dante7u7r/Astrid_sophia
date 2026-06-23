---
name: canvas-vector-render
description: Use when working with Canvas 2D rendering, vector graphics, viewport transforms, hit-testing, or interactive grid-based UI schematics
---

# Skill: Canvas Vector Render
**Revision:** 2.0 — PhD-Grade Reference

---

## 1. Context and Objective

This skill equips the agent with high-performance 2D rendering capabilities for vector-based electrical schematics, grid overlays, and real-time interactive UI controls using the HTML5 Canvas API and TypeScript.

The canonical reference for the coordinate algebra used here is:
> Foley, van Dam, Feiner & Hughes — *Computer Graphics: Principles and Practice*, 3rd ed., §5 (Affine Transformations).

---

## 2. Core Directives & Standards

---

### A. Camera Viewport — Affine Transform Model

#### A.1 The Viewport Transform

The viewport is defined by a 2D affine transform parameterised by a scalar zoom $s$ and a translation vector $\mathbf{t} = (t_x, t_y)$.

The **World-to-Screen** (W→S) projection is:

$$\mathbf{p}_{screen} = s \cdot \mathbf{p}_{world} + \mathbf{t}$$

i.e. $X_s = s \cdot X_w + t_x$ and $Y_s = s \cdot Y_w + t_y$.

The **Screen-to-World** (S→W) inverse is:

$$\mathbf{p}_{world} = \frac{\mathbf{p}_{screen} - \mathbf{t}}{s}$$

Apply to the Canvas 2D context exactly once per frame, after clearing, before issuing any world-space draw calls:

```typescript
ctx.setTransform(s, 0, 0, s, t_x, t_y);
```

> **Critical invariant:** `setTransform` overwrites the entire CTM (Current Transform Matrix). Never compose with `ctx.scale` / `ctx.translate` inside the main render loop — floating-point accumulation will cause drift over time.

#### A.2 Zoom-to-Pointer (Fixed-Point Zoom)

When the user scrolls over screen point $\mathbf{q}_s$, the world point $\mathbf{q}_w = (\mathbf{q}_s - \mathbf{t}) / s$ must remain fixed after the zoom is applied. Given a zoom ratio $\delta$ (e.g. 1.1 for +10 %), the new parameters are:

$$s' = \text{clamp}(s \cdot \delta,\ s_{min},\ s_{max})$$
$$\mathbf{t}' = \mathbf{q}_s - s' \cdot \mathbf{q}_w$$

This is the only mathematically correct derivation; do not use alternative ad-hoc formulations.

#### A.3 Smooth Inertial Panning (optional)

Apply exponential decay to pan velocity each frame:

$$\mathbf{v}_{n+1} = \mathbf{v}_n \cdot (1 - \lambda \Delta t)$$

where $\lambda \approx 8$ gives a physically plausible deceleration. Terminate the animation loop when $\|\mathbf{v}\|_2 < 0.5 \text{ px/s}$.

---

### B. Render-Loop Optimisation

#### B.1 Viewport Frustum Culling

Before issuing **any** draw call for a schematic object, compute its AABB (Axis-Aligned Bounding Box) in world space and test overlap against the visible world-space rectangle:

$$[X_{w,min},\ X_{w,max}] = \left[\frac{-t_x}{s},\ \frac{W_{canvas} - t_x}{s}\right]$$

$$[Y_{w,min},\ Y_{w,max}] = \left[\frac{-t_y}{s},\ \frac{H_{canvas} - t_y}{s}\right]$$

Rejection criterion (skip draw): the AABB does **not** overlap this rectangle on either axis.

Complexity: $O(1)$ per object. Reduces GPU overdraw proportionally to the fraction of schematic outside the viewport.

#### B.2 Draw-Call Batching

Group all objects sharing the same `strokeStyle` / `fillStyle` / `lineWidth` into a single path:

```typescript
ctx.beginPath();
for (const wire of visibleWires) {
    ctx.moveTo(wire.x1, wire.y1);
    ctx.lineTo(wire.x2, wire.y2);
}
ctx.stroke(); // Single GPU flush
```

Changing stroke/fill state mid-path forces a GPU state flush. Minimise state changes; sort render layers by style bucket.

#### B.3 Grid Rendering — Dot Raster

The world-space grid pitch is $g = 20\ \text{px}$ (logical). The visible grid dots span:

$$x \in \left\{ g \cdot k \mid k \in \mathbb{Z},\ X_{w,min} \le g \cdot k \le X_{w,max} \right\}$$

For each such $(x, y)$, project to screen space and draw a filled arc of radius $r = 1.5s$ (so dots maintain constant *visual* size as the user zooms). Skip the dot raster entirely when $s < 0.4$ to avoid over-density. Use a single `beginPath` / `fill` call for all dots.

#### B.4 Grid Snapping

All placement and routing operations must snap to the $g = 20\ \text{px}$ grid **in world space** before any W→S projection:

$$\text{snap}(c) = \left\lfloor \frac{c}{g} + 0.5 \right\rfloor \cdot g$$

(`Math.round(c / g) * g` in JavaScript.) Snap is applied to world coordinates, never to screen coordinates.

---

### C. Wiring & Routing

#### C.1 Orthogonal (Manhattan) Routing

Wire segments are restricted to the rectilinear plane. An L-shaped route between world points $A$ and $B$ uses exactly one bend:

- **H-first:** $A \to (B_x, A_y) \to B$
- **V-first:** $A \to (A_x, B_y) \to B$

For interactive routing, infer the preferred mode from cursor quadrant relative to the source pin. Route endpoints are always snapped per §B.4.

#### C.2 Junction Detection

Given two wire segments, compute all intersection points in world space using standard segment-intersection algebra (parametric $t \in [0,1]$ test). Classify each intersection:

| Topology | Render |
|---|---|
| T-junction (one endpoint on interior of other) | Filled dot, $\emptyset = 4\ \text{px}$ world |
| X-crossing (both interiors) | **Render only if** the two nets are electrically connected; else render a hop arc |
| Endpoint-to-endpoint | No dot (implicit connection) |

The dot radius of $4\ \text{px}$ world renders as $4s\ \text{px}$ screen — visually stable across zoom levels.

#### C.3 Hit-Testing (Inverse Projection)

To determine which schematic object is under the mouse pointer $\mathbf{q}_s$:
1. Convert to world: $\mathbf{q}_w = (\mathbf{q}_s - \mathbf{t}) / s$.
2. For wires, compute the point-to-segment distance in world space; threshold $= 5\ \text{px}$ world.
3. For component bodies, test $\mathbf{q}_w$ against the component AABB.
4. Sort hits by depth (Z-layer); return the topmost.

Never hit-test in screen space — the threshold would be zoom-dependent.

---

### D. DPI / HiDPI Handling

```typescript
const dpr = window.devicePixelRatio ?? 1;
canvas.width  = canvas.clientWidth  * dpr;
canvas.height = canvas.clientHeight * dpr;
ctx.scale(dpr, dpr); // Scale once, before setTransform
```

All offset and size computations inside the orchestrator operate in CSS pixels. Apply the DPR scale factor before `setTransform`; the viewport math above remains unchanged.

---

### E. Failure Modes to Avoid

| Anti-pattern | Consequence |
|---|---|
| Accumulating `ctx.translate` / `ctx.scale` in loop | CTM drift → misaligned renders after hundreds of frames |
| Hit-testing in screen space | Threshold changes with zoom; inconsistent UX |
| Snapping after W→S projection | Sub-pixel grid misalignment at high zoom |
| Drawing dots outside viewport | Quadratic slowdown on large schematics |
| Calling `ctx.stroke()` inside the dot-grid loop | One GPU flush per dot — catastrophic on large grids |
