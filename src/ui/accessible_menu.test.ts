// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";
import { AccessibleMenu } from "./accessible_menu";

describe("AccessibleMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="trigger">Instrumentos</button>
      <div id="menu">
        <button class="dropdown-menu-item-btn">Primero</button>
        <button class="dropdown-menu-item-btn">Segundo</button>
        <button class="dropdown-menu-item-btn">Tercero</button>
      </div>
    `;
  });

  test("expone semantica ARIA y abre con foco desde el teclado", () => {
    const trigger = document.querySelector("#trigger") as HTMLButtonElement;
    const menu = document.querySelector("#menu") as HTMLElement;
    new AccessibleMenu(trigger, menu);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hidden).toBe(true);
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.hidden).toBe(false);
    expect(document.activeElement?.textContent).toBe("Primero");
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
  });

  test("navega con flechas y Escape cierra devolviendo el foco", () => {
    const trigger = document.querySelector("#trigger") as HTMLButtonElement;
    const menu = document.querySelector("#menu") as HTMLElement;
    const controller = new AccessibleMenu(trigger, menu);
    controller.open(0);

    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement?.textContent).toBe("Tercero");
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
