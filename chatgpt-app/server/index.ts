import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ElectionCategory, JurisdictionLevel, WidgetPayload } from '../shared/contracts.js';
import { TerritorialDataStore } from './data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const WIDGET_URI = 'ui://corrientes-territorial/mobile-v1.html';
const WIDGET_MIME = 'text/html;profile=mcp-app';
const dataStore = new TerritorialDataStore();

async function loadWidgetHtml(): Promise<string> {
  const path = join(__dirname, '..', 'dist', 'widget', 'index.html');
  try {
    const html = await readFile(path, 'utf8');
    return html
      .replaceAll('src="/assets/', `src="${PUBLIC_BASE_URL}/assets/`)
      .replaceAll('href="/assets/', `href="${PUBLIC_BASE_URL}/assets/`);
  } catch {
    return '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:16px"><h2>Corrientes Territorial</h2><p>El widget todavía no fue compilado. Ejecutá <code>npm run build:web</code>.</p></body></html>';
  }
}

function widgetMeta() {
  return {
    ui: {
      resourceUri: WIDGET_URI,
      prefersBorder: false,
      csp: {
        connectDomains: [PUBLIC_BASE_URL],
        resourceDomains: [PUBLIC_BASE_URL],
      },
    },
    'openai/outputTemplate': WIDGET_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': 'Consultando Corrientes Territorial…',
    'openai/toolInvocation/invoked': 'Datos territoriales listos',
  };
}

function toolResponse(payload: WidgetPayload, summary: string) {
  return {
    structuredContent: payload,
    content: [{ type: 'text' as const, text: summary }],
    _meta: {
      ui: { resourceUri: WIDGET_URI },
      'openai/outputTemplate': WIDGET_URI,
    },
  };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'corrientes-territorial', version: '0.1.0' });

  server.registerResource(
    'corrientes-mobile-widget',
    WIDGET_URI,
    {
      title: 'Corrientes Territorial',
      description: 'Mapa, fichas y red política optimizados para dispositivos móviles.',
      mimeType: WIDGET_MIME,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: {
            connectDomains: [PUBLIC_BASE_URL],
            resourceDomains: [PUBLIC_BASE_URL],
          },
        },
        'openai/widgetDescription': 'Interfaz móvil para explorar candidaturas, resultados, territorios y relaciones políticas de Corrientes.',
      },
    },
    async () => ({
      contents: [{
        uri: WIDGET_URI,
        mimeType: WIDGET_MIME,
        text: await loadWidgetHtml(),
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {
              connectDomains: [PUBLIC_BASE_URL],
              resourceDomains: [PUBLIC_BASE_URL],
            },
          },
        },
      }],
    }),
  );

  server.registerTool(
    'search_people',
    {
      title: 'Buscar personas y candidaturas',
      description: 'Use this when the user wants to find candidates, offices, lists, or people in Corrientes Territorial.',
      inputSchema: {
        query: z.string().min(1).describe('Nombre, cargo o jurisdicción'),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: widgetMeta(),
    },
    async ({ query, limit }) => {
      const candidates = await dataStore.searchPeople(query, limit);
      return toolResponse({
        view: 'search',
        title: `Resultados para “${query}”`,
        subtitle: `${candidates.length} candidaturas encontradas`,
        candidates,
      }, `Encontré ${candidates.length} candidaturas relacionadas con “${query}”.`);
    },
  );

  server.registerTool(
    'get_territory',
    {
      title: 'Abrir perfil territorial',
      description: 'Use this when the user wants a complete profile of a province, department, or municipality, including candidates and election results.',
      inputSchema: {
        level: z.enum(['province', 'department', 'municipality']),
        jurisdiction: z.string().min(1),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: widgetMeta(),
    },
    async ({ level, jurisdiction }) => {
      const territory = await dataStore.getTerritory(level as JurisdictionLevel, jurisdiction);
      return toolResponse({
        view: 'territory',
        title: territory.jurisdiction,
        subtitle: 'Perfil territorial y escrutinio definitivo 2025',
        territory,
        candidates: territory.candidates,
        results: territory.results,
        selectedJurisdiction: territory.jurisdiction,
      }, `Abrí el perfil de ${territory.jurisdiction}, con ${territory.candidates.length} candidaturas y ${territory.results.length} resultados por lista.`);
    },
  );

  server.registerTool(
    'get_map',
    {
      title: 'Abrir mapa electoral',
      description: 'Use this when the user wants to visualize LLA election performance on a department or municipality map.',
      inputSchema: {
        level: z.enum(['department', 'municipality']),
        category: z.enum(['Gobernador', 'Senadores', 'Diputados', 'Intendente', 'Concejales']),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: widgetMeta(),
    },
    async ({ level, category }) => {
      const features = await dataStore.getMap(level, category as ElectionCategory);
      return toolResponse({
        view: 'map',
        title: `Mapa de ${category}`,
        subtitle: level === 'department' ? 'Resultados LLA por departamento' : 'Resultados LLA por municipio',
        features,
      }, `Preparé el mapa de ${category} con ${features.length} territorios.`);
    },
  );

  return server;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/assets', express.static(join(__dirname, '..', 'dist', 'widget', 'assets'), { maxAge: '1h', immutable: false }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'corrientes-territorial', version: '0.1.0' }));

const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, McpServer>();

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Sesión MCP inválida o no inicializada.' }, id: null });
        return;
      }

      const server = buildServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport!);
          servers.set(newSessionId, server);
        },
      });
      transport.onclose = () => {
        const closedSessionId = transport?.sessionId;
        if (closedSessionId) {
          transports.delete(closedSessionId);
          servers.get(closedSessionId)?.close().catch(() => undefined);
          servers.delete(closedSessionId);
        }
      };
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP POST failed:', error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno del servidor.' }, id: null });
  }
});

for (const method of ['get', 'delete'] as const) {
  app[method]('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Sesión MCP inexistente.');
      return;
    }
    await transport.handleRequest(req, res);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Corrientes Territorial MCP listening on ${PUBLIC_BASE_URL}/mcp`);
});
