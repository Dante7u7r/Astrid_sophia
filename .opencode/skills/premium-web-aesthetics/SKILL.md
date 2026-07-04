---
name: premium-web-aesthetics
description: Use when styling UI with CSS, implementing glassmorphism, dark-mode design systems, micro-animations, responsive grid layouts, or accessible colour systems
---

# Skill: Premium Web Aesthetics
**Revision:** 2.0 — PhD-Grade Reference

---

## 1. Context and Objective

This skill equips the agent to produce state-of-the-art visual experiences: glassmorphism panels, GPU-accelerated micro-animations, fluid responsive layouts, and perceptually uniform colour systems, using Vanilla CSS/HTML5 in a dark-mode paradigm.

Canonical references:
> Zeldman, J. — *Designing with Web Standards*, 3rd ed.
> Reinhard, E. et al. — *Color Imaging: Fundamentals and Applications* (perceptual uniformity, CIELAB).
> Google Material Design 3 — *Tone and Color System*, https://m3.material.io/styles/color

---

## 2. Core Directives & Standards

---

### A. Design Token System

#### A.1 Token Hierarchy

Define tokens in three layers:

```css
:root {
  /* ── Tier 1: Primitive palette (HSL for easy blending) ── */
  --hue-primary:   220;
  --hue-accent:    190;
  --hue-danger:    4;

  /* ── Tier 2: Semantic roles ── */
  --bg-base:       hsl(var(--hue-primary), 15%, 8%);
  --bg-raised:     hsl(var(--hue-primary), 14%, 12%);
  --bg-overlay:    hsl(var(--hue-primary), 13%, 16%);

  --surface-glass: hsla(0, 0%, 100%, 0.04);
  --border-subtle: hsla(0, 0%, 100%, 0.07);
  --border-active: hsla(var(--hue-accent), 100%, 60%, 0.35);

  --text-primary:  hsl(0, 0%, 95%);
  --text-secondary:hsl(0, 0%, 60%);
  --text-disabled: hsl(0, 0%, 35%);

  --accent-neon:   hsl(var(--hue-accent), 100%, 55%);
  --accent-glow:   hsla(var(--hue-accent), 100%, 55%, 0.25);
  --danger:        hsl(var(--hue-danger),  80%, 55%);

  /* ── Tier 3: Component-scope overrides (set locally on components) ── */
  /* e.g., --panel-bg: var(--bg-raised); */
}
```

Rationale for HSL: human-readable, composable with `calc()` for tint/shade derivation, and trivially convertible to P3 wide-gamut via `color(display-p3 ...)` wrapper.

#### A.2 Perceptual Contrast Requirements (WCAG 2.2)

All text must meet minimum contrast ratios against its direct background:

| Text role | Minimum contrast |
|---|---|
| Body / label text | 4.5 : 1 (WCAG AA) |
| Large text (≥ 18 pt bold) | 3 : 1 |
| Interactive component boundary | 3 : 1 |
| Decorative / disabled text | No requirement |

Compute contrast with the relative luminance formula $L = 0.2126 R_{lin} + 0.7152 G_{lin} + 0.0722 B_{lin}$ where $R_{lin} = (R_{8bit}/255)^{2.2}$ (sRGB approximation). Ratio $= (L_{lighter} + 0.05)/(L_{darker} + 0.05)$.

---

### B. Glassmorphism — Implementation Rules

#### B.1 The Four Pillars

```css
.glass-panel {
  /* 1. Semi-transparent background — low alpha to show context */
  background: rgba(10, 13, 20, 0.60);

  /* 2. Backdrop blur — the defining property; GPU-composited on modern browsers */
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%); /* Safari */

  /* 3. Subtle border — catches specular light at the panel edge */
  border: 1px solid var(--border-subtle);

  /* 4. Elevation shadow — separates panel from background depth */
  box-shadow:
    0 1px 2px  hsla(0, 0%, 0%, 0.3),   /* contact shadow */
    0 4px 16px hsla(0, 0%, 0%, 0.25),  /* mid shadow */
    inset 0 1px 0 hsla(0, 0%, 100%, 0.06); /* top-edge specular */
}
```

#### B.2 Performance Constraints

- `backdrop-filter` triggers GPU compositing of a **new stacking context**. A page with more than ~8 simultaneous blurred panels will cause GPU memory pressure on mobile GPUs and high-power consumption on laptops.
- Never apply `backdrop-filter` to elements that scroll rapidly (e.g., list items).
- Use `will-change: transform` on the panel **only when it is actively animating** (add/remove the property in JS). Permanent `will-change` wastes GPU layers.

---

### C. GPU-Accelerated Micro-interactions

#### C.1 The Two Safe Properties

Only `opacity` and `transform` are **composited on the GPU** (off the main thread). All other properties (`height`, `width`, `margin`, `background-color`, `border-radius`) trigger layout reflow or paint on the CPU, causing jank.

**Approved interaction patterns:**

```css
/* Hover lift */
.card:hover {
  transform: translateY(-3px) scale(1.01);
  box-shadow: 0 8px 32px var(--accent-glow);
  opacity: 1;
}

/* Active press */
.btn:active {
  transform: scale(0.96);
  opacity: 0.85;
}
```

#### C.2 Easing Curves — Semantic Selection

| Interaction type | Recommended curve | CSS |
|---|---|---|
| Entering (elements appearing) | Decelerate (ease-out) | `cubic-bezier(0.0, 0.0, 0.2, 1)` (Material) |
| Leaving (elements disappearing) | Accelerate (ease-in) | `cubic-bezier(0.4, 0.0, 1.0, 1)` |
| Standard spatial movement | Standard | `cubic-bezier(0.4, 0.0, 0.2, 1)` |
| Spring-like feedback | Overshoot | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

Duration guidance: 100–200 ms for micro-interactions (hover, press); 250–400 ms for layout transitions (panel open/close).

#### C.3 Reduced Motion Accessibility

**Mandatory:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Never omit this block. Users with vestibular disorders can experience nausea or seizures from motion that ignores this preference.

---

### D. Layout System

#### D.1 Structural Grid

Use CSS Grid for the top-level application shell. Avoid `position: absolute` for layout — it breaks natural reflow and accessibility tree order.

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width, 260px) 1fr;
  grid-template-rows: var(--toolbar-height, 48px) 1fr;
  height: 100dvh; /* dvh accounts for mobile browser chrome */
  overflow: hidden;
}
```

Collapsing the sidebar: change `--sidebar-width` with a transition on `grid-template-columns`. **Do not** toggle `display: none` (causes a hard layout jump) or animate `width` directly (layout reflow).

```css
.app-shell {
  transition: grid-template-columns 300ms cubic-bezier(0.4, 0.0, 0.2, 1);
}
/* Collapsed state */
.app-shell.sidebar-collapsed {
  --sidebar-width: 0px;
}
```

#### D.2 Canvas/Oscilloscope Aspect Ratio

Instrument panels and oscilloscope viewports must maintain exact aspect ratios to prevent schematic distortion:

```css
.canvas-wrapper {
  aspect-ratio: 16 / 9; /* or 4 / 3, etc. */
  width: 100%;
  overflow: hidden;
}
.canvas-wrapper canvas {
  width: 100%;
  height: 100%;
}
```

Update the canvas `width` and `height` **attributes** (not CSS size) on `ResizeObserver` callback to match the actual pixel dimensions, accounting for `devicePixelRatio` (see canvas-vector-render §D).

#### D.3 Zero Layout Shift Principles

- Reserve space for async-loaded content with `min-height` or skeleton screens.
- Avoid inserting elements that shift sibling layout (use `position: fixed/absolute` for overlays).
- Font loading: use `font-display: optional` or preload the font file to prevent FOUT (Flash of Unstyled Text).

---

### E. Dark Mode Typography

#### E.1 Font Smoothing

```css
body {
  -webkit-font-smoothing: antialiased;  /* macOS */
  -moz-osx-font-smoothing: grayscale;  /* Firefox macOS */
  text-rendering: optimizeLegibility;
}
```

On dark backgrounds, sub-pixel rendering (the default) can make light text on dark appear blurry. `antialiased` switches to greyscale anti-aliasing, producing sharper strokes.

#### E.2 Line Length and Density

- Prose / label text: 45–75 characters per line (the Bringhurst measure).
- Dense UI panels (component property editors): 28–40 characters; tighter is acceptable.
- Never exceed 90 characters per line in any context; readability degrades rapidly.

---

### F. Failure Modes and Diagnostics

| Symptom | Root Cause | Remedy |
|---|---|---|
| Jank on hover | Animating `width`/`height`/`margin` | Switch to `transform: scale` |
| Blur panel causes frame drop | Too many simultaneous `backdrop-filter` | Limit to ≤ 8 blurred surfaces; flatten static panels |
| Sidebar collapse jumps | Animating `display` or `width` | Animate `grid-template-columns` instead |
| Text unreadable in dark mode | Insufficient contrast ratio | Verify with WCAG formula; target ≥ 4.5 : 1 |
| Motion sickness reports | Missing `prefers-reduced-motion` | Add the media query block to global CSS |
| FOUT on initial load | No font preload | `<link rel="preload" as="font">` in `<head>` |
| Canvas aspect ratio distortion | CSS size ≠ canvas attribute size | Use `ResizeObserver` + `devicePixelRatio` correction |
