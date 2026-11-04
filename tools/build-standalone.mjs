// 把落地页打包成可离线双击打开的单个 HTML 文件：
// CSS / JS / 图片 / favicon / Windows 安装包全部以内联方式塞进 index.html。
// 同时负责把 tauri build 的安装包复制到 download/ 并同步 index.html 的下载地址。
// 用法：node tools/build-standalone.mjs
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
const outFile = join(outDir, "jinqu-landing-standalone.html");

// 安装包文件名带版本号，跟着 tauri.conf.json 走。
const version = JSON.parse(
  readFileSync(join(root, "..", "src-tauri", "tauri.conf.json"), "utf8")
).version;
const INSTALLER_NAME = `jinqu-${version}-x64-setup.exe`;
const downloadDir = join(root, "download");
const INSTALLER = join(downloadDir, INSTALLER_NAME);

// 1. 从 tauri build 的产物里取最新安装包，复制到 download/
const bundleDir = join(root, "..", "src-tauri", "target", "release", "bundle", "nsis");
if (!existsSync(bundleDir)) {
  throw new Error(`找不到构建产物目录 ${bundleDir}，请先执行 pnpm tauri build`);
}

const installers = readdirSync(bundleDir)
  .filter((name) => name.toLowerCase().endsWith("-setup.exe"))
  .map((name) => ({ name, mtime: statSync(join(bundleDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (!installers.length) {
  throw new Error(`${bundleDir} 下没有找到 *-setup.exe`);
}

mkdirSync(downloadDir, { recursive: true });
copyFileSync(join(bundleDir, installers[0].name), INSTALLER);
const sizeKb = (statSync(INSTALLER).size / 1024).toFixed(0);
console.log(`已复制 ${installers[0].name} -> download/${INSTALLER_NAME}（${sizeKb} KB）`);

// 2. 下载地址只写在 index.html 的 data-download-url 一处，版本改名后同步这一行
const htmlPath = join(root, "index.html");
const htmlSource = readFileSync(htmlPath, "utf8");
const urlAttr = /data-download-url="[^"]*"/;

if (!urlAttr.test(htmlSource)) {
  console.warn("index.html 里没有找到 data-download-url，跳过了下载链接同步");
} else {
  const next = htmlSource.replace(urlAttr, `data-download-url="download/${INSTALLER_NAME}"`);
  if (next !== htmlSource) {
    writeFileSync(htmlPath, next, "utf8");
    console.log(`已更新 index.html 的下载链接 -> download/${INSTALLER_NAME}`);
  }
}

const MIME = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const read = (p) => readFileSync(p, "utf8");
const dataUri = (p) => {
  const ext = p.slice(p.lastIndexOf("."));
  const b64 = readFileSync(p).toString("base64");
  return `data:${MIME[ext] || "application/octet-stream"};base64,${b64}`;
};

const html = htmlSource;
const css = read(join(root, "assets/css/styles.css"));
const js = read(join(root, "assets/js/script.js"));

for (const [asset, content, closer] of [
  ["styles.css", css, "</style"],
  ["script.js", js, "</script"],
]) {
  if (content.includes(closer)) {
    throw new Error(`${asset} 里出现了 ${closer}，内联后会截断 HTML，请先处理`);
  }
}

let out = html;

// 1. 样式表 → <style>
out = out.replace(
  /<link rel="stylesheet" href="assets\/css\/styles\.css" \/>/,
  () => `<style>\n${css}\n</style>`
);

// 2. 脚本 → <script>
out = out.replace(
  /<script src="assets\/js\/script\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`
);

// 3. favicon 与正文图片 → data URI
out = out.replace(/(href|src)="(assets\/img\/[^"]+)"/g, (match, attr, path) => {
  const abs = join(root, path);
  return `${attr}="${dataUri(abs)}"`;
});

// 4. 安装包不再是同源相对路径，交给下面的内嵌下载逻辑处理
out = out.replace(/data-download-url="[^"]*"/, 'data-download-url=""');

// 5. 内嵌安装包（base64 只含 A-Za-z0-9+/=，不会干扰 </script> 解析）
const installerB64 = readFileSync(INSTALLER).toString("base64");
const payload = `<script type="text/plain" id="installer-b64">${installerB64}</script>`;

const downloader = `<script>
// 单文件分发专用：安装包以 base64 内嵌在本页，点击时现场解成 Blob 再触发下载。
(function () {
  var node = document.getElementById("installer-b64");
  if (!node) return;

  var NAME = ${JSON.stringify(INSTALLER_NAME)};
  var b64 = node.textContent.replace(/\\s+/g, "");
  var blobUrl = null;

  function ensureBlob() {
    if (blobUrl) return blobUrl;
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    return blobUrl;
  }

  document.querySelectorAll("[data-download]").forEach(function (link) {
    link.setAttribute("download", NAME);
    link.addEventListener("click", function (event) {
      event.preventDefault();
      var url;
      try {
        url = ensureBlob();
      } catch (err) {
        console.error("安装包解包失败", err);
        return;
      }
      var tmp = document.createElement("a");
      tmp.href = url;
      tmp.download = NAME;
      document.body.appendChild(tmp);
      tmp.click();
      tmp.remove();
    });
  });
})();
</script>`;

out = out.replace("</body>", `${payload}\n${downloader}\n</body>`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, out, "utf8");

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`已生成 ${relative(root, outFile)}`);
console.log(`  页面 ${kb(html.length)} + 样式 ${kb(css.length)} + 脚本 ${kb(js.length)}`);
console.log(`  内嵌安装包 ${kb(installerB64.length)}（base64）`);
console.log(`  合计 ${kb(out.length)}`);
