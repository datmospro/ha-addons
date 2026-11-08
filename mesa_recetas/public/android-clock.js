export const isAndroid = (ua = navigator.userAgent) => /Android/i.test(ua);

export function androidTimerIntent(seconds, label) {
  seconds = Math.round(seconds);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)
    throw new Error("El tiempo debe estar entre 1 segundo y 24 horas");
  return `intent:#Intent;action=android.intent.action.SET_TIMER;category=android.intent.category.DEFAULT;i.android.intent.extra.alarm.LENGTH=${seconds};S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(label)};B.android.intent.extra.alarm.SKIP_UI=false;end`;
}

export function openAndroidClock(
  seconds,
  label,
  {
    android = isAndroid(),
    open = (url) => {
      const link = document.createElement("a");
      link.href = url;
      link.click();
    },
  } = {},
) {
  if (!android) return false;
  open(androidTimerIntent(seconds, label));
  return true; // Solicitud local; no es confirmación del Reloj.
}

export async function saveTimerAndOpenClock(
  payload,
  label,
  { save, openClock = openAndroidClock },
) {
  // Inicia la petición y abre el Reloj en el mismo gesto, antes de esperar red.
  // Así no se pierde la activación del usuario ni se busca otro teléfono.
  const pending = save(payload);
  let clock;
  try {
    if (openClock(payload.seconds, label))
      clock = { status: "requested", method: "local" };
  } catch (error) {
    clock = { status: "failed", method: "local", error: error.message };
  }
  try {
    return { timer: await pending, clock };
  } catch (error) {
    if (clock?.status === "requested")
      throw new Error(
        `${error.message}. Si el Reloj del móvil ha iniciado su cuenta, revísala allí: no se pudo guardar en Mesa.`,
      );
    throw error;
  }
}
