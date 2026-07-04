---
name: electronic-simulation-physics
description: Use when solving circuit equations, MNA formulation, Newton-Raphson, transient integration, AC analysis, or any SPICE-level simulation math
---

# Skill: Electronic Simulation Physics
**Revision:** 2.0 — PhD-Grade Reference

---

## 1. Context and Objective

This skill equips the agent to formulate and solve the mathematical systems governing electrical networks under DC, AC (small-signal), and Transient conditions.

Canonical references:
> Nagel, L.W. — *SPICE2: A Computer Program to Simulate Semiconductor Circuits*, UCB/ERL M520, 1975.
> Vlach, J. & Singhal, K. — *Computer Methods for Circuit Analysis and Design*, 2nd ed., Chapters 3–6.
> Hairer, E. & Wanner, G. — *Solving Ordinary Differential Equations II: Stiff Problems*, §IV.

---

## 2. Core Directives & Standards

---

### A. Modified Nodal Analysis (MNA) — Formal Derivation

#### A.1 System Formulation

Apply KCL at each non-reference node and KVL for each independent voltage source branch. The result is a linear system:

$$\mathbf{A}\,\mathbf{x} = \mathbf{z}$$

with:

$$\mathbf{A} = \begin{pmatrix} \mathbf{G} & \mathbf{B} \\ \mathbf{C} & \mathbf{D} \end{pmatrix}, \quad
\mathbf{x} = \begin{pmatrix} \mathbf{v} \\ \mathbf{j} \end{pmatrix}, \quad
\mathbf{z} = \begin{pmatrix} \mathbf{i} \\ \mathbf{e} \end{pmatrix}$$

where:
- $\mathbf{G} \in \mathbb{R}^{N \times N}$: nodal conductance sub-matrix.
- $\mathbf{B} \in \mathbb{R}^{N \times M}$, $\mathbf{C} \in \mathbb{R}^{M \times N}$: voltage-source incidence matrices ($\mathbf{C} = \mathbf{B}^T$ for independent sources).
- $\mathbf{D} = \mathbf{0}$ for independent voltage sources.
- $\mathbf{v} \in \mathbb{R}^N$: unknown node voltages (node 0 = GND, excluded).
- $\mathbf{j} \in \mathbb{R}^M$: unknown branch currents through voltage sources.
- $\mathbf{i} \in \mathbb{R}^N$: nodal current injections from independent current sources.
- $\mathbf{e} \in \mathbb{R}^M$: voltage source values.

Total system size: $(N + M) \times (N + M)$.

#### A.2 Component Stamps — Complete Catalogue

| Component | Nodes | Action on $\mathbf{A}$ | Action on $\mathbf{z}$ |
|---|---|---|---|
| Resistor $R$ | $a$, $b$ | $\mathbf{G}_{aa} \mathrel{+}= G$; $\mathbf{G}_{bb} \mathrel{+}= G$; $\mathbf{G}_{ab} \mathrel{-}= G$; $\mathbf{G}_{ba} \mathrel{-}= G$ | — |
| Conductance $G$ | $a$, $b$ | same as resistor with $G$ | — |
| Ind. Current Source $I_s$ ($a \to b$) | $a$, $b$ | — | $\mathbf{i}_a \mathrel{-}= I_s$; $\mathbf{i}_b \mathrel{+}= I_s$ |
| Ind. Voltage Source $V_s$ (branch $k$) | $p$, $n$ | $\mathbf{B}_{p,k} \mathrel{+}= 1$; $\mathbf{B}_{n,k} \mathrel{-}= 1$; $\mathbf{C}_{k,p} \mathrel{+}= 1$; $\mathbf{C}_{k,n} \mathrel{-}= 1$ | $\mathbf{e}_k = V_s$ |
| VCCS $g_m V_{ctrl}$ ($p \to n$, ctrl: $c^+$, $c^-$) | — | $\mathbf{G}_{p,c^+} \mathrel{+}= g_m$; $\mathbf{G}_{n,c^+} \mathrel{-}= g_m$; $\mathbf{G}_{p,c^-} \mathrel{-}= g_m$; $\mathbf{G}_{n,c^-} \mathrel{+}= g_m$ | — |

*All row/column indices are 0-based after excluding node 0 (GND). Ground connections contribute no stamp.*

#### A.3 Solvability Conditions

$\mathbf{A}$ is singular (non-invertible) if and only if:
- A **floating node** exists (a node connected only to capacitors or no components).
- A **voltage source loop** exists (two or more voltage sources forming a closed loop with no series impedance).
- An **all-inductor cut-set** exists (a set of inductors whose removal disconnects the graph).

Detect these before attempting LU decomposition. Report the exact offending node/branch rather than a generic "singular matrix" error.

---

### B. Newton-Raphson for Non-linear Devices

#### B.1 Companion Model Linearisation

For a non-linear two-terminal element with $I = f(V)$ at operating point $V^{(k)}$:

$$G_{eq}^{(k)} = \left.\frac{df}{dV}\right|_{V^{(k)}}$$
$$I_{eq}^{(k)} = f\!\left(V^{(k)}\right) - G_{eq}^{(k)} \cdot V^{(k)}$$

Stamp $G_{eq}$ as a conductance and $I_{eq}$ as a parallel current source. The **(+ terminal → – terminal)** orientation of $I_{eq}$ follows the passive sign convention.

#### B.2 Diode Model (Shockley)

$$I_D(V_D) = I_S \left(\exp\!\left(\frac{V_D}{n V_T}\right) - 1\right), \quad V_T = \frac{kT}{q} \approx 25.85\ \text{mV at 300 K}$$

$$G_{eq} = \frac{I_S}{n V_T} \exp\!\left(\frac{V_D^{(k)}}{n V_T}\right) \approx \frac{I_D^{(k)} + I_S}{n V_T}$$

#### B.3 Junction Voltage Limiting (SPICE `pnjlim`)

To prevent exponential blow-up of diode currents during early NR iterations, limit the proposed voltage update:

$$V_D^{new} = \begin{cases}
V_D^{(k)} + n V_T \ln\!\left(\frac{V_D^{new,unclamped} - V_D^{(k)}}{n V_T} + 1\right) & \text{if } V_D^{new,unclamped} > V_D^{(k)} + n V_T \\
V_{max} & \text{if } V_D^{new,unclamped} > V_{max} \approx 1\ \text{V, first iter}
\end{cases}$$

This is **mandatory** for forward-biased PN junctions. Omitting it causes NaN propagation and solver divergence.

#### B.4 Convergence Criteria (SPICE-compatible)

Iteration terminates when, for **all** $x_i \in \mathbf{x}$:

$$\left|x_i^{(k+1)} - x_i^{(k)}\right| < \epsilon_{abs} + \epsilon_{rel} \cdot \left|x_i^{(k+1)}\right|$$

SPICE defaults: $\epsilon_{abs}^{(V)} = 1\ \mu\text{V}$, $\epsilon_{abs}^{(I)} = 1\ \text{pA}$, $\epsilon_{rel} = 10^{-3}$.

Maximum iterations: $N_{max} = 150$. If not converged, reduce voltage source magnitudes (source stepping) or initial conditions and restart.

---

### C. AC Small-Signal Analysis

For an AC source at angular frequency $\omega$, replace reactive elements with their complex admittances:

$$Y_C = j\omega C, \qquad Y_L = \frac{1}{j\omega L}$$

The MNA system becomes complex-valued:

$$\mathbf{A}(\omega)\,\mathbf{x}(\omega) = \mathbf{z}(\omega)$$

Solve with complex LU decomposition. The frequency response (Bode magnitude/phase) is:

$$|H(j\omega)| = \left|\frac{V_{out}(\omega)}{V_{in}(\omega)}\right|, \qquad \angle H(j\omega) = \arg\!\left(\frac{V_{out}(\omega)}{V_{in}(\omega)}\right)$$

Sweep across a logarithmic frequency grid (e.g., $10^1$ to $10^9$ Hz with $N_{pts} = 100$ per decade).

---

### D. Transient Integration — Numerical Methods

#### D.1 Companion Models

For each reactive element, replace with a Norton equivalent at each time step $t_n$ with step size $h = t_n - t_{n-1}$:

**Capacitor $C$, nodes $a$–$b$:**

| Method | $R_{eq}$ | $I_{eq}$ (direction: $a \to b$) |
|---|---|---|
| Backward Euler (BE) | $h / C$ | $-C V_C(t_{n-1}) / h$ |
| Trapezoidal (TR) | $h / (2C)$ | $-I_C(t_{n-1}) - 2C V_C(t_{n-1}) / h$ |

**Inductor $L$, nodes $a$–$b$:**

| Method | $R_{eq}$ | $I_{eq}$ (direction: $a \to b$) |
|---|---|---|
| Backward Euler (BE) | $L / h$ | $-I_L(t_{n-1})$ |
| Trapezoidal (TR) | $2L / h$ | $-I_L(t_{n-1}) - h V_L(t_{n-1}) / (2L)$ |  

> **TR/BE switching (SPICE gear method):** Use TR by default (2nd-order accuracy). Switch locally to BE when the LTE monitor detects a non-smooth transient (discontinuity or rapid slope change), then return to TR. This prevents the "trapezoidal ringing" artefact around discontinuities.

#### D.2 Local Truncation Error (LTE) Estimation and Adaptive Step

Estimate the per-variable LTE for a capacitor voltage using the 3-point backward difference:

$$\text{LTE}_V \approx \frac{h^2}{12} \ddot{V}_C \approx \frac{h^2}{12} \cdot \frac{V_C(t_n) - 2V_C(t_{n-1}) + V_C(t_{n-2})}{h^2}$$

Compute the step size that would have produced $\text{LTE} \le \epsilon_{tol}$:

$$h_{opt} = h \cdot \left(\frac{\epsilon_{tol}}{\|\text{LTE}\|_\infty}\right)^{1/2}$$

Accept the current step if $\|\text{LTE}\|_\infty \le \epsilon_{tol}$, else reject and retry with $h_{new} = 0.9 \cdot h_{opt}$. Cap the step growth at $h_{new} \le 10\,h$.

#### D.3 Initial Conditions

- Capacitors: $V_C(0) = V_{IC}$ (user-specified or 0 V). Enforce as a voltage source in the first step, then remove.
- Inductors: $I_L(0) = I_{IC}$. Enforce as a current source in the first step.
- Run a DC operating point solve first; use its solution as $t = 0^-$ state if no ICs are specified.

---

### E. Failure Modes and Diagnostics

| Symptom | Root Cause | Remedy |
|---|---|---|
| Singular matrix | Floating node or voltage source loop | Detect via graph traversal before solve |
| NR non-convergence | Missing junction limiting | Implement `pnjlim`; reduce source step |
| Trapezoidal ringing | Step spans a discontinuity | Switch to BE locally at the discontinuity |
| LTE blow-up | Step too large for fast transient | Adaptive step with LTE estimator |
| Negative resistance stamp | Wrong sign convention | Audit passive sign convention at each stamp site |
