# Mesa · Recetas

Tu recetario familiar para Home Assistant. Tema grafito y ámbar, acento personalizable y una interfaz pensada para cocinar desde Android.

## Instalar

1. En Home Assistant abre **Ajustes → Complementos → Tienda de complementos** (en versiones recientes puede aparecer como **Apps**).
2. En **⋮ → Repositorios**, añade `https://github.com/datmospro/ha-addons` si todavía no está añadido.
3. Actualiza la tienda desde **⋮ → Buscar actualizaciones** o recarga el repositorio.
4. Instala **Mesa · Recetas**, inicia el add-on y pulsa **Abrir interfaz web**. Puedes activar su acceso en la barra lateral.
5. Abre el mismo panel desde la app Android de Home Assistant en los dos móviles. Ambos comparten los datos.

La primera instalación compila una imagen local para **amd64** o **aarch64**. No necesita claves de pago ni servicios de generación de menús. No modifica Fit Controller ni otros add-ons.

## Qué incluye

- Recetas con categorías, etiquetas, favoritos, buscador, fotografías y vídeos (archivos locales o enlaces directos HTTPS).
- Ingredientes estructurados, cantidades ajustables por raciones o unidades y cantidades repetidas automáticamente en cada paso.
- Modo cocina con pasos grandes, tareas paralelas y múltiples temporizadores persistentes.
- Nutrición obligatoria por ración: kcal, proteínas, hidratos y grasas; datos marcados como estimados o verificados con fuente.
- Semana de desayuno, comida, merienda y cena; entre uno y siete menús diarios rotativos desde el lunes.
- Generador local que prioriza ingredientes/etiquetas deseados y respeta ingredientes excluidos, máximo diario de kcal, mínimo de proteínas y máximos de hidratos y grasas. Los límites de macros a cero se desactivan.
- Revisión antes de guardar, cambios manuales de una comida, comer fuera, huecos y repetición de semanas anteriores. Los objetivos se guardan con cada semana; si los cambios manuales incumplen los límites, se muestra un aviso.
- Compra consolidada para todos los comensales, conversión kg/g y l/ml, casillas compartidas, productos manuales y copia para Google Keep. Las unidades diferentes se conservan por separado.
- Congelador por lotes con raciones, fechas, instrucciones y reservas. El generador puede aprovechar lotes disponibles; también puedes asignarlos manualmente. **Marcar consumido** descuenta el stock una sola vez. Las raciones congeladas no añaden ingredientes a la compra.
- Vista de cocina por tandas que agrupa raciones y propone un orden conservando los pasos de cada receta. Los tiempos siguen siendo los de la receta base; hay que revisar el punto de cocción y dividir lotes según la capacidad del equipo.
- Ajustes de color, comensales y planificación. Tres raciones normales por defecto, con una referencia nutricional común por persona.
- Exportación/restauración JSON con medios subidos, importación de recetas y persistencia SQLite en `/data`.

## Primer uso y recetas de ejemplo

Se incluyen doce recetas editables, tres por tipo de comida, para probar el flujo completo. Sus fotografías son **ilustrativas** y sus macros son **estimaciones orientativas**, no una tabla nutricional calculada por marcas. Revisa o sustituye estos ejemplos antes de usarlos como registro nutricional preciso. No se calcula una dieta individual para cada miembro de la familia.

Los plazos de congelación pertenecen a cada receta; no se deducen automáticamente. El usuario debe comprobarlos al incorporar recetas. En el calendario se indican las comidas del congelador y la necesidad de descongelar en la nevera desde el día anterior; no se envían recordatorios automáticos de descongelación en esta versión.

## Raciones o unidades

Al crear o editar una receta, **Sistema de cálculo** permite elegir **Raciones** o **Unidades**. En unidades indica cuántas produce la receta base y su nombre en singular y plural. Los ingredientes corresponden siempre a toda la receta base.

- **Wraps:** 10 unidades, nombre «wrap / wraps», 10 raciones nutricionales. Seleccionar 4 wraps utiliza el 40 % de los ingredientes.
- **Pastel:** 1 unidad, nombre «pastel / pasteles», 6 raciones nutricionales. Seleccionar 2 pasteles duplica los ingredientes; los macros de un pastel son seis veces los de una porción.

Los macros del editor siguen siendo **por una ración nutricional**. La ficha muestra los macros por unidad cuando usas ese sistema. El plan mantiene la referencia nutricional por persona y muestra por separado la cantidad que se prepara. Al generar el plan se redondea a unidades completas suficientes para los comensales; los sobrantes no se añaden automáticamente al congelador. En el congelador puedes registrar fracciones de unidad.

Las recetas existentes siguen por raciones hasta que las edites. Cambiar de sistema no modifica los ingredientes ni los macros guardados: revisa la equivalencia antes de guardar. En repostería revisa también el molde y el grosor al cambiar cantidades; los tiempos y temperaturas no se multiplican automáticamente.

## Alarmas Android: configuración y límites

### Copia en el Reloj Android (desde 1.2.0)

En **Ajustes → Alarmas en Android → Reloj Android al iniciar**, selecciona un móvil y guarda. Está desactivado inicialmente. La selección se comparte entre usuarios: cualquier contador que inicies desde Mesa, incluido desde PC u otro móvil, solicitará una copia únicamente en ese teléfono. El aviso final de Home Assistant se conserva como respaldo para los móviles marcados.

Pulsa **Probar Reloj · 1 minuto** con el móvil desbloqueado. Companion puede abrir la pantalla del permiso **Mostrar sobre otras aplicaciones**: debes concederlo manualmente si quieres usar esta función. Comprueba que tu app Reloj muestra e inicia un temporizador de un minuto; confirma si lo solicita y vuelve a Mesa para cocinar. Prueba después su sonido con el móvil bloqueado. La compatibilidad depende de la app Reloj instalada y de las restricciones de Android / HyperOS / MIUI.

La petición usa `command_activity` y `android.intent.action.SET_TIMER`, duración restante en segundos y etiqueta del paso. Se muestra la interfaz del Reloj para comprobar el inicio. **Reloj solicitado** solo indica que Home Assistant aceptó la petición, no que el teléfono creó el temporizador. Si la petición inicial se retrasa, la duración recibida puede desfasarse: compruébala antes de bloquear. No se reintenta automáticamente el comando, porque podría crear duplicados.

Una vez creado en el Reloj, su cuenta y sonido los gestiona el teléfono. **Las copias son independientes:** cerrar/cancelar en Mesa no cancela el Reloj, ni al contrario. Los contadores iniciados antes de activar la opción no se copian retrospectivamente. Si falla la petición, Mesa conserva la cuenta y muestra el error.

Referencias: [comandos de Companion](https://companion.home-assistant.io/docs/notifications/notification-commands/#activity) y [temporizadores de Android](https://developer.android.com/guide/components/intents-common#CreateTimer).

### Avisos de Home Assistant y diagnóstico

1. Registra ambos móviles con la aplicación **Home Assistant Companion**.
2. En **Mesa → Ajustes → Alarmas en Android**, pulsa **Buscar móviles**, selecciona los destinos y **Guarda ajustes**.
3. Pulsa **Probar alarma** y comprueba el sonido con cada teléfono bloqueado.
4. Permite las notificaciones de Home Assistant. Configura el canal Android `alarm_stream`, el volumen de alarmas y su permiso para interrumpir No molestar si lo necesitas.

**Probar aviso bloqueado · 1 minuto** crea una cuenta de prueba en Mesa sin copia nativa. Bloquea el móvil, déjalo quieto y espera sin abrir Companion: sirve para revisar el retraso de notificaciones. La prueba inmediata por sí sola no verifica el comportamiento en reposo prolongado.

En Xiaomi revisa en la información de Home Assistant batería **Sin restricciones**, inicio automático/en segundo plano, datos en segundo plano y permisos de notificación y sonido. Los nombres varían por modelo y versión. En Companion revisa **Conexión persistente → Siempre** si necesitas probar una conexión directa; puede consumir más batería. Revisa también el volumen del Reloj y No molestar. Estas comprobaciones requieren los móviles físicos; el add-on no puede verificarlas remotamente.

Los temporizadores se guardan con una fecha de vencimiento en el servidor. Siguen funcionando al navegar, cerrar el navegador o reiniciar el add-on. Al vencer se envía un aviso con `priority: high`, `ttl: 0` y `channel: alarm_stream` mediante Home Assistant. Los fallos de entrega a Home Assistant se reintentan y se muestran en la interfaz.

Los reintentos se hacen solo para los móviles cuya llamada falló. Una respuesta correcta de Home Assistant no confirma recepción ni sonido en el teléfono; no se reenvía por falta de confirmación del dispositivo.

Pulsa el nombre o el tiempo de un contador para abrir el paso que lo inició. Los contadores nuevos conservan también las raciones. Junto al botón de tiempo de cada paso aparece **Otro tiempo**: puedes iniciar un contador adicional de minutos y segundos, con opciones rápidas de +1, +2, +5 y +10 minutos, sin cambiar los contadores en marcha. También está disponible en la vista por tandas y en pasos sin temporizador predefinido. Si has reordenado los pasos, se busca el texto original; si el paso se ha eliminado o reescrito, se abre la receta para revisarla.

**Los avisos finales son notificaciones de Home Assistant; la copia opcional en el Reloj se solicita por separado al iniciar.** Los avisos necesitan Home Assistant y el add-on encendidos, conexión y permisos correctos. Una respuesta correcta de Home Assistant confirma la aceptación del aviso, no que el teléfono lo haya reproducido. La interfaz también emite un sonido si está abierta y el navegador permite audio. Debes probarlo en vuestros teléfonos antes de depender de ello mientras cocináis.

Referencia: [notificaciones críticas y Alarm Stream de Home Assistant Companion](https://companion.home-assistant.io/docs/notifications/critical-notifications/).

## Incorporar recetas desde capturas, texto o enlaces

Pasa la información al asistente para preparar un JSON siguiendo [`public/recipe-example.json`](public/recipe-example.json). Después usa **Recetas → Importar** para cargarlo. No hay conexión automática del asistente a la base de datos de tu Home Assistant ni importación automática desde redes sociales en esta versión.

- `servings`: raciones nutricionales de la receta base. `nutrition` siempre contiene valores **por una ración nutricional**.
- `yield_mode`: `servings` (predeterminado) o `units`. En unidades añade `yield_quantity` (entero positivo), `yield_unit` y `yield_unit_plural`. Ejemplo de un pastel para seis porciones: `"yield_mode": "units", "yield_quantity": 1, "yield_unit": "pastel", "yield_unit_plural": "pasteles", "servings": 6`.
- Cada ingrediente lleva `id`, `name`, `quantity`, `unit` y `group` (sección de la compra).
- Los pasos usan `{{id}}`: por ejemplo `Añade {{leche}}`. Al cocinar se sustituye por `200 ml de leche`, ajustado a los comensales.
- Si se reparte un ingrediente, `uses` indica su fracción en cada paso: `{"leche": 0.5}`. Las fracciones de todos los pasos deben sumar 1 por ingrediente. La interfaz permite editar estos porcentajes.
- `timer_minutes` es el temporizador del paso y `parallel` indica qué hacer mientras tanto. Ordena las preparaciones largas al principio; el editor permite mover los pasos.
- `image`, `video` y las imágenes/vídeos de cada paso admiten HTTPS o archivos subidos. Un enlace a una página de YouTube/Instagram no equivale a un vídeo directo: conserva ese enlace en `source`.
- `meal_types` admite `Desayuno`, `Comida`, `Merienda`, `Cena`.
- Usa nombres coherentes para ingredientes. El campo opcional `components` de un ingrediente permite indicar los componentes de salsas o mezclas (por ejemplo `["sésamo", "garbanzos"]`); el editor también permite escribirlos y el generador los tiene en cuenta para las exclusiones. La app no puede adivinar componentes que no se hayan registrado.
- No marques macros como `verified` sin indicar `nutrition_source`.

La importación valida todo el lote antes de guardar y crea identificadores nuevos para evitar reemplazar recetas por accidente. El editor manual permite añadir y modificar recetas sin usar JSON.

## Datos, acceso y copias

La interfaz se sirve mediante [Home Assistant Ingress](https://contributors.home-assistant.io/apps/guides/ingress/): no expone un puerto al exterior ni solicita otra contraseña. Usa el acceso remoto seguro que ya tengas configurado en Home Assistant para abrirla fuera de casa.

- Base de datos: `/data/mesa.db`, con SQLite WAL.
- Archivos subidos: `/data/media/`, máximo 30 MB por archivo.
- Los cambios entre pantallas se actualizan aproximadamente cada cinco segundos, excepto mientras se edita un formulario. Una edición antigua no sobrescribe silenciosamente cambios de otra pantalla.
- **Ajustes → Descargar copia completa** incluye datos y medios locales. Guarda copias antes de restaurar o desinstalar. La restauración sustituye datos y descarta los temporizadores.
- El formato de restauración de la interfaz admite hasta 120 MB de JSON. Para bibliotecas mayores usa una copia completa del add-on desde Home Assistant, que incluye `/data`.
- Los temporizadores suenan en todos los móviles seleccionados; no hay perfiles ni permisos separados por persona.

## Desarrollo y comprobaciones

Requiere Node.js 24 o posterior. No tiene dependencias externas en ejecución; utiliza `node:sqlite`.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npx playwright test
npm start
```

En desarrollo abre `http://127.0.0.1:8099`. Los datos locales van a `.data/`. Se pueden cambiar `PORT` y `DATA_DIR`. El contenedor activa `INGRESS_ONLY=true` y solo acepta tráfico de Supervisor (`172.30.32.2`), aparte de `/health`. Nunca publiques el servidor de desarrollo sin autenticación.

El flujo de GitHub Actions comprueba dominio/API, interfaz en escritorio y Android simulado, y construcción/arranque del contenedor para amd64 y arm64. Las comprobaciones simuladas no sustituyen la instalación real en Home Assistant ni la prueba de sonido en móviles físicos.

## Fotografías

Fotografías ilustrativas descargadas de Unsplash bajo su [licencia](https://unsplash.com/license), almacenadas localmente para evitar dependencias al cocinar. Identificadores originales:

- Avena: `photo-1517673400267-0251440c45dc`
- Tostada: `photo-1525351484163-7529414344d8`
- Bowl: `photo-1546069901-ba9599a7e63c`
- Pasta: `photo-1473093295043-cdd812d0e601`
- Verduras: `photo-1512621776951-a57141f2eefd`
- Salmón: `photo-1467003909585-2f8a72700288`
