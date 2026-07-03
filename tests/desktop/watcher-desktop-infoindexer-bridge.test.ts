import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { callDesktopInfoIndexerTool } from '../../apps/watcher-desktop/src/desktop-infoindexer-bridge.js';
import { saveProfile, type DesktopCorePaths } from '../../apps/watcher-desktop/src/desktop-profile-store.js';
import { stageDesktopServiceSecret } from '../../apps/watcher-desktop/src/desktop-service-secret.js';

describe('watcher desktop InfoIndexer bridge', () => {
  it('calls the stateless tools bridge with project bearer and no-store receipt', async () => {
    const paths = testPaths();
    const profile = saveProfile(paths, {
      id: 'infoindexer',
      name: 'InfoIndexer',
      root: join(paths.userDataPath, 'INFOINDEXER'),
      indexId: 'idx-infoindexer',
      serverUrl: 'http://127.0.0.1:14900/mcp/p/infoindexer',
      tokenEnv: 'MCP_BEARER_TOKEN',
    }, { stageLocalSecrets: false });
    stageDesktopServiceSecret(profile, 'pb_desktop_infoindexer_secret_12345');

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      content: 'search ok',
      structuredContent: {
        schemaVersion: 'infoindexer.search_companies/v1',
        status: 'ok',
        project_id: 'infoindexer',
      },
      isError: false,
    }), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callDesktopInfoIndexerTool(paths, {
      tool: 'infoindexer.search_companies',
      projectId: 'infoindexer',
      query: 'ООО Ромашка',
      limit: 10,
      projection: 'compact',
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:14900/api/tools/call', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer pb_desktop_infoindexer_secret_12345',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        tool: 'infoindexer.search_companies',
        arguments: {
          project_id: 'infoindexer',
          query: 'ООО Ромашка',
          limit: 10,
          projection: 'compact',
        },
      }),
    }));
    expect(result).toMatchObject({
      ok: true,
      content: 'search ok',
      isError: false,
      status: 200,
      cacheControl: 'no-store',
      endpoint: 'http://127.0.0.1:14900/api/tools/call',
      projectId: 'infoindexer',
      tool: 'infoindexer.search_companies',
    });
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      project_id: 'infoindexer',
    });
  });
});

function testPaths(): DesktopCorePaths {
  const root = join(tmpdir(), `pbw-infoindexer-bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const homePath = join(root, 'home');
  const userDataPath = join(root, 'user-data');
  mkdirSync(homePath, { recursive: true });
  mkdirSync(userDataPath, { recursive: true });
  return { homePath, userDataPath };
}
