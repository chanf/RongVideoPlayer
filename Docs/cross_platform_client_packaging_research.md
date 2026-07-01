# Android / Windows 客户端打包调研

> 调研日期：2026-07-01
> 调研对象：当前 Rong VideoPlayer / 学习辅助工具项目
> 目标：评估在现有 Electron + HTML5 + FFmpeg + macOS 原生辅助程序架构上，打包 Android 客户端和 Windows 客户端可能遇到的问题，并给出改造路线。

---

## 1. 结论摘要

当前项目可以认为是一个 **macOS 优先的 Electron 桌面应用**，不是一个天然跨端项目。

### Android 结论

**不能直接把当前 Electron 应用打包成 Android APK。**

原因不是单个配置缺失，而是运行时模型完全不同：

* Electron 本身面向桌面系统，当前主进程大量依赖 Node.js、文件系统、子进程、本地 HTTP 服务和桌面窗口能力。
* Android 没有 Electron 主进程运行环境，也不能直接使用当前 `main.js` 中的 `fs`、`child_process.spawn/execFile`、`dialog`、`shell`、本地二进制辅助程序等能力。
* 当前 PDF 原生阅读依赖 macOS Swift / PDFKit 辅助程序 `pdf_render_mac`，Android 无法复用。
* 当前 OCR 预留能力依赖 macOS Vision 辅助程序 `ocr_mac`，Android 无法复用。
* 当前视频转码、Bilibili 下载合并依赖本地 `ffmpeg/ffprobe` 命令行，Android 需要完全不同的二进制集成、权限和后台任务模型。

因此 Android 方向应视为 **新客户端工程**，复用产品设计、数据模型和部分 Web UI 经验，但不能期望“改一改 electron-builder 配置”完成。

### Windows 结论

**Windows 客户端可以基于 Electron 继续推进，但不是零成本打包。**

Windows 的主要问题集中在：

* 当前 `package.json` 只配置了 macOS `dmg` 目标。
* `bin/ocr_mac`、`bin/pdf_render_mac` 是 macOS 辅助程序，Windows 不可运行。
* PDF 原生阅读必须替换为 Windows 可用的渲染方案，例如 Poppler、PDFium、MuPDF，或改为跨平台 Node/wasm 渲染方案。
* FFmpeg / FFprobe 需要随 Windows 包分发 `.exe`，不能依赖用户 PATH。
* macOS 专用窗口样式、Finder 文案、Homebrew 提示、HEVC `hvc1` 兼容逻辑需要按 Windows 改造。
* 路径、文件权限、临时目录、杀进程信号、文件名规则、安装包签名和杀软误报都需要专项验证。

总体评估：**Windows 是中等工作量的跨平台移植；Android 是重建客户端。**

---

## 2. 当前项目的平台绑定点

### 2.1 Electron 桌面架构

当前入口是 `package.json`：

```json
{
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --dir",
    "dist": "electron-builder"
  }
}
```

这说明当前客户端运行依赖 Electron 桌面运行时。Android 无法直接运行这个入口；Windows 可以运行，但需要对应平台配置和资源。

### 2.2 当前打包配置只面向 macOS

`package.json` 中当前 `build` 配置只有 macOS：

```json
"build": {
  "appId": "com.rong.videoplayer",
  "productName": "Rong VideoPlayer",
  "extraResources": [
    {
      "from": "bin",
      "to": "bin",
      "filter": [
        "ocr_mac",
        "pdf_render_mac"
      ]
    }
  ],
  "mac": {
    "category": "public.app-category.video",
    "target": ["dmg"]
  }
}
```

问题：

* 没有 `win` 配置。
* 没有 `linux` 配置。
* `extraResources` 只包含 macOS 二进制名称。
* `build.sh` 标题和流程也是“macOS 打包脚本”，并且只围绕 `.app` / `.dmg`。

### 2.3 主窗口是 macOS 风格

`main.js` 中窗口配置包含 macOS 特性：

```js
new BrowserWindow({
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: 15, y: 15 }
})
```

Windows 可以忽略或表现不同，但如果要做 Windows 客户端，需要重新审视：

* 是否使用系统标题栏。
* 是否自绘标题栏和窗口拖拽区域。
* 最小化、最大化、关闭按钮布局。
* 高 DPI 和窗口边框行为。

Android 没有桌面窗口概念，需要重新设计页面导航、沉浸式阅读和系统返回键行为。

### 2.4 本地 HTTP 服务

当前主进程启动本地 HTTP 服务，默认端口 `30032`：

```js
const SERVER_PORT = 30032;
```

主要路由：

* `/video?path=<absolute-path>&start=<sec>`：播放或转码本地视频。
* `/screenshot?path=<absolute-path>`：读取截图、图片、PDF 缓存图等本地文件。

Windows 可继续使用这个方案，但需要处理：

* 端口占用。
* 防火墙提示。
* 杀软对本地 HTTP 服务的拦截。
* URL 编码与 Windows 盘符路径，例如 `C:\Users\...`。
* 安全边界：当前通过 query 读取任意本地路径，跨平台分发前应收紧白名单或 token。

Android 不建议沿用这个方案。Android 更适合：

* 使用原生播放器直接读取 `content://` 或应用私有文件。
* 通过 WebView bridge 或原生模块传递媒体流。
* 避免在移动端开放本地 HTTP 服务访问任意文件路径。

### 2.5 FFmpeg / FFprobe 依赖

当前 `main.js` 动态解析 `ffmpeg` / `ffprobe`：

```js
const FFMPEG_PATH = resolveBinaryPath('ffmpeg');
const FFPROBE_PATH = resolveBinaryPath('ffprobe');
```

解析路径包括：

* 系统 PATH：macOS 用 `which`，Windows 用 `where`。
* `/usr/local/bin`、`/opt/homebrew/bin`、`/usr/bin`。
* `process.resourcesPath/bin`。
* 项目本地 `bin`。

风险：

* 当前 `bin` 目录没有 Windows 的 `ffmpeg.exe` / `ffprobe.exe`。
* 当前错误提示偏 macOS，例如提示 `brew install ffmpeg`。
* Windows 用户通常不会预装 FFmpeg，依赖 PATH 会导致大量启动后功能不可用。
* Android 上不能直接执行当前桌面版 FFmpeg，需要 Android ABI 对应二进制或使用移动端库。

### 2.6 PDF 原生阅读依赖 macOS PDFKit

当前 PDF 阅读链路是：

```text
renderer.js -> ipcRenderer.invoke('pdf-get-info' / 'pdf-render-page')
main.js -> execFile(PDF_RENDERER_PATH, ...)
pdf_render_mac -> Swift / PDFKit -> PNG 缓存
```

关键文件：

* `pdf_render_mac.swift`
* `bin/pdf_render_mac`
* `main.js` 中 `PDF_RENDERER_PATH = resolveBinaryPath('pdf_render_mac')`

风险：

* `pdf_render_mac` 是 macOS 可执行文件，Windows 和 Android 都不可运行。
* Swift / PDFKit 是 Apple 平台能力，Windows / Android 没有同等 API。
* 当前 `package.json` 只打包 `pdf_render_mac`，没有 Windows 或 Android 渲染器。
* 如果 Windows 不替换此部分，PDF 原生阅读、PDF 缩略图、PDF 页缓存都会失效。

### 2.7 OCR 依赖 macOS Vision

当前项目包含：

* `ocr_mac.swift`
* `bin/ocr_mac`

README 中也说明这是 macOS Vision OCR 预留能力。

风险：

* Windows 不可运行 `ocr_mac`。
* Android 不可运行 `ocr_mac`。
* 如果后续 OCR 正式接入，跨平台需要提前抽象 OCR Provider，例如：
  * macOS：Vision。
  * Windows：Windows.Media.Ocr、Tesseract、云服务或本地模型。
  * Android：ML Kit Text Recognition、Tesseract、云服务或本地模型。

### 2.8 文件系统和用户数据

当前数据主要在 Electron `app.getPath('userData')` 下：

* `playback-history.json`
* `screenshots-db.json`
* `Screenshots/`
* `notes-db.json`
* `UploadedMaterials/`
* `PdfCache/`

Windows 可继续映射到 `%APPDATA%` 或 Electron 默认用户数据目录，但要注意：

* 路径长度限制。
* 非 ASCII 文件名。
* Windows 文件名非法字符。
* 文件被占用时删除失败。
* 杀软扫描导致写入延迟。

Android 不能直接沿用“用户任意本地绝对路径”的模型。Android 需要考虑：

* 应用私有目录。
* MediaStore。
* Storage Access Framework。
* `content://` URI 持久授权。
* Android 13+ 的媒体权限细分。
* 用户卸载应用时私有数据清除问题。

### 2.9 渲染进程过重

当前 `renderer.js` 已超过 6000 行，混合了：

* 主窗口视频播放。
* 媒体目录树。
* 图片预览。
* PDF 阅读器。
* 截图库。
* Bilibili 下载器。
* 在线社区原型。
* 设置。
* 笔记模块。

这会直接影响跨平台移植：

* 很难只复用其中某一部分 UI。
* 很难替换平台能力 Provider。
* 很难给 Windows / Android 做条件分支。
* 回归测试成本高。

跨平台前建议先做模块化拆分。

---

## 3. Android 客户端主要问题

### 3.1 Electron 不能作为 Android 打包路径

当前工程是 Electron 桌面应用。Android 客户端不能通过 `electron-builder` 生成 APK。

可选路线只有两类：

1. **独立原生 Android 客户端**：Kotlin / Jetpack Compose / ExoPlayer / PDFium / Room。
2. **混合客户端**：保留部分 Web UI，用 Capacitor / Cordova / Android WebView 包裹，再通过原生插件补齐文件、视频、PDF、下载等能力。

考虑当前项目大量依赖本地文件、视频播放、PDF 原生阅读和下载任务，推荐优先评估 **原生 Android 客户端**。

### 3.2 本地媒体目录树需要重做

桌面端可以直接选择一个目录并递归扫描：

```js
fs.readdirSync(dirPath)
fs.statSync(fullPath)
```

Android 上不能这样自由读取用户文件系统。需要：

* 使用系统文件选择器选择目录或文件。
* 处理 `content://` URI。
* 申请和保存 URI 持久授权。
* 通过 DocumentFile 或 MediaStore 构建目录树。
* 避免扫描性能过高导致 ANR。

影响功能：

* 媒体目录树。
* 最近打开文件。
* 自动恢复上次目录。
* 文件删除。
* 分类继承。
* 截图与原视频跳转。

### 3.3 视频播放和转码策略要重做

当前桌面端策略：

* Chromium 可播格式直接 HTTP Range 播放。
* 不兼容格式通过 `ffmpeg` 实时转码为 Fragmented MP4。

Android 建议策略：

* 使用 ExoPlayer / Media3 作为主播放器。
* Android 原生支持格式优先直接播放。
* 对 MKV、RMVB、AVI 等格式，评估是否必须支持实时转码。
* 如果必须支持转码，需要 Android ABI 版本 FFmpeg，且要处理 CPU、耗电、发热、后台限制。

风险：

* 移动设备实时转码体验可能很差。
* 后台下载和转码容易被系统杀掉。
* 大文件访问、seek、缓存都需要重新设计。

### 3.4 PDF 阅读器要替换实现

Android 可选 PDF 技术路线：

| 方案 | 说明 | 风险 |
| :--- | :--- | :--- |
| PDFium Android | 常见移动端 PDF 渲染方案 | 需要处理 native 库、ABI、缩放和缓存 |
| Android PdfRenderer | 系统 API，可渲染 PDF 页 | 功能较基础，受系统版本和文件来源限制 |
| WebView + pdf.js | 前端复用度高 | 大 PDF 性能、内存和字体渲染需验证 |
| 服务端/桌面端预渲染 | 先生成图片页 | 不适合完全离线移动端 |

当前项目已有 PDF 阅读经验文档，里面关于“不闪烁、不位移、旧页保留后替换、自动适配与手动缩放分离”的原则仍然适用，但底层渲染器需要重写。

### 3.5 Bilibili 下载器移动端风险高

Android 客户端若保留下载器，需要额外处理：

* 登录态安全存储。
* 后台下载任务。
* 网络变化和断点续传。
* 存储目录选择。
* 通知栏进度。
* Android 后台执行限制。
* 音视频合并 FFmpeg 的体积、授权、CPU 和耗电问题。

建议 Android 第一版不要完整搬运 Bilibili 下载器，可以只做：

* 本地视频/PDF/图片查看。
* 笔记查看与编辑。
* 截图/摘录基础功能。

下载器可作为后续专项。

### 3.6 笔记和数据同步需要重新定义

当前笔记、截图、分类都存 JSON 文件。Android 端可以继续用 JSON，但更建议：

* Room 数据库保存结构化数据。
* 应用私有目录保存附件和截图。
* 设计导入/导出或同步机制。
* 与桌面端保持数据模型兼容。

如果未来希望桌面和 Android 同步，需要尽早定义跨端数据格式，而不是让 Android 各自实现一套。

---

## 4. Windows 客户端主要问题

### 4.1 打包配置缺失

当前 `electron-builder` 没有 Windows target。需要增加类似：

```json
"win": {
  "target": ["nsis", "portable"],
  "icon": "build/icon.ico"
}
```

同时需要：

* 生成 `.ico` 图标。
* 配置 `nsis` 安装器参数。
* 确认 appId、productName、卸载信息。
* 判断是否需要代码签名证书。
* CI 或本地构建环境要能生成 Windows 包。

注意：在 macOS 上构建 Windows 安装包通常可行，但代码签名、某些 native 依赖和安装器验证仍建议在 Windows 环境实际测试。

### 4.2 FFmpeg / FFprobe 必须随包分发

Windows 用户机器大概率没有 `ffmpeg`。建议：

```text
bin/win/ffmpeg.exe
bin/win/ffprobe.exe
```

并修改 `resolveBinaryPath()`：

* Windows 优先查 `process.resourcesPath/bin/win/<name>.exe`。
* 开发环境查 `bin/win/<name>.exe`。
* 最后才查 PATH。

否则这些功能会不稳定：

* 非原生视频格式播放。
* Bilibili 音视频合并。
* HEVC 探测。
* 视频时长探测。

### 4.3 PDF 渲染器必须替换

当前 `PDF_RENDERER_PATH = resolveBinaryPath('pdf_render_mac')`。

Windows 需要替代物，例如：

| 方案 | 说明 | 适合度 |
| :--- | :--- | :--- |
| Poppler `pdftoppm` / `pdfinfo` | 命令行调用方式接近当前 Swift helper | 高 |
| PDFium 自写 helper | 可控，跨平台潜力好 | 中高 |
| MuPDF `mutool draw` | 命令行可生成页面图片 | 中 |
| pdf.js / canvas | 避免 native helper | 中，但大 PDF 性能需测 |

为了最小改动，建议先把当前 PDF IPC 抽象成平台适配层：

```text
pdf-get-info
pdf-render-page

macOS   -> pdf_render_mac
Windows -> pdf_render_win / poppler / mupdf
Android -> Android PdfRenderer / PDFium
```

前端 PDF 阅读器可以继续复用，底层渲染器按平台替换。

### 4.4 OCR 不能使用 `ocr_mac`

Windows 如果要提供 OCR，需要替换为：

* Windows.Media.Ocr。
* Tesseract OCR。
* 本地模型。
* 云 OCR 服务。

如果 OCR 当前只是预留能力，可以 Windows 第一版先禁用 OCR 入口，只确保打包资源里不要包含不可运行的 `ocr_mac`。

### 4.5 macOS 文案和系统行为需要调整

当前项目中存在 macOS 语义：

* Finder 相关文案和 IPC，例如 `open-in-finder`、`open-image-in-finder`。
* README / 错误提示中 `brew install ffmpeg`。
* HEVC `hvc1` 逻辑注释“确保 macOS 原生播放支持”。
* `trafficLightPosition` 和自定义 macOS 标题栏。

Windows 需要改成中性表达：

* “在文件管理器中打开”。
* “在系统中显示文件”。
* FFmpeg 缺失提示指向内置依赖或 Windows 安装说明。

### 4.6 文件路径和删除操作需要验证

Windows 特有问题：

* 盘符路径：`C:\Users\...`。
* 反斜杠转义。
* 路径包含空格和中文。
* 路径长度限制。
* 文件名非法字符。
* 文件被播放器、杀软或资源管理器占用时删除失败。
* `fs.rmSync(..., { recursive: true, force: true })` 删除目录风险更高，需要二次确认和错误提示。

当前代码已有 `sanitizeFilename()`，但仍需要全链路测试。

### 4.7 子进程和信号处理差异

当前转码流关闭时：

```js
ffmpegProcess.kill('SIGKILL')
```

Windows 上 `SIGKILL` 并不是 Unix 语义，Node 会做一定兼容，但建议实测：

* 快速拖动进度条。
* 连续打开多个视频。
* 关闭窗口。
* 下载任务取消。
* FFmpeg 子进程是否残留。

必要时需要引入平台化的子进程清理策略。

### 4.8 安全与分发问题

当前渲染进程启用：

```js
nodeIntegration: true
contextIsolation: false
```

桌面内部工具可以先接受，但面向 Windows 大范围分发时风险更高：

* 远程内容注入风险。
* Bilibili / 社区 HTML 解析和链接展示风险。
* 本地 HTTP 文件读取风险。
* 杀软对本地服务、下载器、子进程调用的敏感度。

建议 Windows 公测前至少完成：

* 限制 `/screenshot` 和 `/video` 只能读取已授权目录、缓存目录和应用数据目录。
* 将 nodeIntegration 关闭，改用 preload 暴露白名单 IPC。
* 下载任务和文件删除增加路径边界校验。

---

## 5. 推荐改造路线

### 阶段 0：先稳定当前 macOS 版本

目标：避免跨平台改造把当前功能打散。

建议：

* 提交当前主窗口视频/PDF/图片支持改动。
* 给 PDF 阅读器、目录树恢复、最后展示文件恢复做一次手测。
* 把 `renderer.js` 拆分纳入工程治理计划。

### 阶段 1：平台能力抽象

目标：先把平台相关代码集中起来。

建议新增：

```text
platform/
  binaries.js        # ffmpeg、ffprobe、pdf renderer、ocr helper 路径解析
  filesystem.js      # 打开文件、显示文件、删除、权限检查
  pdfRenderer.js     # PDF info/render 抽象
  ocrProvider.js     # OCR 抽象
  windowConfig.js    # 不同平台窗口配置
```

主进程不要直接散落 `process.platform` 判断。

### 阶段 2：Windows 最小可用版

目标：先跑通核心学习场景，而不是一次性搬完所有能力。

建议范围：

* 媒体目录树。
* 视频播放，内置 FFmpeg/FFprobe。
* 图片预览。
* PDF 阅读，替换 Windows PDF renderer。
* 笔记和截图基础功能。

暂缓：

* OCR。
* Windows 深度集成。
* 社区正式化。

### 阶段 3：Windows 分发质量

目标：从“能跑”到“可发给用户”。

需要补齐：

* Windows installer / portable 包。
* 图标和文件关联。
* 自动更新策略。
* 代码签名。
* 杀软误报验证。
* Windows 10 / 11 多机型测试。
* 路径、权限、中文文件名、长路径测试。

### 阶段 4：Android 独立客户端评估

目标：确认 Android 是否值得做，以及第一版功能边界。

建议第一版只做：

* 本地资料库。
* 视频播放。
* PDF 阅读。
* 图片查看。
* 笔记查看/编辑。
* 简单导入/导出或同步。

暂不建议第一版做：

* 完整 Bilibili 下载器。
* 实时转码所有桌面格式。
* OCR 全量能力。
* 与桌面完全一致的目录树体验。

---

## 6. Windows 打包前检查清单

### 必须解决

* [ ] 增加 `electron-builder` Windows 配置。
* [ ] 准备 `build/icon.ico`。
* [ ] 打包 `ffmpeg.exe`、`ffprobe.exe`。
* [ ] 替换或新增 Windows PDF 渲染器。
* [ ] `resolveBinaryPath()` 支持平台目录和 `.exe`。
* [ ] Finder 文案改为通用文件管理器文案。
* [ ] FFmpeg 缺失提示改为 Windows 友好说明。
* [ ] 验证 `/video` 和 `/screenshot` 对 Windows 路径的 URL 编码。
* [ ] 验证文件删除、移动、打开、复制剪贴板。
* [ ] 验证子进程取消和关闭应用时不会残留 FFmpeg。

### 建议解决

* [ ] 按平台拆分窗口配置。
* [ ] 将 PDF renderer 抽象为 provider。
* [ ] 收紧本地 HTTP 文件访问范围。
* [ ] 模块化 `renderer.js`。
* [ ] 添加基础 smoke test。
* [ ] 在 Windows 10 / 11 上实测安装包、免安装包。

---

## 7. Android 开发前检查清单

### 产品边界

* [ ] 明确 Android 第一版是否只做阅读/播放/笔记。
* [ ] 明确是否需要 Bilibili 下载器。
* [ ] 明确是否必须支持 MKV、RMVB、AVI 实时转码。
* [ ] 明确桌面端与移动端是否需要同步。

### 技术选型

* [ ] Kotlin + Jetpack Compose 还是 WebView/Capacitor。
* [ ] 视频播放器：Media3 / ExoPlayer。
* [ ] PDF：PdfRenderer / PDFium / pdf.js。
* [ ] 数据库：Room / JSON 文件。
* [ ] 文件访问：MediaStore / SAF / 应用私有目录。
* [ ] OCR：ML Kit / Tesseract / 暂不支持。

### 数据兼容

* [ ] 定义跨端笔记数据格式。
* [ ] 定义附件、截图、PDF 缓存迁移策略。
* [ ] 定义导入/导出或同步协议。

---

## 8. 风险优先级

| 风险 | Android | Windows | 说明 |
| :--- | :---: | :---: | :--- |
| Electron 运行时不可用 | P0 | - | Android 不能直接打包当前 Electron 应用 |
| PDF 渲染器平台绑定 | P0 | P0 | `pdf_render_mac` 只能在 macOS 使用 |
| FFmpeg 分发 | P0 | P0 | Windows 需要 `.exe`，Android 需要 ABI 库或替代方案 |
| 文件系统模型 | P0 | P1 | Android SAF/MediaStore 重构量大；Windows 主要是路径和权限 |
| Bilibili 下载器 | P1 | P1 | 跨平台可做，但移动端后台限制更强 |
| OCR | P2 | P2 | 当前是预留能力，可暂缓 |
| UI 适配 | P1 | P2 | Android 需要移动端重设；Windows 主要标题栏/布局调整 |
| 安全模型 | P1 | P1 | 面向分发时必须收紧本地文件访问和 IPC |

---

## 9. 建议决策

### 如果目标是尽快增加 Windows 用户

建议优先做 Windows Electron 移植。

最短路径：

1. 保持 Electron 架构。
2. 内置 Windows FFmpeg/FFprobe。
3. 替换 PDF renderer。
4. 增加 Windows 打包配置。
5. 做 Windows 路径、权限、安装包测试。

这是可控的中等规模工程。

### 如果目标是移动端学习工具

建议不要从“把 Electron 打成 Android 包”开始，而是启动 Android 独立客户端设计。

最短路径：

1. 复用产品功能规划和数据模型。
2. 第一版只做本地资料阅读、视频播放、笔记。
3. 暂缓下载器、转码、OCR。
4. 后续通过导入/导出或同步协议和桌面端互通。

这是新产品客户端工程，不是打包任务。

---

## 10. 后续建议任务

1. 先提交当前 macOS 功能改动，建立稳定回退点。
2. 拆分 `renderer.js`，至少先抽出媒体目录树、主窗口播放器、PDF 阅读器、图片预览和历史恢复模块。
3. 抽象 `pdfRenderer`，让前端 PDF 阅读器不关心底层是 PDFKit、PDFium、Poppler 还是 pdf.js。
4. 抽象 `binaryResolver`，统一处理 `ffmpeg`、`ffprobe`、PDF renderer、OCR helper 的平台路径。
5. 新增 Windows spike 分支，只追求打开窗口、选择目录、播放 MP4、打开图片、打开 PDF 首页这五个最小闭环。
6. Android 暂不进入实现，先做产品范围和数据同步方案设计。
