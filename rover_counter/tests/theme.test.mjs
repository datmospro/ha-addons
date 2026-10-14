import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readTheme,
  saveTheme,
  validTheme,
  THEME_KEY,
} from "../web/src/utils/theme.mjs";
test("new browsers and unknown saved styles keep the existing design", () => {
  assert.equal(readTheme({ getItem: () => null }), "current");
  assert.equal(readTheme({ getItem: () => "obsolete" }), "current");
  assert.equal(validTheme(null), "current");
});
test("each supported theme is saved and restored without touching match data", () => {
  const values = new Map([["match", "unchanged"]]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  for (const style of ["board", "fantasy", "current"]) {
    assert.equal(saveTheme(storage, style), true);
    assert.equal(readTheme(storage), style);
    assert.equal(values.get("match"), "unchanged");
    assert.equal(values.get(THEME_KEY), style);
  }
});
test("restricted storage does not break application startup or theme switching", () => {
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.equal(readTheme(blocked), "current");
  assert.equal(saveTheme(blocked, "fantasy"), false);
});
