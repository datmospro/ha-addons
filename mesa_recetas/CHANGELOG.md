# 1.3.0

- Los temporizadores normales y personalizados abren el Reloj en el mismo Android que pulsa el botón, mediante un enlace local de Companion. No hay selector ni destinatario compartido.
- La prueba de un minuto también se ejecuta en el propio móvil. Desde PC solo se inicia el contador de Mesa.
- Se retira el envío remoto al Reloj y se ignora el antiguo móvil configurado, evitando crear alarmas en otro teléfono. Los avisos finales opcionales se conservan como respaldo.
- Puedes avanzar o retroceder por los pasos mientras se guarda el temporizador, sin perder esos toques por la espera de red.

# 1.2.0

- Copia opcional en el Reloj Android al iniciar cada contador normal o personalizado. Selección de un móvil en Ajustes, desactivada inicialmente.
- Pruebas separadas de Reloj nativo y aviso con pantalla bloqueada, ambas de un minuto; ayuda para restricciones de batería y conexión en Xiaomi / Android.
- Fallos del Reloj visibles sin perder el contador. Se distingue solicitud de confirmación real y se recuerda que las copias se cancelan por separado.
- Los reintentos de avisos finales se limitan a los móviles cuya llamada a Home Assistant falló.

# 1.1.0

- Sistema de cálculo por raciones o unidades al crear y editar recetas, con nombre singular y plural: wraps, pasteles, pizzas…
- Las cantidades de ingredientes y pasos, el modo cocina y los temporizadores conservan la cantidad seleccionada.
- Plan semanal, compra, congelador y cocina por tandas muestran las unidades correspondientes. El generador prepara unidades completas suficientes para los comensales.
- Equivalencia entre unidades y raciones nutricionales para mantener los macros por persona. Las recetas existentes conservan el sistema por raciones.

# 1.0.1

- Pulsa un contador para abrir su receta y paso, conservando las raciones con las que se inició.
- Botón «Otro tiempo» en cada paso, también en cocina por tandas: minutos/segundos personalizados y opciones rápidas de +1, +2, +5 y +10 minutos.
- Los contadores adicionales no alteran los anteriores. Se mantiene la navegación de los contadores antiguos cuando su receta y paso se pueden identificar.
- Los botones de los contadores conservan el foco al actualizar los segundos.

# 1.0.0

- Primera versión de Mesa · Recetas, con tema grafito y ámbar y acento configurable.
- Recetario, medios, cantidades en los pasos y modo cocina.
- Plan semanal manual/automático con macros, exclusiones y menús rotativos.
- Lista compartida, copia para Keep, congelador y cocina por tandas.
- Temporizadores persistentes y avisos Android mediante Home Assistant.
- Importación, copias de seguridad y comprobaciones automatizadas.
