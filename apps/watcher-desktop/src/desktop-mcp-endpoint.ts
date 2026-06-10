export function normalizeMcpServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed
    .replace(/\/mcp\/p\/[^/]+$/i, '')
    .replace(/\/mcp$/i, '');
}

export function buildProjectMcpEndpoint(serverUrl: string, projectId: string): string {
  const base = normalizeMcpServerUrl(serverUrl);
  const encodedProjectId = encodeURIComponent(projectId.trim());
  return base ? `${base}/mcp/p/${encodedProjectId}` : '';
}
