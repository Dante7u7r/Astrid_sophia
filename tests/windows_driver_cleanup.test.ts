import { describe, expect, it, vi } from "vitest";
import { cleanupWindowsWebDrivers, ownedWebDrivers, type WindowsProcess } from "../scripts/windows_driver_cleanup";

const entry = (pid: number, parentPid: number, name = "node.exe", second = pid): WindowsProcess => ({
  pid, parentPid, name, createdAt: new Date(second * 1000).toISOString(),
});
const tree = () => [entry(1, 0), entry(2, 1, "cmd.exe"), entry(3, 2, "tauri-driver.exe"), entry(4, 3, "msedgedriver.exe")];

describe("limpieza de drivers Windows por propietario", () => {
  it("encuentra solo los drivers descendientes del launcher, incluyendo un shell intermedio", () => {
    expect(ownedWebDrivers([...tree(), entry(7, 0, "tauri-driver.exe"), entry(8, 7, "msedgedriver.exe")], 1)
      .map(process => process.pid)).toEqual([3, 4]);
  });

  it("no mata aplicaciones, drivers ajenos ni procesos sin propietario comprobable", () => {
    expect(ownedWebDrivers([entry(1, 0), entry(2, 1, "biaani.exe"), entry(3, 99, "tauri-driver.exe")], 1)).toEqual([]);
    expect(ownedWebDrivers(tree(), 99)).toEqual([]);
  });

  it("rechaza ciclos, PID duplicados y un PID padre reutilizado", () => {
    expect(ownedWebDrivers([entry(1, 0), entry(2, 3, "tauri-driver.exe", 2), entry(3, 2, "cmd.exe", 2)], 1)).toEqual([]);
    expect(ownedWebDrivers([...tree(), entry(2, 99)], 1)).toEqual([]);
    expect(ownedWebDrivers([entry(1, 0), entry(2, 1, "cmd.exe", 9), entry(3, 2, "tauri-driver.exe", 3)], 1)).toEqual([]);
  });

  it("rechaza fechas desconocidas", () => {
    const processes = tree();
    processes[1].createdAt = "desconocida";
    expect(ownedWebDrivers(processes, 1)).toEqual([]);
  });

  it("revalida identidad y no cierra un PID reutilizado entre lecturas", () => {
    const terminate = vi.fn();
    const listProcesses = vi.fn().mockReturnValueOnce(tree()).mockReturnValue([
      entry(1, 0), entry(2, 1), entry(3, 2, "tauri-driver.exe", 30),
    ]);
    cleanupWindowsWebDrivers({ platform: "win32", ownerPid: 1, listProcesses, terminate, warn: vi.fn() });
    expect(terminate).not.toHaveBeenCalled();
  });

  it("solo termina los PID propios y omite hijos ya cerrados por el driver padre", () => {
    const terminate = vi.fn();
    const listProcesses = vi.fn().mockReturnValueOnce(tree()).mockReturnValueOnce(tree()).mockReturnValue([entry(1, 0)]);
    cleanupWindowsWebDrivers({ platform: "win32", ownerPid: 1, listProcesses, terminate, warn: vi.fn() });
    expect(terminate.mock.calls).toEqual([[3]]);
  });

  it("informa errores de inspección sin terminar procesos por nombre", () => {
    const terminate = vi.fn();
    const warn = vi.fn();
    cleanupWindowsWebDrivers({ platform: "win32", ownerPid: 1,
      listProcesses: () => { throw new Error("CIM no disponible"); }, terminate, warn });
    expect(terminate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CIM no disponible"));
  });

  it("no ejecuta comandos Windows en otras plataformas", () => {
    const listProcesses = vi.fn();
    cleanupWindowsWebDrivers({ platform: "linux", ownerPid: 1, listProcesses, terminate: vi.fn(), warn: vi.fn() });
    expect(listProcesses).not.toHaveBeenCalled();
  });
});
