import { execFileSync } from "node:child_process";

export interface WindowsProcess {
  pid: number;
  parentPid: number;
  name: string;
  createdAt: string;
}

/** Fail closed: a driver must have an intact, chronologically valid owner chain. */
export function ownedWebDrivers(processes: WindowsProcess[], ownerPid: number): WindowsProcess[] {
  const byPid = new Map(processes.map(entry => [entry.pid, entry]));
  if (byPid.size !== processes.length || !byPid.has(ownerPid)) return [];
  return processes.filter(candidate => {
    if (!/^(tauri-driver|msedgedriver)\.exe$/i.test(candidate.name) || candidate.pid === ownerPid) return false;
    let child = candidate;
    const visited = new Set<number>();
    while (child.pid !== ownerPid) {
      if (visited.has(child.pid)) return false;
      visited.add(child.pid);
      const parent = byPid.get(child.parentPid);
      if (!parent) return false;
      const childTime = Date.parse(child.createdAt);
      const parentTime = Date.parse(parent.createdAt);
      // Windows can reuse a dead parent's PID. A newer process is not that parent.
      if (!Number.isFinite(childTime) || !Number.isFinite(parentTime) || parentTime > childTime) return false;
      child = parent;
    }
    return true;
  });
}

export function readWindowsProcesses(): WindowsProcess[] {
  const output = execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}}, @{n='parentPid';e={$_.ParentProcessId}}, @{n='name';e={$_.Name}}, @{n='createdAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress",
  ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const raw: unknown = JSON.parse(output);
  if (!Array.isArray(raw)) throw new Error("No se obtuvo la lista de procesos Windows.");
  return raw.filter((entry): entry is WindowsProcess => (
    typeof entry === "object" && entry !== null
    && Number.isInteger(entry.pid) && entry.pid > 0
    && Number.isInteger(entry.parentPid) && entry.parentPid >= 0
    && typeof entry.name === "string" && typeof entry.createdAt === "string"
  ));
}

interface CleanupDependencies {
  platform: string;
  ownerPid: number;
  listProcesses(): WindowsProcess[];
  terminate(pid: number): void;
  warn(message: string): void;
}

export function cleanupWindowsWebDrivers(deps: CleanupDependencies = {
  platform: process.platform,
  ownerPid: process.pid,
  listProcesses: readWindowsProcesses,
  terminate: pid => { execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
    stdio: "ignore", windowsHide: true, timeout: 10_000,
  }); },
  warn: message => console.warn(message),
}): void {
  if (deps.platform !== "win32") return;
  try {
    const candidates = ownedWebDrivers(deps.listProcesses(), deps.ownerPid);
    for (const candidate of candidates) {
      // Revalidate ownership and creation time immediately before terminating a PID.
      const current = ownedWebDrivers(deps.listProcesses(), deps.ownerPid);
      if (!current.some(entry => entry.pid === candidate.pid && entry.createdAt === candidate.createdAt)) continue;
      deps.terminate(candidate.pid);
    }
  } catch (error) {
    deps.warn(`No se pudo confirmar la limpieza de los drivers E2E propios: ${String(error)}`);
  }
}
