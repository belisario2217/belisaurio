import { describe, expect, it } from "vitest";
import { displayProgramName } from "./program-name.js";

describe("Academic program display name", () => {
  it.each([
    "Licenciatura en Enfermería IFOP", "Licenciatura en Enfermería UNITEN",
    "LICENCIATURA EN ENFERMERIA IFOP", "licenciatura en enfermería - UNITEN",
    "Licenciatura en Enfermería (IFOP)", "Licenciatura en Enfermería [UNITEN]",
    "Licenciatura en Enfermería IFOP UNITEN", "  Licenciatura   en Enfermeri\u0301a  ",
    "Licenciatura en Enfermería"
  ])("uses the degree name for %s", name => {
    expect(displayProgramName(name)).toBe("Licenciatura en Enfermería");
  });

  it("preserves other degree names and does not remove matching text within a name", () => {
    expect(displayProgramName("Licenciatura en Derecho IFOP")).toBe("Licenciatura en Derecho");
    expect(displayProgramName("UNITEN Diplomado en Salud Comunitaria")).toBe("UNITEN Diplomado en Salud Comunitaria");
    expect(displayProgramName("Programa UNITEN Avanzado")).toBe("Programa UNITEN Avanzado");
    expect(displayProgramName("Curso en Biomedicina")).toBe("Curso en Biomedicina");
    expect(displayProgramName("")).toBe("");
  });
});
