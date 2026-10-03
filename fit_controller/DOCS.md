# Fit Controller · Recetas y cocina semanal

## Empezar

1. Abre **Plan de Dieta**. En el recetario, **8 ideas para empezar** permite incorporar una colección sin configurar servicios externos. No duplica ni sustituye platos existentes con el mismo nombre.
2. Guarda tus favoritos y revisa las cantidades, los macros y la conservación de cada receta. Puedes subir una foto propia (PNG, JPEG o WebP, hasta 6 MB).
3. Pulsa **Preparar mi semana**. Selecciona semana, personas, días, almuerzos/cenas, recetas y repeticiones. Los límites de calorías y proteína corresponden a cada plato y persona; no completan por sí solos los objetivos de todo el día.
4. Revisa la propuesta, cambia los platos que quieras y pulsa **Guardar este menú**. Por defecto se rellenan huecos libres. La opción de reemplazar afecta únicamente a los días y comidas seleccionados.
5. Abre **Compra y cocina por lotes** para preparar las cantidades totales, marcar la compra, seguir los platos y obtener etiquetas.

## Cantidades y lista de compra

Los macros se guardan **por ración**. Los ingredientes admiten dos bases explícitas:

- **Para 1 ración:** se multiplican por las raciones del menú.
- **Para la receta completa:** se dividen por las raciones de la receta y se multiplican por las raciones del menú.

Ejemplo: 1.700 g de pollo para una receta de 10 raciones requieren 340 g para dos raciones. Tres comidas de dos raciones requieren 1.020 g.

La compra suma recetas repetidas y convierte kg a g y litros a ml. No suma gramos con mililitros ni supone equivalencias entre tazas y gramos. Mantiene separados los ingredientes opcionales y los nombres que difieren (por ejemplo, arroz seco y arroz cocido). Las cantidades ambiguas o sin unidad se señalan para revisión. No es posible producir una compra completa si faltan ingredientes o cantidades: corrige las advertencias antes de comprar.

Las cantidades son las necesarias para cocinar; no se redondean al tamaño de los envases comerciales. Marca un ingrediente como disponible solo cuando tengas toda la cantidad necesaria. **Copiar compra pendiente** omite los marcados. Las casillas de compra/cocinado se guardan en el addon, se comparten entre dispositivos y se reinician cuando cambia el contenido del plan.

Los ingredientes indicados como **Fresco** se incluyen en la compra, pero se muestran por separado del contenido que se congela. Las instrucciones de preparación son las de la receta original: adapta las tandas y los recipientes al número de raciones calculado.

## Importar capturas o texto

En **Configuración → Importación de recetas con IA**, introduce tu clave API de OpenAI. El modelo predeterminado es `gpt-4.1-mini`; puedes indicar otro compatible con imágenes y salidas estructuradas. La API se factura por separado de ChatGPT.

En **Importar una receta**, pega el texto y/o selecciona hasta cuatro capturas. Al pulsar **Leer receta y revisar**, ese contenido se envía a OpenAI. El enlace original se conserva como referencia; no se descarga Instagram ni se promete extraer un vídeo desde su URL.

La extracción devuelve un borrador: revisa ingredientes, raciones, macros, preparación y conservación antes de guardarlo. Los datos ausentes se señalan; no se inventan pasos ni se calculan nutrientes no presentes en la fuente. Si faltan macros, los campos sin información quedan a cero y la receta se marca **Macros pendientes**: no participa en las propuestas automáticas hasta que completes los datos y su origen.

La clave se guarda en SQLite y sus copias de seguridad, y no se devuelve al navegador. El addon mantiene el modelo de acceso local/Ingress existente; no lo publiques en Internet sin control de acceso.

Sin clave, puedes crear recetas manualmente o usar **Importar JSON IA**. El botón de copiar instrucciones proporciona el formato para tu herramienta de IA. La importación JSON actualiza las recetas con el mismo título y las comidas expresamente indicadas; si un elemento falla, no guarda cambios parciales. Exporta el recetario antes de una sustitución amplia.

## Congelar la semana

Cada receta indica si congela bien, si se congela por partes, si se prepara en el día o si su conservación aún necesita revisión. Las recetas antiguas comienzan como **Conservación por revisar**. La propuesta automática puede limitarse a las que hayas marcado como aptas.

La sesión agrupa raciones por plato y muestra cantidades, preparación, notas de congelación y recalentado. Marca los platos cocinados y envasados. Imprime la compra, el plan de cocina y etiquetas por comida con espacio para la fecha de cocinado y congelación. Las etiquetas de varias raciones sirven para un recipiente familiar; si envasas individualmente, identifica cada recipiente.

Las recomendaciones generales de enfriado, descongelación y recalentado están enlazadas a la [Food Standards Agency](https://www.food.gov.uk/safety-hygiene/chilling), con indicaciones específicas para [arroz y sobras](https://www.food.gov.uk/safety-hygiene/home-food-fact-checker). El estado «congela bien» describe la preparación prevista; no sustituye las instrucciones concretas del alimento y la receta.

## Datos y actualización

La versión 1.9.0 añade columnas sin borrar tablas ni menús. Conserva `/data/fitcontroller.db`, los archivos de `/data/uploads` y la copia en `/config/fit_controller`. Las fotos nuevas del recetario se guardan en `uploads/recipes`. Los JSON exportados incluyen referencias a fotos, pero no sus archivos ni claves API.

Las recetas anteriores se mantienen con cantidades por ración. Especialmente en importaciones antiguas de Spoonacular con varias raciones, abre **Editar** y revisa si las cantidades corresponden al lote completo. Las nuevas importaciones de Spoonacular se convierten correctamente a una ración.

## Desarrollo y validación

Node.js 22 con `node:sqlite`. Instala con `npm ci`, ejecuta `npm test` y arranca con `npm start`. No hay compilación del frontend.

Para una prueba aislada puedes configurar `DB_PATH`, `UPLOADS_DIR`, `CONFIG_BACKUP_DIR` y `PORT`. El contenedor usa los valores habituales de Home Assistant.

Las pruebas cubren unidades, fracciones, escalado, importación atómica, persistencia tras reiniciar, aislamiento de semanas, concurrencia de propuestas, subida de imágenes y contratos de importación IA mediante respuestas simuladas. Una prueba con API real requiere tu propia clave; no se realiza automáticamente ni durante `npm test`.

Implementación de IA basada en [Responses y salidas estructuradas](https://developers.openai.com/api/docs/guides/structured-outputs) y [entradas de imagen](https://developers.openai.com/api/docs/guides/images-vision).
