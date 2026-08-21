export interface IpcStatusController {
  init(): void;
  setStatus(text: string, color: string): void;
}

export function createIpcStatusController(): IpcStatusController {
  let statusDot: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let footerSolver: HTMLElement | null = null;

  return {
    init: () => {
      statusDot = document.querySelector("#ipc-status-dot");
      statusText = document.querySelector("#ipc-status-text");
      footerSolver = document.querySelector(".footer-solver");
    },
    setStatus: (text, color) => {
      if (!statusDot || !statusText) return;
      statusDot.classList.add("active");

      const upper = text.toUpperCase();
      if (upper.includes("FALLBACK") || upper.includes("RESPALDO")) {
        statusDot.style.backgroundColor = "var(--warning, #f59e0b)";
        statusText.innerHTML = `<span class="badge-fallback-linear" data-tooltip="Modo de respaldo web: El solver Rust no está disponible. Circuitos con diodos o transistores usan resistencias fijas aproximadas (no exactas).">FALLBACK: SOLO LINEAL</span>`;
        if (footerSolver) {
          footerSolver.textContent = "Solver: Web Fallback (Solo Lineal - Sin Newton-Raphson)";
          footerSolver.style.color = "var(--warning, #f59e0b)";
        }
      } else {
        statusDot.style.backgroundColor = color || "var(--accent-cyan)";
        statusText.textContent = text;
        statusText.style.color = color || "inherit";
        if (footerSolver && text.includes("Rust")) {
          footerSolver.textContent = "Solver: MNA Newton-Raphson (Rust)";
          footerSolver.style.color = "inherit";
        }
      }
    },
  };
}
