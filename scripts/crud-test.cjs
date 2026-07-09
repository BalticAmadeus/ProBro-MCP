const assert = require('node:assert');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function readConfigFromEnv() {
  return {
    mode: process.env.PROBRO_MCP_MODE || 'remote',
    agentHost: process.env.PROBRO_AGENT_HOST || '127.0.0.1',
    agentPort: Number(process.env.PROBRO_AGENT_PORT || '23456'),
    database: process.env.PROBRO_DB_DATABASE || '',
    dlc: process.env.PROBRO_DLC || '',
    projectRoot: process.env.PROBRO_PROJECT_ROOT || projectRoot,
  };
}

function validateConfig(cfg) {
  if (!cfg.database) {
    throw new Error('PROBRO_DB_DATABASE is required');
  }
  if (cfg.mode === 'local' && !cfg.dlc) {
    throw new Error('PROBRO_DLC is required in local mode');
  }
}

function extractText(result) {
  if (!result || !Array.isArray(result.content)) {
    return '';
  }
  return result.content.find((item) => item.type === 'text')?.text || '';
}

function parseToolResult(result) {
  const text = extractText(result);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function throwIfToolError(payload, context) {
  if (typeof payload === 'string') {
    if (/error|failed|refused|not found|locked/i.test(payload)) {
      throw new Error(`${context} failed: ${payload}`);
    }
    return;
  }

  if (!payload || typeof payload !== 'object') {
    return;
  }

  const hasOpenEdgeError =
    typeof payload.error === 'number' ||
    typeof payload.description === 'string' ||
    typeof payload.trace === 'string';

  if (hasOpenEdgeError) {
    throw new Error(`${context} failed: ${payload.description || payload.error}`);
  }

  if (payload.ok === false) {
    throw new Error(`${context} failed: ${payload.message || JSON.stringify(payload)}`);
  }
}

function getFieldsPayload(payload) {
  if (Array.isArray(payload?.fields)) {
    return payload.fields;
  }
  if (Array.isArray(payload?.columns)) {
    return payload.columns;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function getRowsPayload(payload) {
  if (Array.isArray(payload?.rawData)) {
    return payload.rawData;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function getRowId(row) {
  const candidates = ['Rowid', 'ROWID', 'rowid', 'rowId', '_rowid'];
  for (const key of candidates) {
    if (row && typeof row[key] === 'string' && row[key].length > 0) {
      return row[key];
    }
  }
  return '';
}

function inferStringKeyField(fields, rows) {
  const keyLikeField = fields.find((field) => {
    const key = String(field.key || field.name || '').toLowerCase();
    return key.endsWith('rep') || key.endsWith('code') || key.endsWith('id') || key.endsWith('num');
  });

  if (!keyLikeField) {
    return null;
  }

  const fieldName = keyLikeField.key || keyLikeField.name;
  const values = rows
    .map((row) => row?.[fieldName])
    .filter((value) => typeof value === 'string' && value.length > 0);

  return {
    fieldName,
    existingValues: values,
  };
}

function pickTableForCrudTest(tables) {
  // Try State first since it's a simple lookup table with few constraints
  for (const table of ['State', 'Country', 'Salesrep', 'Customer', 'Order']) {
    const found = tables.find((t) => {
      const tname = typeof t === 'string' ? t : (t.table || t.name || '');
      return tname.toLowerCase() === table.toLowerCase();
    });
    if (found) {
      return typeof found === 'string' ? found : (found.table || found.name);
    }
  }
  return 'State';
}

function pickStateData(fields, rows) {
  const keyInfo = inferStringKeyField(fields, rows);
  if (!keyInfo) {
    throw new Error('Could not infer State key field');
  }

  const existing = new Set(keyInfo.existingValues);
  let candidate = 'ZZ';
  let suffix = 0;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `ZZ${String(suffix).padStart(2, '0')}`;
  }

  const maybeNameField = fields.find((field) => /name/i.test(field.key || field.name || ''));

  const data = [
    { key: keyInfo.fieldName, value: candidate },
  ];

  if (maybeNameField) {
    data.push({ key: maybeNameField.key || maybeNameField.name, value: 'MCP TEST' });
  }

  return {
    tableName: 'State',
    keyField: keyInfo.fieldName,
    insertData: data,
    updateField: maybeNameField ? maybeNameField.key || maybeNameField.name : keyInfo.fieldName,
    updatedValue: maybeNameField ? 'MCP TEST UPDATED' : `${candidate}X`,
    insertedKeyValue: candidate,
  };
}

async function run() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const cfg = readConfigFromEnv();
  validateConfig(cfg);

  const connectionArgs = cfg.mode === 'local'
    ? {
        mode: 'local',
        dlc: cfg.dlc,
        database: cfg.database,
        agentPort: cfg.agentPort,
        projectRoot: cfg.projectRoot,
      }
    : {
        mode: 'remote',
        agentHost: cfg.agentHost,
        agentPort: cfg.agentPort,
        database: cfg.database,
      };

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/index.js'],
    cwd: projectRoot,
  });

  const client = new Client(
    { name: 'probro-mcp-crud-test', version: '0.1.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const setConnectionResult = parseToolResult(await client.callTool({
      name: 'probro_set_connection',
      arguments: connectionArgs,
    }));
    throwIfToolError(setConnectionResult, 'probro_set_connection');

    const listTablesResult = parseToolResult(await client.callTool({
      name: 'probro_list_tables',
      arguments: {},
    }));
    throwIfToolError(listTablesResult, 'probro_list_tables');

    const tables = Array.isArray(listTablesResult?.tables) ? listTablesResult.tables : (Array.isArray(listTablesResult) ? listTablesResult : []);
    const targetTableName = pickTableForCrudTest(tables);

    const details = parseToolResult(await client.callTool({
      name: 'probro_get_table_details',
      arguments: { tableName: targetTableName },
    }));
    throwIfToolError(details, 'probro_get_table_details');

    const rowsPayload = parseToolResult(await client.callTool({
      name: 'probro_query_table',
      arguments: { tableName: targetTableName, pageLength: 20, start: 0 },
    }));
    throwIfToolError(rowsPayload, 'probro_query_table');

    const fields = getFieldsPayload(details);
    const rows = getRowsPayload(rowsPayload);
    assert(fields.length > 0, `Expected ${targetTableName} fields`);
    assert(rows.length > 0, `Expected ${targetTableName} rows`);

    const plan = pickStateData(fields, rows);

    const insertResult = parseToolResult(await client.callTool({
      name: 'probro_mutate_table',
      arguments: {
        tableName: plan.tableName,
        mode: 'INSERT',
        crud: [],
        data: plan.insertData,
        useWriteTriggers: true,
        useDeleteTriggers: true,
      },
    }));
    throwIfToolError(insertResult, 'INSERT');

    const insertedRowsPayload = parseToolResult(await client.callTool({
      name: 'probro_query_table',
      arguments: {
        tableName: plan.tableName,
        wherePhrase: `${plan.tableName}.${plan.keyField} = '${plan.insertedKeyValue}'`,
        pageLength: 5,
        start: 0,
      },
    }));
    throwIfToolError(insertedRowsPayload, 'query inserted record');

    const insertedRows = getRowsPayload(insertedRowsPayload);
    assert.strictEqual(insertedRows.length, 1, `Expected one inserted ${plan.tableName} row`);
    const insertedRow = insertedRows[0];
    const insertedRowId = getRowId(insertedRow);
    assert(insertedRowId, 'Expected inserted row to expose a row id');

    const updateResult = parseToolResult(await client.callTool({
      name: 'probro_mutate_table',
      arguments: {
        tableName: plan.tableName,
        mode: 'UPDATE',
        crud: [],
        lastRowID: insertedRowId,
        data: [
          {
            key: plan.updateField,
            value: plan.updatedValue,
            defaultValue: insertedRow[plan.updateField],
          },
        ],
        useWriteTriggers: true,
        useDeleteTriggers: true,
      },
    }));
    throwIfToolError(updateResult, 'UPDATE');

    const updatedRowsPayload = parseToolResult(await client.callTool({
      name: 'probro_query_table',
      arguments: {
        tableName: plan.tableName,
        wherePhrase: `${plan.tableName}.${plan.keyField} = '${plan.insertedKeyValue}'`,
        pageLength: 5,
        start: 0,
      },
    }));
    throwIfToolError(updatedRowsPayload, 'query updated record');

    const updatedRows = getRowsPayload(updatedRowsPayload);
    assert.strictEqual(updatedRows.length, 1, `Expected one updated ${plan.tableName} row`);
    const updatedRow = updatedRows[0];
    assert.strictEqual(updatedRow[plan.updateField], plan.updatedValue, 'Expected updated field value to persist');

    const deleteResult = parseToolResult(await client.callTool({
      name: 'probro_mutate_table',
      arguments: {
        tableName: plan.tableName,
        mode: 'DELETE',
        crud: [insertedRowId],
        data: [],
        useWriteTriggers: true,
        useDeleteTriggers: true,
      },
    }));
    throwIfToolError(deleteResult, 'DELETE');

    const deletedRowsPayload = parseToolResult(await client.callTool({
      name: 'probro_query_table',
      arguments: {
        tableName: plan.tableName,
        wherePhrase: `${plan.tableName}.${plan.keyField} = '${plan.insertedKeyValue}'`,
        pageLength: 5,
        start: 0,
      },
    }));
    throwIfToolError(deletedRowsPayload, 'query deleted record');

    const deletedRows = getRowsPayload(deletedRowsPayload);
    assert.strictEqual(deletedRows.length, 0, `Expected deleted ${plan.tableName} row to be gone`);

    console.log(`CRUD test passed: inserted ${plan.insertedKeyValue} into ${plan.tableName}, updated ${plan.updateField}, then deleted the row.`);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error('CRUD test failed:', error.message || error);
  process.exit(1);
});
