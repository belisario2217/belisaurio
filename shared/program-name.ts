/** Display the academic program independently of the institution that owns its plan. */
export function displayProgramName(value: string): string {
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim()
    .replace(/(?:[\s,;:/|–—-]+(?:IFOP|UNITEN)|\s*[\[(]\s*(?:IFOP|UNITEN)\s*[\])])+\s*$/iu, "").trim();
  const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
  return key === "licenciatura en enfermeria" ? "Licenciatura en Enfermería" : name;
}
