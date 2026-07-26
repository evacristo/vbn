# Corrientes Territorial · Backend privado

Backend de sincronización para Corrientes Territorial Mobile Pro, implementado como Cloudflare Worker con D1 y R2.

## Despliegue recomendado

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/evacristo/vbn/tree/chatgpt-mobile-app/territorio-backend)

El asistente de Cloudflare clona únicamente esta carpeta, crea los recursos necesarios y solicita `BOOTSTRAP_SECRET`. Elegí una frase larga y aleatoria y conservála hasta crear el primer administrador.

La configuración no contiene identificadores pertenecientes a una cuenta particular. D1 y R2 se aprovisionan automáticamente mediante los bindings `DB` y `FILES`. El comando de despliegue publica el Worker y aplica `schema-v2.sql` a D1.

## Funciones

- Espacio de trabajo compartido por la organización.
- Usuarios con roles `admin`, `editor` y `viewer`.
- Contraseñas derivadas con PBKDF2-SHA-256 y sal individual.
- Sesiones revocables por dispositivo.
- Control de revisiones, resolución de conflictos e historial restaurable.
- Auditoría de accesos y modificaciones.
- Adjuntos privados en R2, compartidos sólo con usuarios autorizados.
- API compatible con **Más → Sincronización** de la aplicación móvil.

## Primera activación desde el teléfono

1. Tocá **Deploy to Cloudflare**.
2. Iniciá sesión en Cloudflare y autorizá el despliegue.
3. Definí `BOOTSTRAP_SECRET` cuando el formulario lo solicite.
4. Copiá la URL terminada en `workers.dev` que entrega Cloudflare.
5. Abrí Corrientes Territorial Pro y entrá en **Más → Sincronización**.
6. Pegá la URL, ingresá el secreto de arranque y creá el primer administrador.
7. La aplicación iniciará la sesión remota y permitirá subir el espacio local.

El secreto de arranque deja de servir para crear cuentas una vez que existe el primer usuario. Desde entonces, los administradores crean y gestionan usuarios dentro de la aplicación.

## Uso local

```bash
cd territorio-backend
npm install
npx wrangler login
cp .dev.vars.example .dev.vars
npm run dev
```

Para desplegar desde una terminal autenticada:

```bash
npm run deploy
```

El script ejecuta primero `wrangler deploy`, que aprovisiona los bindings, y luego aplica el esquema mediante el nombre del binding `DB`.

## API principal

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/login` | Iniciar sesión |
| POST | `/api/logout` | Revocar la sesión actual |
| GET | `/api/me` | Usuario, organización y dispositivo actuales |
| GET/POST | `/api/admin/users` | Listar o crear usuarios |
| PATCH | `/api/admin/users/:id` | Cambiar rol o estado de un usuario |
| GET | `/api/sessions` | Listar sesiones y dispositivos |
| DELETE | `/api/sessions/:id` | Revocar una sesión |
| GET | `/api/sync/pull` | Descargar el espacio compartido |
| POST | `/api/sync/push` | Subir cambios con control de revisión |
| GET | `/api/history` | Consultar revisiones anteriores |
| POST | `/api/history/:revision/restore` | Restaurar una revisión |
| GET/POST | `/api/files` | Listar o subir adjuntos |
| GET/DELETE | `/api/files/:id` | Descargar o eliminar un adjunto |

## Reglas de seguridad

- Nunca colocar contraseñas, tokens o `BOOTSTRAP_SECRET` en GitHub Pages.
- Los usuarios `viewer` no pueden modificar datos ni archivos.
- Los archivos R2 no son públicos; el Worker exige una sesión válida.
- Las sesiones se almacenan como hashes y pueden revocarse por dispositivo.
- El backend limita el tamaño del espacio y de los adjuntos.
- `ALLOWED_ORIGIN` está restringido a `https://evacristo.github.io`.

## GitHub Actions, alternativa avanzada

El workflow manual puede desplegar sin el botón cuando se agregan estos secretos al entorno `territorio-production`:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TERRITORIO_BOOTSTRAP_SECRET`

El token de Cloudflare debe limitarse a la cuenta y a los permisos estrictamente necesarios para Workers, D1 y R2.
