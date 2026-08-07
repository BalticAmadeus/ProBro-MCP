import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProBroBridge, buildConnectionString } from './probroBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultProjectRoot = path.resolve(__dirname, '..');

let activeConnection = null;
let bridge = null;
let autoConnectPromise = null;
let activeConnectionSource = null;

function toInt(value, fallback) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTruthy(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getByPath(source, keyPath) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(source, keyPath)) {
    return source[keyPath];
  }

  return keyPath.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return acc[key];
  }, source);
}

function firstDefined(source, paths) {
  for (const p of paths) {
    const value = getByPath(source, p);
    if (typeof value !== 'undefined' && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function firstString(source, paths, fallback = '') {
  const value = firstDefined(source, paths);
  if (typeof value === 'undefined') {
    return fallback;
  }
  return String(value).trim();
}

function firstInt(source, paths, fallback) {
  const value = firstDefined(source, paths);
  if (typeof value === 'undefined') {
    return fallback;
  }
  return toInt(value, fallback);
}

function firstBool(source, paths, fallback = false) {
  const value = firstDefined(source, paths);
  if (typeof value === 'undefined') {
    return fallback;
  }
  return isTruthy(value);
}

function readWorkspaceSettings(projectRoot) {
  const candidates = [];
  if (projectRoot) {
    candidates.push(path.join(projectRoot, '.vscode', 'settings.json'));
  }
  candidates.push(path.resolve(defaultProjectRoot, '.vscode', 'settings.json'));
  candidates.push(path.resolve(process.cwd(), '.vscode', 'settings.json'));

  for (const settingsPath of candidates) {
    try {
      if (!fs.existsSync(settingsPath)) {
        continue;
      }

      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(
        raw
          .replace(/^\uFEFF/, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1')
          .replace(/,\s*([}\]])/g, '$1')
      );
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function getVsCodeStateDatabasePaths() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const codeUserDir = path.join(appData, 'Code', 'User');

  return [
    path.join(codeUserDir, 'workspaceStorage'),
    path.join(codeUserDir, 'globalStorage', 'state.vscdb'),
  ];
}

function listWorkspaceStateDbPaths(workspaceStorageRoot) {
  const stateDbPaths = [];
  if (!fs.existsSync(workspaceStorageRoot)) {
    return stateDbPaths;
  }

  for (const entry of fs.readdirSync(workspaceStorageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dbPath = path.join(workspaceStorageRoot, entry.name, 'state.vscdb');
    if (fs.existsSync(dbPath)) {
      stateDbPaths.push(dbPath);
    }
  }

  return stateDbPaths;
}

function loadProBroDbConfigsFromVsCodeState() {
  const [workspaceStorageRoot, globalStateDbPath] = getVsCodeStateDatabasePaths();
  const stateDbPaths = listWorkspaceStateDbPaths(workspaceStorageRoot);

  if (fs.existsSync(globalStateDbPath)) {
    stateDbPaths.push(globalStateDbPath);
  }

  if (stateDbPaths.length === 0) {
    return [];
  }

  const script = [
    'import json, sqlite3, sys',
    'results = []',
    'seen = set()',
    'for db in sys.argv[1:]:',
    '    try:',
    '        conn = sqlite3.connect(db)',
    "        rows = conn.execute(\"select key, cast(value as text) from ItemTable where key='pro-bro.dbconfig'\").fetchall()",
    '        for key, value in rows:',
    '            if not value:',
    '                continue',
    '            try:',
    '                parsed = json.loads(value)',
    '            except Exception:',
    '                continue',
    '            if isinstance(parsed, dict):',
    '                for item_key, item_value in parsed.items():',
    '                    if item_key not in seen and isinstance(item_value, dict):',
    '                        seen.add(item_key)',
    '                        results.append(item_value)',
    '    except Exception:',
    '        continue',
    'print(json.dumps(results))',
  ].join('\n');

  try {
    const raw = execFileSync('python', ['-c', script, ...stateDbPaths], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function loadProBroActiveConnectionFromVsCodeState() {
  const [workspaceStorageRoot] = getVsCodeStateDatabasePaths();
  const stateDbPaths = listWorkspaceStateDbPaths(workspaceStorageRoot);

  if (stateDbPaths.length === 0) {
    return null;
  }

  const script = [
    'import json, sqlite3, sys',
    'result = None',
    'for db in sys.argv[1:]:',
    '    try:',
    '        conn = sqlite3.connect(db)',
    "        rows = conn.execute(\"select key, cast(value as text) from ItemTable where key in ('pro-bro.activeConnection','BalticAmadeus.pro-bro')\").fetchall()",
    '        for key, value in rows:',
    '            if not value:',
    '                continue',
    '            try:',
    '                parsed = json.loads(value)',
    '            except Exception:',
    '                continue',
    "            if key == 'pro-bro.activeConnection' and isinstance(parsed, dict):",
    '                result = parsed',
    '                break',
    "            if key == 'BalticAmadeus.pro-bro' and isinstance(parsed, dict):",
    "                nested = parsed.get('pro-bro.activeConnection')",
    '                if isinstance(nested, dict):',
    '                    result = nested',
    '                    break',
    '    except Exception:',
    '        continue',
    '    if result:',
    '        break',
    'print(json.dumps(result))',
  ].join('\n');

  try {
    const raw = execFileSync('python', ['-c', script, ...stateDbPaths], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function pickPreferredProBroConnection(connections) {
  if (!Array.isArray(connections) || connections.length === 0) {
    return null;
  }

  const preferred = connections.find((item) => item && item.workState === true) || connections[0];
  return preferred && typeof preferred === 'object' ? preferred : null;
}

function listSavedProBroConnections() {
  const connections = loadProBroDbConfigsFromVsCodeState();
  const preferred = pickPreferredProBroConnection(connections);

  return {
    source: 'pro-bro.dbconfig',
    count: connections.length,
    preferredConnectionId: preferred ? String(preferred.id || '') : '',
    connections,
  };
}

function getAutoConnectionInputFromEnv() {
  const autoConnectEnabled = isTruthy(process.env.PROBRO_AUTO_CONNECT || 'false');
  if (!autoConnectEnabled) {
    return null;
  }

  const mode = (process.env.PROBRO_MCP_MODE || 'remote').trim().toLowerCase();
  const database = (process.env.PROBRO_DB_DATABASE || '').trim();
  if (!database) {
    return null;
  }

  const shared = {
    database,
    user: process.env.PROBRO_DB_USER || '',
    password: process.env.PROBRO_DB_PASSWORD || '',
    dbHost: process.env.PROBRO_DB_HOST || '',
    dbPort: process.env.PROBRO_DB_PORT || '',
    params: process.env.PROBRO_DB_PARAMS || '',
    projectRoot: process.env.PROBRO_PROJECT_ROOT || defaultProjectRoot,
    startupTimeoutMs: toInt(process.env.PROBRO_STARTUP_TIMEOUT_MS, 15000),
    socketTimeoutMs: toInt(process.env.PROBRO_SOCKET_TIMEOUT_MS, 15000),
  };

  if (mode === 'local') {
    const dlc = (process.env.PROBRO_DLC || '').trim();
    if (!dlc) {
      return null;
    }

    return {
      mode: 'local',
      dlc,
      agentPort: toInt(process.env.PROBRO_AGENT_PORT, 23456),
      tempFilesPath: process.env.PROBRO_TEMP_FILES_PATH || '',
      logEntryTypes: process.env.PROBRO_LOG_ENTRY_TYPES || '',
      ...shared,
    };
  }

  return {
    mode: 'remote',
    agentHost: process.env.PROBRO_AGENT_HOST || '127.0.0.1',
    agentPort: toInt(process.env.PROBRO_AGENT_PORT, 23456),
    ...shared,
  };
}

function getAutoConnectionInputFromWorkspaceSettings() {
  const settings = readWorkspaceSettings(defaultProjectRoot);
  if (!settings) {
    return null;
  }

  const autoConnectEnabled = firstBool(settings, ['pro-bro.mcp.autoConnect', 'probro.mcp.autoConnect', 'probro.autoConnect'], true);
  if (!autoConnectEnabled) {
    return null;
  }

  const mode = firstString(
    settings,
    ['pro-bro.mcp.mode', 'probro.mcp.mode', 'probro.connection.mode', 'probro.mode', 'probro.activeConnection.mode'],
    'remote'
  ).toLowerCase();

  const database = firstString(settings, [
    'pro-bro.mcp.database',
    'probro.mcp.database',
    'probro.connection.database',
    'probro.database',
    'probro.activeConnection.database',
    'probro.connection.dbName',
  ]);

  if (!database) {
    return null;
  }

  const shared = {
    database,
    user: firstString(settings, ['pro-bro.mcp.user', 'probro.mcp.user', 'probro.connection.user', 'probro.user']),
    password: firstString(settings, ['pro-bro.mcp.password', 'probro.mcp.password', 'probro.connection.password', 'probro.password']),
    dbHost: firstString(settings, ['pro-bro.mcp.dbHost', 'probro.mcp.dbHost', 'probro.connection.dbHost', 'probro.dbHost']),
    dbPort: firstString(settings, ['pro-bro.mcp.dbPort', 'probro.mcp.dbPort', 'probro.connection.dbPort', 'probro.dbPort']),
    params: firstString(settings, ['pro-bro.mcp.params', 'probro.mcp.params', 'probro.connection.params', 'probro.params']),
    projectRoot: firstString(settings, ['pro-bro.mcp.projectRoot', 'probro.mcp.projectRoot', 'probro.projectRoot'], defaultProjectRoot),
    startupTimeoutMs: firstInt(settings, ['pro-bro.mcp.startupTimeoutMs', 'probro.mcp.startupTimeoutMs', 'probro.startupTimeoutMs'], 15000),
    socketTimeoutMs: firstInt(settings, ['pro-bro.mcp.socketTimeoutMs', 'probro.mcp.socketTimeoutMs', 'probro.socketTimeoutMs'], 15000),
  };

  if (mode === 'local') {
    const dlc = firstString(settings, [
      'pro-bro.mcp.dlc',
      'probro.mcp.dlc',
      'probro.connection.dlc',
      'probro.dlc',
      'probro.activeConnection.dlc',
    ]);

    if (!dlc) {
      return null;
    }

    return {
      mode: 'local',
      dlc,
      agentPort: firstInt(settings, ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'], 23456),
      tempFilesPath: firstString(settings, ['pro-bro.mcp.tempFilesPath', 'probro.mcp.tempFilesPath', 'probro.tempFilesPath']),
      logEntryTypes: firstString(settings, ['pro-bro.mcp.logEntryTypes', 'probro.mcp.logEntryTypes', 'probro.logEntryTypes']),
      ...shared,
    };
  }

  return {
    mode: 'remote',
    agentHost: firstString(
      settings,
      ['pro-bro.mcp.agentHost', 'probro.mcp.agentHost', 'probro.connection.agentHost', 'probro.agentHost', 'probro.activeConnection.agentHost'],
      '127.0.0.1'
    ),
    agentPort: firstInt(settings, ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'], 23456),
    ...shared,
  };
}

function getAutoConnectionInputFromProBroState() {
  const connection = pickPreferredProBroConnection(loadProBroDbConfigsFromVsCodeState());
  if (!connection) {
    return null;
  }

  const database = String(connection.name || '').trim();
  if (!database) {
    return null;
  }

  const modeHint = String(connection.connectionId || '').trim().toUpperCase();
  const settings = readWorkspaceSettings(defaultProjectRoot) || {};
  const dlcFromSettings = firstString(settings, [
    'pro-bro.mcp.dlc',
    'probro.mcp.dlc',
    'probro.connection.dlc',
    'probro.dlc',
    'probro.activeConnection.dlc',
  ]);

  const agentHostFromSettings = firstString(
    settings,
    ['pro-bro.mcp.agentHost', 'probro.mcp.agentHost', 'probro.connection.agentHost', 'probro.agentHost', 'probro.activeConnection.agentHost']
  );
  const agentPortFromSettings = firstInt(
    settings,
    ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'],
    0
  );

  if (modeHint === 'LOCAL' && dlcFromSettings) {
    return {
      mode: 'local',
      database,
      user: String(connection.user || '').trim(),
      password: String(connection.password || '').trim(),
      dbHost: String(connection.host || '').trim(),
      dbPort: String(connection.port || '').trim(),
      params: String(connection.params || '').trim(),
      projectRoot: defaultProjectRoot,
      startupTimeoutMs: 15000,
      socketTimeoutMs: 15000,
      dlc: dlcFromSettings,
      agentPort: firstInt(settings, ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'], 23456),
      tempFilesPath: firstString(settings, ['pro-bro.mcp.tempFilesPath', 'probro.mcp.tempFilesPath', 'probro.tempFilesPath']),
      logEntryTypes: firstString(settings, ['pro-bro.mcp.logEntryTypes', 'probro.mcp.logEntryTypes', 'probro.logEntryTypes']),
    };
  }

  if (modeHint === 'LOCAL') {
    return {
      mode: 'local',
      database,
      user: String(connection.user || '').trim(),
      password: String(connection.password || '').trim(),
      dbHost: String(connection.host || '').trim(),
      dbPort: String(connection.port || '').trim(),
      params: String(connection.params || '').trim(),
      projectRoot: defaultProjectRoot,
      startupTimeoutMs: 15000,
      socketTimeoutMs: 15000,
      dlc: '',
      agentPort: firstInt(settings, ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'], 23456),
      tempFilesPath: firstString(settings, ['pro-bro.mcp.tempFilesPath', 'probro.mcp.tempFilesPath', 'probro.tempFilesPath']),
      logEntryTypes: firstString(settings, ['pro-bro.mcp.logEntryTypes', 'probro.mcp.logEntryTypes', 'probro.logEntryTypes']),
    };
  }

  return {
    mode: 'remote',
    database,
    user: String(connection.user || '').trim(),
    password: String(connection.password || '').trim(),
    dbHost: String(connection.host || '').trim(),
    dbPort: String(connection.port || '').trim(),
    params: String(connection.params || '').trim(),
    projectRoot: defaultProjectRoot,
    startupTimeoutMs: 15000,
    socketTimeoutMs: 15000,
    agentHost: agentHostFromSettings,
    agentPort: agentPortFromSettings,
  };
}

function getAutoConnectionInputFromProBroActiveState() {
  const connection = loadProBroActiveConnectionFromVsCodeState();
  if (!connection) {
    return null;
  }

  const database = String(connection.name || '').trim();
  if (!database) {
    return null;
  }

  const modeHint = String(connection.connectionId || '').trim().toUpperCase();
  const settings = readWorkspaceSettings(defaultProjectRoot) || {};
  const modeFromSettings = firstString(settings, ['pro-bro.mcp.mode', 'probro.mcp.mode', 'probro.mode'], '').toLowerCase();
  const dlcFromSettings = firstString(settings, [
    'pro-bro.mcp.dlc',
    'probro.mcp.dlc',
    'probro.connection.dlc',
    'probro.dlc',
    'probro.activeConnection.dlc',
  ]);
  const dlcFromState = firstString(connection, ['dlc', 'runtime.dlc', 'local.dlc', 'connection.dlc']);

  const agentHostFromSettings = firstString(
    settings,
    ['pro-bro.mcp.agentHost', 'probro.mcp.agentHost', 'probro.connection.agentHost', 'probro.agentHost', 'probro.activeConnection.agentHost']
  );
  const agentHostFromState = firstString(connection, ['agentHost', 'runtime.agentHost', 'remote.agentHost']);
  const agentPortFromSettings = firstInt(
    settings,
    ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'],
    0
  );
  const agentPortFromState = firstInt(connection, ['agentPort', 'runtime.agentPort', 'remote.agentPort'], 0);
  const tempFilesPathFromState = firstString(connection, ['tempFilesPath', 'runtime.tempFilesPath', 'local.tempFilesPath']);
  const logEntryTypesFromState = firstString(connection, ['logEntryTypes', 'runtime.logEntryTypes', 'local.logEntryTypes']);
  const startupTimeoutMsFromState = firstInt(connection, ['startupTimeoutMs', 'runtime.startupTimeoutMs'], 15000);
  const socketTimeoutMsFromState = firstInt(connection, ['socketTimeoutMs', 'runtime.socketTimeoutMs'], 15000);

  const preferLocal = modeFromSettings === 'local';

  if (preferLocal) {
    return {
      mode: 'local',
      database,
      user: String(connection.user || '').trim(),
      password: String(connection.password || '').trim(),
      dbHost: String(connection.host || '').trim(),
      dbPort: String(connection.port || '').trim(),
      params: String(connection.params || '').trim(),
      projectRoot: defaultProjectRoot,
      startupTimeoutMs: startupTimeoutMsFromState,
      socketTimeoutMs: socketTimeoutMsFromState,
      dlc: dlcFromState || dlcFromSettings || '',
      agentPort: agentPortFromState || firstInt(settings, ['pro-bro.mcp.agentPort', 'probro.mcp.agentPort', 'probro.connection.agentPort', 'probro.agentPort'], 23456),
      tempFilesPath: tempFilesPathFromState || firstString(settings, ['pro-bro.mcp.tempFilesPath', 'probro.mcp.tempFilesPath', 'probro.tempFilesPath']),
      logEntryTypes: logEntryTypesFromState || firstString(settings, ['pro-bro.mcp.logEntryTypes', 'probro.mcp.logEntryTypes', 'probro.logEntryTypes']),
    };
  }

  return {
    mode: 'remote',
    database,
    user: String(connection.user || '').trim(),
    password: String(connection.password || '').trim(),
    dbHost: String(connection.host || '').trim(),
    dbPort: String(connection.port || '').trim(),
    params: String(connection.params || '').trim(),
    projectRoot: defaultProjectRoot,
    startupTimeoutMs: startupTimeoutMsFromState,
    socketTimeoutMs: socketTimeoutMsFromState,
    agentHost: agentHostFromSettings || agentHostFromState || '127.0.0.1',
    agentPort: agentPortFromSettings || agentPortFromState || 23456,
  };
}

function formatAutoConnectionFailure(error, autoConnection) {
  const message = String(error && error.message ? error.message : error);

  if (!autoConnection || !autoConnection.input) {
    return message;
  }

  const { input, source } = autoConnection;

  if (input.mode === 'local' && message.includes('dlc is required in local mode')) {
    return `Configured local ProBro connection from ${source} is missing DLC. Set pro-bro.mcp.dlc (or probro.mcp.dlc) in workspace settings, or call probro_set_connection with dlc explicitly. Raw error: ${message}`;
  }

  if (input.mode === 'remote' && message.includes('agentHost and agentPort are required in remote mode')) {
    return `Configured remote ProBro connection from ${source} is missing agent endpoint. Set pro-bro.mcp.agentHost and pro-bro.mcp.agentPort, or call probro_set_connection explicitly. Raw error: ${message}`;
  }

  if (input.mode === 'remote' && message.includes('ECONNREFUSED')) {
    return `Configured remote ProBro agent at ${input.agentHost || '127.0.0.1'}:${input.agentPort || 23456} was unavailable. No automatic fallback was attempted. Active source: ${source}. Raw error: ${message}`;
  }

  if (input.mode === 'remote') {
    return `Configured remote ProBro connection from ${source} failed. No automatic fallback was attempted. Raw error: ${message}`;
  }

  if (input.mode === 'local') {
    return `Configured local ProBro connection from ${source} failed. No automatic fallback was attempted. Raw error: ${message}`;
  }

  return message;
}

export function getAutoConnectionCandidates() {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (source, input) => {
    if (!input || typeof input !== 'object') {
      return;
    }
    const key = [source, input.mode || '', input.database || '', input.agentHost || '', input.agentPort || ''].join('|');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ source, input });
  };

  const proBroActiveInput = getAutoConnectionInputFromProBroActiveState();
  pushCandidate('proBroActiveState', proBroActiveInput);

  // Extension-selected active connection is authoritative when present.
  if (candidates.length > 0 && candidates[0].source === 'proBroActiveState') {
    return candidates;
  }

  const proBroStateInput = getAutoConnectionInputFromProBroState();
  pushCandidate('proBroState', proBroStateInput);

  const workspaceInput = getAutoConnectionInputFromWorkspaceSettings();
  pushCandidate('workspaceSettings', workspaceInput);

  const envInput = getAutoConnectionInputFromEnv();
  pushCandidate('env', envInput);

  return candidates;
}

export function getAutoConnectionInput() {
  return getAutoConnectionCandidates()[0] || null;
}

function asTextContent(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function normalizeWherePhrase(wherePhrase) {
  if (!wherePhrase) {
    return wherePhrase;
  }
  const trimmed = String(wherePhrase).trim();
  return trimmed.replace(/^where\s+/i, '');
}

function normalizeFilters(filters) {
  if (!filters) {
    return filters;
  }

  if (Array.isArray(filters)) {
    const columns = {};
    for (const item of filters) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const key = item.column || item.columnKey || item.name;
      const value = item.value;
      if (key && typeof value !== 'undefined' && value !== null && String(value).length > 0) {
        columns[key] = String(value);
      }
    }
    return {
      enabled: true,
      columns,
    };
  }

  if (typeof filters === 'object' && filters.columns) {
    return {
      enabled: filters.enabled !== false,
      columns: filters.columns,
    };
  }

  if (typeof filters === 'object') {
    return {
      enabled: true,
      columns: filters,
    };
  }

  return filters;
}

const BEHAVIORAL_DEFAULTS = [
  'Behavioral defaults:',
  'For record updates, query the row first and pass its ROWID as lastRowID.',
  'For write operations, include the required CRUD fields and preserve explicit defaults.',
  'Prefer the smallest payload that satisfies the operation.',
].join(' ');

function withBehavioralDefaults(description) {
  return `${BEHAVIORAL_DEFAULTS} ${description}`;
}

const sortColumnSchema = z.object({
  columnKey: z.string(),
  direction: z.enum(['ASC', 'DESC']).default('ASC'),
});

async function resetBridge(newConnection) {
  if (bridge) {
    await bridge.close();
  }
  bridge = new ProBroBridge(newConnection.runtime);
  await bridge.init();
}

async function setActiveConnection(connection, source = 'manual') {
  const normalized = normalizeConnectionInput(connection);
  await resetBridge(normalized);
  activeConnection = normalized;
  activeConnectionSource = source;
  return normalized;
}

async function ensureActiveConnection() {
  if (activeConnection && bridge) {
    return;
  }

  if (!autoConnectPromise) {
    autoConnectPromise = (async () => {
      const autoConnections = getAutoConnectionCandidates();
      if (autoConnections.length === 0) {
        throw new Error(
          'No active ProBro connection. Define ProBro state or workspace settings, or call probro_set_connection manually. PROBRO_* env vars are optional overrides.'
        );
      }

      const failures = [];

      for (const autoConnection of autoConnections) {
        try {
          const normalized = normalizeConnectionInput(autoConnection.input);
          await resetBridge(normalized);
          activeConnection = normalized;
          activeConnectionSource = autoConnection.source;
          return;
        } catch (error) {
          failures.push(formatAutoConnectionFailure(error, autoConnection));
        }
      }

      throw new Error(failures.join(' | '));
    })();
  }

  try {
    await autoConnectPromise;
  } catch (error) {
    // Allow the next request to re-attempt auto-connect after transient failures.
    autoConnectPromise = null;
    throw error;
  }
}

function getConnectionStatus() {
  const autoCandidates = getAutoConnectionCandidates();
  const autoConnection = autoCandidates[0] || null;
  return {
    connected: Boolean(activeConnection && bridge),
    autoConnectEnabled: Boolean(autoConnection),
    autoConnectSource: activeConnectionSource || (autoConnection ? autoConnection.source : null),
    connection: activeConnection
      ? {
          mode: activeConnection.runtime.mode,
          agentHost: activeConnection.runtime.agentHost,
          agentPort: activeConnection.runtime.agentPort,
          database: activeConnection.dbConnection.database,
          dbHost: activeConnection.dbConnection.dbHost || '',
          dbPort: activeConnection.dbConnection.dbPort || '',
          user: activeConnection.dbConnection.user || '',
        }
      : null,
    envDefaults: autoConnection
      ? {
          mode: autoConnection.input.mode,
          agentHost: autoConnection.input.agentHost || '',
          agentPort: autoConnection.input.agentPort || 0,
          database: autoConnection.input.database,
        }
      : null,
    autoConnectCandidates: autoCandidates.map((candidate) => ({
      source: candidate.source,
      mode: candidate.input.mode,
      database: candidate.input.database,
      agentHost: candidate.input.agentHost || '',
      agentPort: candidate.input.agentPort || 0,
    })),
  };
}

async function refreshAutoConnection() {
  if (bridge) {
    await bridge.close();
  }

  bridge = null;
  activeConnection = null;
  activeConnectionSource = null;
  autoConnectPromise = null;

  await ensureActiveConnection();
  return getConnectionStatus();
}

function normalizeConnectionInput(input) {
  const mode = input.mode;
  const dbConnection = {
    database: input.database,
    user: input.user || '',
    password: input.password || '',
    dbHost: input.dbHost || '',
    dbPort: input.dbPort || '',
    params: input.params || '',
  };

  if (!dbConnection.database) {
    throw new Error('database is required');
  }

  if (mode === 'local') {
    if (!input.dlc) {
      throw new Error('dlc is required in local mode');
    }
    return {
      dbConnection,
      runtime: {
        mode: 'local',
        projectRoot: input.projectRoot || defaultProjectRoot,
        dlc: input.dlc,
        agentHost: '127.0.0.1',
        agentPort: input.agentPort || 23456,
        startupTimeoutMs: input.startupTimeoutMs || 15000,
        socketTimeoutMs: input.socketTimeoutMs || 15000,
        tempFilesPath: input.tempFilesPath || '',
        logEntryTypes: input.logEntryTypes || '',
      },
    };
  }

  if (!input.agentHost || !input.agentPort) {
    throw new Error('agentHost and agentPort are required in remote mode');
  }

  return {
    dbConnection,
    runtime: {
      mode: 'remote',
      projectRoot: input.projectRoot || defaultProjectRoot,
      dlc: '',
      agentHost: input.agentHost,
      agentPort: input.agentPort,
      startupTimeoutMs: input.startupTimeoutMs || 15000,
      socketTimeoutMs: input.socketTimeoutMs || 15000,
      tempFilesPath: '',
      logEntryTypes: '',
    },
  };
}

async function exec(command, params) {
  await ensureActiveConnection();

  const payload = {
    connectionString: buildConnectionString(activeConnection.dbConnection),
    command,
  };

  if (typeof params !== 'undefined') {
    payload.params = params;
  }

  return bridge.execute(payload);
}

const server = new McpServer({
  name: 'probro-mcp-server',
  version: '0.1.0',
  instructions: BEHAVIORAL_DEFAULTS,
});

server.tool(
  'probro_set_connection',
  withBehavioralDefaults('Configure ProBro database connection (required before CRUD operations). Supports local mode (starts OpenEdge runtime) or remote mode (connects to existing OpenEdge agent).'),
  {
    mode: z.enum(['local', 'remote']).default('local'),
    projectRoot: z.string().optional(),
    dlc: z.string().optional(),
    agentHost: z.string().optional(),
    agentPort: z.number().int().positive().optional(),
    database: z.string(),
    user: z.string().optional(),
    password: z.string().optional(),
    dbHost: z.string().optional(),
    dbPort: z.string().optional(),
    params: z.string().optional(),
    startupTimeoutMs: z.number().int().positive().optional(),
    socketTimeoutMs: z.number().int().positive().optional(),
    tempFilesPath: z.string().optional(),
    logEntryTypes: z.string().optional(),
  },
  async (input) => {
    const normalized = await setActiveConnection(input, 'manual');

    const version = await exec('get_version');
    return asTextContent({
      ok: true,
      runtime: normalized.runtime,
      version,
    });
  }
);

server.tool(
  'probro_set_active_connection',
  withBehavioralDefaults('Set the active ProBro connection from an already-prepared extension or host context.'),
  {
    mode: z.enum(['local', 'remote']).default('local'),
    projectRoot: z.string().optional(),
    dlc: z.string().optional(),
    agentHost: z.string().optional(),
    agentPort: z.number().int().positive().optional(),
    database: z.string(),
    user: z.string().optional(),
    password: z.string().optional(),
    dbHost: z.string().optional(),
    dbPort: z.string().optional(),
    params: z.string().optional(),
    startupTimeoutMs: z.number().int().positive().optional(),
    socketTimeoutMs: z.number().int().positive().optional(),
    tempFilesPath: z.string().optional(),
    logEntryTypes: z.string().optional(),
  },
  async (input) => {
    const normalized = await setActiveConnection(input, 'extension');
    return asTextContent({
      ok: true,
      runtime: normalized.runtime,
      connection: {
        mode: normalized.runtime.mode,
        database: normalized.dbConnection.database,
        agentHost: normalized.runtime.agentHost,
        agentPort: normalized.runtime.agentPort,
      },
    });
  }
);

server.tool('probro_get_version', withBehavioralDefaults('Get ProBro and OpenEdge version information.'), {}, async () => {
  const data = await exec('get_version');
  return asTextContent(data);
});

server.tool(
  'probro_get_connection_status',
  withBehavioralDefaults('Check current connection status, including active connection details and auto-connect configuration.'), {}, async () => {
  const status = getConnectionStatus();
  if (status.connected) {
    return asTextContent(status);
  }

  try {
    await ensureActiveConnection();
    return asTextContent(getConnectionStatus());
  } catch (error) {
    return asTextContent({
      ...status,
      connected: false,
      lastError: error.message || String(error),
    });
  }
});

server.tool(
  'probro_refresh_auto_connection',
  withBehavioralDefaults('Force-refresh auto-connect settings and reconnect using env or workspace ProBro configuration.'), {},
  async () => {
    try {
      const status = await refreshAutoConnection();
      return asTextContent({
        ok: true,
        refreshed: true,
        status,
      });
    } catch (error) {
      return asTextContent({
        ok: false,
        refreshed: false,
        error: error.message || String(error),
        status: getConnectionStatus(),
      });
    }
  }
);

server.tool(
  'probro_get_saved_connections',
  withBehavioralDefaults('List saved ProBro connection definitions discovered from VS Code state storage.'),
  {},
  async () => {
    return asTextContent(listSavedProBroConnections());
  }
);

server.tool('probro_list_tables', withBehavioralDefaults('List all available tables in the connected ProBro database.'), {}, async () => {
  const data = await exec('get_tables');
  return asTextContent(data);
});

server.tool(
  'probro_get_table_details',
  withBehavioralDefaults('Get detailed schema and field information for a specific table.'),
  {
    tableName: z.string(),
  },
  async ({ tableName }) => {
    const data = await exec('get_table_details', tableName);
    return asTextContent(data);
  }
);

server.tool(
  'probro_query_table',
  withBehavioralDefaults('Query and retrieve records from a table with filtering, sorting, and pagination support.'),
  {
    tableName: z.string(),
    wherePhrase: z.string().optional(),
    start: z.number().int().nonnegative().default(0),
    pageLength: z.number().int().positive().default(100),
    minTime: z.number().int().nonnegative().default(100),
    lastRowID: z.string().default(''),
    sortColumns: z.array(sortColumnSchema).default([]),
    filters: z.object({
      enabled: z.boolean().optional(),
      columns: z.record(z.string()).optional(),
    }).passthrough().optional(),
    timeOut: z.number().int().positive().default(1000),
  },
  async (input) => {
    const payload = {
      wherePhrase: normalizeWherePhrase(input.wherePhrase),
      start: input.start,
      pageLength: input.pageLength,
      minTime: input.minTime,
      lastRowID: input.lastRowID,
      sortColumns: input.sortColumns,
      filters: normalizeFilters(input.filters),
      timeOut: input.timeOut,
    };

    const data = await exec('get_table_data', {
      tableName: input.tableName,
      ...payload,
    });
    return asTextContent(data);
  }
);

server.tool(
  'probro_mutate_table',
  withBehavioralDefaults('Insert, update, delete, or copy records in a table. Supports write and delete triggers.'),
  {
    tableName: z.string(),
    mode: z.enum(['INSERT', 'UPDATE', 'DELETE', 'COPY']),
    crud: z.array(z.string()).default([]),
    data: z
      .array(
        z.object({
          key: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
        })
      )
      .default([]),
    useWriteTriggers: z.boolean().default(true),
    useDeleteTriggers: z.boolean().default(true),
    wherePhrase: z.string().optional(),
    start: z.number().int().nonnegative().default(0),
    pageLength: z.number().int().positive().default(100),
    minTime: z.number().int().nonnegative().default(100),
    lastRowID: z.string().default(''),
    sortColumns: z.array(sortColumnSchema).default([]),
    filters: z.object({
      enabled: z.boolean().optional(),
      columns: z.record(z.string()).optional(),
    }).passthrough().optional(),
    timeOut: z.number().int().positive().default(1000),
  },
  async (input) => {
    const payload = {
      tableName: input.tableName,
      mode: input.mode,
      crud: input.crud,
      data: input.data,
      useWriteTriggers: input.useWriteTriggers,
      useDeleteTriggers: input.useDeleteTriggers,
      wherePhrase: normalizeWherePhrase(input.wherePhrase),
      start: input.start,
      pageLength: input.pageLength,
      minTime: input.minTime,
      lastRowID: input.lastRowID,
      sortColumns: input.sortColumns,
      filters: normalizeFilters(input.filters),
      timeOut: input.timeOut,
    };

    const data = await exec('submit_table_data', payload);
    return asTextContent(data);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on('SIGINT', async () => {
  if (bridge) {
    await bridge.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (bridge) {
    await bridge.close();
  }
  process.exit(0);
});

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch(async (error) => {
    if (bridge) {
      await bridge.close();
    }
    console.error(error);
    process.exit(1);
  });
}
