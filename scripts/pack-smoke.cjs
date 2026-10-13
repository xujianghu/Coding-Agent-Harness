const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const directory = mkdtempSync(path.join(tmpdir(), 'harness-package-'));
const npm = process.env.npm_execpath || process.env.HARNESS_NPM_CLI;
if (!npm) throw new Error('请通过 npm run test:package 启动打包测试');
function run(args, cwd = directory) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env, timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || '命令失败');
  return result.stdout;
}
try {
  const packed = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], process.cwd()));
  run([npm, 'install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund', path.join(directory, packed[0].filename)]);
  const installed = path.join(directory, 'node_modules', 'coding-agent-harness');
  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  for (const binary of Object.values(manifest.bin)) {
    const help = run([path.join(installed, binary), '--help']);
    if (!help.includes('Usage:')) throw new Error('安装后的 CLI 无法显示帮助');
  }
  if (!existsSync(path.join(installed, 'eval', 'manifest.json'))) throw new Error('安装包缺少固定评测任务');
  const workspace = path.join(directory, 'workspace');
  require('node:fs').mkdirSync(workspace);
  run([path.join(installed, manifest.bin.harness), 'init', '-w', workspace]);
  const output = run([path.join(installed, manifest.bin.harness), 'run', '离线机制自检', '-w', workspace, '--mock']);
  if (!output.includes('未通过或未配置')) throw new Error('离线未验收任务被误标为验收通过');
  const task = JSON.parse(readFileSync(path.join(installed, 'eval', 'manifest.json'), 'utf8')).tasks[0].id;
  run([path.join(installed, manifest.bin['harness-eval']), '--mock', '--mode', 'full', '--tasks', task, '--output', path.join(directory, 'eval-results')], workspace);
  if (!existsSync(path.join(installed, 'dist', 'web-ui', 'index.html'))) throw new Error('安装包缺少前端构建产物');
  const webSmoke = `
    (async () => {
      const { startWebServer } = require(${JSON.stringify(path.join(installed, 'dist', 'web', 'server.js'))});
      const app = await startWebServer({workspace:${JSON.stringify(workspace)},port:0});
      try {
        const page = await fetch(app.url);
        if (!page.ok || !(await page.text()).includes('id="root"')) throw new Error('安装包前端不可用');
        const api = await fetch(new URL('/api/workspace',app.url));
        const workspaceInfo = await api.json();
        if (!api.ok || !workspaceInfo.workspace || !workspaceInfo.projectId) throw new Error('安装包工作台API不可用');
        let projectId = workspaceInfo.projectId;
        const request = async (route, body) => {
          const response = await fetch(new URL(route, app.url), {method:'POST',headers:{'Content-Type':'application/json','X-Harness-Project':projectId},body:JSON.stringify(body)});
          if (!response.ok) throw new Error('安装包会话API不可用：'+route);
          return response.json();
        };
        const conversation = await request('/api/conversations', {mock:true,title:'安装包会话检查'});
        const detail = await fetch(new URL('/api/conversations/'+conversation.id, app.url));
        if (!(await detail.json()).canSend) throw new Error('新建会话不能发送消息');
        const listing = await fetch(new URL('/api/files?conversationId='+conversation.id, app.url));
        if (!listing.ok || !Array.isArray((await listing.json()).entries)) throw new Error('安装包文件浏览不可用');
        const {run} = await request('/api/conversations/'+conversation.id+'/messages', {content:'离线机制检查'});
        if (run.conversationId !== conversation.id) throw new Error('任务未关联会话');
        const controller = new AbortController();
        const stream = await fetch(new URL('/api/runs/'+run.id+'/events',app.url),{signal:controller.signal});
        if (!stream.ok || !stream.headers.get('content-type')?.includes('text/event-stream')) throw new Error('安装包执行事件流不可用');
        const reader = stream.body.getReader();
        const snapshot = await reader.read();
        if (!new TextDecoder().decode(snapshot.value).includes('event: run')) throw new Error('事件流未发送当前快照');
        controller.abort();
        await reader.cancel().catch(() => {});
        await request('/api/runs/'+run.id+'/cancel', {});
        const fs = require('node:fs');
        const path = require('node:path');
        const secondWorkspace = path.join(${JSON.stringify(directory)}, 'second-project');
        fs.mkdirSync(secondWorkspace);
        fs.writeFileSync(path.join(secondWorkspace, 'sample.js'), 'module.exports = 42;');
        const projectListing = await fetch(new URL('/api/projects', app.url));
        if (!projectListing.ok || !(await projectListing.json()).projects.length) throw new Error('安装包项目列表不可用');
        const opened = await request('/api/projects/open', {path:secondWorkspace});
        projectId = opened.workspace.projectId;
        if (!projectId || opened.workspace.initialized || fs.existsSync(path.join(secondWorkspace, '.harness'))) throw new Error('打开项目不应隐式初始化');
        const source = await fetch(new URL('/api/file?path=sample.js', app.url), {headers:{'X-Harness-Project':projectId}});
        if (!source.ok || !(await source.json()).content.includes('42')) throw new Error('安装包不能浏览本地项目代码');
        const initialized = await request('/api/projects/open', {path:secondWorkspace,initialize:true});
        if (!initialized.workspace.initialized || !fs.existsSync(path.join(secondWorkspace, '.harness', 'config.yaml'))) throw new Error('安装包项目初始化不可用');
        const returned = await request('/api/projects/open', {path:${JSON.stringify(workspace)}});
        projectId = returned.workspace.projectId;
        const saved = await fetch(new URL('/api/conversations/'+conversation.id, app.url), {headers:{'X-Harness-Project':projectId}});
        if (!saved.ok || (await saved.json()).id !== conversation.id) throw new Error('切回项目丢失会话');
      } finally { await app.close(); }
    })().catch(error => { console.error(error);process.exitCode=1; });
  `;
  run(['-e', webSmoke], workspace);
  console.log('安装包、CLI、离线执行、包内评测与前端/API 验证通过。');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
