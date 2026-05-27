# Skill: Premium Web Aesthetics

## 1. Context and Objective
This skill equips the agent with high-end modern design capabilities. It focuses on creating state-of-the-art visual experiences, micro-animations, glassmorphism panels, and fluid responsive layouts using Vanilla CSS and HTML5 in a dark-mode paradigm.

---

## 2. Core Directives & Standards

### A. Dynamic Theme & Design Tokens
1. **Central Token System:** Define all design variables inside a central `:root` element in HSL format to allow easy color blending and opacity adjustments:
   ```css
   :root {
     --bg-primary: hsl(220, 15%, 8%);
     --border-glass: hsla(0, 0%, 100%, 0.08);
     --accent-neon: hsl(190, 100%, 50%);
   }
   ```
2. **Glassmorphism Panels:** Style windows and side panels with subtle backdrop blur filters and high elevations:
   ```css
   .glass-panel {
     background: rgba(15, 17, 23, 0.7);
     backdrop-filter: blur(16px) saturate(180%);
     border: 1px solid var(--border-glass);
   }
   ```

### B. GPU-Accelerated Micro-interactions
1. **GPU-Friendly Properties:** Limit transitions and animations to properties processed natively by the GPU (`opacity` and `transform`). Avoid animating `height`, `width`, or `margin` to prevent layout reflows.
2. **Interactive States:** Add smooth micro-animations to improve the tactile feedback of the app:
   - **Hover:** Settle scale adjustments (e.g., `transform: scale(1.02)`), neon glow drop-shadows.
   - **Active:** Squeeze compression effects (e.g., `transform: scale(0.96)`).
3. **Bezier Curves:** Utilize sleek cubic-bezier easing curves rather than linear transitions:
   ```css
   transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
   ```

### C. Zero Layout-Shift Grid Layouts
1. **CSS Grid / Flexbox Systems:** Use strict Grid layouts for structural sidebars and main viewports. Collapsing a sidebar must adjust the Grid fractions smoothly without causing erratic visual jumps.
2. **Aspect Ratio Preservation:** Maintain exact dimensions on instrument panels, dials, and osciloscopio screens.
