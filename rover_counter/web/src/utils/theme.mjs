export const themes = [
  { id: "current", name: "Actual", description: "Limpio, compacto y moderno." },
  {
    id: "board",
    name: "Mesa de cartas",
    description: "Tapete, papel, madera y latón.",
  },
  {
    id: "fantasy",
    name: "Taberna de fantasía",
    description: "Pergamino, estandartes y magia azul.",
  },
];
export const THEME_KEY = "rover-counter.theme.v1";
export function validTheme(value) {
  return themes.some((t) => t.id === value) ? value : "current";
}
export function readTheme(storage) {
  try {
    return validTheme(storage.getItem(THEME_KEY));
  } catch {
    return "current";
  }
}
export function saveTheme(storage, value) {
  try {
    storage.setItem(THEME_KEY, validTheme(value));
    return true;
  } catch {
    return false;
  }
}
