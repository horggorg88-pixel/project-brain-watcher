import type {
  AccessLoginRequest,
  DesktopAccessState,
  McpConfigDiscovery,
  SavedProjectProfile,
  WatcherPolicyGate,
} from './contracts.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import { defaultProfile, readProfiles } from './desktop-profile-store.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { readDesktopServiceSecret, readDesktopServiceSecretState } from './desktop-service-secret.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';

export function readAccessState(paths: DesktopCorePaths): DesktopAccessState {
  const config = discoverMcpConfig(paths);
  const secretState = readDesktopServiceSecretState(resolveConfiguredProfile(paths, config));
  const serviceSecretReady = secretState.configured && secretState.acl.restricted;
  return buildAccessState({
    email: null,
    signedIn: false,
    serverVerified: false,
    secretConfigured: secretState.configured,
    serviceSecretConfigured: serviceSecretReady,
    config,
    message: 'Войдите данными личного кабинета, чтобы открыть локальный пульт watcher.',
  });
}

export async function loginAccess(paths: DesktopCorePaths, request: AccessLoginRequest): Promise<DesktopAccessState> {
  const email = request.email.trim().toLowerCase();
  const password = request.password;
  const config = discoverMcpConfig(paths);
  const profile = resolveConfiguredProfile(paths, config);
  const secretState = readDesktopServiceSecretState(profile);
  const serviceSecretReady = secretState.configured && secretState.acl.restricted;
  const token = profile ? readDesktopServiceSecret(profile) ?? process.env[profile.tokenEnv] ?? null : null;
  const authGate = validateLogin(email, password);
  if (authGate.decision !== 'allow') {
    return buildAccessState({
      email,
      signedIn: false,
      serverVerified: false,
      secretConfigured: secretState.configured,
      serviceSecretConfigured: serviceSecretReady,
      config,
      message: authGate.reasons.join(' '),
      extraGates: [authGate],
    });
  }
  const serverAccess = config.found && serviceSecretReady && profile
    ? await verifyProjectServerAccess(profile, token)
    : { verified: false, message: '' };
  const serverVerified = serverAccess.verified;
  return buildAccessState({
    email,
    signedIn: true,
    serverVerified,
    secretConfigured: secretState.configured,
    serviceSecretConfigured: serviceSecretReady,
    config,
    message: config.found && serviceSecretReady && serverVerified
      ? 'Локальный пульт открыт. Конфиг MCP и secret-файл службы найдены.'
      : config.found && serviceSecretReady
      ? `Локальный пульт открыт, но серверная проверка не завершена. ${serverAccess.message}`
      : config.found && secretState.configured
      ? `Локальный пульт открыт, но ACL secret-файла службы не подтверждён. ${secretState.acl.repairHint ?? ''}`.trim()
      : config.found
      ? 'Локальный пульт открыт, но bearer для службы не найден. Импортируйте конфиг из личного кабинета.'
      : 'Учётные данные приняты локально, но файл настройки MCP не найден. Откройте личный кабинет и скачайте настройку.',
    extraGates: [authGate],
  });
}

function buildAccessState(input: {
  readonly email: string | null;
  readonly signedIn: boolean;
  readonly serverVerified: boolean;
  readonly secretConfigured: boolean;
  readonly serviceSecretConfigured: boolean;
  readonly config: McpConfigDiscovery;
  readonly message: string;
  readonly extraGates?: readonly WatcherPolicyGate[];
}): DesktopAccessState {
  const configGate = configDiscoveryGate(input.config);
  const secretGate: WatcherPolicyGate = input.serviceSecretConfigured
    ? { decision: 'allow', risk: 'low', reasons: ['Secret-файл watcher-службы найден'] }
    : { decision: 'prompt', risk: 'medium', reasons: ['Secret-файл watcher-службы ещё не создан'] };
  const serverGate: WatcherPolicyGate = input.serverVerified
    ? { decision: 'allow', risk: 'low', reasons: ['Серверный доступ подтверждён'] }
    : { decision: 'prompt', risk: 'medium', reasons: ['Серверная проверка учётной записи ожидает серверный контроль допуска'] };
  return {
    status: input.signedIn
      ? input.config.found
        ? resolveSignedInStatus(input)
        : 'config_missing'
      : 'signed_out',
    signedIn: input.signedIn,
    serverVerified: input.serverVerified,
    serviceSecretConfigured: input.serviceSecretConfigured,
    email: input.email,
    message: input.message,
    config: input.config,
    gates: [...(input.extraGates ?? []), configGate, secretGate, serverGate],
  };
}

function resolveSignedInStatus(input: {
  readonly serverVerified: boolean;
  readonly secretConfigured: boolean;
  readonly serviceSecretConfigured: boolean;
  readonly config: McpConfigDiscovery;
}): DesktopAccessState['status'] {
  const profile = input.config.found;
  if (!profile) return 'config_missing';
  if (input.serverVerified && input.serviceSecretConfigured) return 'local_ready';
  if (!input.secretConfigured) return 'secret_missing';
  if (!input.serviceSecretConfigured) return 'acl_failed';
  return 'bearer_unverified';
}

function validateLogin(email: string, password: string): WatcherPolicyGate {
  const reasons: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reasons.push('Введите почту из личного кабинета.');
  if (password.length < 8) reasons.push('Пароль должен быть не короче 8 символов.');
  return reasons.length === 0
    ? { decision: 'allow', risk: 'low', reasons: ['Форма входа заполнена'] }
    : { decision: 'deny', risk: 'medium', reasons };
}

function configDiscoveryGate(config: McpConfigDiscovery): WatcherPolicyGate {
  return config.found
    ? { decision: 'allow', risk: 'low', reasons: [`Файл настройки MCP найден: ${config.source}`] }
    : { decision: 'deny', risk: 'high', reasons: ['Файл настройки MCP не найден локально'] };
}

function resolveConfiguredProfile(paths: DesktopCorePaths, config: McpConfigDiscovery): SavedProjectProfile | null {
  const profiles = readProfiles(paths);
  const matched = profiles.find(profile => (
    (config.projectId && profile.id === config.projectId)
    || (config.localPath && profile.root === config.localPath)
  ));
  return matched ?? profiles[0] ?? defaultProfile(paths);
}
