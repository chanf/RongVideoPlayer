const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn, exec, execFile } = require('child_process');

let mainWindow;
let videoServer;
const SERVER_PORT = 30032;
const HISTORY_FILE = path.join(app.getPath('userData'), 'playback-history.json');

// Paths to ffmpeg and ffprobe (dynamically resolved to prevent issues on other machines)
function resolveBinaryPath(name) {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const pathStr = require('child_process').execSync(`${whichCmd} ${name}`, { stdio: [] }).toString().trim();
    if (pathStr && fs.existsSync(pathStr)) {
      return pathStr;
    }
  } catch (e) {}

  const commonPaths = [
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/bin/${name}`,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', name) : null,
    path.join(__dirname, 'bin', name),
    path.join(__dirname, '..', 'bin', name)
  ].filter(Boolean);

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return name;
}

const FFMPEG_PATH = resolveBinaryPath('ffmpeg');
const FFPROBE_PATH = resolveBinaryPath('ffprobe');
const PDF_RENDERER_PATH = resolveBinaryPath('pdf_render_mac');

function checkFFmpegExists() {
  try {
    if (path.isAbsolute(FFMPEG_PATH)) {
      return fs.existsSync(FFMPEG_PATH);
    }
    const { execSync } = require('child_process');
    execSync(`${FFMPEG_PATH} -version`, { stdio: [] });
    return true;
  } catch (e) {
    return false;
  }
}

function checkFolderWritable(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch (e) {
    console.error(`Folder ${dirPath} is not writable:`, e);
    return false;
  }
}

// Supported extensions by Chromium natively
const NATIVE_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Rong VideoPlayer',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity of development
    },
  });

  mainWindow.maximize();
  mainWindow.loadFile('index.html');
  
  // Open devtools in development if needed
  // mainWindow.webContents.openDevTools();
}

// Start the local video streaming server
function startVideoServer() {
  videoServer = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, `http://localhost:${SERVER_PORT}`);
    if (urlObj.pathname === '/screenshot') {
      const imgPath = urlObj.searchParams.get('path');
      if (imgPath && fs.existsSync(imgPath)) {
        const ext = path.extname(imgPath).toLowerCase();
        let contentType = 'image/png';
        if (ext === '.pdf') {
          contentType = 'application/pdf';
        } else if (ext === '.jpg' || ext === '.jpeg') {
          contentType = 'image/jpeg';
        } else if (ext === '.txt') {
          contentType = 'text/plain; charset=utf-8';
        }
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(imgPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found.');
      }
    } else if (urlObj.pathname === '/video') {
      const filePath = urlObj.searchParams.get('path');
      const startParam = urlObj.searchParams.get('start');
      const startSec = startParam ? parseFloat(startParam) : 0;

      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Video file not found.');
        return;
      }

      probeVideoInfo(filePath).then((probeData) => {
        const needsTranscode = checkNeedsTranscode(filePath, probeData);

        if (!needsTranscode) {
          // Native playback - stream with Range support
          streamNative(filePath, req, res);
        } else {
          // Transcode on-the-fly using ffmpeg
          streamTranscode(filePath, startSec, probeData, req, res);
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  videoServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Video server port ${SERVER_PORT} is already in use. Assuming another instance is active.`);
    } else {
      console.error('Video streaming server error:', err);
    }
  });

  videoServer.listen(SERVER_PORT, () => {
    console.log(`Video streaming server listening on port ${SERVER_PORT}`);
  });
}

// Helper: Stream native files with 206 range requests
function streamNative(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  
  // Simple mime type detection
  let contentType = 'video/mp4';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') contentType = 'video/webm';
  if (ext === '.ogg') contentType = 'video/ogg';

  if (req.headers.range) {
    const parts = req.headers.range.replace(/bytes=/, "").split("-");
    const partialstart = parts[0];
    const partialend = parts[1];
    const start = parseInt(partialstart, 10);
    const end = partialend ? parseInt(partialend, 10) : total - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// Helper: Stream with on-the-fly transcoding
function streamTranscode(filePath, startSec, probeData, req, res) {
  const args = [];

  // 1. Seek before input if requested (fast seek)
  if (startSec > 0) {
    args.push('-ss', startSec.toString());
  }

  args.push('-i', filePath);

  // Determine transcoding settings based on probes
  let videoCodec = 'libx264';
  let audioCodec = 'aac';

  if (probeData && probeData.streams) {
    const videoStream = probeData.streams.find(s => s.codec_type === 'video');
    const audioStream = probeData.streams.find(s => s.codec_type === 'audio');

    // If video is already h264, we copy it to avoid heavy encoding CPU usage
    if (videoStream && videoStream.codec_name === 'h264') {
      videoCodec = 'copy';
    }
    // If audio is already aac/mp3/opus/vorbis, copy it
    if (audioStream && ['aac', 'mp3', 'opus', 'vorbis'].includes(audioStream.codec_name)) {
      audioCodec = 'copy';
    }
  }

  args.push('-c:v', videoCodec);
  if (videoCodec === 'libx264') {
    // Optimized h264 encoding options for real-time streaming
    args.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p');
  }

  args.push('-c:a', audioCodec);
  if (audioCodec === 'aac') {
    args.push('-b:a', '128k');
  }

  // Output as fragmented MP4 for browser compatibility
  args.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  );

  console.log(`Spawning ffmpeg: ${FFMPEG_PATH} ${args.join(' ')}`);
  const ffmpegProcess = spawn(FFMPEG_PATH, args);

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked',
    'Access-Control-Allow-Origin': '*'
  });

  ffmpegProcess.stdout.pipe(res);

  ffmpegProcess.stderr.on('data', (data) => {
    // log ffmpeg logs if needed (verbose)
    // console.log(`ffmpeg: ${data.toString()}`);
  });

  ffmpegProcess.on('error', (err) => {
    console.error('ffmpeg process error:', err);
  });

  // If the browser aborts the request (seeking or closing page), kill ffmpeg
  req.on('close', () => {
    console.log('Client closed connection. Killing ffmpeg process.');
    ffmpegProcess.kill('SIGKILL');
  });
}

// Check if a video format needs transcoding
function checkNeedsTranscode(filePath, probeData) {
  const ext = path.extname(filePath).toLowerCase();
  
  // If it's not a native browser container extension, it needs at least remuxing
  if (!NATIVE_EXTENSIONS.includes(ext)) {
    return true;
  }

  if (probeData && probeData.streams) {
    const videoStream = probeData.streams.find(s => s.codec_type === 'video');
    const audioStream = probeData.streams.find(s => s.codec_type === 'audio');

    const videoSupported = videoStream && ['h264', 'vp8', 'vp9', 'av1'].includes(videoStream.codec_name);
    const audioSupported = audioStream && ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(audioStream.codec_name);

    if (!videoSupported || !audioSupported) {
      return true;
    }
  }

  return false;
}

// Probe video info using ffprobe
function probeVideoInfo(filePath) {
  return new Promise((resolve) => {
    exec(`"${FFPROBE_PATH}" -v error -print_format json -show_format -show_streams "${filePath}"`, (err, stdout) => {
      if (err) {
        console.error('ffprobe error:', err);
        return resolve(null);
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (e) {
        console.error('Failed to parse ffprobe JSON:', e);
        resolve(null);
      }
    });
  });
}

// Generate Directory Tree (recursive)
function buildDirectoryTree(dirPath, depth = 0) {
  if (depth > 6) return null; // Avoid recursion overflow
  
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return null;

    const files = fs.readdirSync(dirPath);
    const children = [];

    for (const file of files) {
      // Skip hidden files and common ignored directories
      if (file.startsWith('.') || ['node_modules', '$RECYCLE.BIN', 'System Volume Information'].includes(file)) {
        continue;
      }

      const fullPath = path.join(dirPath, file);
      let fileStats;
      try {
        fileStats = fs.statSync(fullPath);
      } catch (e) {
        continue;
      }

      if (fileStats.isDirectory()) {
        const subTree = buildDirectoryTree(fullPath, depth + 1);
        // Only add folder if it contains video files (recursively)
        if (subTree && subTree.children && subTree.children.length > 0) {
          children.push(subTree);
        }
      } else {
        const ext = path.extname(file).toLowerCase();
        const videoExtensions = ['.mp4', '.mkv', '.rmvb', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.ts', '.3gp'];
        if (videoExtensions.includes(ext)) {
          children.push({
            name: file,
            path: fullPath,
            type: 'file',
            size: fileStats.size
          });
        }
      }
    }

    // Sort: directories first, then files alphabetically
    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });

    return {
      name: path.basename(dirPath),
      path: dirPath,
      type: 'directory',
      children: children
    };
  } catch (err) {
    console.error('Error building directory tree:', err);
    return null;
  }
}

// IPC Handlers
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  const tree = buildDirectoryTree(folderPath);
  return { folderPath, tree };
});

ipcMain.handle('get-directory-tree', async (event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) return null;
  return buildDirectoryTree(folderPath);
});

ipcMain.handle('open-in-finder', async (event, dirPath) => {
  if (dirPath && fs.existsSync(dirPath)) {
    shell.openPath(dirPath);
    return true;
  }
  return false;
});

ipcMain.handle('probe-video', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const probeData = await probeVideoInfo(filePath);
  
  let duration = 0;
  if (probeData && probeData.format && probeData.format.duration) {
    duration = parseFloat(probeData.format.duration);
  }
  
  const needsTranscode = checkNeedsTranscode(filePath, probeData);
  return {
    duration,
    needsTranscode,
    probeData
  };
});

ipcMain.handle('get-history', async () => {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const historyObj = JSON.parse(data);
      if (historyObj.sessdata) {
        sessdata = historyObj.sessdata;
      }
      return historyObj;
    }
  } catch (err) {
    console.error('Error reading history file:', err);
  }
  return {};
});

ipcMain.handle('save-history', async (event, historyData) => {
  try {
    let currentHistory = {};
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        currentHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      } catch (e) {}
    }
    const updatedHistory = { ...currentHistory, ...historyData };
    if (updatedHistory.sessdata) {
      sessdata = updatedHistory.sessdata;
    }
    
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing history file:', err);
    return false;
  }
});

// ========================================================
// Bilibili 登录与下载引擎 (Bilibili Downloader Engine)
// ========================================================

const os = require('os');

let sessdata = null;
const downloaderTasks = new Map();
let activeDownloads = 0;
let MAX_CONCURRENT_DOWNLOADS = 3;

// 带有 SESSDATA 的 B站请求封装
function biliFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  options.headers['Referer'] = 'https://www.bilibili.com';
  if (sessdata) {
    options.headers['Cookie'] = `SESSDATA=${sessdata}`;
  }
  return fetch(url, options);
}

// 提取网页源码中的 INITIAL_STATE JSON
function extractInitialStateJson(html) {
  try {
    const marker = 'window.__INITIAL_STATE__=';
    const startIndex = html.indexOf(marker);
    if (startIndex === -1) return null;
    
    const tail = html.substring(startIndex + marker.length);
    let endIndex = tail.indexOf(';(function');
    if (endIndex === -1) endIndex = tail.indexOf(';</script>');
    if (endIndex === -1) endIndex = tail.indexOf('\n');
    
    if (endIndex === -1) return null;
    
    const jsonText = tail.substring(0, endIndex).trim();
    return JSON.parse(jsonText);
  } catch (err) {
    console.error('Failed to parse window.__INITIAL_STATE__:', err);
  }
  return null;
}

// 递归抓取合集列表
async function fetchBiliPlaylist(bvid) {
  const res = await biliFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || '获取视频信息失败');
  }
  
  const data = json.data;
  
  // 1. 多分P
  if (data.pages && data.pages.length > 1) {
    return {
      type: 'multi_part',
      title: data.title,
      videos: data.pages.map(p => ({
        bvid: bvid,
        cid: p.cid,
        title: p.part || `P${p.page}`,
        index: p.page
      }))
    };
  }
  
  // 2. UGC 订阅合集/系列
  if (data.ugc_season && data.ugc_season.sections) {
    const section = data.ugc_season.sections[0];
    if (section && section.episodes && section.episodes.length > 0) {
      return {
        type: 'collection',
        title: data.ugc_season.title || data.title,
        videos: section.episodes.map((e, idx) => ({
          bvid: e.bvid,
          cid: e.cid,
          title: e.title,
          index: idx + 1
        }))
      };
    }
  }
  
  // 3. HTML 兜底（从源码提取 __INITIAL_STATE__）
  try {
    const htmlRes = await biliFetch(`https://www.bilibili.com/video/${bvid}`);
    const html = await htmlRes.text();
    const initialState = extractInitialStateJson(html);
    
    if (initialState) {
      const ugcSeason = initialState.ugc_season || (initialState.videoData && initialState.videoData.ugc_season);
      if (ugcSeason && ugcSeason.sections && ugcSeason.sections[0]) {
        const section = ugcSeason.sections[0];
        if (section.episodes && section.episodes.length > 0) {
          return {
            type: 'collection',
            title: ugcSeason.title || data.title,
            videos: section.episodes.map((e, idx) => {
              const epBvid = e.bvid || (e.arc && e.arc.bvid);
              const epCid = (e.page && e.page.cid) || e.cid;
              const epTitle = e.title || (e.arc && e.arc.title) || `选集 ${idx + 1}`;
              return {
                bvid: epBvid,
                cid: epCid,
                title: epTitle,
                index: idx + 1
              };
            })
          };
        }
      }
    }
  } catch (e) {
    console.warn('Scraping HTML initial state failed:', e);
  }
  
  // 4. 单视频
  return {
    type: 'single',
    title: data.title,
    videos: [{
      bvid: bvid,
      cid: data.cid,
      title: data.title,
      index: 1
    }]
  };
}

// 自动质量降级获取流地址
async function fetchBiliPlayurl(bvid, cid, quality) {
  const qualityList = [120, 116, 112, 80, 64, 32];
  let startIndex = qualityList.indexOf(parseInt(quality));
  if (startIndex === -1) startIndex = 3; // 默认 1080P (80)
  
  for (let i = startIndex; i < qualityList.length; i++) {
    const qn = qualityList[i];
    try {
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${qn}&fnval=16&fourk=1`;
      const res = await biliFetch(url);
      const json = await res.json();
      
      if (json.code === 0 && json.data && json.data.dash) {
        const dash = json.data.dash;
        const videoArray = dash.video || [];
        const audioArray = dash.audio || [];
        
        if (videoArray.length > 0 && audioArray.length > 0) {
          const videoUrl = videoArray[0].baseUrl;
          const audioUrl = audioArray[0].baseUrl;
          return { videoUrl, audioUrl };
        }
      }
    } catch (e) {
      console.warn(`Quality qn=${qn} playurl fetch failed, retrying lower...`, e);
    }
  }
  return null;
}

// 流式断点/取消下载写入
async function downloadBiliStream(url, destPath, abortSignal, onProgress) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com'
  };
  
  const response = await fetch(url, { headers, signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Download stream failed: status ${response.status}`);
  }
  
  const totalBytes = parseInt(response.headers.get('content-length'), 10) || 0;
  const fileStream = fs.createWriteStream(destPath);
  
  let downloadedBytes = 0;
  let bodyStream;
  if (response.body.getReader) {
    const { Readable } = require('stream');
    bodyStream = Readable.fromWeb(response.body);
  } else {
    bodyStream = response.body;
  }
  
  try {
    for await (const chunk of bodyStream) {
      if (abortSignal.aborted) {
        throw new Error('aborted');
      }
      fileStream.write(chunk);
      downloadedBytes += chunk.length;
      if (onProgress && totalBytes > 0) {
        onProgress(downloadedBytes, totalBytes);
      }
    }
  } catch (err) {
    fileStream.end();
    fs.unlink(destPath, () => {});
    throw err;
  }
  
  fileStream.end();
}

// 检测视频是否为 H.265 / HEVC 编码
function probeHEVC(videoPath) {
  return new Promise((resolve) => {
    const ffmpeg = spawn(FFMPEG_PATH, ['-i', videoPath]);
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    ffmpeg.on('close', () => {
      const lower = stderr.toLowerCase();
      resolve(lower.includes('hevc') || lower.includes('h265') || lower.includes('hev1'));
    });
    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

// 合并视频与音频轨，在 macOS 上强制注入 hvc1 标志确保原生播放支持
function mergeAudioVideo(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    probeHEVC(videoPath).then((isHEVC) => {
      const args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy'
      ];
      
      if (isHEVC) {
        args.push('-tag:v', 'hvc1');
      }
      
      args.push('-c:a', 'copy', '-y', outputPath);
      
      const ffmpeg = spawn(FFMPEG_PATH, args);
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg merge failed with code ${code}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(new Error('未检测到本地 FFmpeg 依赖！合并音视频轨失败，请在系统中安装 FFmpeg 并加入 PATH 环境变量'));
        } else {
          reject(err);
        }
      });
    });
  });
}

function sanitizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]/g, '_').trim();
}

// 向渲染窗口推送下载进度
function sendTaskProgress(id) {
  const task = downloaderTasks.get(id);
  if (!task) return;
  mainWindow.webContents.send('download-task-update', {
    id: task.id,
    bvid: task.bvid,
    cid: task.cid,
    title: task.title,
    partTitle: task.partTitle,
    progress: task.progress,
    speed: task.speed,
    status: task.status,
    bytesDownloaded: task.bytesDownloaded,
    bytesTotal: task.bytesTotal,
    warning: task.warning,
    error: task.error
  });
}

// 下载并合并的核心异步任务
async function runDownloadTask(task) {
  const sanitizedTitle = sanitizeFilename(task.partTitle || task.title || 'bili_video');
  const finalFilePath = path.join(task.savePath, `${sanitizedTitle}.mp4`);
  
  // 避免重复下载：如果最终的合并文件已经存在，直接标记为已完成
  if (fs.existsSync(finalFilePath)) {
    task.status = 'completed';
    task.progress = 100;
    task.speed = 0;
    sendTaskProgress(task.id);
    return;
  }

  const tempDir = os.tmpdir();
  const videoTempPath = path.join(tempDir, `${task.id}_video.m4v`);
  const audioTempPath = path.join(tempDir, `${task.id}_audio.m4a`);
  
  try {
    // 1. 核心依赖检查：若本地 FFmpeg 缺失，立刻报错阻断下载，防止浪费流量
    if (!checkFFmpegExists()) {
      throw new Error('未检测到本地 FFmpeg 依赖！合并音视频轨失败，请在系统中安装 FFmpeg 并加入 PATH 环境变量（例如运行 brew install ffmpeg）');
    }

    // 2. 写入权限检查：若目标路径不可写，则报错阻断
    if (!checkFolderWritable(task.savePath)) {
      throw new Error(`下载保存目录不可写或权限不足，目标路径：${task.savePath}。请检查磁盘读写权限或更改下载设置。`);
    }

    const playUrlRes = await fetchBiliPlayurl(task.bvid, task.cid, task.quality);
    if (!playUrlRes) {
      throw new Error('获取下载流地址失败，请重新登录尝试');
    }
    
    const { videoUrl, audioUrl } = playUrlRes;
    
    let videoDownloadedBytes = 0;
    let videoTotalBytes = 0;
    let audioDownloadedBytes = 0;
    let audioTotalBytes = 0;
    
    let lastProgressTime = Date.now();
    let lastDownloadedBytes = 0;
    
    const updateProgress = () => {
      const total = videoTotalBytes + audioTotalBytes;
      const current = videoDownloadedBytes + audioDownloadedBytes;
      task.bytesDownloaded = current;
      task.bytesTotal = total;
      
      if (total > 0) {
        task.progress = Math.round((current / total) * 100);
      }
      
      const now = Date.now();
      const elapsed = (now - lastProgressTime) / 1000;
      if (elapsed >= 0.5) {
        const deltaBytes = current - lastDownloadedBytes;
        task.speed = parseFloat(((deltaBytes / elapsed) / (1024 * 1024)).toFixed(1));
        lastProgressTime = now;
        lastDownloadedBytes = current;
      }
      
      sendTaskProgress(task.id);
    };
    
    const downloadVideoPromise = downloadBiliStream(videoUrl, videoTempPath, task.controller.signal, (downloaded, total) => {
      videoDownloadedBytes = downloaded;
      videoTotalBytes = total;
      updateProgress();
    });
    
    const downloadAudioPromise = downloadBiliStream(audioUrl, audioTempPath, task.controller.signal, (downloaded, total) => {
      audioDownloadedBytes = downloaded;
      audioTotalBytes = total;
      updateProgress();
    });
    
    await Promise.all([downloadVideoPromise, downloadAudioPromise]);
    
    task.status = 'merging';
    task.speed = 0;
    sendTaskProgress(task.id);
    
    const sanitizedTitle = sanitizeFilename(task.partTitle || task.title || 'bili_video');
    const finalFilePath = path.join(task.savePath, `${sanitizedTitle}.mp4`);
    
    fs.mkdirSync(task.savePath, { recursive: true });
    
    await mergeAudioVideo(videoTempPath, audioTempPath, finalFilePath);
    
    fs.unlinkSync(videoTempPath);
    fs.unlinkSync(audioTempPath);
    
    task.status = 'completed';
    task.progress = 100;
    sendTaskProgress(task.id);
    
    mainWindow.webContents.send('rescan-directory', task.savePath);
    
  } catch (err) {
    if (fs.existsSync(videoTempPath)) fs.unlinkSync(videoTempPath);
    if (fs.existsSync(audioTempPath)) fs.unlinkSync(audioTempPath);
    
    if (task.controller.signal.aborted) {
      task.status = 'paused';
    } else {
      task.status = 'failed';
      task.error = err.message || '下载出错';
    }
    sendTaskProgress(task.id);
  }
}

// 调度任务队列
function processQueue() {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) return;
  
  for (const [id, task] of downloaderTasks.entries()) {
    if (task.status === 'pending') {
      task.status = 'downloading';
      activeDownloads++;
      runDownloadTask(task).finally(() => {
        activeDownloads--;
        processQueue();
      });
      if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) break;
    }
  }
}

// Bilibili 二维码登录与进度管理 IPC 通道
ipcMain.handle('bili-get-qrcode', async () => {
  try {
    const res = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    const json = await res.json();
    return json.code === 0 ? json.data : null;
  } catch (err) {
    console.error('Error generating Bili qrcode:', err);
    return null;
  }
});

ipcMain.handle('bili-poll-login', async (event, qrcodeKey) => {
  try {
    const res = await fetch(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcodeKey}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
    });
    const json = await res.json();
    if (json.code === 0 && json.data) {
      const code = json.data.code;
      if (code === 0 && json.data.url) {
        const urlObj = new URL(json.data.url);
        const extracted = urlObj.searchParams.get('SESSDATA');
        if (extracted) {
          sessdata = extracted;
          return { code, sessdata: extracted, success: true };
        }
      }
      return { code, success: false };
    }
  } catch (err) {
    console.error('Error polling Bili login:', err);
  }
  return { code: -1, success: false };
});

ipcMain.handle('bili-get-profile', async () => {
  if (!sessdata) return null;
  try {
    const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
    const json = await res.json();
    if (json.code === 0 && json.data) {
      return {
        isLogin: json.data.isLogin,
        uname: json.data.uname,
        face: json.data.face
      };
    }
  } catch (err) {
    console.error('Error getting Bili profile:', err);
  }
  return null;
});

ipcMain.handle('bili-parse-url', async (event, url) => {
  try {
    const bvidMatch = url.match(/video\/(BV[a-zA-Z0-9]+)/);
    if (!bvidMatch) {
      throw new Error('未在链接中匹配到合法的 Bvid');
    }
    const bvid = bvidMatch[1];
    return await fetchBiliPlaylist(bvid);
  } catch (err) {
    console.error('Error parsing Bili url:', err);
    throw err;
  }
});

ipcMain.handle('list-subdirectories', async (event, dirPath) => {
  try {
    const targetPath = dirPath || app.getPath('downloads');
    if (fs.existsSync(targetPath)) {
      const files = fs.readdirSync(targetPath, { withFileTypes: true });
      return files
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .map(dirent => dirent.name);
    }
  } catch (err) {
    console.error('Failed to list subdirectories:', err);
  }
  return [];
});

ipcMain.handle('bili-start-download', async (event, { episodes, quality, savePath, subFolder, collectionTitle, collectionType }) => {
  let baseSavePath = savePath || app.getPath('downloads');
  if (subFolder) {
    baseSavePath = path.join(baseSavePath, subFolder);
  }
  let targetSavePath = baseSavePath;
  
  // 如果是分P视频或合集系列，专门为其建立同名子目录，实现归档分类
  if (collectionType && collectionType !== 'single' && collectionTitle) {
    const folderName = sanitizeFilename(collectionTitle);
    targetSavePath = path.join(baseSavePath, folderName);
  }
  
  let usingFallback = false;
  let targetPathWritable = checkFolderWritable(targetSavePath);
  
  if (!targetPathWritable) {
    // Attempt fallback to system Downloads directory
    const systemDownloads = app.getPath('downloads');
    const fallbackPath = (collectionType && collectionType !== 'single' && collectionTitle)
      ? path.join(systemDownloads, sanitizeFilename(collectionTitle))
      : systemDownloads;
      
    if (checkFolderWritable(fallbackPath)) {
      targetSavePath = fallbackPath;
      usingFallback = true;
      console.warn(`Original save path ${savePath} not writable. Fell back to default downloads directory: ${targetSavePath}`);
    } else {
      throw new Error(`下载开始失败！您指定的保存目录 ${targetSavePath} 不存在或没有写入权限，且系统默认下载文件夹也无法访问。请检查磁盘权限或重新设置下载目录。`);
    }
  }

  const taskIds = [];
  
  for (const item of episodes) {
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const task = {
      id: taskId,
      bvid: item.bvid,
      cid: item.cid,
      title: item.title,
      partTitle: item.partTitle,
      quality: quality,
      savePath: targetSavePath,
      progress: 0,
      speed: 0,
      status: 'pending',
      warning: usingFallback ? '提示：设定的下载目录无写入权限，已自动保存至系统默认下载目录。' : null,
      error: null,
      bytesDownloaded: 0,
      bytesTotal: 0,
      controller: new AbortController()
    };
    
    downloaderTasks.set(taskId, task);
    taskIds.push(taskId);
    sendTaskProgress(taskId);
  }
  
  processQueue();
  return taskIds;
});

ipcMain.handle('bili-cancel-task', async (event, taskId) => {
  const task = downloaderTasks.get(taskId);
  if (task) {
    task.controller.abort();
    if (task.status === 'pending') {
      downloaderTasks.delete(taskId);
    }
    return true;
  }
  return false;
});

ipcMain.handle('bili-pause-all', async () => {
  for (const task of downloaderTasks.values()) {
    if (task.status === 'downloading' || task.status === 'merging' || task.status === 'pending') {
      task.controller.abort();
      task.status = 'paused';
    }
  }
  for (const id of downloaderTasks.keys()) {
    sendTaskProgress(id);
  }
  return true;
});

ipcMain.handle('bili-start-all', async () => {
  for (const task of downloaderTasks.values()) {
    if (task.status === 'paused' || task.status === 'failed') {
      task.controller = new AbortController();
      task.status = 'pending';
      task.error = null;
    }
  }
  for (const id of downloaderTasks.keys()) {
    sendTaskProgress(id);
  }
  processQueue();
  return true;
});

ipcMain.handle('bili-get-tasks', () => {
  const list = [];
  for (const task of downloaderTasks.values()) {
    list.push({
      id: task.id,
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      partTitle: task.partTitle,
      progress: task.progress,
      speed: task.speed,
      status: task.status,
      bytesDownloaded: task.bytesDownloaded,
      bytesTotal: task.bytesTotal,
      warning: task.warning,
      error: task.error
    });
  }
  return list;
});

ipcMain.handle('select-download-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('set-max-downloads', (event, val) => {
  if (typeof val === 'number') {
    MAX_CONCURRENT_DOWNLOADS = Math.max(1, Math.min(5, val));
  }
  return MAX_CONCURRENT_DOWNLOADS;
});

ipcMain.handle('get-max-downloads', () => {
  return MAX_CONCURRENT_DOWNLOADS;
});

// ==========================================
// 视频截屏与数据库管理 (Screenshot & DB)
// ==========================================
const SCREENSHOTS_DB_FILE = path.join(app.getPath('userData'), 'screenshots-db.json');
const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'Screenshots');

function getScreenshotsDB() {
  if (fs.existsSync(SCREENSHOTS_DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SCREENSHOTS_DB_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse screenshots db:', e);
    }
  }
  return {
    categories: [{ id: 'uncategorized', name: '未分类' }],
    screenshots: []
  };
}

function saveScreenshotsDB(db) {
  try {
    fs.mkdirSync(path.dirname(SCREENSHOTS_DB_FILE), { recursive: true });
    fs.writeFileSync(SCREENSHOTS_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save screenshots db:', e);
    return false;
  }
}

ipcMain.handle('get-screenshots-db', () => {
  return getScreenshotsDB();
});

ipcMain.handle('save-screenshots-db', (event, db) => {
  return saveScreenshotsDB(db);
});

ipcMain.handle('delete-directory-folder', async (event, dirPath) => {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return true;
    }
  } catch (err) {
    console.error('Failed to delete directory:', err);
  }
  return false;
});

ipcMain.handle('save-screenshot', async (event, { base64Data, videoPath, videoName, playbackTime, categoryId }) => {
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    
    // Clean video name for safe filename
    const cleanVideoName = videoName.replace(/[\\/:*?"<>|]/g, '_').trim();
    // Helper to format time
    const formatTimestamp = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return [h, m, s].map(v => String(v).padStart(2, '0')).join('-');
    };
    
    const timeStr = formatTimestamp(playbackTime);
    const filename = `${cleanVideoName}_${timeStr}_${Date.now().toString().slice(-4)}.png`;
    const fullPath = path.join(SCREENSHOTS_DIR, filename);
    
    fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));
    
    // Update DB
    const db = getScreenshotsDB();
    const newScreenshot = {
      id: 'shot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      filename: filename,
      relativePath: `Screenshots/${filename}`,
      absolutePath: fullPath,
      videoName: videoName,
      videoPath: videoPath,
      playbackTime: playbackTime,
      categoryId: categoryId || 'uncategorized',
      createdAt: Date.now()
    };
    
    db.screenshots.push(newScreenshot);
    saveScreenshotsDB(db);
    
    return { success: true, screenshot: newScreenshot };
  } catch (err) {
    console.error('Error saving screenshot:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-screenshot-file', async (event, absolutePath) => {
  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      return true;
    }
  } catch (err) {
    console.error('Error deleting screenshot file:', err);
  }
  return false;
});

ipcMain.handle('open-image-in-finder', async (event, absolutePath) => {
  if (absolutePath && fs.existsSync(absolutePath)) {
    shell.showItemInFolder(absolutePath);
    return true;
  }
  return false;
});

ipcMain.handle('copy-image-to-clipboard', async (event, absolutePath) => {
  try {
    if (absolutePath && fs.existsSync(absolutePath)) {
      const { clipboard, nativeImage } = require('electron');
      const image = nativeImage.createFromPath(absolutePath);
      clipboard.writeImage(image);
      return true;
    }
  } catch (e) {
    console.error('Failed to copy image to clipboard:', e);
  }
  return false;
});

// ==========================================
// 学习笔记数据管理 (Notes Management DB)
// ==========================================
const NOTES_DB_FILE = path.join(app.getPath('userData'), 'notes-db.json');

function getNotesDB() {
  if (fs.existsSync(NOTES_DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(NOTES_DB_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse notes db:', e);
    }
  }
  return {
    notes: []
  };
}

function saveNotesDB(db) {
  try {
    fs.mkdirSync(path.dirname(NOTES_DB_FILE), { recursive: true });
    fs.writeFileSync(NOTES_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save notes db:', e);
    return false;
  }
}

ipcMain.handle('get-notes-db', () => {
  return getNotesDB();
});

ipcMain.handle('save-notes-db', (event, db) => {
  return saveNotesDB(db);
});

ipcMain.handle('upload-material', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要上传的学习资料',
    properties: ['openFile'],
    filters: [
      { name: '所有支持类型', extensions: ['md', 'txt', 'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'png', 'jpg', 'jpeg'] },
      { name: 'Markdown文档', extensions: ['md'] },
      { name: '文本文档', extensions: ['txt'] },
      { name: 'PDF文档', extensions: ['pdf'] },
      { name: 'Word文档', extensions: ['docx', 'doc'] },
      { name: 'PPT幻灯片', extensions: ['pptx', 'ppt'] },
      { name: 'Excel表格', extensions: ['xlsx', 'xls'] },
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const srcPath = result.filePaths[0];
  const name = path.basename(srcPath);
  const ext = path.extname(srcPath).toLowerCase();
  
  const uploadDir = path.join(app.getPath('userData'), 'UploadedMaterials');
  fs.mkdirSync(uploadDir, { recursive: true });
  
  const destName = `${Date.now()}_${name}`;
  const destPath = path.join(uploadDir, destName);
  
  try {
    fs.copyFileSync(srcPath, destPath);
    const stats = fs.statSync(destPath);
    
    let text = null;
    if (ext === '.md' || ext === '.txt') {
      text = fs.readFileSync(destPath, 'utf8');
    }
    
    return {
      name,
      extension: ext,
      absolutePath: destPath,
      size: stats.size,
      text
    };
  } catch (e) {
    console.error('Failed to upload material:', e);
    throw e;
  }
});

// ==========================================
// PDF 原生阅读支持 (PDFKit renderer bridge)
// ==========================================
const PDF_CACHE_DIR = path.join(app.getPath('userData'), 'PdfCache');
const PDF_RENDER_CACHE_VERSION = 'v2';

function runPdfRenderer(args) {
  return new Promise((resolve, reject) => {
    execFile(PDF_RENDERER_PATH, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      let parsed = null;
      try {
        parsed = stdout ? JSON.parse(stdout.trim()) : null;
      } catch (parseError) {
        reject(new Error(`PDF 渲染器返回了无效数据: ${parseError.message}`));
        return;
      }

      if (error) {
        reject(new Error((parsed && parsed.error) || stderr || error.message));
        return;
      }

      if (!parsed || parsed.success === false) {
        reject(new Error((parsed && parsed.error) || 'PDF 渲染失败'));
        return;
      }

      resolve(parsed);
    });
  });
}

function normalizePdfScale(scale) {
  const parsed = Number(scale);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(3, Math.max(1, parsed));
}

function getPdfCachePath(pdfPath, pageIndex, scale) {
  const stat = fs.statSync(pdfPath);
  const cacheKey = crypto
    .createHash('sha1')
    .update(`${PDF_RENDER_CACHE_VERSION}:${pdfPath}:${stat.size}:${stat.mtimeMs}:${pageIndex}:${scale}`)
    .digest('hex');
  return path.join(PDF_CACHE_DIR, `${cacheKey}.png`);
}

ipcMain.handle('pdf-get-info', async (event, pdfPath) => {
  try {
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error('PDF 文件不存在');
    }
    if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
      throw new Error('请选择 PDF 文件');
    }

    const info = await runPdfRenderer(['info', pdfPath]);
    return {
      success: true,
      pageCount: info.pageCount,
      title: info.title || path.basename(pdfPath, '.pdf')
    };
  } catch (err) {
    console.error('Failed to read PDF info:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf-render-page', async (event, { pdfPath, pageIndex, scale }) => {
  try {
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error('PDF 文件不存在');
    }
    if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
      throw new Error('请选择 PDF 文件');
    }

    const normalizedPageIndex = parseInt(pageIndex, 10);
    if (!Number.isInteger(normalizedPageIndex) || normalizedPageIndex < 0) {
      throw new Error('PDF 页码无效');
    }

    const normalizedScale = normalizePdfScale(scale);
    const outputPath = getPdfCachePath(pdfPath, normalizedPageIndex, normalizedScale);
    fs.mkdirSync(PDF_CACHE_DIR, { recursive: true });

    if (!fs.existsSync(outputPath)) {
      await runPdfRenderer([
        'render',
        pdfPath,
        String(normalizedPageIndex),
        String(normalizedScale),
        outputPath
      ]);
    }

    return {
      success: true,
      pageIndex: normalizedPageIndex,
      absolutePath: outputPath
    };
  } catch (err) {
    console.error('Failed to render PDF page:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-path', async (event, targetPath) => {
  if (targetPath && fs.existsSync(targetPath)) {
    shell.openPath(targetPath);
    return true;
  }
  return false;
});

// App Lifecycle
app.whenReady().then(() => {
  startVideoServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (videoServer) {
    videoServer.close();
  }
});
