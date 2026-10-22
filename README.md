# Badge Checker

Herramienta local para detectar placas (badges) de Habbo **duplicadas o similares** antes de subirlas a un holo. Compara una placa nueva contra toda la base (~27.000 placas) y también permite auditar la base completa.

- **Duplicados exactos:** la misma imagen a nivel píxel, aunque cambie el borde, el tamaño o la posición.
- **Similares:** el mismo dibujo con cambios de color, ruido, una pequeña edición o desplazado 1px.

Stack: Next.js (App Router) + TypeScript, `sharp` para procesar imágenes y PostgreSQL. Las placas se leen de una carpeta local y nunca se modifican ni se copian al repo.

## Requisitos

- Node.js 24 o superior.
- PostgreSQL 14 o superior (se usa `bit_count()`); hoy corre con PostgreSQL 18 local.
- La carpeta de placas (`.gif`/`.png`).

## Configuración (`.env`)

Copiá `.env.example` a `.env` y completá los valores:

| Variable | Qué es | Valor actual |
|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL. La base es exclusiva del proyecto. | `postgres://…/badge_checker` |
| `BADGES_DIR` | Carpeta con las placas originales (solo lectura). | `C:\Users\Joe\Desktop\badges-all-hotels-gif` |
| `SIM_DHASH_MAX` | Prefiltro: distancia máxima de dHash (0–64). | `20` |
| `SIM_SILHOUETTE_MAX` | Prefiltro: distancia máxima de silueta (0–64). | `10` |
| `SIM_DESIGN_MIN` | Score de diseño mínimo para la **web de verificación** (0–1). | `0.575` (~93% de precisión) |
| `SIM_SCAN_DESIGN_MIN` | Score de diseño mínimo para el **escaneo completo** (0–1). | `0.725` (~99% de precisión) |

Los umbrales de diseño se calibraron con 409 pares etiquetados a mano (ver `npm run calibrate`).

## Puesta en marcha (primera vez)

```bash
npm install
```
```bash
npm run dev
```

Después abrí `http://localhost:3000`. Si la base todavía no existe, la web muestra el popup **"Primera ejecución"**: explica que hace falta una base de datos para guardar los hashes y, con el botón **Crear base de datos**, la crea, aplica las migraciones, indexa todas las placas y hace el primer escaneo, mostrando el progreso (unos 2 minutos con 27.000 placas). Si no se puede conectar a PostgreSQL, el popup lo indica y ofrece **Reintentar**.

## Comandos npm

### Desarrollo y calidad

#### `npm run dev`
Levanta la web en modo desarrollo en `http://localhost:3000`, con recarga automática al editar código. Al iniciar no indexa ni escanea; si hay migraciones nuevas, las aplica sola. Las páginas son:

- `/` — **Verificar:** subís una placa (arrastrando, con clic o pegándola con Ctrl+V) y muestra los duplicados exactos y las similares, cada una ampliada en pixel-art al lado de la tuya. El slider de diseño ajusta el umbral en vivo; dHash y silueta están en "Prefiltro".
- `/scan` — **Escaneo:** los grupos de duplicados y de similares que ya existen en la base, según el último `npm run scan`.
- `/calibrate` — **Calibración:** etiquetado de pares para calibrar los umbrales.

**Aviso de cambios y botón "Actualizar BD".** En todas las páginas, la web compara la carpeta de placas con la base al cargar y cada vez que volvés a la pestaña. Si hay placas nuevas, modificadas, eliminadas o restauradas, o si el escaneo es anterior a los últimos cambios, muestra un aviso con los conteos ("Ver placas" lista los nombres) y un botón **Actualizar BD**. El botón hace en segundo plano lo mismo que `npm run index` y, si hace falta, `npm run scan`, mostrando el progreso. Al terminar, `/scan` se actualiza solo. Si no hay cambios, no se muestra nada.

Revisar la carpeta tarda unos 2–3 s con 27.000 placas, pero no frena la página: el aviso aparece cuando termina.

#### `npm run build` / `npm run start`
Compila la app para producción y la sirve. Es lo mismo que `dev` pero optimizado y sin recarga automática.

#### `npm test`
Corre todos los tests con Vitest. No necesitan la base de datos: generan placas sintéticas en memoria. Cubren:

- La misma placa en 40x40 y en 42x42 con 1px de borde.
- Una 42x42 con el diseño descentrado.
- Dos 42x42 que solo difieren en el borde exterior.
- Recoloreada, desplazada 1px, y borde blanco contra transparente (no debe ser exacta).
- Diseños distintos con la misma silueta, y franjas horizontales contra verticales.
- GIF con frames repetidos, animada contra su versión estática y animada con un frame vacío.
- Agrupamiento y las estimaciones de la calibración.
- Qué placas son nuevas, modificadas, eliminadas o restauradas, y el freno de seguridad.
- Cómo se interpretan los errores de conexión a PostgreSQL.

Para correr un solo archivo o un solo test:

```bash
npx vitest run tests/core.test.ts -t "empty frame"
```

#### `npm run typecheck`
Verifica los tipos de TypeScript de todo el proyecto (`tsc --noEmit`) sin generar archivos.

### Base de datos (automática)

No hay comandos para la base: se crea y se migra sola.

- **Creación:** desde el popup de primera ejecución de la web, o al correr cualquier comando que la usa (`index`, `scan`, `compare`, `calibrate`), que la crea sin preguntar e informa "Base … creada". Para crearla se conecta a la base `postgres` del servidor con el mismo usuario de `DATABASE_URL`.
- **Migraciones:** los archivos nuevos de `src/data/migrations/` se aplican solos, en orden y cada uno en una transacción, la primera vez que la web o un comando usa la base. Se registran en `schema_migrations`. Hoy hay 8:

| Migración | Qué crea |
|---|---|
| `001_init` | Placas, hashes exactos, huellas por frame y errores de indexado. |
| `002_edge_map` | Mapa de bordes y versión del análisis. |
| `003_scan`, `004_scan_group_position` | Resultados del escaneo. |
| `005_calibration`, `007_calibration_restratify` | Calibración. |
| `006_oriented_edges` | Bordes orientados, el score actual. |
| `008_missing_badges` | Marca de placas eliminadas de la carpeta (borrado suave). |

### Indexado

#### `npm run index`
Recorre `BADGES_DIR` y guarda en la base, por cada placa:

- Nombre, tamaño original y formato.
- Frames únicos y si es animada.
- Hashes exactos.
- Huellas por frame: dHash, silueta y mapa de bordes.

Es **incremental**: solo procesa las placas nuevas, las modificadas (cambió el tamaño o la fecha del archivo), las restauradas y las que fueron indexadas con una versión anterior del análisis. Sobre la base completa tarda unos 70 s; si no hay nada nuevo, unos segundos. Es lo mismo que hace el botón **Actualizar BD** de la web.

**Placas eliminadas de la carpeta (borrado suave).** No se borran de la base: se marcan como eliminadas y se les quitan los hashes y las huellas, así que dejan de aparecer en la verificación, en `compare` y en el escaneo. Conservan su registro y sus etiquetas de calibración, y si el archivo vuelve a la carpeta se reindexan solas.

**Freno de seguridad.** Si de una vez falta más del 5% de las placas (por ejemplo, porque `BADGES_DIR` apunta a otra carpeta o a un disco desconectado), no se marca ninguna: el indexador avisa y la web muestra un aviso con el botón "Marcar igual como eliminadas". Desde la terminal se fuerza con `--allow-mass-missing`.

El código de la placa (nombre del archivo) es su identidad: si renombrás una placa, la vieja queda como eliminada y la nueva se indexa aparte. Si dos placas con distinto código tienen el mismo contenido, se informan como duplicado exacto.

Muestra el progreso y, al terminar, un resumen:

- Total indexado y cantidad por tamaño.
- Placas animadas con su listado.
- Tamaños fuera de 40x40/42x42.
- Archivos con error.
- Placas eliminadas de la carpeta.

Los archivos ilegibles se registran sin cortar la ejecución y se reintentan cuando el archivo cambia. Los listados completos quedan en `reports/` (`rare-sizes.csv`, `animated.csv`, `errors.csv`).

Opciones:

- `--limit N`: procesa como máximo N placas pendientes. Sirve para probar con una muestra:

```bash
npm run index -- --limit 200
```

- `--allow-mass-missing`: marca las placas eliminadas aunque se active el freno de seguridad.

> `npm run index`, `npm run scan` y el botón **Actualizar BD** no pueden correr a la vez: si ya hay una actualización en curso, el segundo avisa y no hace nada.

### Comparación y escaneo

#### `npm run compare -- <imagen>`
Compara una imagen contra la base desde la terminal; es lo mismo que la página de verificación. Lista:

- Los duplicados exactos, indicando si son idénticos, idénticos al recortar a 40x40 o con el mismo contenido en otra posición.
- Las similares ordenadas por score de diseño, con sus distancias de dHash y silueta.

Opciones:

| Opción | Qué hace | Por defecto |
|---|---|---|
| `--design N` | Score de diseño mínimo (0–1). | `SIM_DESIGN_MIN` |
| `--dhash N` | Distancia máxima de dHash para el prefiltro. | `SIM_DHASH_MAX` |
| `--sil N` | Distancia máxima de silueta para el prefiltro. | `SIM_SILHOUETTE_MAX` |
| `--limit N` | Cantidad máxima de similares a listar. | 30 |

```bash
npm run compare -- "C:\ruta\placa-nueva.gif" --design 0.5 --limit 50
```

#### `npm run scan`
Analiza toda la base contra sí misma y guarda el resultado, que es lo que muestra `/scan`. Tarda unos 35–40 s.

- **Duplicados exactos:** pares de placas que comparten algún hash exacto, agrupados por componentes conexas. Si A = B y B = C, van al mismo grupo.
- **Similares:** pares que pasan el prefiltro y el score de diseño, agrupados en grupos "estrella": una placa central y las placas que se parecen directamente a ella. Los grupos no se encadenan.

Cada escaneo reemplaza al anterior. Al terminar imprime los totales y los grupos más grandes.

Opciones: `--design N`, `--dhash N` y `--sil N`. Por defecto usa `SIM_SCAN_DESIGN_MIN` y el mismo prefiltro que la web.

### Calibración

#### `npm run calibrate`
Calcula e imprime el informe de calibración de umbrales:

- Etiquetas por franja de score de diseño (franjas de 2,5 puntos, de 45% a 100%).
- Por cada umbral posible, estimado sobre toda la base:
  - **Precisión:** de los pares reportados, cuántos son realmente parecidos según tus etiquetas.
  - **Cobertura:** de los pares parecidos, cuántos se reportan.
  - **Falsos por consulta:** placas no relacionadas que aparecen en promedio al verificar una placa.
- Qué porcentaje de variantes sintéticas se sigue detectando: placas reales recoloreadas, con otros colores, desplazadas, con ruido, con un bloque editado o con paleta reducida.

Las etiquetas se cargan en `/calibrate`. La página muestra cada par ampliado sin nombres ni score para no condicionarte, y se responde con el teclado: **P** parecida, **N** no parecida, **Espacio** no sé, **Z** deshacer.

Si todavía no hay una muestra de pares, la genera automáticamente.

Opciones:

| Opción | Qué hace | Por defecto |
|---|---|---|
| `--sample` | Vuelve a armar la muestra: reubica los pares existentes según su score actual y completa cada franja hasta `--per` pares. Las etiquetas se conservan; los pares que bajan de 45% quedan afuera. | — |
| `--per N` | Pares por franja al muestrear. | 12 |
| `--synthetic N` | Cantidad de placas reales para medir las variantes sintéticas. Con `0` se omite y el informe es instantáneo. | 300 |

```bash
npm run calibrate -- --synthetic 0
npm run calibrate -- --sample --per 20
```

## Cómo se detecta

1. **Normalización.** Cada frame se lleva a 40x40 **sin reescalar**:
   - Recorte centrado si es más grande, relleno transparente centrado si es más chico. Si la diferencia es impar, el píxel extra va abajo/derecha.
   - Los píxeles con alfa 0 se normalizan a (0,0,0,0).
   - En los GIF se usan los frames ya compuestos y se descartan los repetidos. Una placa con un solo frame distinto se trata como estática.
2. **Duplicado exacto.** SHA-256 sobre los píxeles, no sobre el archivo:
   - Imagen completa: "Idéntica".
   - Recorte 40x40, más las 9 posiciones de recorte posibles en las 42x42: "Idéntica al recortar".
   - Recorte a los píxeles visibles: "Mismo contenido, distinto relleno/posición".
3. **Similitud.** Una placa es similar si cumple las tres condiciones:
   - **dHash** (luces y sombras, 64 bits) ≤ 20.
   - **Silueta** (forma visible, 64 bits) ≤ 10.
   - **Score de diseño** ≥ el umbral. Es la superposición de los mapas de bordes orientados: dónde cambia el color en horizontal y en vertical, ignorando la paleta y tolerando 1px de desplazamiento.

   Los dos hashes son un prefiltro barato; el score de diseño es la verificación real y lo calcula PostgreSQL (`edge_iou()`).
4. **Animadas.** Cada frame único tiene sus propias huellas, y hay coincidencia si cualquier frame coincide. Así, la versión estática de una placa animada también se detecta.

## Estado actual

- **Base:** 27.034 archivos en la carpeta; 27.028 indexados. Los 6 restantes no son placas: 3 son restos de macOS (`BR040`, `CCS01`, `IT505`) y 3 son archivos de Photoshop con extensión `.gif` (`HBN07`, `NO012`, `V2015`).
- **Duplicados exactos:** 555 grupos, que abarcan 2.086 placas.
- **Umbrales:** calibrados con 409 pares etiquetados. 0,575 para la web (~93% de precisión) y 0,725 para el escaneo (~99%).

### Limitaciones conocidas

- La base no se actualiza sola: la web avisa de los cambios en la carpeta, pero hay que tocar **Actualizar BD** (o correr `npm run index` y `npm run scan`).
- Placas de la **misma plantilla con distinto ícono o número**, como los `ACH_*` con números romanos, suelen quedar por debajo del umbral, porque el score compara el dibujo completo.
- Las placas de más de 42px usan solo el recorte centrado; se listan en `reports/rare-sizes.csv` para revisarlas.

### Preparado para el deploy

La capa de datos (`src/data/`, SQL plano con `pg`) y el almacenamiento de imágenes (`src/storage/`, interfaz `ImageStore`) están desacoplados. Para pasar a Vercel + Supabase se cambia `DATABASE_URL` y se agrega una implementación de `ImageStore` para Supabase Storage.
