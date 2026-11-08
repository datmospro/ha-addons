// La cantidad de preparación puede expresarse en unidades; los datos guardados
// de planes, stock y temporizadores siguen usando raciones nutricionales.
export const isUnits = (r) => r?.yield_mode === "units";
export const portionsPerUnit = (r) =>
  isUnits(r) ? r.servings / r.yield_quantity : 1;
export const toPortions = (r, quantity) =>
  Number(quantity) * portionsPerUnit(r);
export const fromPortions = (r, portions) =>
  Number(portions) / portionsPerUnit(r);
export const unitName = (r, quantity = 2) =>
  isUnits(r)
    ? Number(quantity) === 1
      ? r.yield_unit
      : r.yield_unit_plural
    : Number(quantity) === 1
      ? "ración"
      : "raciones";
export const formatAmount = (r, portions) => {
  const quantity = fromPortions(r, portions);
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(quantity)} ${unitName(r, quantity)}`;
};
export const nutritionPerUnit = (r) =>
  Object.fromEntries(
    Object.entries(r.nutrition).map(([k, v]) => [k, v * portionsPerUnit(r)]),
  );
export const defaultPortions = (r, family) =>
  isUnits(r) ? r.servings : family;
export const plannedPortions = (r, diners) =>
  isUnits(r)
    ? Math.ceil(diners / portionsPerUnit(r)) * portionsPerUnit(r)
    : diners;
