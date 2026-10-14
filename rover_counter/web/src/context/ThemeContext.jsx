import { createContext, useContext, useEffect, useState } from "react";
import {
  readTheme,
  saveTheme,
  validTheme,
  THEME_KEY,
} from "../utils/theme.mjs";
const ThemeContext = createContext();
export function useTheme() {
  return useContext(ThemeContext);
}
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return readTheme(window.localStorage);
    } catch {
      return "current";
    }
  });
  const [persisted, setPersisted] = useState(true);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const listener = (e) => {
      if (e.key === THEME_KEY) setTheme(validTheme(e.newValue));
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);
  const selectTheme = (value) => {
    const next = validTheme(value);
    setTheme(next);
    try {
      setPersisted(saveTheme(window.localStorage, next));
    } catch {
      setPersisted(false);
    }
  };
  return (
    <ThemeContext.Provider value={{ theme, selectTheme, persisted }}>
      {children}
    </ThemeContext.Provider>
  );
}
