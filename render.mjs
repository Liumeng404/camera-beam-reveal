/**
 * 确定性逐帧渲染脚本：把 index.html 渲染为 1920x1080 MP4（H.264 / yuv420p）。
 *
 * 依赖：
 *   - 本机已安装 Chrome 或 Edge
 *   - 本机已安装 ffmpeg（在 PATH 中）
 *   - Node.js + puppeteer-core（可通过 NODE_PATH 指定或本地 npm i puppeteer-core）
 *
 * 用法：
 *   node render.mjs [--fps 60] [--out out/camera-beam-reveal.mp4] [--font /path/to/font.ttf]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const FPS = Number(arg('--fps', '60'));
const OUT = path.resolve(ROOT, arg('--out', 'out/camera-beam-reveal.mp4'));
const FONT_PATH = arg('--font', '');

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH');
}

function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch {
    if (process.env.PUPPETEER_CORE_PATH) {
      return require(process.env.PUPPETEER_CORE_PATH);
    }
    throw new Error('找不到 puppeteer-core，请先运行 npm i puppeteer-core 或设置 PUPPETEER_CORE_PATH');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/__local_font__.ttf' && FONT_PATH && fs.existsSync(FONT_PATH)) {
        res.writeHead(200, { 'Content-Type': 'font/ttf' });
        fs.createReadStream(FONT_PATH).pipe(res);
        return;
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function main() {
  const puppeteer = loadPuppeteer();
  const executablePath = findBrowser();
  const { server, baseUrl } = await startServer();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/index.html?embed=1&t=0`, { waitUntil: 'networkidle0' });

    if (FONT_PATH && fs.existsSync(FONT_PATH)) {
      await page.addStyleTag({
        content: `@font-face { font-family: "DeYiHei"; src: url("${baseUrl}/__local_font__.ttf") format("truetype"); font-weight: 100 900; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.load('700 48px "DeYiHei"');
        await document.fonts.ready;
      });
    }

    const meta = await page.evaluate(() => window.__meta);
    const [W, H] = meta.size || [1920, 1080];
    const DUR = meta.duration || 4.8;
    const totalFrames = Math.round(DUR * FPS);

    if (W !== 1920 || H !== 1080) {
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    }

    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-r', String(FPS),
      '-i', '-',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-preset', 'medium',
      '-movflags', '+faststart',
      OUT,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    const ffmpegDone = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    });

    console.log(`Rendering ${totalFrames} frames (${W}x${H} @ ${FPS}fps, ${DUR}s) -> ${OUT}`);
    for (let f = 0; f < totalFrames; f++) {
      const t = f / FPS;
      await page.evaluate(sec => window.__renderAt(sec), t);
      const buf = await page.screenshot({ type: 'png' });
      if (!ffmpeg.stdin.write(buf)) {
        await new Promise(r => ffmpeg.stdin.once('drain', r));
      }
      if ((f + 1) % 30 === 0 || f === totalFrames - 1) {
        console.log(`  frame ${f + 1}/${totalFrames} (${t.toFixed(2)}s)`);
      }
    }
    ffmpeg.stdin.end();
    await ffmpegDone;

    const stat = fs.statSync(OUT);
    console.log(`Done: ${OUT} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
