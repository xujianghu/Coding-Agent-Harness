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
        if (!api.ok || !(await api.json()).workspace) throw new Error('安装包工作台API不可用');
      } finally { await app.close(); }
    })().catch(error => { console.error(error);process.exitCode=1; });
  `;
  run(['-e', webSmoke], workspace);
  console.log('安装包、CLI、离线执行、包内评测与前端/API 验证通过。');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
