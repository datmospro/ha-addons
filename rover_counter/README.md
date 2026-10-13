# Rover Counter

Interfaz móvil para equipos, partidas de Tute subastado y contador libre.

## Acceso

Abre `http://IP_DE_HOME_ASSISTANT:8099` o el dominio configurado en tu proxy. El complemento incorpora el botón **Abrir interfaz web**. La aplicación conserva sus datos en `/data/game_counter.db`.

## Tute subastado

1. Elige dos equipos, el objetivo y el orden de reparto. Las flechas permiten cambiar el orden desde el móvil; pulsa un jugador para que reparta primero.
2. Selecciona equipo, puntos (70–230, en pasos de cinco) y palo, y confirma la subasta.
3. Marca si se consiguió: suma la apuesta al equipo que subasta o al contrario, según el resultado.
4. Si nadie subasta, pulsa **Nadie subasta · volver a repartir**. Se registra un reparto sin puntos y reparte el siguiente jugador. El historial incluye estos repartos; la numeración corresponde a repartos, no solo a rondas jugadas.
5. **Deshacer** recupera el marcador y el turno anteriores. Al editar o eliminar un reparto se recalculan las puntuaciones y los turnos posteriores.
6. **Finalizar** conserva la partida para consultarla. Las partidas terminadas no son editables.

El guardado debe confirmarse por el servidor antes de mostrarlo como completado. Si falla, la aplicación conserva los campos para volver a intentarlo. La migración a 2.3.0 añade el indicador de reparto sin subasta y conserva equipos, puntuaciones e historial anteriores.

## Desarrollo

- `cd web && npm ci && npm run dev`: interfaz en `127.0.0.1:5179`, con API local en `127.0.0.1:3109`.
- `cd server && npm ci`: dependencias del servidor. Usa `PORT=3109` y un `DB_PATH` de prueba antes de ejecutar `node index.js`.
- `node --test tests/*.test.*`: puntuación, rotación, migración desde el esquema anterior, persistencia, guardado atómico y protección de partidas finalizadas.
- `cd web && npm run lint && npm run build`: análisis de hooks y compilación.
