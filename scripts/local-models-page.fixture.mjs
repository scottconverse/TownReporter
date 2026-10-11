const originalFetch = globalThis.fetch;
const BLOCKED_PORTS = new Set([1234,11434,8080]);
const BLOCKED_PATHS = ['chat/completions','/responses','/messages','/api/chat','/api/generate'];

function getUrl(input){
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    if (input && typeof input === 'object' && 'url' in input) return new URL(input.url);
    return null;
  } catch { return null; }
}

function isLoopback(hostname){
  const h = hostname.replace(/^\[|\]$/g,'');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function jsonResponse(payload){
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
}

function rejectResponse(reason){
  return new Response(JSON.stringify({error:{message:reason,type:'fixture_blocked'}}),{status:403,headers:{'content-type':'application/json'}});
}

globalThis.fetch = async function fixtureFetch(input, init){
  const url = getUrl(input);
  if (!url) return originalFetch.call(globalThis, input, init);
  const hostname = url.hostname;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const pathname = url.pathname;

  for (const blocked of BLOCKED_PATHS) {
    if (pathname.includes(blocked)) {
      return rejectResponse(`Blocked completion path: ${blocked}`);
    }
  }

  if (BLOCKED_PORTS.has(port) || isLoopback(hostname)) {
    if (hostname === '127.0.0.1' && port === 1234 && pathname === '/v1/models') {
      return jsonResponse({data:[{id:'release-h-local-fixture'}]});
    }
    if (port === 1234 && pathname === '/api/v0/models') {
      return jsonResponse({data:[{id:'release-h-local-fixture',type:'llm',state:'loaded'}]});
    }
    if (BLOCKED_PORTS.has(port)) {
      return rejectResponse(`Blocked host/port ${hostname}:${port}`);
    }
    if (!isLoopback(hostname)) {
      return rejectResponse(`Blocked non-loopback host ${hostname}`);
    }
    return originalFetch.call(globalThis, input, init);
  }

  return rejectResponse(`Blocked non-loopback host ${hostname}`);
};

process.on('exit', () => { globalThis.fetch = originalFetch; });
