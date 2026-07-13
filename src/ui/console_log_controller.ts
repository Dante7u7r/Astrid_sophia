export type ConsoleLogType = "system" | "send" | "receive" | "error";

export interface ConsoleLogController {
  init(): void;
  addLog(text: string, type?: ConsoleLogType): void;
  bindClearButton(): void;
}

export interface ConsoleLogControllerDeps {
  recordQaLog(text: string, type: ConsoleLogType): void;
  now(): Date;
}

function formatTimestamp(now: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now.getMilliseconds().toString().padStart(3, "0")}`;
}

export function createConsoleLogController(deps: ConsoleLogControllerDeps): ConsoleLogController {
  let consoleOutput: HTMLElement | null = null;
  let clearConsoleBtn: HTMLButtonElement | null = null;

  return {
    init: () => {
      consoleOutput = document.querySelector("#console-output");
      clearConsoleBtn = document.querySelector("#clear-console-btn");
    },
    addLog: (text, type = "system") => {
      deps.recordQaLog(text, type);
      if (!consoleOutput) return;

      const line = document.createElement("div");
      line.className = `log-line ${type}`;
      line.textContent = `[${formatTimestamp(deps.now())}] ${text}`;
      consoleOutput.appendChild(line);
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    },
    bindClearButton: () => {
      clearConsoleBtn?.addEventListener("click", () => {
        if (consoleOutput) {
          consoleOutput.innerHTML = `<div class="log-line system-msg">> Limpieza de registros. Consola limpia.</div>`;
        }
      });
    },
  };
}
