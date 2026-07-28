# Corrientes Territorial — Handoff técnico, funcional y operativo

**Proyecto:** Corrientes Territorial  
**Repositorio:** `evacristo/vbn`  
**Fecha de corte:** 27 de julio de 2026  
**Producto principal:** Mobile Pro  
**Audiencia:** mantenedores, desarrolladores, operadores territoriales, administradores de infraestructura y futuras instancias de ChatGPT/Codex.

> Este documento es el punto de entrada para continuar el proyecto. Debe leerse antes de modificar el frontend, los datos electorales, el backend, las pruebas o el modelo de sincronización.

---

## 1. Resumen ejecutivo

Corrientes Territorial es una herramienta **mobile-first** de inteligencia política y electoral para Corrientes. El producto principal es una aplicación web instalable, diseñada para teléfono y iPad, publicada en GitHub Pages. Combina:

- una capa pública de candidaturas, resultados, geometrías y fuentes oficiales;
- una capa privada de CRM político, notas, relaciones, agenda, visitas, alertas, informes, importaciones y evaluación territorial.

Funciona en dos modos:

1. **Local-first:** toda la operación funciona sin backend. El workspace se guarda en `localStorage` y los adjuntos en `IndexedDB`.
2. **Colaborativo:** el backend privado ya está implementado para Cloudflare Workers, D1 y R2. Agrega usuarios, roles, sesiones, sincronización, historial, auditoría y adjuntos compartidos. Falta únicamente la autorización humana de una cuenta Cloudflare y el bootstrap inicial.

### Estado por componente

| Componente | Estado | Observación |
|---|---|---|
| Mobile Pro | Publicado y testable | Superficie principal móvil |
| Datos oficiales 2025 | Publicados | Candidaturas, resultados y geometrías |
| Trabajo offline | Implementado | `localStorage` + `IndexedDB` |
| PWA | Implementada | Manifest, icono y service worker |
| CRM/visitas/alertas/informes | Implementados | Probados en teléfono e iPad |
| Backend privado | Código fusionado, no activado | Requiere autorizar Cloudflare |
| Usuarios y roles | Implementados | Admin, editor y viewer |
| Sync multi-dispositivo | Implementada | Requiere endpoint remoto |
| ChatGPT App/MCP | Prototipo compilable | Complementaria, no desplegada |
| Login local | Barrera visual | Usuario y contraseña iguales; no es seguridad real |
| Login remoto | Implementado | PBKDF2, sesiones y roles server-side |

### Enlace canónico

```text
https://evacristo.github.io/vbn/territorio-mobile-pro/launch.html
```

Usar siempre `launch.html`, no `index.html`. El launcher solicita el HTML con `cache: no-store` y reescribe versiones de recursos para reducir problemas de caché en Safari/iOS.

---

## 2. Principios no negociables

### Mobile-first real

- Diseñar primero para 390–430 px.
- Probar también en iPad a 820 × 1180.
- No depender de `hover`.
- Controles táctiles de 44–48 px como mínimo.
- Formularios de una columna y navegación inferior.
- Evitar dependencias pesadas cuando SVG/JavaScript nativo alcance.
- Ninguna fuente secundaria debe bloquear el mapa o la interfaz.
- Los flujos operativos y administrativos deben poder hacerse desde un teléfono.

### Separación entre oficial y privado

**Sólo lectura oficial:** candidaturas, categorías, jurisdicciones, votos, porcentajes, posiciones, geometrías y URLs fuente.

**Editable privado:** CRM, notas, etiquetas, prioridades, relaciones, inferencias, agenda, visitas, alertas y evaluaciones.

Nunca presentar una inferencia del usuario como dato oficial.

### Semántica electoral

- El porcentaje pertenece a la lista o fórmula, no individualmente a la persona.
- Gobernador/vice comparten fórmula.
- Intendente/vice comparten resultado ejecutivo.
- Senadores, diputados y concejales comparten el resultado de su lista/categoría.
- No reutilizar Intendente para Concejales ni viceversa.
- “Candidato” no implica “electo”. Para electos hacen falta actas de proclamación.
- Describir faltantes como “sin lista oficial localizada”, no como ausencia política absoluta.

### Evidencia de relaciones

Cada relación privada debe conservar tipo, fuente, estado, confianza, nota y fecha. Estados:

- `official`;
- `declared`;
- `inferred`;
- `review`.

---

## 3. Repositorio y ramas

Repositorio:

```text
https://github.com/evacristo/vbn
```

- Rama predeterminada: `main`.
- Sitio publicado: `gh-pages`.
- PR principal Mobile Pro/backend: `#3`.
- Merge: `b48a5661481b8d8cb8191c4413a70151459bc422`.
- Corrección posterior del botón Cloudflare: `50638ba6c34d7d53008af4f77bba50b0c3c52933`.

### `main`

Contiene backend, prototipo ChatGPT App/MCP, workflows, documentación y este handoff.

### `gh-pages`

Contiene frontend publicado, datasets, geometrías, Mobile Next, Mobile Pro y rutas históricas.

### Riesgo estructural

El frontend vivo está en `gh-pages`, mientras backend/tests están en `main`. Un cambio completo puede exigir commits coordinados en dos ramas. Los tests UI hacen un segundo checkout de `gh-pages`.

**Recomendación futura:** mover la fuente frontend a `main` y generar `gh-pages` mediante workflow para evitar divergencia.

---

## 4. URLs y superficies

Producto:

```text
https://evacristo.github.io/vbn/territorio-mobile-pro/launch.html
```

Directo para diagnóstico:

```text
https://evacristo.github.io/vbn/territorio-mobile-pro/index.html
```

Mobile Next heredada:

```text
https://evacristo.github.io/vbn/territorio-mobile-next/
```

Datos:

```text
https://evacristo.github.io/vbn/lla-candidates-2025.json
https://evacristo.github.io/vbn/election-results-2025.json
```

Backend one-click:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/evacristo/vbn/tree/main/territorio-backend
```

Rutas históricas como `mobile-v2.html`, `mobile-v3.html`, `fix-mobile-map.html` y `territorio-mobile/` no son el producto principal.

---

## 5. Historia y decisiones

### PWA/mapa inicial

La primera PWA sufrió caché persistente y service workers viejos en Safari. También hubo un archivo JavaScript de resultados vacío que dejó el mapa sin datos.

Decisiones adoptadas:

- geometrías empaquetadas localmente;
- `cache: no-store` para datos;
- reintentos;
- launcher con versionado;
- mapa tolerante a fallos;
- rutas nuevas para saltos importantes.

### Candidaturas LLA

Se procesaron PDF oficiales Corrientes 2025. Resultado reportado:

- 74 municipios revisados;
- 58 con listas oficiales LLA localizadas;
- 470 personas;
- 471 nominaciones;
- 1.000 relaciones estructurales del dataset;
- 16 municipios sin lista oficial localizada;
- sin DNI.

### Auditoría de resultados

Se corrigió la mezcla de porcentajes por persona y categorías. Cobertura final:

- provincia;
- 25 departamentos;
- 74 municipios;
- 100 jurisdicciones;
- 3.013 resultados alianza/categoría/jurisdicción;
- 417 resultados LLA;
- 471 candidaturas enlazadas a su categoría y territorio.

Controles conocidos:

- Monte Caseros: Intendente 14,87%; Concejales 11,47%.
- Ramada Paso: Intendente 1,67%; Concejales 2,96%.
- Provincia: Gobernador 9,51%; Senadores 9,99%; Diputados 10,11%.

---

## 6. Arquitectura

```text
GitHub Pages / gh-pages
  ├── Datos públicos oficiales
  ├── Mobile Next (base heredada)
  └── Mobile Pro
       ├── localStorage: workspace
       ├── IndexedDB: adjuntos
       └── service worker: shell/offline

Mobile Pro ── HTTPS/Bearer/cookie ──> Cloudflare Worker
                                           ├── D1: usuarios, sesiones, sync, audit
                                           └── R2: adjuntos privados

ChatGPT App/MCP experimental
  └── consulta conversacional; no es la superficie móvil primaria
```

La arquitectura es **local-first**: una caída de red no debe impedir consultar o registrar trabajo.

---

## 7. Frontend Mobile Pro

### Secuencia de carga

1. `launch.html` solicita `index.html` con `cache: no-store`.
2. Reescribe versiones de `pro-addon.js` y `pro.css`.
3. `index.html` carga CSS base de Mobile Next y CSS Pro.
4. Carga:
   - `core-v2.js`;
   - `workspace-v2.js`;
   - `views-v2.js`;
   - `pro-addon.js`;
   - `main-v2.js`.
5. `pro-addon.js` inyecta:
   - `pro-addon-main.js`;
   - `coverage-addon.js`;
   - `backend-setup-addon.js`;
   - `remote-auth-addon.js`;
   - `admin-addon.js`;
   - `team-admin-addon.js`;
   - `team-admin-bridge.js`;
   - `viewer-guard-addon.js`;
   - `startup-guard-addon.js`.

### Archivos principales en `gh-pages/territorio-mobile-pro`

| Archivo | Responsabilidad |
|---|---|
| `launch.html` | entrada y anti-caché |
| `index.html` | estructura de vistas |
| `manifest.webmanifest` | instalación PWA |
| `icon.svg` | icono |
| `pro.css` | estilos Pro |
| `pro-addon.js` | loader de add-ons |
| `pro-addon-main.js` | CRM, visitas, alertas, informes, importación, PWA |
| `coverage-addon.js` | cobertura de 74 municipios |
| `backend-setup-addon.js` | deploy, health y bootstrap |
| `remote-auth-addon.js` | auth remota, push/pull, conflictos y archivos |
| `admin-addon.js` | alta rápida de usuarios |
| `team-admin-addon.js` | organización, roles, sesiones, historial y auditoría |
| `team-admin-bridge.js` | refresco tras login/logout |
| `viewer-guard-addon.js` | bloqueo visual para viewer |
| `startup-guard-addon.js` | evita render prematuro |
| `sw.js` | offline/cache |

### Dependencia de Mobile Next

Mobile Pro hereda:

```text
../territorio-mobile-next/styles-v2.css
../territorio-mobile-next/core-v2.js
../territorio-mobile-next/workspace-v2.js
../territorio-mobile-next/views-v2.js
../territorio-mobile-next/main-v2.js
```

No borrar ni renombrar sin refactor y pruebas.

### Versiones al corte

- Launcher: `20260726-sync4`.
- Build Pro: `2026.07.26-mobile-pro-1`.
- Service worker: `ct-pro-20260726-5`.
- Manifest start URL: `launch.html?source=installed-sync4`.

Actualizar coordinadamente al publicar recursos críticos.

---

## 8. Datos oficiales

Archivos:

```text
lla-candidates-2025.json
election-results-2025.json
map-departments.js
map-municipalities-1.js
map-municipalities-2.js
```

### Candidaturas

```json
{
  "people": [{"id":"...","name":"..."}],
  "nominations": [{
    "personId":"...",
    "office":"Intendente",
    "jurisdiction":"Goya",
    "level":"municipal",
    "roleKey":"mayor",
    "order":1,
    "sourceUrl":"https://..."
  }]
}
```

### Resultados

```json
{
  "jurisdictionType":"municipality",
  "jurisdiction":"Goya",
  "category":"Intendente",
  "alliance":"LA LIBERTAD AVANZA",
  "votes":0,
  "validVotes":0,
  "percentageDisplayed":0.0,
  "sourceUrl":"https://..."
}
```

### Geometría

```js
["Territorio", "M ... Z", [xCentro, yCentro]]
```

Mapa SVG nativo, sin Google Maps/Leaflet/Mapbox.

### Normalización

Se eliminan tildes/puntuación, se comprimen espacios y se aplican aliases. Ejemplos:

- Capital/Ciudad de Corrientes → Corrientes;
- Berón de Astrada → San Antonio de Itatí;
- Carlos Pellegrini → Colonia Carlos Pellegrini;
- Concepción → Concepción del Yaguareté Corá;
- Mantilla → Pedro R. Fernández;
- Santa Rosa → Colonia Santa Rosa.

`coverage-addon.js` une candidaturas, geometría y resultados para que los selectores muestren 74 municipios y no sólo los 58 con lista localizada.

### Limitaciones

- Sin DNI.
- Sin condición de electo.
- Sin actas de proclamación.
- Sin serie histórica completa.
- Puede haber persona con más de una nominación.
- Falta tabla explícita municipio → departamento para resolver perfectamente categorías provinciales desde un perfil municipal.

---

## 9. Workspace local versión 3

### Claves

```text
ct_mobile_session_v2
ct_mobile_workspace_v3:<usuario>
ct_mobile_workspace_v2:<usuario>
ct_mobile_workspace_v1:<usuario>
ct_device_id
IndexedDB: corrientes-territorial-pro / attachments
```

### Forma aproximada

```json
{
  "version":3,
  "user":"Ivo",
  "relations":[],
  "personNotes":{},
  "personTags":{},
  "territoryNotes":{},
  "territoryTags":{},
  "territoryMeta":{},
  "favoritesPeople":[],
  "favoritesTerritories":[],
  "recent":[],
  "agenda":[],
  "sourceReviews":{},
  "settings":{"theme":"system","font":"normal","compact":false},
  "audit":[],
  "snapshots":[],
  "personProfiles":{},
  "customPeople":[],
  "visits":[],
  "dismissedAlerts":[],
  "importHistory":[],
  "deletedRecords":[],
  "lastReport":{},
  "security":{"autoLockMinutes":15,"lastBackup":"","hideOnBackground":true},
  "sync":{
    "endpoint":"",
    "token":"",
    "deviceId":"device-...",
    "lastPull":"",
    "lastPush":"",
    "lastError":"",
    "pending":false,
    "revision":0,
    "remoteUser":null,
    "organization":null
  }
}
```

### Relaciones

Tipos:

- `referente_de`;
- `responde_a`;
- `aliado_de`;
- `equipo_de`;
- `formula_con`;
- `vinculo_politico`;
- `otro`.

### CRM

Campos principales: teléfono, WhatsApp, correo, redes, estado, influencia, afinidad, capacidad, último contacto, próxima acción, responsable, organización y rol.

Estados: `uncontacted`, `contacted`, `meeting`, `active`, `inactive`.

### Agenda

Tipos: seguimiento, reunión, llamada, evento, investigación y otro. Puede asociar persona y territorio.

### Visitas

Guarda territorio, fecha, presentes, problemas, compromisos, próximo paso, responsable, estado, notas, GPS y metadatos de adjuntos.

Adjuntos locales:

- blob en IndexedDB;
- metadata en workspace;
- no incluidos en export JSON;
- cliente: 8 MB por archivo y 25 MB por lote;
- backend: 12 MB por archivo.

---

## 10. Funciones del producto

### Inicio

KPIs, accesos rápidos, situación, alertas, visitas abiertas, contactos gestionados, cambios pendientes, desempeño, mediana territorial, recientes, salud de datos y sync.

### Mapa

- departamento/municipio;
- cinco categorías;
- búsqueda;
- zoom/reset;
- ranking;
- votos, porcentaje, posición y válidos;
- fuente oficial;
- favoritos y acceso al perfil.

“Sin dato” no equivale a cero.

### Personas/CRM

Búsqueda por nombre, cargo, municipio, etiquetas, notas, teléfono, correo, organización y próxima acción. Filtros de vínculo, favoritos y seguimiento. Ficha con candidaturas, resultados, fuentes y CRM completo.

### Territorios

Candidaturas, resultados, prioridad, estado, responsable, notas, etiquetas, favorito, mapa, comparación, visita, inteligencia e historial.

### Comparador

Dos territorios, una categoría: votos, válidos, porcentaje, diferencia, candidaturas y notas.

### Red política

Crear/editar/eliminar relaciones, filtros, vista circular, vista de centralidad y ranking de grado. La centralidad es grado simple, no una afirmación causal de poder.

### Agenda

Crear, editar, completar, reabrir y eliminar actividades.

### Fuentes

Inventario de URLs de candidaturas, resultados y relaciones; búsqueda, tipo, estado pendiente/verificada y cobertura.

### Visitas

Trabajo territorial offline con ubicación y adjuntos. Al activar sync, los adjuntos pendientes se suben a R2.

### Alertas

Genera alertas por:

- tareas vencidas;
- visitas abiertas >14 días;
- seguimiento CRM vencido;
- contacto desactualizado >30 días;
- favorito sin contacto;
- territorio sin responsable;
- relación con confianza baja;
- fuentes pendientes;
- backup ausente/viejo;
- teléfono duplicado;
- cambios sin sincronizar.

### Informes

- territorial;
- persona;
- semanal;
- ranking;
- dossier de reunión.

Salida imprimible/PDF, Web Share API o portapapeles.

### Importación

Texto pegado y CSV, con bandeja de revisión. La extracción es heurística.

### Respaldo/exportaciones

- JSON completo sin token;
- candidaturas CSV;
- resultados CSV;
- relaciones CSV;
- agenda CSV;
- visitas CSV;
- CRM CSV.

### Privacidad local

- shield al ir a segundo plano;
- auto-lock;
- datos no cifrados;
- login local no seguro.

### PWA

Manifest standalone, icono maskable, service worker, shell cacheado y datos network-first con fallback.

---

## 11. Inteligencia y algoritmos

### Índice territorial

Variables:

- `pct`: máximo entre Intendente y Concejales;
- `network = min(100, relaciones × 12)`;
- `contact`: porcentaje de candidatos con CRM iniciado;
- `activity = min(100, visitas × 18 + agenda × 8)`.

```text
score = round(min(100,
  pct * 2
  + network * 0.25
  + contact * 0.20
  + activity * 0.20
))
```

Es una heurística interna, no un dato oficial ni científico.

### Posición electoral

Se ordenan alianzas de categoría/jurisdicción por porcentaje y votos; se localiza la alianza normalizada `LA LIBERTAD AVANZA`.

---

## 12. Sincronización cliente

### Payload compartido

Arrays:

- `relations`;
- `agenda`;
- `visits`;
- `customPeople`;
- `importHistory`;
- `deletedRecords`.

Objetos:

- `personProfiles`;
- `personNotes`;
- `personTags`;
- `territoryNotes`;
- `territoryTags`;
- `territoryMeta`;
- `sourceReviews`.

No se comparte token, configuración de UI, recientes, snapshots ni auditoría local.

### Push

1. Subir adjuntos pendientes.
2. Enviar workspace y revisión.
3. Ante `409`, descargar/fusionar.
4. Reintentar con revisión nueva y `force`.
5. Guardar revisión/estado.

### Merge

Arrays con ID: conserva el registro con `updatedAt`/`createdAt` más nuevo. Objetos: remoto pisa local para la misma clave.

### Riesgos

- depende del reloj del dispositivo;
- no hace merge campo a campo;
- `deletedRecords` no aplica tombstones automáticamente;
- puede resucitar eliminaciones;
- el force resuelve conflicto técnico, no semántico.

Prioridad: timestamps del servidor, tombstones efectivos y merge determinista.

---

## 13. Backend privado

### Stack

- Cloudflare Worker;
- D1;
- R2;
- Wrangler 4.x;
- ESM.

Entry points:

```text
src/worker.js
  -> src/index-v3.js
       -> src/index-v2.js
```

- v2: API principal;
- v3: hardening, throttle, auditoría, organización, reset y poda;
- worker: errores finales y CORS.

### Configuración

- nombre: `corrientes-territorial-api`;
- `workers_dev = true`;
- `ALLOWED_ORIGIN = https://evacristo.github.io`;
- `SESSION_TTL_DAYS = 30`;
- D1 binding `DB`;
- R2 binding `FILES`;
- observabilidad activa.

### Secretos

Worker:

- `BOOTSTRAP_SECRET`.

GitHub Actions:

- `CLOUDFLARE_API_TOKEN`;
- `CLOUDFLARE_ACCOUNT_ID`;
- `TERRITORIO_BOOTSTRAP_SECRET`.

Nunca ponerlos en GitHub Pages.

### D1

- `users`;
- `organizations`;
- `organization_members`;
- `sessions`;
- `organization_workspaces`;
- `organization_workspace_history`;
- `audit_log_v2`;
- `login_attempts`;
- `shared_file_metadata`.

### Roles

**Admin:** usuarios, organización, contraseñas, sesiones, datos, historial, archivos.

**Editor:** leer/escribir workspace y adjuntos.

**Viewer:** sólo lectura. UI y servidor bloquean escritura; la autoridad final es server-side.

### Passwords

- PBKDF2-SHA-256;
- 180.000 iteraciones;
- sal individual;
- hash 256 bits;
- comparación constante.

El mínimo actual de tres caracteres es deuda técnica y debe endurecerse antes de datos altamente sensibles.

### Sesiones

- token aleatorio 32 bytes;
- servidor guarda SHA-256;
- cookie HttpOnly/Secure/SameSite=None;
- token también devuelto para Bearer;
- TTL 30 días, rango 1–90;
- revocables;
- reset de contraseña revoca sesiones;
- desactivar usuario revoca sesiones.

### Login throttle

- 10 fallos;
- ventana 15 minutos;
- por username o hash de IP;
- `429` y `Retry-After: 900`.

### Límites

- request push: 1,8 MB;
- workspace: 1,5 MB;
- archivo: 12 MB;
- historial servido: 30;
- historial conservado: 50;
- sesiones: 50;
- archivos listados: 300;
- auditoría: 100.

### API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | estado/capacidades |
| POST | `/api/login` | login |
| POST | `/api/logout` | logout |
| GET | `/api/me` | identidad/sesión |
| GET/POST | `/api/admin/users` | listar/crear |
| PATCH | `/api/admin/users/:id` | rol/estado |
| POST | `/api/admin/users/:id/password` | reset |
| GET/POST | `/api/organization` | leer/renombrar |
| GET | `/api/sessions` | dispositivos |
| DELETE | `/api/sessions/:id` | revocar |
| GET | `/api/sync/pull` | descargar workspace |
| POST | `/api/sync/push` | subir workspace |
| GET | `/api/history` | historial |
| POST | `/api/history/:revision/restore` | restaurar |
| GET | `/api/audit` | auditoría |
| GET/POST | `/api/files` | listar/subir |
| GET/DELETE | `/api/files/:id` | descargar/eliminar |

### Errores

- `401 unauthorized`;
- `403 forbidden/read_only`;
- `409 revision_conflict`;
- `409 last_admin_required`;
- `409 cannot_deactivate_current_user`;
- `413 workspace_too_large/file_too_large/request_too_large`;
- `429 too_many_attempts`;
- `404 *_not_found`.

---

## 14. Activación desde teléfono

1. Abrir Mobile Pro.
2. **Más → Sincronización**.
3. **Desplegar en Cloudflare**.
4. Autorizar cuenta.
5. Definir una frase larga como `BOOTSTRAP_SECRET`.
6. Copiar URL `workers.dev`.
7. Pegar URL en Mobile Pro.
8. Probar conexión.
9. Crear primer administrador.
10. La app inicia sesión remota.
11. Subir workspace local.
12. Crear editor y viewer.
13. Probar dos dispositivos.
14. Revocar una sesión.
15. Probar historial y adjunto.

`/health` esperado:

```json
{
  "ok":true,
  "service":"corrientes-territorial-api",
  "version":"0.3.0",
  "storage":"shared-organization-workspace",
  "capabilities":["users","roles","sessions","sync","history","audit","files"]
}
```

---

## 15. Desarrollo local

Backend:

```bash
cd territorio-backend
npm install
cp .dev.vars.example .dev.vars
npm run check
npm run test:integration
npm run dev
```

D1 local:

```bash
npm run db:init:local
```

Deploy manual:

```bash
npx wrangler login
npm run deploy
```

Frontend local:

```bash
python3 -m http.server 8765 --directory <checkout-gh-pages>
```

Fixture:

```text
http://127.0.0.1:8765/territorio-mobile-pro/launch.html?fixture=1
```

Datos reales:

```text
http://127.0.0.1:8765/territorio-mobile-pro/launch.html
```

Fixture base: 4 personas, 4 nominaciones, 2 municipios, 2 departamentos y resultados mínimos.

---

## 16. CI y pruebas

Workflows:

- `chatgpt-mobile-app-check.yml`;
- `mobile-next-real-data.yml`;
- `mobile-next-smoke.yml`;
- `mobile-pro-smoke.yml`;
- `mobile-pro-sync-smoke.yml`;
- `mobile-safe-smoke.yml`;
- `territorio-backend-check.yml`;
- `territorio-backend-deploy.yml`.

Viewports:

- 390 × 844;
- 820 × 1180;
- touch/mobile habilitado.

Mobile Pro smoke verifica login, mapa, CRM, visita, alertas, informe, importación, sync y ausencia de errores JS.

Sync smoke usa API mockeada y verifica health, bootstrap, login, organización, push/pull, usuarios, sesiones e historial.

Integración backend verifica bootstrap, roles, shared workspace, conflicto 409, viewer 403, archivos, restore, reset, revocación, auditoría, organización y rate limiting.

Build backend verifica:

- `node --check`;
- Wrangler dry-run aislado;
- Wrangler dry-run producción;
- schema SQLite;
- tablas requeridas.

---

## 17. Runbook de incidentes

### Página no carga

- usar launcher;
- probar privado;
- revisar scripts faltantes;
- confirmar orden del loader;
- incrementar versiones;
- revisar service worker.

### Mapa no abre

- confirmar `CT.activateView` y `main-v2.js`;
- buscar error anterior en `renderAll`;
- probar fixture;
- confirmar `mapViewport`;
- garantizar tolerancia a arrays vacíos.

### Mapa sin territorios

- revisar los tres archivos de geometría;
- revisar `DATA_ROOT` y parser;
- confirmar `coverage-addon.js`;
- esperar 25 departamentos y 74 municipios.

### Porcentajes erróneos

- no editar manualmente;
- verificar categoría/nivel;
- usar `percentageDisplayed`;
- comparar votos/válidos;
- confirmar alianza;
- no cruzar categorías.

### Cambios no aparecen en otro dispositivo

- misma organización;
- sesión remota activa;
- push origen, pull destino;
- revisar 401/403/409/413;
- revisar revisión y auditoría.

### 409

Conflicto de revisión. Exportar backup si persiste. Descargar, fusionar y reintentar; no forzar sin copia.

### 413

Workspace o archivo demasiado grande. No incluir blobs en JSON y comprimir imágenes.

### 429

Esperar 15 minutos y corregir credenciales.

### Adjuntos faltantes

- confirmar blob en IndexedDB;
- confirmar `remoteSynced`;
- revisar R2 y D1 metadata;
- recordar que export JSON no incluye blobs.

### Safari viejo

- cerrar app instalada;
- abrir launcher;
- borrar datos del sitio si hace falta;
- incrementar service worker, launcher y manifest.

---

## 18. Seguridad y deuda

### Protegido al activar backend

- passwords derivadas;
- sesiones revocables;
- roles server-side;
- R2 privado;
- token hashes;
- auditoría;
- throttle;
- CORS;
- límites;
- historial;
- viewer bloqueado.

### No protegido realmente

- login local;
- `localStorage` sin cifrar;
- IndexedDB sin cifrar;
- GitHub Pages público;
- shield visual.

### Riesgos prioritarios

1. mínimo de password demasiado bajo;
2. Bearer en localStorage/workspace;
3. revisar CSRF por cookie `SameSite=None`;
4. origen `evacristo.github.io` demasiado amplio;
5. MIME activos servidos inline desde R2;
6. sin MFA/WebAuthn;
7. sin antivirus;
8. sin política formal de retención;
9. bootstrap single-tenant por conteo global;
10. rol duplicado en dos tablas.

Antes de datos muy sensibles:

- contraseña mínima 12;
- prohibir password=username;
- passkeys;
- dominio dedicado;
- token fuera de workspace;
- CSRF explícito o sólo Bearer;
- MIME allowlist/attachment;
- sesiones rotativas;
- cifrado local selectivo;
- backup remoto probado.

---

## 19. Deuda técnica priorizada

### Alta

1. Desplegar backend real.
2. Probar tres roles en dos dispositivos.
3. Mover fuente frontend a `main`.
4. Tombstones efectivos.
5. timestamps server-side.
6. passwords fuertes.
7. estrategia segura de token/CSRF.
8. MIME seguro.
9. migraciones D1 versionadas.
10. agregar `team-admin-bridge.js` al precache.
11. mapa municipio → departamento.

### Media

- backup de adjuntos;
- paginación server-side;
- provenance versionada;
- histórico electoral;
- proclamaciones/electos;
- comunidades/betweenness;
- alertas configurables;
- índice configurable;
- deduplicación avanzada;
- notificaciones push.

---

## 20. ChatGPT App/MCP

Existe en `main/chatgpt-app`. Stack: Node 22, TypeScript, Express 5, MCP SDK, Apps SDK UI, React 19, Vite y Zod.

Herramientas implementadas:

- `search_people`;
- `get_territory`;
- `get_map`.

Pendientes:

- grafo;
- escritura de relaciones/notas;
- export;
- auth con backend.

Mobile Pro sigue siendo el producto principal. La app ChatGPT debe consumir el backend privado y actuar como canal complementario.

---

## 21. Plan recomendado

### Fase 1 — Activación

Cloudflare, admin, sync inicial, editor, viewer, dos dispositivos, sesiones, restore y adjunto.

### Fase 2 — Hardening

Passwords, dominio, token/CSRF, MIME, tombstones, server timestamps, migraciones y observabilidad.

### Fase 3 — Datos

Proclamaciones, autoridades, histórico, resultados por mesa, participación y perfiles completos.

### Fase 4 — Inteligencia

Reglas configurables, ranking, comunidades, caminos, alertas predictivas e informes programados.

### Fase 5 — ChatGPT

Desplegar MCP, conectar backend, agregar escritura confirmada y mantener Mobile Pro como fallback.

---

## 22. Disciplina de cambios

### Frontend

- exportar workspace de prueba;
- fixture actualizado;
- Playwright;
- teléfono e iPad;
- revisar dependencia Mobile Next;
- revisar service worker.

### Datos

- conservar fuente;
- documentar fecha/alcance;
- validar conteos y porcentajes;
- validar nominación → resultado;
- versionar schema;
- no inventar electos.

### Backend

- `npm run check`;
- `npm run test:integration`;
- Wrangler dry-run;
- schema;
- compatibilidad;
- no borrar D1/R2;
- migración/rollback.

### Publicación frontend

1. actualizar archivo;
2. query version;
3. launcher;
4. manifest;
5. service worker `VERSION`;
6. agregar archivo nuevo al `SHELL`;
7. smoke fixture;
8. real-data;
9. Safari público.

---

## 23. Criterios de aceptación

Frontend:

- abre desde launcher;
- login local;
- cero `pageerror`;
- mapa;
- 25 departamentos;
- 74 municipios;
- búsqueda;
- fixture y real-data;
- teléfono/iPad;
- export JSON;
- migración sin pérdida;
- viewer no escribe;
- sin secretos en frontend;
- caché coherente.

Backend:

- `/health`;
- bootstrap una vez;
- roles correctos;
- viewer 403;
- conflicto 409;
- historial/restore;
- sesiones;
- reset revoca;
- archivo sube/descarga;
- rate limiting;
- CORS esperado.

---

## 24. Checklist para nuevo mantenedor

1. Leer este documento.
2. Abrir producto en teléfono.
3. Probar fixture.
4. Probar datos reales.
5. Revisar `gh-pages/territorio-mobile-pro`.
6. Revisar `main/territorio-backend`.
7. Ejecutar integración backend.
8. Revisar PR #3.
9. Confirmar si Cloudflare está desplegado.
10. Confirmar endpoint/organización.
11. Confirmar responsable de Cloudflare.
12. Confirmar último backup.
13. Confirmar usuarios/dispositivos.
14. Revisar auditoría/historial.
15. No publicar credenciales.
16. No mezclar oficial e inferido.
17. Mantener Mobile Pro como superficie principal.

---

## 25. Inventario principal

### `main`

```text
.github/workflows/
  chatgpt-mobile-app-check.yml
  mobile-next-real-data.yml
  mobile-next-smoke.yml
  mobile-pro-smoke.yml
  mobile-pro-sync-smoke.yml
  mobile-safe-smoke.yml
  territorio-backend-check.yml
  territorio-backend-deploy.yml

chatgpt-app/
  Dockerfile
  README.md
  package.json
  render.yaml
  server/
  shared/
  web/

territorio-backend/
  IMPLEMENTATION.md
  README.md
  package.json
  schema-v2.sql
  scripts/integration-test.mjs
  src/index-v2.js
  src/index-v3.js
  src/worker.js
  wrangler.ci.toml
  wrangler.test.toml
  wrangler.toml
```

### `gh-pages`

```text
lla-candidates-2025.json
election-results-2025.json
map-departments.js
map-municipalities-1.js
map-municipalities-2.js

territorio-mobile-next/
  index.html
  styles-v2.css
  core-v2.js
  workspace-v2.js
  views-v2.js
  main-v2.js

territorio-mobile-pro/
  launch.html
  index.html
  manifest.webmanifest
  icon.svg
  pro.css
  pro-addon.js
  pro-addon-main.js
  coverage-addon.js
  backend-setup-addon.js
  remote-auth-addon.js
  admin-addon.js
  team-admin-addon.js
  team-admin-bridge.js
  viewer-guard-addon.js
  startup-guard-addon.js
  sw.js
```

---

## 26. API — ejemplos

Login:

```http
POST /api/login
Content-Type: application/json

{
  "username":"Ivo",
  "password":"contraseña-segura",
  "deviceId":"iphone-ivo"
}
```

Pull:

```http
GET /api/sync/pull
Authorization: Bearer <token>
```

Push:

```http
POST /api/sync/push
Authorization: Bearer <token>
Content-Type: application/json

{
  "revision":4,
  "deviceId":"iphone-ivo",
  "workspace":{"version":3,"relations":[],"agenda":[],"visits":[]}
}
```

Conflicto:

```json
{"error":"revision_conflict","revision":5,"workspace":{}}
```

Archivo:

```http
POST /api/files
Authorization: Bearer <token>
Content-Type: image/jpeg
X-File-Id: file-123
X-File-Name: foto.jpg
X-Visit-Id: visit-123

<bytes>
```

---

## 27. Glosario

- **LLA:** La Libertad Avanza.
- **Nominación:** persona–cargo–jurisdicción.
- **Workspace:** conjunto privado editable.
- **Fixture:** dataset pequeño determinista.
- **D1:** base SQL Cloudflare.
- **R2:** almacenamiento de objetos.
- **Worker:** API serverless Cloudflare.
- **Revisión:** número monotónico del workspace.
- **Tombstone:** marca de eliminación para sync.
- **MCP:** Model Context Protocol.
- **PWA:** aplicación web instalable.

---

## 28. Estado final

### Confirmado

- Mobile Pro publicado.
- Diseño y pruebas teléfono/iPad.
- 470 personas, 471 nominaciones, 25 departamentos y 74 municipios.
- CRM, visitas, alertas, informes, importación, red, agenda y fuentes.
- Backend fusionado en `main`.
- Workflows UI, datos reales, sync mockeada y backend.
- Botón Cloudflare apunta a `main`.

### Pendiente de acción humana

- autorizar Cloudflare;
- elegir `BOOTSTRAP_SECRET`;
- desplegar;
- crear admin;
- prueba real multi-dispositivo.

### No afirmar todavía

- backend activo en producción;
- datos locales cifrados;
- login local seguro;
- candidatos electos;
- ChatGPT App desplegada;
- merge perfecto;
- adjuntos incluidos en backup JSON.

---

## 29. Próximo paso

Activar el backend privado y probar dos dispositivos con admin, editor y viewer. Antes de cargar información altamente sensible, aplicar como mínimo:

1. password policy fuerte;
2. dominio/origen dedicado;
3. MIME seguro para adjuntos;
4. estrategia token/CSRF;
5. tombstones efectivos;
6. backup remoto verificado.
