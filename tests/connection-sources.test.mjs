import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getAutoConnectionCandidates } from '../src/index.js';

test('auto-connect should include env fallback when enabled', () => {
  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probro-appdata-env-'));
  const wsRoot = path.join(tempRoot, 'Code', 'User', 'workspaceStorage', 'empty-workspace');
  fs.mkdirSync(wsRoot, { recursive: true });

  process.env.APPDATA = tempRoot;
  process.env.PROBRO_AUTO_CONNECT = 'true';
  process.env.PROBRO_MCP_MODE = 'local';
  process.env.PROBRO_DB_DATABASE = 'C:/temp/sample.db';
  process.env.PROBRO_DLC = 'C:/Progress/OpenEdge';

  const candidates = getAutoConnectionCandidates();

  if (typeof originalAppData === 'undefined') {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });

  delete process.env.PROBRO_AUTO_CONNECT;
  delete process.env.PROBRO_MCP_MODE;
  delete process.env.PROBRO_DB_DATABASE;
  delete process.env.PROBRO_DLC;

  assert.ok(candidates.some((candidate) => candidate.source === 'env'));
  assert.equal(candidates[0].source, 'env');
});

test('auto-connect should read nested pro-bro.activeConnection from BalticAmadeus.pro-bro workspace state', () => {
  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probro-appdata-'));
  const workspaceStateDb = path.join(
    tempRoot,
    'Code',
    'User',
    'workspaceStorage',
    'workspace-under-test',
    'state.vscdb'
  );

  fs.mkdirSync(path.dirname(workspaceStateDb), { recursive: true });

  const nestedState = {
    'pro-bro.activeConnection': {
      connectionId: 'LOCAL',
      name: 'C:/OpenEdge/WRK/sports2020/sports2020.db',
      host: 'localhost',
      port: '23567',
      user: '',
      password: '',
      params: '-ct 1',
    },
  };

  const createDbScript = [
    'import sqlite3, sys',
    'db = sys.argv[1]',
    'payload = sys.argv[2]',
    'conn = sqlite3.connect(db)',
    'conn.execute("create table if not exists ItemTable (key text primary key, value text)")',
    "conn.execute(\"insert or replace into ItemTable(key, value) values ('BalticAmadeus.pro-bro', ?)\", (payload,))",
    'conn.commit()',
  ].join('\n');

  try {
    execFileSync('python', ['-c', createDbScript, workspaceStateDb, JSON.stringify(nestedState)], {
      stdio: 'ignore',
    });
  } catch {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return;
  }

  process.env.APPDATA = tempRoot;

  const candidates = getAutoConnectionCandidates();

  if (typeof originalAppData === 'undefined') {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });

  const proBroCandidate = candidates.find((candidate) => candidate.source === 'proBroActiveState');

  assert.ok(proBroCandidate);
  assert.equal(candidates.length, 1);
  assert.equal(proBroCandidate.input.mode, 'remote');
  assert.equal(proBroCandidate.input.database, 'C:/OpenEdge/WRK/sports2020/sports2020.db');
  assert.equal(proBroCandidate.input.params, '-ct 1');
  assert.equal(proBroCandidate.input.agentHost, '127.0.0.1');
  assert.equal(proBroCandidate.input.agentPort, 23456);
});

test('auto-connect should read direct pro-bro.activeConnection workspace state key', () => {
  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probro-appdata-direct-'));
  const workspaceStateDb = path.join(
    tempRoot,
    'Code',
    'User',
    'workspaceStorage',
    'workspace-under-test',
    'state.vscdb'
  );

  fs.mkdirSync(path.dirname(workspaceStateDb), { recursive: true });

  const directState = {
    connectionId: 'REMOTE',
    name: 'C:/OpenEdge/WRK/sports2020/sports2020.db',
    host: '127.0.0.1',
    port: '23456',
    user: 'sports',
    password: 'secret',
    params: '-ct 1',
  };

  const createDbScript = [
    'import sqlite3, sys',
    'db = sys.argv[1]',
    'payload = sys.argv[2]',
    'conn = sqlite3.connect(db)',
    'conn.execute("create table if not exists ItemTable (key text primary key, value text)")',
    "conn.execute(\"insert or replace into ItemTable(key, value) values ('pro-bro.activeConnection', ?)\", (payload,))",
    'conn.commit()',
  ].join('\n');

  try {
    execFileSync('python', ['-c', createDbScript, workspaceStateDb, JSON.stringify(directState)], {
      stdio: 'ignore',
    });
  } catch {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return;
  }

  process.env.APPDATA = tempRoot;

  const candidates = getAutoConnectionCandidates();

  if (typeof originalAppData === 'undefined') {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });

  const proBroCandidate = candidates.find((candidate) => candidate.source === 'proBroActiveState');

  assert.ok(proBroCandidate);
  assert.equal(candidates.length, 1);
  assert.equal(proBroCandidate.input.database, 'C:/OpenEdge/WRK/sports2020/sports2020.db');
  assert.equal(proBroCandidate.input.user, 'sports');
  assert.equal(proBroCandidate.input.mode, 'remote');
});

test('auto-connect should read runtime settings from pro-bro.activeConnection workspace state when present', () => {
  const originalAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probro-appdata-runtime-'));
  const workspaceStateDb = path.join(
    tempRoot,
    'Code',
    'User',
    'workspaceStorage',
    'workspace-under-test',
    'state.vscdb'
  );

  fs.mkdirSync(path.dirname(workspaceStateDb), { recursive: true });

  const runtimeState = {
    connectionId: 'LOCAL',
    name: 'C:/OpenEdge/WRK/sports2020/sports2020.db',
    host: 'localhost',
    port: '23567',
    user: '',
    password: '',
    params: '-ct 1',
    dlc: 'C:/Progress/OpenEdge',
    agentPort: 23456,
    tempFilesPath: 'C:/temp/probro',
    logEntryTypes: '4gl,db',
  };

  const createDbScript = [
    'import sqlite3, sys',
    'db = sys.argv[1]',
    'payload = sys.argv[2]',
    'conn = sqlite3.connect(db)',
    'conn.execute("create table if not exists ItemTable (key text primary key, value text)")',
    'conn.execute("insert or replace into ItemTable(key, value) values (?, ?)", ("pro-bro.activeConnection", payload))',
    'conn.commit()',
  ].join('\n');

  try {
    execFileSync('python', ['-c', createDbScript, workspaceStateDb, JSON.stringify(runtimeState)], {
      stdio: 'ignore',
    });
  } catch {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return;
  }

  process.env.APPDATA = tempRoot;

  const candidates = getAutoConnectionCandidates();

  if (typeof originalAppData === 'undefined') {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });

  const proBroCandidate = candidates.find((candidate) => candidate.source === 'proBroActiveState');

  assert.ok(proBroCandidate);
  assert.equal(proBroCandidate.input.mode, 'remote');
  assert.equal(proBroCandidate.input.database, 'C:/OpenEdge/WRK/sports2020/sports2020.db');
  assert.equal(proBroCandidate.input.agentHost, '127.0.0.1');
  assert.equal(proBroCandidate.input.agentPort, 23456);
});
