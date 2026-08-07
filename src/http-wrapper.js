import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let mcpProcess = null;
let mcpClient = null;

async function startMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProcess = spawn('node', ['src/index.js'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    setTimeout(() => {
      resolve();
    }, 1000);

    mcpProcess.on('error', (err) => {
      reject(err);
    });

    mcpProcess.on('exit', (code) => {
      console.error(`MCP process exited with code ${code}`);
    });
  });
}

async function callMcpTool(toolName, args) {
  if (!mcpClient) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    const transport = new StdioClientTransport({
      command: 'node',
      args: ['src/index.js'],
      cwd: projectRoot,
    });

    mcpClient = new Client(
      {
        name: 'probro-http-wrapper',
        version: '0.1.0',
      },
      {
        capabilities: {},
      }
    );

    await mcpClient.connect(transport);
  }

  const result = await mcpClient.callTool({
    name: toolName,
    arguments: args || {},
  });

  return result;
}

function extractText(result) {
  if (!result || !Array.isArray(result.content)) {
    return '';
  }
  const textBlock = result.content.find((item) => item.type === 'text');
  return textBlock ? textBlock.text : '';
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const urlParts = req.url.split('/').filter(Boolean);
  if (urlParts.length < 2 || urlParts[0] !== 'api') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const toolName = urlParts[1];

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const args = body ? JSON.parse(body) : {};

      const result = await callMcpTool(toolName, args);
      const text = extractText(result);
      const payload = parsePayload(text);

      res.writeHead(200);
      res.end(
        JSON.stringify({
          ok: true,
          tool: toolName,
          result: payload,
        })
      );
    } catch (err) {
      res.writeHead(500);
      res.end(
        JSON.stringify({
          ok: false,
          error: err.message || String(err),
        })
      );
    }
  });
});

const PORT = process.env.PROBRO_HTTP_PORT || 3000;

server.listen(PORT, () => {
  console.log(`ProBro HTTP wrapper listening on http://localhost:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  POST http://localhost:${PORT}/api/probro_set_connection`);
  console.log(`  POST http://localhost:${PORT}/api/probro_set_active_connection`);
  console.log(`  POST http://localhost:${PORT}/api/probro_get_version`);
  console.log(`  POST http://localhost:${PORT}/api/probro_get_saved_connections`);
  console.log(`  POST http://localhost:${PORT}/api/probro_refresh_auto_connection`);
  console.log(`  POST http://localhost:${PORT}/api/probro_list_tables`);
  console.log(`  POST http://localhost:${PORT}/api/probro_get_table_details`);
  console.log(`  POST http://localhost:${PORT}/api/probro_query_table`);
  console.log(`  POST http://localhost:${PORT}/api/probro_mutate_table`);
  console.log('');
  console.log('Example (set connection):');
  console.log('  curl -X POST http://localhost:3000/api/probro_set_connection \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"mode":"local","dlc":"C:/Progress/OpenEdge","database":"C:/OpenEdge/WRK/sports2020/sports2020.db","agentPort":23456}\'');
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    await mcpClient.close();
  }
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    await mcpClient.close();
  }
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});
