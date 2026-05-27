# Skill: Canvas Vector Render

## 1. Context and Objective
This skill equips the agent with high-performance 2D rendering capabilities. It focuses on drawing vector-based electrical schematics, grid lines, and real-time interactive UI controls using HTML5 Canvas and TypeScript.

---

## 2. Core Directives & Standards

### A. Camera Viewport Matrix Math
1. **Transform Context:** Use a centralized coordinate transformation model. Apply translation and scaling matrices dynamically to render the coordinate system:
   ```typescript
   ctx.setTransform(zoom, 0, 0, zoom, offsetX, offsetY);
   ```
2. **Coordinate Space Conversion:**
   - **Screen to World:** Converts physical screen pixels to logical world grid coordinates:
     $$X_{world} = \frac{X_{screen} - offset_X}{zoom}$$
     $$Y_{world} = \frac{Y_{screen} - offset_Y}{zoom}$$
   - **World to Screen:** Projects logical coordinates back to physical screen space:
     $$X_{screen} = X_{world} \cdot zoom + offset_X$$
     $$Y_{screen} = Y_{world} \cdot zoom + offset_Y$$

### B. Render Loop Optimization
1. **Viewport Frustum Culling:** Before drawing any component or wire segment, calculate its bounding box and test for overlap with the visible screen area:
   ```typescript
   const viewMinX = -offsetX / zoom;
   const viewMaxX = (canvas.width - offsetX) / zoom;
   ```
   Do not call stroke, fill, or path operations on elements completely outside these boundaries.
2. **Path Batches:** Minimize context changes by grouping draw calls of the same style (e.g., draw all grid dots in a single batch path, draw all copper wires in a single path before stroke).
3. **Grid Snapping:** Component anchor pins and cable junctions must be snapped to a logical 20px grid:
   $$\text{snapped} = \text{Math.round}\left(\frac{\text{coord}}{20}\right) \cdot 20$$

### C. Wiring & Routing Algorithms
1. **Orthogonal Routing:** Wire runs must only follow horizontal and vertical lines. Implement Manhattan routing paths between nodes:
   - Path step on X axis first, then Y axis, or vice versa, avoiding diagonal steps.
2. **Junction Detection:** Calculate wire-to-wire intersections. If a T-junction or X-intersection is detected, render a connection dot ($\emptyset = 4\text{px}$) only when the lines are electrically connected.
