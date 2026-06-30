# Rong VideoPlayer - 视频截屏与截图库管理系统产品设计方案

本方案旨在为 **Rong VideoPlayer** 增加一键视频截屏功能，并配套提供“截图库管理系统”，允许用户对截取的视频画面进行分类整理、快速预览和导出分享。

---

## 1. 核心功能设计

### 1.1 一键截屏功能 (Screen Capture)
* **截屏触发方式**：
  1. **快捷键**：播放视频时，按下键盘 **`Option + 1`** 键 (Alt + 1)。
  2. **控制栏按钮**：在视频控制栏（Buttons Bar）右侧新增“相机”图标按钮。
* **物理保存**：
  * 截屏图像默认以 `.png` 格式保存至应用数据目录下的专属文件夹：`userData/Screenshots/`。
  * 文件名自动命名规则：`[视频文件名]_[当前播放时间戳 HH-MM-SS].png`，如 `Rust_Tutorial_00_15_24.png` (注意清除文件名中的非法字符)。
* **视觉交互反馈**：
  * 截屏成功时，视频画面上闪烁一次白色“快门闪光”特效（200ms 渐隐）。
  * 界面右下角弹出半透明小卡片，展示截图预览缩略图并提示“截图已保存至库”，3秒后自动划出隐藏。

### 1.2 截图库文件管理 (Metadata Library)
截图的元数据在本地进行持久化管理，在 `userData/screenshots-db.json` 中保存：
* **数据模式 (JSON Schema)**:
```json
{
  "categories": [
    { "id": "uncategorized", "name": "未分类" },
    { "id": "cat_1", "name": "核心要点" },
    { "id": "cat_2", "name": "精彩画面" }
  ],
  "screenshots": [
    {
      "id": "shot_1782800102932",
      "filename": "Rust_Tutorial_00_15_24.png",
      "relativePath": "Screenshots/Rust_Tutorial_00_15_24.png",
      "videoName": "Rust 语言基础.mp4",
      "videoPath": "/Users/feng/Videos/Rust 语言基础.mp4",
      "playbackTime": 924.5,
      "categoryId": "uncategorized",
      "createdAt": 1782800102932
    }
  ]
}
```

### 1.3 截图库管理面板 (Screenshot Library UI)
在主界面开辟独立的“截图库”主面板（通过左侧导航栏新增的相机图标按钮切换）：

```
+----------------------------------------------------------------------------------+
|  [Rong VideoPlayer]                                                     [ 切换皮肤 ] |
+----------------------------------------------------------------------------------+
|  [播放器]  |  截图库分类        |  [ 🔍 搜索截图 ] [➕ 新建类别]                      |
|  [下载器]  |  ================|  +--------------------------------------------+  |
|  [社区]    |  📂 全部 (12)    |  | [📷 缩略图]     [📷 缩略图]     [📷 缩略图]    |  |
|  [截图库★]  |  📂 未分类 (8)   |  |                                            |  |
|  ----------|  📂 核心要点 (3)  |  | Rust知识点      精彩分镜        技术架构图    |  |
|  [登录B站] |  📂 精彩画面 (1)  |  | 00:15:24        01:04:12        00:03:45      |  |
|  [用户头像]|                  |  | [📂] [🏷️] [❌]  [📂] [🏷️] [❌]  [📂] [🏷️] [❌] |  |
|            |                  |  +--------------------------------------------+  |
+----------------------------------------------------------------------------------+
```

* **左侧类别边栏**：
  * 列出所有类别名称及截图数量，点击可切换视图。
  * 提供 `➕ 新建分类` 按钮，弹出输入框创建新分类。
  * 支持右键或悬浮按钮编辑/删除自定义分类（删除分类时，该分类下的图片自动归入“未分类”）。
* **右侧图片网格 (Grid Card)**：
  * 卡片显示截图缩略图、原视频名称、截屏时的播放进度时间戳。
  * **悬浮快捷操作**：
    * `📂 在 Finder 中显示`：点击调用 Finder 选中该物理图片文件。
    * `🏷️ 修改分类`：点击弹出下拉菜单，快速移动到其他类别。
    * `❌ 删除`：点击确认后，物理删除图片并清除元数据记录。
  * **双击大图预览 (Lightbox)**：双击卡片弹出高保真大图预览遮罩层，支持左右键切换、复制图片到剪贴板，以及点击 `跳转至播放点`（直接拉起播放器并 Seek 到截图时刻）。

---

## 2. 详细技术方案

### 2.1 截屏物理提取 (`renderer.js` + `main.js` IPC)
```javascript
// 渲染进程截取当前帧
function captureVideoFrame() {
  if (!videoElement || videoElement.readyState < 2) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  
  // 转换成 base64 png
  const dataUrl = canvas.toDataURL('image/png');
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
  
  // 发送给主进程写入文件系统
  ipcRenderer.invoke('save-screenshot', {
    base64Data,
    videoPath: currentFilePath,
    videoName: path.basename(currentFilePath),
    playbackTime: isTranscoding ? (transcodeStartTime + videoElement.currentTime) : videoElement.currentTime
  });
}
```

### 2.2 主进程保存与入库 (`main.js`)
* 主进程接收 `save-screenshot` 信号。
* 确保 `userData/Screenshots` 目录存在。
* 写入文件后，将元数据追加至 `screenshots-db.json`，并把更新后的数据发送回渲染进程刷新 UI。

---

## 3. UI 视觉交互草图 (Mockup Wireframe)

### 3.1 截图库面板 (Screenshot View Layout)
主视图采用 Flex 布局分为：
* **`screenshot-sidebar`** (宽度 `180px`)：类别列表，带有激活高亮。
* **`screenshot-main`** (填充剩余空间)：
  * **顶部条 (Bar)**：搜索框、新建分类按钮。
  * **内容区 (Grid)**：滚动卡片区。

### 3.2 大图预览弹窗 (Lightbox View)
```
+-----------------------------------------------------------------+
|                          [ 关闭 X ]                              |
|                                                                 |
|                      +-------------------+                      |
|                      |                   |                      |
|                      |                   |                      |
|                      |    [ 高清大图 ]    |                      |
|                      |                   |                      |
|                      |                   |                      |
|                      +-------------------+                      |
|                                                                 |
|     视频名: Rust语言基础.mp4  |  截图时刻: 00:15:24                  |
|     [ 🚀 跳转到视频此处播放 ]   [ 📋 复制到剪切板 ]   [ 📂 打开所在文件夹 ]  |
+-----------------------------------------------------------------+
```

---

## 4. 步骤路线规划

* **阶段一**：主进程扩展与截屏提取（底层 IPC 实现、快门闪烁特效及右下角气泡提醒）。
* **阶段二**：截图库主面板框架（index.html 左侧栏新增截图库切换按钮，右侧新建截图库的主容器与 CSS 样式编写）。
* **阶段三**：元数据绑定与操作逻辑（分类增删改、大图 Lightbox 预览、跳转播放、物理删除、复制剪贴板联调）。
