import { test, expect } from "@playwright/test";
let baseline;
test.beforeEach(async ({ request }) => {
  baseline = await (await request.get("/api/export")).json();
});
test.afterEach(async ({ request }) => {
  await request.post("/api/restore", {
    data: { ...baseline, confirm: "RESTAURAR" },
  });
});

test("Unidades: dos pasteles, cuatro wraps, editor, compra y congelador", async ({
  page,
  request,
}, info) => {
  const original = baseline.recipes.find((r) => r.id === "avena");
  const cake = {
    ...original,
    id: "cake",
    title: "Pastel en unidades",
    _rev: 0,
    servings: 6,
    yield_mode: "units",
    yield_quantity: 1,
    yield_unit: "pastel",
    yield_unit_plural: "pasteles",
    nutrition: { kcal: 192.5, protein: 8.75, carbs: 20.3, fat: 8.4 },
    freezable: true,
    freezer_days: 60,
  };
  const wraps = {
    ...original,
    id: "wraps",
    title: "Wraps en unidades",
    _rev: 0,
    servings: 10,
    yield_mode: "units",
    yield_quantity: 10,
    yield_unit: "wrap",
    yield_unit_plural: "wraps",
  };
  expect((await request.post("/api/recipe", { data: cake })).ok()).toBeTruthy();
  expect(
    (await request.post("/api/recipe", { data: wraps })).ok(),
  ).toBeTruthy();
  await page.goto("/#detail/cake");
  await expect(page.getByLabel("pasteles", { exact: true })).toHaveValue("1");
  await page.getByLabel("pasteles", { exact: true }).fill("2");
  await page.getByLabel("pasteles", { exact: true }).press("Tab");
  await expect(page.locator(".ingredients")).toContainText("100 g");
  await expect(page.locator(".step").first()).toContainText("100 g de copos");
  await expect(page.locator(".metric").first()).toContainText("1155");
  await expect(page.locator(".notice")).toContainText(
    "192,5 kcal por ración nutricional",
  );
  await page.getByRole("button", { name: "Empezar a cocinar" }).click();
  await expect(page.locator(".cook")).toContainText("2 pasteles");
  await page.getByRole("button", { name: "Iniciar · 5 min" }).click();
  await page.goto("/#shopping");
  await page
    .getByRole("button", {
      name: "Abrir Pastel en unidades, paso 1",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("2 pasteles");
  await page.goto("/#detail/wraps");
  await page.getByLabel("wraps", { exact: true }).fill("4");
  await page.getByLabel("wraps", { exact: true }).press("Tab");
  await expect(page.locator(".ingredients")).toContainText("20 g");
  await page.goto("/#detail/cake");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.locator('[name="yield_mode"]')).toHaveValue("units");
  await expect(page.locator('[name="yield_quantity"]')).toHaveValue("1");
  await expect(page.locator('[name="yield_quantity"]')).toBeEnabled();
  await expect(page.locator("#dialog-error")).not.toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-editor-unidades.png`,
    fullPage: true,
  });
  await page.locator('[name="yield_mode"]').selectOption("servings");
  await expect(page.locator("#yield-unit-fields")).not.toBeVisible();
  await expect(page.locator('[name="yield_quantity"]')).toBeDisabled();
  await expect(page.getByLabel("Raciones de la receta base", { exact: true })).toBeVisible();
  await page.locator('[name="yield_mode"]').selectOption("units");
  await expect(page.locator('[name="yield_quantity"]')).toBeEnabled();
  await expect(page.getByLabel("Raciones nutricionales que rinde la receta base", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Guardar receta", exact: true })
    .click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.goto("/#week");
  await page
    .locator('[data-action="edit-meal"][data-day="0"][data-slot="0"]:visible')
    .click();
  await page.locator('#meal-form [name="recipe_id"]').selectOption("cake");
  await expect(page.locator('#meal-form [name="servings"]')).toHaveValue("1");
  await page.locator('#meal-form [name="servings"]').fill("2");
  await page
    .getByRole("button", { name: "Guardar comida", exact: true })
    .click();
  await expect(page.locator("dialog")).not.toBeVisible();
  let current = await (await request.get("/api/state")).json();
  expect(current.plans[0].entries[0].servings).toBe(12);
  await page.goto("/#shopping");
  await expect(
    page.locator(".shop-item").filter({ hasText: "copos de avena" }),
  ).toContainText("100 g");
  await page.goto("/#freezer");
  await page.getByRole("button", { name: "Añadir lote", exact: true }).click();
  await page.locator('#stock-form [name="recipe_id"]').selectOption("cake");
  await page.locator('#stock-form [name="portions"]').fill("3");
  await page.getByRole("button", { name: "Guardar lote", exact: true }).click();
  await expect(page.locator(".stock-card")).toContainText("pasteles");
  current = await (await request.get("/api/state")).json();
  expect(current.stock[0].portions).toBe(18);
  await page.screenshot({
    path: `test-results/${info.project.name}-stock-unidades.png`,
    fullPage: true,
  });
});

test("Contadores abren su paso y permiten un tiempo adicional personalizado", async ({
  page,
  request,
}, info) => {
  await page.goto("/#detail/bowl");
  await page.locator("#servings").fill("5");
  await page.locator("#servings").press("Tab");
  await page.getByRole("button", { name: "Empezar a cocinar" }).click();
  await page.getByRole("button", { name: "Iniciar · 15 min" }).click();
  await page.getByRole("button", { name: "Siguiente paso" }).click();
  await page
    .getByRole("button", { name: "Temporizador personalizado del paso 2" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Temporizador personalizado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+2 min", exact: true }).click();
  await page.locator('#custom-timer-form [name="seconds"]').fill("30");
  await page
    .getByRole("button", { name: "Iniciar temporizador", exact: true })
    .click();
  await expect(page.locator(".timer-pill")).toHaveCount(2);
  const state = await (await request.get("/api/state")).json();
  const extra = state.timers.find((t) => t.custom);
  expect(extra.duration_seconds).toBe(150);
  expect(extra.step_index).toBe(1);
  expect(extra.servings).toBe(5);
  await page.goto("/#recipes");
  await page
    .getByRole("button", {
      name: "Abrir Bowl de pollo y quinoa, paso 1",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("Paso 1 de 3");
  await expect(page.locator(".cook")).toContainText("350 g de quinoa");
  await page
    .getByRole("button", {
      name: "Abrir Bowl de pollo y quinoa, paso 2",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("Paso 2 de 3");
  await expect(page.locator(".cook")).toContainText(
    "750 g de pechuga de pollo",
  );
  // El hash no cambia al avanzar; tocar otra vez el mismo contador debe volver al paso 2.
  await page.getByRole("button", { name: "Siguiente paso" }).click();
  await page
    .getByRole("button", {
      name: "Abrir Bowl de pollo y quinoa, paso 2",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("Paso 2 de 3");
  await page.screenshot({
    path: `test-results/${info.project.name}-temporizador-extra.png`,
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Abrir Bowl de pollo y quinoa, paso 2",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("5 raciones");
  await expect(page.locator(".cook")).toContainText("Paso 2 de 3");
  // Los contadores antiguos se identifican por el nombre original.
  await request.post("/api/timer", {
    data: { label: "Bowl de pollo y quinoa · Paso 3", seconds: 120 },
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Abrir Bowl de pollo y quinoa, paso 3",
      exact: true,
    })
    .click();
  await expect(page.locator(".cook")).toContainText("Paso 3 de 3");
});
test("Recorrido completo: recetas, raciones, cocina, plan, compra, congelador y ajustes", async ({
  page,
  request,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "¿Qué cocinamos?" }),
  ).toBeVisible();
  await expect(page.locator(".recipe-card")).toHaveCount(12);
  await page.screenshot({
    path: `test-results/${info.project.name}-recetario.png`,
    fullPage: true,
  });
  await page.getByRole("searchbox").fill("Bowl de pollo");
  await expect(page.locator(".recipe-card")).toHaveCount(1);
  await page.locator(".recipe-card .title").click();
  await expect(
    page.getByRole("heading", { name: "Bowl de pollo y quinoa" }),
  ).toBeVisible();
  await page.locator("#servings").fill("5");
  await page.locator("#servings").press("Tab");
  await expect(page.locator(".ingredients")).toContainText("350 g");
  await expect(page.locator(".step").first()).toContainText("350 g de quinoa");
  await page.getByRole("button", { name: "Empezar a cocinar" }).click();
  await expect(page.locator(".cook")).toContainText("Paso 1 de 3");
  await page.getByRole("button", { name: "Iniciar · 15 min" }).click();
  await page.getByRole("button", { name: "Siguiente paso" }).click();
  await page.getByRole("button", { name: "Iniciar · 8 min" }).click();
  await expect(page.locator(".timer-pill")).toHaveCount(2);
  await page.screenshot({
    path: `test-results/${info.project.name}-cocina.png`,
    fullPage: true,
  });
  await page.goto("/#week");
  await page.getByRole("button", { name: "Generar menú" }).click();
  await page.locator('#generate-form [name="kcal_max"]').fill("1800");
  await page.locator('#generate-form [name="excluded"]').fill("salmón");
  await page.getByRole("button", { name: "Crear propuesta" }).click();
  await expect(
    page.getByRole("heading", { name: "Tu propuesta semanal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar esta semana" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  const state = await (await request.get("/api/state")).json();
  const p = state.plans[0];
  expect(p.entries).toHaveLength(28);
  expect(p.entries.some((e) => e.recipe_id === "salmon")).toBeFalsy();
  await page.screenshot({
    path: `test-results/${info.project.name}-semana.png`,
    fullPage: true,
  });
  await page.goto("/#shopping");
  await expect(
    page.getByRole("heading", { name: "Tu lista", exact: true }),
  ).toBeVisible();
  const check = page.locator("[data-shop-key]").first();
  await check.check();
  await expect(page.locator(".shop-item.checked")).toHaveCount(1);
  await page.locator('#extra-form [name="name"]').fill("Papel de cocina");
  await page.locator('#extra-form button[type="submit"]').click();
  await expect(page.locator(".shop-item")).toContainText(["Papel de cocina"]);
  await page.goto("/#freezer");
  await page.getByRole("button", { name: "Añadir lote" }).click();
  await page.locator('#stock-form [name="recipe_id"]').selectOption("bowl");
  await page.locator('#stock-form [name="portions"]').fill("6");
  await page.getByRole("button", { name: "Guardar lote" }).click();
  await expect(page.locator(".stock-card")).toHaveCount(1);
  await page.goto("/#settings");
  await page.getByRole("button", { name: "Acento #38d5cb" }).click();
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  expect((await (await request.get("/api/state")).json()).settings.accent).toBe(
    "#38d5cb",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-ajustes.png`,
    fullPage: true,
  });
  for (const hash of [
    "recipes",
    "week",
    "shopping",
    "freezer",
    "batch",
    "settings",
  ]) {
    await page.goto("/#" + hash);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});
test("Editor, inserción de cantidades e importación de JSON", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Nueva receta" }).click();
  const form = page.locator("#recipe-form");
  await form.locator('[name="title"]').fill("Leche templada de prueba");
  await form.locator('[name="servings"]').fill("1");
  await form.locator('[name="nutrition_kcal"]').fill("100");
  await form.locator('[name="nutrition_protein"]').fill("5");
  await form.locator('[name="nutrition_carbs"]').fill("10");
  await form.locator('[name="nutrition_fat"]').fill("4");
  await form.locator('[data-ingredient] [data-key="name"]').fill("leche");
  await form.locator('[data-ingredient] [data-key="quantity"]').fill("200");
  await form.locator('[data-ingredient] [data-key="unit"]').fill("ml");
  await form.locator("[data-step] textarea").fill("Calienta ");
  await form.getByRole("button", { name: "+ i0", exact: true }).click();
  await form.locator('[data-step] [data-key="timer_minutes"]').fill("2");
  await form.getByRole("button", { name: "Guardar receta" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Leche templada de prueba" }),
  ).toBeVisible();
  await expect(page.locator(".step")).toContainText("600 ml de leche");
  await page.goto("/#recipes");
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page
    .locator("#import-json")
    .fill('{"recipes": [{"title":"incompleta"}]}');
  await page
    .getByRole("button", { name: "Importar recetas", exact: true })
    .click();
  await expect(page.locator("#dialog-error")).toBeVisible();
});
