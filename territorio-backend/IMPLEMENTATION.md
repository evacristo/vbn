# Implementación de colaboración móvil

## Producto

Aplicación pública testable:

`https://evacristo.github.io/vbn/territorio-mobile-pro/launch.html`

La interfaz es mobile-first y funciona en modo local aun cuando el backend no esté configurado. La activación remota se realiza desde **Más → Sincronización → Activar backend privado**.

## Modelo compartido

Los usuarios autorizados pertenecen a una organización y trabajan sobre un único espacio territorial compartido. El servidor conserva:

- usuarios, roles y estado de cuenta;
- sesiones y dispositivos revocables;
- revisión actual del espacio;
- versiones anteriores restaurables;
- auditoría de accesos y cambios;
- fotos y documentos privados asociados a visitas.

## Roles

- `admin`: administra organización, usuarios, contraseñas, sesiones, datos y archivos.
- `editor`: consulta y modifica el espacio compartido y sus adjuntos.
- `viewer`: consulta y descarga; la interfaz bloquea acciones de edición y el servidor las rechaza con HTTP 403.

## Conflictos y modo offline

La aplicación trabaja primero con almacenamiento local. Cada subida incluye la revisión conocida. Cuando otro dispositivo modificó el espacio, el cliente descarga el estado remoto, fusiona registros por identificador y fecha de actualización, y reintenta la subida. El servidor conserva la versión reemplazada para permitir recuperación.

## Activación desde un dispositivo móvil

1. Abrir la aplicación Pro.
2. Entrar en **Más → Sincronización**.
3. Tocar **Desplegar en Cloudflare**.
4. Autorizar el despliegue y definir `BOOTSTRAP_SECRET`.
5. Copiar la URL `workers.dev` entregada por Cloudflare.
6. Pegarla en la aplicación y probar la conexión.
7. Crear el primer administrador con el secreto de arranque.
8. Subir el espacio local.
9. Crear desde la consola las cuentas editoras o de sólo lectura.

El secreto de arranque no se guarda en la aplicación ni en GitHub Pages.

## Validación automatizada

La integración local verifica:

- alta del primer administrador;
- usuarios editor y viewer;
- contraseñas derivadas y restablecimiento administrativo;
- espacio compartido entre cuentas;
- detección de conflictos de revisión;
- rechazo de escritura para viewer;
- adjuntos compartidos;
- historial y restauración;
- revocación de sesiones;
- activación y desactivación de cuentas;
- auditoría, organización y limitación de intentos de acceso.

Playwright verifica además el recorrido de activación desde pantallas de teléfono e iPad, usando la misma interfaz publicada.
