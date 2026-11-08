import test from "node:test";
import assert from "node:assert/strict";
import {
  isAndroid,
  androidTimerIntent,
  openAndroidClock,
  saveTimerAndOpenClock,
} from "../public/android-clock.js";

test("Reloj local: acción, segundos, etiqueta escapada y sin paquete ni destinatario", () => {
  const uri = androidTimerIntent(20.00000001, "Crêpe; salsa=1# & limón");
  assert.match(uri, /^intent:#Intent;action=android.intent.action.SET_TIMER;/);
  assert.match(uri, /i.android.intent.extra.alarm.LENGTH=20;/);
  assert.match(
    uri,
    /S.android.intent.extra.alarm.MESSAGE=Cr%C3%AApe%3B%20salsa%3D1%23%20%26%20lim%C3%B3n;/,
  );
  assert.match(uri, /B.android.intent.extra.alarm.SKIP_UI=false;end$/);
  assert.ok(!uri.includes("package="));
  for (const seconds of [0, -1, NaN, 86401])
    assert.throws(() => androidTimerIntent(seconds, "x"));
  assert.ok(isAndroid("Mozilla/5.0 (Linux; Android 15; Xiaomi 15T)"));
  assert.ok(!isAndroid("Mozilla/5.0 (Windows NT 10.0)"));
});

test("Reloj local: cada móvil abre su propio enlace antes de esperar a la red; PC no abre nada", async () => {
  for (const phone of ["Xiaomi", "Lorena"]) {
    const order = [];
    let finish;
    const pending = saveTimerAndOpenClock({ seconds: 120 }, phone, {
      save: () => {
        order.push("guardar");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      openClock: (seconds, label) =>
        openAndroidClock(seconds, label, {
          android: true,
          open: (uri) => order.push(uri),
        }),
    });
    assert.equal(order[0], "guardar");
    assert.ok(order[1].startsWith("intent:")); // Sigue dentro del gesto, sin await previo.
    assert.match(order[1], new RegExp(`MESSAGE=${phone};`));
    finish({ id: phone });
    assert.equal((await pending).clock.method, "local");
  }
  let calls = 0;
  assert.equal(
    openAndroidClock(60, "PC", { android: false, open: () => calls++ }),
    false,
  );
  assert.equal(calls, 0);
});

test("Reloj local: el fallo de apertura conserva la cuenta y el fallo de guardado avisa de la copia", async () => {
  const result = await saveTimerAndOpenClock({ seconds: 60 }, "Pollo", {
    save: async () => ({ id: "mesa" }),
    openClock: () => {
      throw new Error("No disponible");
    },
  });
  assert.equal(result.timer.id, "mesa");
  assert.equal(result.clock.status, "failed");
  await assert.rejects(
    saveTimerAndOpenClock({ seconds: 60 }, "Pollo", {
      save: async () => {
        throw new Error("Sin conexión");
      },
      openClock: () => true,
    }),
    /Reloj.*no se pudo guardar en Mesa/,
  );
});
