# Skill: Electronic Simulation Physics

## 1. Context and Objective
This skill equips the agent with domain-specific knowledge to formulate and solve the mathematical equations governing electrical networks. It focuses on compiling physical circuit schematics into analytical mathematical models and solving them under DC, AC, and Transient conditions.

---

## 2. Core Directives & Standards

### A. Modified Nodal Analysis (MNA)
1. **System Formulation:** Compile the circuit netlist into a linear-algebraic system:
   $$\mathbf{A} \cdot \mathbf{x} = \mathbf{z}$$
   - Matrix $\mathbf{A}$ size is $(N+M) \times (N+M)$, where $N$ is the number of active nodes (excluding Ground / Node 0) and $M$ is the number of independent voltage sources.
   - Vector $\mathbf{x}$ represents the unknowns: $[V_1 \dots V_N, I_{v1} \dots I_{vM}]^T$.
   - Vector $\mathbf{z}$ represents the excitations (independent current sources and voltage source values).
2. **Component Stamps:** Apply the standard MNA stamps:
   - **Resistor ($R$) between nodes $A$ and $B$ (conductance $G = 1/R$):**
     Add $+G$ to $A,A$ and $B,B$; add $-G$ to $A,B$ and $B,A$.
   - **Independent Current Source ($I_{in}$) flowing from $A$ to $B$:**
     Add $-I_{in}$ to row $A$ in vector $\mathbf{z}$; add $+I_{in}$ to row $B$ in vector $\mathbf{z}$.
   - **Independent Voltage Source ($V_{in}$) between nodes $pos$ and $neg$ (branch index $k$):**
     Add $+1$ to matrix cell $pos, (N+k)$ and $(N+k), pos$.
     Add $-1$ to matrix cell $neg, (N+k)$ and $(N+k), neg$.
     Set row $(N+k)$ of vector $\mathbf{z}$ to $V_{in}$.

### B. Newton-Raphson (NR) for Non-linear Devices
1. **Jacobian Formulation:** Solve non-linear elements (Diodes, BJTs, MOSFETs) iteratively. For each iteration $k$, linearize the device around the current operating voltage $V^{(k)}$:
   - Equivalent conductance: $G_{eq} = \left.\frac{\partial I(V)}{\partial V}\right|_{V^{(k)}}$
   - Equivalent independent current injection: $I_{eq} = I(V^{(k)}) - G_{eq} \cdot V^{(k)}$
2. **Stamp Injection:** Stamp $G_{eq}$ as a linear resistor between the device terminals, and stamp $I_{eq}$ as a current source in parallel.
3. **Convergence Criteria:** Terminate iteration when:
   $$\| \mathbf{x}^{(k+1)} - \mathbf{x}^{(k)} \|_\infty < \epsilon_{abs} + \epsilon_{rel} \cdot \| \mathbf{x}^{(k+1)} \|_\infty$$
   where $\epsilon_{abs} = 1\mu\text{V}$ (voltages) / $1\text{pA}$ (currents) and $\epsilon_{rel} = 10^{-3}$.
4. **Junction Limiting:** Implement voltage limiting (e.g., SPICE `pnjlim`) to prevent runaway exponential currents in forward-biased PN junctions.

### C. Transient Integration (Time Domain)
1. **Capacitor ($C$) Integration:**
   - **Trapezoidal Rule (2nd order):** Equivalent resistance $R_{eq} = \frac{h}{2C}$. Equivalent current source $I_{eq}(t) = -I_C(t-h) - \frac{2C}{h}V_C(t-h)$ in parallel.
   - **Backward Euler (1st order):** Equivalent resistance $R_{eq} = \frac{h}{C}$. Equivalent current source $I_{eq}(t) = -\frac{C}{h}V_C(t-h)$ in parallel.
2. **Inductor ($L$) Integration:**
   - **Trapezoidal Rule:** Equivalent resistance $R_{eq} = \frac{2L}{h}$. Equivalent current source $I_{eq}(t) = I_L(t-h) + \frac{2L}{h}V_L(t-h)$ in parallel.
   - **Backward Euler:** Equivalent resistance $R_{eq} = \frac{L}{h}$. Equivalent current source $I_{eq}(t) = I_L(t-h)$ in parallel.
3. **Adaptive Time-stepping:** Monitor Local Truncation Error (LTE) to dynamically adjust step size $h$ to maintain both speed and numerical stability.
