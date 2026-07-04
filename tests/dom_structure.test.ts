import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

describe("estructura DOM principal", () => {
  it("no anida tarjetas de componentes dentro de otras tarjetas", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const window = new Window();
    window.document.write(html);

    const nestedCards = [...window.document.querySelectorAll(".component-card")]
      .map((card) => ({
        id: card.id,
        parentCardId: card.parentElement?.closest(".component-card")?.id ?? null,
        childCardCount: card.querySelectorAll(".component-card").length,
      }))
      .filter((card) => card.parentCardId !== null || card.childCardCount > 0);

    expect(nestedCards).toEqual([]);
  });
});
