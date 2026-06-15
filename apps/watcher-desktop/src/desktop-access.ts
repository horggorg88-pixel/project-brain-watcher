import type { AccessLoginRequest, DesktopAccessState, McpConfigDiscovery, SavedProjectProfile, WatcherPolicyGate } from './contracts.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import { applyMcpConfigToProfile, defaultProfile, readProfiles } from './desktop-profile-store.js';
import { authorizeDesktopAccount } from './desktop-account-auth.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { saveDesktopAccessHandoff } from './desktop-access-handoff.js';
import { readDesktopEnvServiceToken, readDesktopServiceSecretState, readDesktopServiceToken, stageDesktopServiceSecret } from './desktop-service-secret.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';
import { clearDesktopAccessSession, readDesktopAccessSession, saveDesktopAccessSession } from './desktop-access-session.js';
export function readAccessState(paths: DesktopCorePaths): DesktopAccessState {
  const config = discoverMcpConfig(paths);
  const secretState = readDesktopServiceSecretState(resolveConfiguredProfile(paths, config));
  const serviceSecretReady = secretState.configured && secretState.acl.restricted;
  const session = readDesktopAccessSession(paths);
  const signedIn = session !== null;
  const serverVerified = signedIn && serviceSecretReady && session.serverVerified;
  return buildAccessState({
    email: session?.email ?? null,
    signedIn,
    serverVerified,
    secretConfigured: secretState.configured,
    serviceSecretConfigured: serviceSecretReady,
    config,
    message: signedIn
      ? 'Локальный пульт открыт. Состояние MCP-контура обновлено.'
      : 'Войдите данными личного кабинета, чтобы открыть локальный пульт watcher.',
  });
}

export async function loginAccess(paths: DesktopCorePaths, request: AccessLoginRequest): Promise<DesktopAccessState> {
  const email = request.email.trim().toLowerCase();
  const password = request.password;
  const config = discoverMcpConfig(paths);
  const profile = resolveConfiguredProfile(paths, config);
  let secretState = readDesktopServiceSecretState(profile);
  const authGate = validateLogin(email, password);
  if (authGate.decision !== 'allow') {
    const serviceSecretReady = secretState.configured && secretState.acl.restricted;
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
  const enteredBarrierKey = barrierTokenFromLogin(password);
  let activeProfile = profile;
  if (activeProfile && enteredBarrierKey) secretState = stageDesktopServiceSecret(activeProfile, enteredBarrierKey);
  let token = activeProfile ? enteredBarrierKey ?? readDesktopServiceToken(activeProfile) : null;
  let verifiedToken = token;
  let serverAccess = config.found && token !== null && activeProfile
    ? await verifyProjectServerAccess(activeProfile, token)
    : { verified: false, message: '' };
  if (activeProfile && !serverAccess.verified && !enteredBarrierKey) {
    const envToken = readDesktopEnvServiceToken(activeProfile);
    if (envToken && envToken !== token) {
      const envAccess = await verifyProjectServerAccess(activeProfile, envToken);
      if (envAccess.verified) {
        serverAccess = envAccess;
        verifiedToken = envToken;
      }
    }
  }
  let accountAccess: Awaited<ReturnType<typeof authorizeDesktopAccount>> | null = null;
  if (!enteredBarrierKey && (!activeProfile || !config.found || !serverAccess.verified)) {
    accountAccess = await authorizeDesktopAccount({ email, password }, config, activeProfile);
  }
  if (accountAccess?.ok && accountAccess.serverUrl && accountAccess.bearerToken) {
    saveDesktopAccessHandoff(paths, {
      serverUrl: accountAccess.serverUrl,
      consoleUrl: accountAccess.consoleUrl,
      tokenEnv: accountAccess.tokenEnv,
      token: accountAccess.bearerToken,
    });
    if (profile) {
      activeProfile = {
        ...profile,
        serverUrl: profile.serverUrl || accountAccess.serverUrl,
        consoleUrl: profile.consoleUrl || accountAccess.consoleUrl || '',
        tokenEnv: profile.tokenEnv || accountAccess.tokenEnv,
      };
      secretState = stageDesktopServiceSecret(activeProfile, accountAccess.bearerToken);
    }
  }
  token = activeProfile ? enteredBarrierKey ?? accountAccess?.bearerToken ?? readDesktopServiceToken(activeProfile) : null;
  if (config.found && token !== null && activeProfile && accountAccess?.ok) {
    serverAccess = await verifyProjectServerAccess(activeProfile, token);
    verifiedToken = token;
  }
  if (activeProfile && serverAccess.verified && verifiedToken && !enteredBarrierKey) {
    secretState = stageDesktopServiceSecret(activeProfile, verifiedToken);
  }
  const serviceSecretReady = secretState.configured && secretState.acl.restricted;
  const serverVerified = serverAccess.verified;
  saveDesktopAccessSession(paths, { email, serverVerified });
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
      ? `Локальный пульт открыт, но bearer для службы не найден. ${accountAccess?.message ?? 'Войдите по данным личного кабинета.'}`
      : accountAccess?.ok
      ? 'Учётные данные приняты. Теперь выберите папку проекта: пульт сам создаст .brain с вашим bearer.'
      : `Учётные данные приняты локально, но файл настройки MCP не найден. ${accountAccess?.message ?? 'Выберите папку проекта в пульте.'}`,
    extraGates: [authGate],
  });
}

export function logoutAccess(paths: DesktopCorePaths): DesktopAccessState {
  clearDesktopAccessSession(paths);
  return readAccessState(paths);
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

function barrierTokenFromLogin(value: string): string | null {
  const token = value.trim();
  return /^pb_[^\s]{8,}$/.test(token) ? token : null;
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
  return applyMcpConfigToProfile(matched ?? profiles[0] ?? defaultProfile(paths), config);
}
