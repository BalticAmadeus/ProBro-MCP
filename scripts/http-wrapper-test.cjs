const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const PORT = 3001;

let wrapperProcess = null;

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Starting HTTP wrapper test...\n');

  // Start wrapper
  console.log(`Starting HTTP wrapper on port ${PORT}...`);
  wrapperProcess = spawn('node', ['src/http-wrapper.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PROBRO_HTTP_PORT: PORT,
    },
  });

  wrapperProcess.stderr.on('data', (data) => {
    console.error(`[wrapper stderr] ${data}`);
  });

  // Wait for wrapper to start
  await wait(2000);

  try {
    // Test 1: Get version before connection (should fail)
    console.log('\nTest 1: probro_get_version (pre-connection) - should error');
    const versionResult = await makeRequest('POST', '/api/probro_get_version', {});
    console.log(`Status: ${versionResult.status}`);
    console.log(`Response:`, versionResult.data);

    if (
      versionResult.status === 500 ||
      (versionResult.data.ok === false && versionResult.data.error)
    ) {
      console.log('✓ Pre-connection error correctly returned');
    } else {
      console.log('✗ Expected error before connection');
    }

    // Test 2: Set connection
    console.log('\nTest 2: probro_set_connection (local mode)');
    if (
      !process.env.PROBRO_DB_DATABASE ||
      !process.env.PROBRO_DLC ||
      !process.env.PROBRO_AGENT_PORT
    ) {
      console.log(
        'Skipping: set PROBRO_DB_DATABASE, PROBRO_DLC, PROBRO_AGENT_PORT env vars'
      );
    } else {
      const connResult = await makeRequest('POST', '/api/probro_set_connection', {
        mode: 'local',
        dlc: process.env.PROBRO_DLC,
        database: process.env.PROBRO_DB_DATABASE,
        agentPort: parseInt(process.env.PROBRO_AGENT_PORT),
      });
      console.log(`Status: ${connResult.status}`);
      console.log(`Response:`, connResult.data);

      if (connResult.data.ok) {
        console.log('✓ Connection set successfully');

        // Test 3: List tables
        console.log('\nTest 3: probro_list_tables');
        const tablesResult = await makeRequest('POST', '/api/probro_list_tables', {});
        console.log(`Status: ${tablesResult.status}`);

        if (tablesResult.data.ok && tablesResult.data.result) {
          const tableList = Array.isArray(tablesResult.data.result)
            ? tablesResult.data.result
            : tablesResult.data.result.tables || [];
          console.log(`✓ Retrieved ${tableList.length} tables`);
          if (tableList.length > 0) {
            console.log(`  First few tables: ${tableList.slice(0, 3).join(', ')}`);
          }
        } else {
          console.log('✗ Failed to list tables');
          console.log('Response:', tablesResult.data);
        }
      } else {
        console.log('✗ Failed to set connection');
      }
    }

    console.log('\n✅ HTTP wrapper tests completed');
  } catch (err) {
    console.error('Test failed:', err.message);
  }

  // Cleanup
  if (wrapperProcess) {
    console.log('\nShutting down wrapper...');
    wrapperProcess.kill();
  }
}

runTests().catch((err) => {
  console.error(err);
  if (wrapperProcess) {
    wrapperProcess.kill();
  }
  process.exit(1);
});
