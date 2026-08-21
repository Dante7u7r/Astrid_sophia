export type ConsoleLogType = "system" | "send" | "receive" | "error";

export interface ConsoleLogEntry {
  time: string;
  text: string;
  type: ConsoleLogType;
}

export interface ConsoleLogController {
  init(): void;
  addLog(text: string, type?: ConsoleLogType): void;
  bindClearButton(): void;
  getLogs(): ConsoleLogEntry[];
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
  const recentLogs: ConsoleLogEntry[] = [];
  const MAX_LOGS = 50;

  return {
    init: () => {
      consoleOutput = document.querySelector("#console-output");
      clearConsoleBtn = document.querySelector("#clear-console-btn");
    },
    addLog: (text, type = "system") => {
      deps.recordQaLog(text, type);
      const timeStr = formatTimestamp(deps.now());
      recentLogs.push({ time: timeStr, text, type });
      if (recentLogs.length > MAX_LOGS) {
        recentLogs.shift();
      }

      if (!consoleOutput) return;

      const line = document.createElement("div");
      line.className = `log-line ${type}`;
      line.textContent = `[${timeStr}] ${text}`;
      consoleOutput.appendChild(line);
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    },
    bindClearButton: () => {
      clearConsoleBtn?.addEventListener("click", () => {
        recentLogs.length = 0;
        if (consoleOutput) {
          consoleOutput.innerHTML = `<div class="log-line system-msg">> Limpieza de registros. Consola limpia.</div>`;
        }
      });
    },
    getLogs: () => [...recentLogs],
  };
}
