# Corrientes Territorial · Backend privado

Backend de sincronización para Corrientes Territorial Mobile Pro, implementado como Cloudflare Worker con D1 y R2.

## Funciones

- Usuarios con roles `admin`, `editor` y `viewer`.
- Contraseñas derivadas con PBKDF2-SHA-256 y sal individual.
- Sesiones revocables por dispositivo.
- Espacio de trabajo sincronizado con control de revisiones.
- Historial de versiones y auditoría.
- Almacenamiento privado de adjuntos en R2.
- API compatible con la pantalla **Sincronización** de la app móvil.

## Recursos necesarios

- Una cuenta de Cloudflare.
- Una base D1 llamada `corrientes-territorial`.
- Un bucket R2 llamado `corrientes-territorial-files`.
- Un secreto de arranque para crear el primer administrador.

## Preparación local

```bash
cd territorio-backend
npm install
npx wrangler login
```

Crear la base y copiar el `database_id` devuelto a `wrangler.toml`:

```bash
npx wrangler d1 create corrientes-territorial
```

Crear el bucket privado:

```bash
npx wrangler r2 bucket create corrientes-territorial-files
```

Aplicar el esquema SQL:

```bash
npm run db:init:remote
```

Guardar el secreto de arranque:

```bash
npx wrangler secret put BOOTSTRAP_SECRET
```

Desplegar:

```bash
npm run deploy
```

## Primer administrador

Sólo se permite usar el secreto de arranque mientras no exista ningún usuario.

```bash
curl -X POST "https://TU-WORKER.workers.dev/api/admin/users" \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Secret: TU_SECRETO" \
  --data '{"username":"Ivo","password":"Ivo","role":"admin"}'
```

Aunque la interfaz admite inicialmente usuario y contraseña iguales, el servidor nunca almacena la contraseña en texto plano.

## Conectar la aplicación móvil

En **Más → Sincronización**:

1. Escribir la URL HTTPS del Worker.
2. Iniciar sesión contra `/api/login` para obtener un token.
3. Pegar temporalmente ese token en **Token de dispositivo**.
4. Usar **Descargar cambios** o **Subir cambios**.

La siguiente iteración de la interfaz reemplazará el pegado manual del token por un formulario de inicio de sesión remoto cuando el Worker esté desplegado.

## API principal

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/login` | Iniciar sesión |
| POST | `/api/logout` | Revocar sesión |
| GET | `/api/me` | Usuario y dispositivo actuales |
| POST | `/api/admin/users` | Crear usuario |
| GET | `/api/sync/pull` | Descargar espacio privado |
| POST | `/api/sync/push` | Subir espacio privado |
| GET | `/api/history` | Revisiones anteriores |
| GET/POST | `/api/files` | Listar o subir adjuntos |
| GET/DELETE | `/api/files/:id` | Descargar o eliminar adjunto |

## Reglas de seguridad

- No colocar contraseñas o tokens en GitHub Pages.
- No guardar `BOOTSTRAP_SECRET` en el repositorio.
- Los usuarios `viewer` no pueden modificar datos ni archivos.
- Los archivos R2 permanecen privados; se descargan únicamente mediante el Worker autenticado.
- El backend rechaza espacios excesivamente grandes y controla conflictos de revisión.
- Mantener `ALLOWED_ORIGIN` limitado al dominio de la aplicación.

## Despliegue con GitHub Actions

El workflow manual requiere estos secretos de repositorio:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `TERRITORIO_BOOTSTRAP_SECRET`

El token de Cloudflare debe limitarse a los permisos necesarios para desplegar Workers y administrar los recursos vinculados.
