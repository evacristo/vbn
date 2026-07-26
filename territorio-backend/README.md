# Corrientes Territorial · Backend privado

Backend de sincronización para Corrientes Territorial Mobile Pro, implementado como Cloudflare Worker con D1 y R2.

## Despliegue recomendado

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/evacristo/vbn/tree/chatgpt-mobile-app/territorio-backend)

El asistente de Cloudflare clona esta carpeta, crea los recursos vinculados y solicita `BOOTSTRAP_SECRET`. Elegí una frase larga y aleatoria y conservála hasta crear el primer administrador.

La configuración no contiene identificadores de una cuenta particular. Los bindings son:

- `DB`: base D1 privada.
- `FILES`: bucket R2 privado.
- `BOOTSTRAP_SECRET`: secreto usado una sola vez para crear el primer administrador.

## Funciones

- Espacio territorial compartido por toda la organización.
- Usuarios con roles `admin`, `editor` y `viewer`.
- Contraseñas derivadas con PBKDF2-SHA-256 y sal individual.
- Bloqueo temporal después de intentos reiterados de acceso fallidos.
- Sesiones revocables por dispositivo.
- Cambio de roles, activación y desactivación de cuentas.
- Restablecimiento administrativo de contraseñas con revocación de sesiones.
- Sincronización con control de revisiones y conflictos.
- Historial restaurable, limitado a las 50 revisiones más recientes.
- Auditoría de accesos y modificaciones.
- Adjuntos privados en R2, compartidos sólo con usuarios autorizados.
- API integrada con **Más → Sincronización** de la aplicación móvil.

## Primera activación desde el teléfono

1. Tocá **Deploy to Cloudflare**.
2. Iniciá sesión en Cloudflare y autorizá el despliegue.
3. Definí `BOOTSTRAP_SECRET` cuando el formulario lo solicite.
4. Copiá la URL terminada en `workers.dev`.
5. Abrí Corrientes Territorial Pro y entrá en **Más → Sincronización**.
6. Pegá la URL y tocá **Probar conexión**.
7. Ingresá el secreto de arranque y creá el primer administrador.
8. Conectá la cuenta y subí el espacio local.

El secreto de arranque deja de permitir nuevas cuentas después de crear el primer usuario. Desde entonces, los administradores gestionan usuarios, dispositivos, contraseñas, historial y auditoría desde la propia aplicación móvil.

## Uso local

```bash
cd territorio-backend
npm install
npx wrangler login
cp .dev.vars.example .dev.vars
npm run dev
```

Pruebas:

```bash
npm run check
npm run test:integration
```

Despliegue desde una terminal autenticada:

```bash
npm run deploy
```

El despliegue publica primero el Worker para aprovisionar los bindings y luego aplica `schema-v2.sql` a D1.

## API principal

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/login` | Iniciar sesión |
| POST | `/api/logout` | Revocar la sesión actual |
| GET | `/api/me` | Usuario, organización y dispositivo actuales |
| GET/POST | `/api/admin/users` | Listar o crear usuarios |
| PATCH | `/api/admin/users/:id` | Cambiar rol o estado |
| POST | `/api/admin/users/:id/password` | Restablecer contraseña y revocar sesiones |
| GET | `/api/organization` | Consultar el espacio compartido |
| POST | `/api/organization` | Cambiar su nombre |
| GET | `/api/sessions` | Listar sesiones y dispositivos |
| DELETE | `/api/sessions/:id` | Revocar una sesión |
| GET | `/api/sync/pull` | Descargar el espacio compartido |
| POST | `/api/sync/push` | Subir cambios con control de revisión |
| GET | `/api/history` | Consultar revisiones anteriores |
| POST | `/api/history/:revision/restore` | Restaurar una revisión |
| GET | `/api/audit` | Consultar actividad y auditoría |
| GET/POST | `/api/files` | Listar o subir adjuntos |
| GET/DELETE | `/api/files/:id` | Descargar o eliminar un adjunto |

## Reglas de seguridad

- Nunca colocar contraseñas, tokens o `BOOTSTRAP_SECRET` en GitHub Pages.
- Los usuarios `viewer` no pueden modificar datos ni archivos.
- Los archivos R2 no son públicos; el Worker exige una sesión válida.
- Las sesiones se almacenan como hashes y pueden revocarse por dispositivo.
- Cambiar una contraseña revoca las sesiones existentes de esa cuenta.
- El backend limita el tamaño del espacio y de los adjuntos.
- `ALLOWED_ORIGIN` está restringido a `https://evacristo.github.io`.

## GitHub Actions

El workflow manual utiliza el entorno `territorio-production` y requiere:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `TERRITORIO_BOOTSTRAP_SECRET`

El token de Cloudflare debe limitarse a los permisos necesarios para Workers, D1 y R2.
