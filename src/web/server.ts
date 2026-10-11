import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { createRunManager, WebApiError } from './manager';
import { listWorkspaceFiles, readWorkspaceFile } from './files';

export interface WebServerOptions { workspace: string; port?: number; host?: string; configPath?: string; staticDir?: string }

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new WebApiError('写请求必须使用 application/json', 415, 'UNSUPPORTED_MEDIA_TYPE');
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > 65536) throw new WebApiError('请求体超过 64 KiB', 413, 'BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > 65536) throw new WebApiError('请求体超过 64 KiB', 413, 'BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new WebApiError('请求体不是有效 JSON'); }
}

function validateHost(request: IncomingMessage, port: number): void {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!request.headers.host || !allowed.has(request.headers.host.toLowerCase())) throw new WebApiError('仅接受当前本地服务的 Host', 403, 'INVALID_HOST');
  const origin = request.headers.origin;
  if (origin && ![...allowed].map(host => `http://${host}`).includes(origin)) throw new WebApiError('请求来源不属于当前本地服务', 403, 'INVALID_ORIGIN');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new WebApiError('拒绝跨站请求', 403, 'CROSS_SITE_REQUEST');
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function staticFile(response: ServerResponse, pathname: string, staticDir: string, head: boolean): void {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new WebApiError('URL 编码无效'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..')) throw new WebApiError('静态资源路径无效');
  if (!existsSync(staticDir)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('前端资源尚未构建，请运行 npm run build 后重启工作台。');
    return;
  }
  const root = realpathSync(staticDir);
  let path = resolve(root, '.' + decoded);
  const within = (candidate: string) => { const remainder = relative(root, candidate); return !isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith('..' + sep); };
  if (!within(path)) throw new WebApiError('静态资源路径越界');
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    if (extname(decoded)) throw new WebApiError('静态资源不存在', 404, 'NOT_FOUND');
    path = join(root, 'index.html');
  }
  if (!existsSync(path)) throw new WebApiError('前端入口不存在，请重新构建', 503, 'UI_NOT_BUILT');
  path = realpathSync(path);
  if (!within(path)) throw new WebApiError('静态资源符号链接越界', 403, 'INVALID_PATH');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink > 1 || stat.size > 16 * 1024 * 1024) throw new WebApiError('静态资源类型或大小无效', 403, 'INVALID_PATH');
  response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': extname(path) === '.html' ? 'no-store' : 'no-cache' });
  response.end(head ? undefined : readFileSync(path));
}

/** 本地工作台拥有当前用户的文件与命令权限，因此固定只监听回环地址。 */
export async function startWebServer(options: WebServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  if (options.host !== undefined && options.host !== '127.0.0.1') throw new WebApiError('工作台只能监听 127.0.0.1');
  const requestedPort = options.port ?? 4173;
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new WebApiError('端口必须是 0 到 65535 的整数');
  const manager = createRunManager(options);
  const streams = new Set<ServerResponse>();
  const staticDir = options.staticDir ?? resolve(__dirname, '../web-ui');
  let port = requestedPort;
  function streamRun(request: IncomingMessage, response: ServerResponse, id: string): void {
    manager.getRun(id);
    if (streams.size >= 64) throw new WebApiError('实时连接数量超过上限，请关闭其他页面', 429, 'TOO_MANY_STREAMS');
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    streams.add(response);
    let backpressured = false;
    let pending: string | undefined;
    let disposed = false;
    const emit = (frame: string) => {
      if (disposed || response.destroyed) return;
      // 慢客户端只保留最新完整快照，不累积无限事件队列。
      if (backpressured) { pending = frame; return; }
      backpressured = !response.write(frame);
    };
    const unsubscribe = manager.subscribe(id, run => emit(`event: run\ndata: ${JSON.stringify(run)}\n\n`));
    const heartbeat = setInterval(() => { if (!backpressured && !disposed) backpressured = !response.write(': heartbeat\n\n'); }, 15000);
    heartbeat.unref();
    const cleanup = () => {
      if (disposed) return;
      disposed = true; pending = undefined;
      clearInterval(heartbeat); unsubscribe(); streams.delete(response);
      response.removeListener('drain', drain);
      response.removeListener('close', cleanup);
      response.removeListener('error', cleanup);
      request.removeListener('aborted', cleanup);
    };
    const drain = () => {
      backpressured = false;
      if (pending) { const frame = pending; pending = undefined; emit(frame); }
    };
    response.on('drain', drain);
    response.once('close', cleanup);
    response.once('error', cleanup);
    request.once('aborted', cleanup);
  }
  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const handle = async () => {
      validateHost(request, port);
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const path = url.pathname;
      const method = request.method;
      if (path.startsWith('/api/')) {
        if (method === 'GET' && path === '/api/workspace') return reply(response, 200, manager.getWorkspace());
        if (method === 'GET' && path === '/api/runs') return reply(response, 200, { runs: manager.list() });
        if (method === 'GET' && path === '/api/evaluations') return reply(response, 200, { reports: manager.evaluations() });
        if (method === 'GET' && path === '/api/conversations') return reply(response, 200, { conversations: manager.listConversations() });
        if (method === 'POST' && path === '/api/conversations') return reply(response, 201, manager.createConversation(await jsonBody(request)));
        const conversationRoute = path.match(/^\/api\/conversations\/([a-zA-Z0-9_-]{1,100})(?:\/(messages))?$/);
        if (conversationRoute) {
          const [, id, operation] = conversationRoute;
          if (method === 'GET' && !operation) return reply(response, 200, manager.getConversation(id));
          if (method === 'POST' && operation === 'messages') return reply(response, 201, manager.sendMessage(id, await jsonBody(request)));
        }
        if (method === 'GET' && (path === '/api/files' || path === '/api/file')) {
          if ([...url.searchParams.keys()].some(key => !['conversationId', 'path'].includes(key))) throw new WebApiError('包含未知文件参数');
          const fileWorkspace = manager.fileWorkspace(url.searchParams.get('conversationId') ?? undefined);
          const filePath = url.searchParams.get('path') ?? '';
          return reply(response, 200, path === '/api/files' ? listWorkspaceFiles(fileWorkspace, filePath) : readWorkspaceFile(fileWorkspace, filePath));
        }
        const eventsRoute = path.match(/^\/api\/runs\/([a-zA-Z0-9_-]{1,100})\/events$/);
        if (method === 'GET' && eventsRoute) return streamRun(request, response, eventsRoute[1]);
        if (method === 'POST' && path === '/api/runs') return reply(response, 201, manager.start(await jsonBody(request)));
        const route = path.match(/^\/api\/runs\/([a-zA-Z0-9_-]{1,100})(?:\/(cancel|approve|resume))?$/);
        if (route) {
          const [, id, operation] = route;
          if (method === 'GET' && !operation) return reply(response, 200, manager.getRun(id));
          if (method === 'POST' && operation) {
            const input = await jsonBody(request);
            if (operation === 'cancel' || operation === 'resume') {
              if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new WebApiError('此操作的请求体必须是空对象');
              return reply(response, operation === 'resume' ? 202 : 200, operation === 'resume' ? manager.resume(id) : await manager.cancel(id));
            }
            const approval = input as Record<string, unknown>;
            if (!approval || typeof approval !== 'object' || Array.isArray(approval) || typeof approval.approvalId !== 'string' || typeof approval.approved !== 'boolean' || Object.keys(approval).some(key => !['approvalId', 'approved'].includes(key))) throw new WebApiError('审批需要 approvalId 与布尔 approved');
            return reply(response, 200, manager.approve(id, approval.approvalId, approval.approved));
          }
        }
        throw new WebApiError('API 路径或方法不存在', 404, 'NOT_FOUND');
      }
      if (method !== 'GET' && method !== 'HEAD') throw new WebApiError('方法不允许', 405, 'METHOD_NOT_ALLOWED');
      staticFile(response, path, staticDir, method === 'HEAD');
    };
    void handle().catch(error => {
      if (response.headersSent || response.destroyed) return;
      reply(response, error instanceof WebApiError ? error.status : 500, { error: { message: error instanceof Error ? error.message : '服务发生错误', code: error instanceof WebApiError ? error.code : 'INTERNAL_ERROR' } });
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolveReady, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', () => { server.removeListener('error', reject); resolveReady(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法获取服务端口');
  port = address.port;
  let closing: Promise<void> | undefined;
  return { url: `http://127.0.0.1:${port}`, close() {
    return closing ??= (async () => {
      await manager.close();
      for (const stream of streams) stream.end();
      await new Promise<void>((resolveClosed, reject) => { server.close(error => error ? reject(error) : resolveClosed()); server.closeAllConnections(); });
    })();
  } };
}
