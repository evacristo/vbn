# Corrientes Territorial — ChatGPT App

Aplicación privada, mobile-first, para consultar y editar inteligencia política territorial de Corrientes desde ChatGPT.

## Objetivo

- Operar principalmente desde iPhone, iPad y Android.
- Consultar candidaturas, resultados, territorios y relaciones mediante lenguaje natural.
- Mostrar un widget táctil con mapa SVG, fichas, resultados y grafo.
- Conservar una vista web móvil de respaldo, conectada al mismo backend.
- Mantener datos oficiales separados de notas, inferencias y relaciones editables.

## Arquitectura

**Arquetipo:** interactive-decoupled.

- `server/`: servidor MCP con herramientas de lectura y escritura.
- `web/`: widget React de bajo peso, diseñado primero para 390–430 px de ancho.
- `shared/`: tipos y contratos compartidos.
- `data/`: importación controlada de candidaturas, resultados y geometrías.

El widget no contiene secretos ni credenciales. Las modificaciones se realizan mediante herramientas MCP y se persisten en el backend.

## Herramientas previstas

1. `search_people` — buscar personas, candidaturas y cargos.
2. `get_territory` — obtener perfil territorial y resultados por categoría.
3. `get_map` — preparar los datos del mapa para departamento o municipio.
4. `get_relationship_graph` — consultar relaciones y jerarquías con evidencia.
5. `save_relationship` — crear o actualizar una relación con fuente, estado y confianza.
6. `save_note` — guardar una nota privada sobre persona o territorio.
7. `export_workspace` — exportar datos editables y auditoría.

## Principios móviles

- Controles táctiles de al menos 44 px.
- Una columna por defecto; dos columnas sólo en iPad horizontal.
- Sin hover como requisito funcional.
- Navegación inferior o pestañas desplazables.
- Carga progresiva: primero resumen, luego geometría y grafo.
- Ningún panel debe bloquear el mapa si falla una fuente secundaria.
- Acciones de escritura con confirmación clara.
- Soporte de modo oscuro y tamaños dinámicos de texto.

## Estado

La rama inicial establece contratos y estructura. La siguiente etapa integra la base electoral existente y despliega un endpoint MCP HTTPS privado.
