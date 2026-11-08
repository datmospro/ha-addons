import test from "node:test";
import assert from "node:assert/strict";
import { seedRecipes } from "../seed.mjs";
import {
  validateRecipe,
  generatePlan,
  DEFAULTS,
  shopping,
  stepText,
  nutritionDay,
} from "../domain.mjs";
import {
  toPortions,
  fromPortions,
  formatAmount,
  nutritionPerUnit,
  plannedPortions,
} from "../public/yield.js";

const base = seedRecipes()[0];
const cake = validateRecipe({
  ...base,
  id: "cake",
  title: "Pastel de prueba",
  servings: 6,
  yield_mode: "units",
  yield_quantity: 1,
  yield_unit: "pastel",
  yield_unit_plural: "pasteles",
  nutrition: { kcal: 192.5, protein: 8.75, carbs: 20.3, fat: 8.4 },
});
test("Las recetas existentes siguen calculando por raciones", () => {
  const old = { ...base };
  delete old.yield_mode;
  const r = validateRecipe(old);
  assert.equal(r.yield_mode, "servings");
  assert.equal(toPortions(r, 3), 3);
  assert.equal(formatAmount(r, 3), "3 raciones");
});
test("Dos pasteles duplican ingredientes y pasos, conservando la porción nutricional", () => {
  assert.equal(toPortions(cake, 2), 12);
  assert.equal(fromPortions(cake, 12), 2);
  assert.equal(formatAmount(cake, 12), "2 pasteles");
  assert.equal(nutritionPerUnit(cake).kcal, 1155);
  assert.match(
    stepText(cake, cake.steps[0], toPortions(cake, 2)),
    /100 g de copos/,
  );
  const entries = [{ recipe_id: "cake", servings: 12, source: "cook" }];
  assert.equal(
    shopping({ entries }, [cake]).find((i) => i.name === "copos de avena")
      .quantity,
    100,
  );
  assert.equal(nutritionDay(entries, [cake]).kcal, 192.5);
});
test("Los wraps cuentan unidades, sin confundirlas con pasteles completos", () => {
  const wraps = validateRecipe({
    ...base,
    servings: 10,
    yield_mode: "units",
    yield_quantity: 10,
    yield_unit: "wrap",
    yield_unit_plural: "wraps",
  });
  assert.equal(toPortions(wraps, 4), 4);
  assert.equal(formatAmount(wraps, 4), "4 wraps");
  assert.equal(nutritionPerUnit(wraps).kcal, base.nutrition.kcal);
});
test("El generador redondea unidades completas y mantiene sus objetivos por ración", () => {
  const rows = [{ ...cake, meal_types: ["Desayuno", "Comida", "Merienda", "Cena"] }];
  assert.equal(plannedPortions(cake, 3), 6);
  assert.equal(plannedPortions(cake, 7), 12);
  const plan = generatePlan(rows, DEFAULTS, "2026-11-09", () => 0.5);
  assert.equal(plan.entries.length, 28);
  for (const e of plan.entries.filter((e) => e.recipe_id === "cake"))
    assert.equal(e.servings, 6);
});
test("Las unidades no válidas se rechazan y el cambio de modo no cambia cantidades", () => {
  for (const data of [
    { yield_mode: "other" },
    { yield_quantity: 0 },
    { yield_quantity: 1.5 },
    { yield_unit: " " },
    { yield_unit_plural: " " },
  ])
    assert.throws(() => validateRecipe({ ...cake, ...data }));
  const portions = validateRecipe({ ...cake, yield_mode: "servings" });
  assert.equal(portions.servings, 6);
  assert.deepEqual(portions.ingredients, cake.ingredients);
  assert.deepEqual(portions.nutrition, cake.nutrition);
});
