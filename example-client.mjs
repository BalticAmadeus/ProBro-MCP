#!/usr/bin/env node

/**
 * Simple example client for the ProBro HTTP wrapper
 * 
 * Usage:
 *   node example-client.mjs
 * 
 * Prerequisites:
 *   - HTTP wrapper running: npm run start:http
 *   - Environment variables set (or modify hardcoded values below):
 *     - PROBRO_DB_DATABASE
 *     - PROBRO_DLC
 *     - PROBRO_AGENT_PORT
 */

const API_BASE = 'http://localhost:3000/api';

async function call(endpoint, body = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!data.ok) {
    console.error(`❌ ${endpoint} failed:`, data.error);
    throw new Error(data.error);
  }

  // Handle both parsed and string results
  let result = data.result;
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      // Keep as string if not valid JSON
    }
  }

  return result;
}

async function main() {
  try {
    // Step 1: Set connection
    console.log('📡 Setting connection...');
    const connectionResult = await call('probro_set_connection', {
      mode: 'local',
      dlc: process.env.PROBRO_DLC || 'C:/Progress/OpenEdge',
      database:
        process.env.PROBRO_DB_DATABASE ||
        'C:/OpenEdge/WRK/sports2020/sports2020.db',
      agentPort: parseInt(process.env.PROBRO_AGENT_PORT || '23456'),
    });

    // Extract version from nested structure
    const version = connectionResult?.version || connectionResult;
    const proVersion = version?.proversion || 'unknown';
    console.log(`✓ Connected to OpenEdge ${proVersion}`);

    // Step 2: Get version
    console.log('\n📊 Getting version info...');
    const versionInfo = await call('probro_get_version', {});
    const dbVersion = versionInfo?.dbversion || versionInfo?.version || 'unknown';
    console.log(`✓ OpenEdge Database: v${dbVersion}`);
    if (versionInfo?.debug) {
      console.log(`✓ ProBro Connection time: ${versionInfo.debug.time}ms`);
    }

    // Step 3: List tables
    console.log('\n📋 Listing all tables...');
    const tables = await call('probro_list_tables', {});
    const tableArray = Array.isArray(tables) ? tables : tables?.tables || [];
    console.log(`✓ Found ${tableArray.length} tables:`);
    tableArray.slice(0, 10).forEach((t) => {
      const tableName = typeof t === 'string' ? t : t.table || JSON.stringify(t);
      console.log(`  - ${tableName}`);
    });
    if (tableArray.length > 10) {
      console.log(`  ... and ${tableArray.length - 10} more`);
    }

    // Step 4: Get table details
    console.log('\n🔍 Getting table details for "Customer"...');
    const customerDetails = await call('probro_get_table_details', {
      tableName: 'Customer',
    });

    const fields = customerDetails?.fields || [];
    console.log(`✓ Customer table has ${fields.length} columns:`);
    fields.slice(0, 5).forEach((f) => {
      const colName = f?.column || f?.name || 'unknown';
      const colType = f?.type || f?.dataType || 'unknown';
      console.log(`  - ${colName}: ${colType}`);
    });

    // Step 5: Query data
    console.log('\n🔎 Querying first 5 customers...');
    const queryResult = await call('probro_query_table', {
      tableName: 'Customer',
      pageLength: 5,
      start: 0,
    });

    const data = queryResult?.data || queryResult || [];
    const dataArray = Array.isArray(data) ? data : [];
    console.log(`✓ Retrieved ${dataArray.length} records:`);
    dataArray.slice(0, 3).forEach((record) => {
      const recordStr = typeof record === 'object' ? JSON.stringify(record) : String(record);
      console.log(`  - ${recordStr.substring(0, 80)}`);
    });
    console.log('\n✅ All examples completed successfully!');
    console.log(
      '\nNow you can:\n' +
        '1. Call these endpoints from Copilot Chat via HTTP requests\n' +
        '2. Create a custom agent that uses these tools\n' +
        '3. Build a VS Code extension that wraps this API'
    );
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
