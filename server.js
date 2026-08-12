const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, 'release');

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null;
  return targetPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>环中AIStudio 测试下载</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto; padding:24px; line-height:1.6;">
<h2>环中AIStudio 测试下载页</h2>
<p>请下载下面这个“免登录+修复对话版”安装包：</p>
<ul>
  <li><a href="/环中AIStudio-0.1.0-arm64-免登录-修复对话版.zip">环中AIStudio-0.1.0-arm64-免登录-修复对话版.zip</a></li>
  <li><a href="/环中AIStudio-0.1.0-arm64-mac.zip">环中AIStudio-0.1.0-arm64-mac.zip</a></li>
</ul>
<p>下载后解压并替换应用程序中的旧版本即可。</p>
</body></html>`;
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  const filePath = safeJoin(ROOT, decodeURIComponent(url.pathname.slice(1)));
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, 'Not found');
  }

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Download server: http://127.0.0.1:${PORT}`);
});
