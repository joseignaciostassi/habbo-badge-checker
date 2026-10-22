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

Los umbrales de diseño se calibraron con 409 pares etiquetados a mano (ver **Calibración** más abajo). Si cambiás `SIM_SCAN_DESIGN_MIN` (o el prefiltro), la web avisa que el escaneo quedó desactualizado y **Actualizar BD** lo rehace completo con los umbrales nuevos.

## Puesta en marcha (primera vez)

```bash
npm install
```
```bash
npm run dev
```

Después abrí `http://localhost:3000`. Si la base todavía no existe, la web muestra el popup **"Primera ejecución"**: explica que hace falta una base de datos para guardar los hashes y, con el botón **Crear base de datos**, la crea, aplica las migraciones, indexa todas las placas y hace el primer escaneo, mostrando el progreso (unos 2 minutos con 27.000 placas). Si no se puede conectar a PostgreSQL, el popup lo indica y ofrece **Reintentar**.

Todo se usa desde la web: no hay comandos para indexar, escanear ni calibrar.

## Comandos npm

#### `npm run dev`
Levanta la web en modo desarrollo en `http://localhost:3000`, con recarga automática al editar código. Al iniciar no indexa ni escanea; si hay migraciones nuevas, las aplica sola.

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
- Cuándo el escaneo puede ser incremental.
- Cómo se interpretan los errores de conexión a PostgreSQL.
- Los límites de la placa a verificar: extensión, formato real, peso y dimensiones.

Para correr un solo archivo o un solo test:

```bash
npx vitest run tests/core.test.ts -t "empty frame"
```

#### `npm run typecheck`
Verifica los tipos de TypeScript de todo el proyecto (`tsc --noEmit`) sin generar archivos.

## La aplicación

### Verificar (`/`)
Subís una placa (arrastrando, con clic o pegándola con Ctrl+V) y muestra los duplicados exactos y las similares, cada una ampliada en pixel-art al lado de la tuya. El slider de diseño ajusta el umbral en vivo; dHash y silueta están en "Prefiltro", con una explicación de cada uno. Solo acepta archivos `.gif` o `.png` con contenido GIF o PNG real, de hasta 50x50 y 200 KB; si no cumple, lo indica sin enviarlo.

### Aviso de cambios y "Actualizar BD"
En todas las páginas, la web compara la carpeta de placas con la base al cargar y cada vez que volvés a la pestaña (tarda unos 2–3 s con 27.000 placas, sin frenar la página). Si hay placas nuevas, modificadas, eliminadas o restauradas, o si el escaneo quedó desactualizado, muestra un aviso con los conteos ("Ver placas" lista los nombres) y el botón **Actualizar BD**, que en segundo plano y mostrando el progreso:

1. **Indexa** las placas nuevas, las modificadas (cambió el tamaño o la fecha del archivo), las restauradas y las que fueron indexadas con una versión anterior del análisis. Por cada una guarda nombre, tamaño original, formato, frames únicos, si es animada, hashes exactos y huellas por frame (dHash, silueta y mapa de bordes). Sobre la base completa tarda unos 70 s. Los archivos ilegibles se registran sin cortar el proceso y se reintentan cuando el archivo cambia.
2. **Actualiza el escaneo**, de forma **incremental**: solo compara las placas que cambiaron contra toda la base y conserva el resto de los pares, así que con unas pocas placas nuevas tarda menos de un segundo. Hace un escaneo completo (~35 s) si no hay uno previo, si cambiaron los umbrales o si cambió más del 25% de las placas.

Al terminar, `/scan` se actualiza solo. Si no hay cambios, no se muestra nada.

**Placas eliminadas de la carpeta (borrado suave).** No se borran de la base: se marcan como eliminadas y se les quitan los hashes y las huellas, así que dejan de aparecer en la verificación y en el escaneo. Conservan su registro y sus etiquetas de calibración, y si el archivo vuelve a la carpeta se reindexan solas.

**Freno de seguridad.** Si de una vez falta más del 5% de las placas (por ejemplo, porque `BADGES_DIR` apunta a otra carpeta o a un disco desconectado), no se marca ninguna: la web muestra un aviso con el botón "Marcar igual como eliminadas".

El código de la placa (nombre del archivo) es su identidad: si renombrás una placa, la vieja queda como eliminada y la nueva se indexa aparte. Si dos placas con distinto código tienen el mismo contenido, se informan como duplicado exacto.

### Escaneo (`/scan`)
Los grupos de duplicados y de similares que ya existen en la base, según el último escaneo:

- **Duplicados exactos:** pares de placas que comparten algún hash exacto, agrupados por componentes conexas. Si A = B y B = C, van al mismo grupo.
- **Similares:** pares que pasan el prefiltro y el score de diseño (`SIM_SCAN_DESIGN_MIN`), agrupados en grupos "estrella": una placa central (con borde naranja) y las placas que se parecen directamente a ella. Los grupos no se encadenan.

### Calibración (`/calibrate`)
Sirve para elegir los umbrales de diseño a partir de tus propias etiquetas. La página muestra cada par ampliado, sin nombres ni score para no condicionarte, y se responde con el teclado: **P** parecida, **N** no parecida, **Espacio** no sé, **Z** deshacer.

- **Generar más pares:** busca pares candidatos en toda la base (~35 s) y suma hasta 12 pares nuevos en cada franja de score de diseño (franjas de 2,5 puntos, de 45% a 100%). Antes reubica los pares existentes según su score actual; las etiquetas se conservan y los pares que bajan de 45% dejan de contar. La primera vez arma la muestra inicial.
- **Estimación por umbral**, sobre toda la base:
  - **Precisión:** de los pares reportados, cuántos son realmente parecidos según tus etiquetas.
  - **Cobertura:** de los pares parecidos, cuántos se reportan.
  - **Falsos por consulta:** placas no relacionadas que aparecen en promedio al verificar una placa.

Con eso elegís los valores de `SIM_DESIGN_MIN` y `SIM_SCAN_DESIGN_MIN` en `.env`.

> **Actualizar BD** y **Generar más pares** no pueden correr a la vez: si ya hay uno en curso, el otro avisa y no hace nada.

### Base de datos (automática)

No hay comandos para la base: se crea y se migra sola.

- **Creación:** desde el popup de primera ejecución. Para crearla se conecta a la base `postgres` del servidor con el mismo usuario de `DATABASE_URL`.
- **Migraciones:** los archivos nuevos de `src/data/migrations/` se aplican solos, en orden y cada uno en una transacción, la primera vez que la web usa la base. Se registran en `schema_migrations`. Hoy hay 8:

| Migración | Qué crea |
|---|---|
| `001_init` | Placas, hashes exactos, huellas por frame y errores de indexado. |
| `002_edge_map` | Mapa de bordes y versión del análisis. |
| `003_scan`, `004_scan_group_position` | Resultados del escaneo. |
| `005_calibration`, `007_calibration_restratify` | Calibración. |
| `006_oriented_edges` | Bordes orientados, el score actual. |
| `008_missing_badges` | Marca de placas eliminadas de la carpeta (borrado suave). |

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

- La base no se actualiza sola: la web avisa de los cambios en la carpeta, pero hay que tocar **Actualizar BD**.
- Placas de la **misma plantilla con distinto ícono o número**, como los `ACH_*` con números romanos, suelen quedar por debajo del umbral, porque el score compara el dibujo completo.
- Las placas de más de 42px usan solo el recorte centrado.

### Preparado para el deploy

La capa de datos (`src/data/`, SQL plano con `pg`) y el almacenamiento de imágenes (`src/storage/`, interfaz `ImageStore`) están desacoplados. Para pasar a Vercel + Supabase se cambia `DATABASE_URL` y se agrega una implementación de `ImageStore` para Supabase Storage.
