export interface IpcStatusController {
  init(): void;
  setStatus(text: string, color: string): void;
}

export function createIpcStatusController(): IpcStatusController {
  let statusDot: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;

  return {
    init: () => {
      statusDot = document.querySelector("#ipc-status-dot");
      statusText = document.querySelector("#ipc-status-text");
    },
    setStatus: (text, color) => {
      if (!statusDot || !statusText) return;
      statusDot.classList.add("active");
      statusText.textContent = text;
      statusText.style.color = color;
    },
  };
}
