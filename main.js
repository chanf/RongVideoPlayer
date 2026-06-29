const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec } = require('child_process');

let mainWindow;
let videoServer;
const SERVER_PORT = 30032;
const HISTORY_FILE = path.join(app.getPath('userData'), 'playback-history.json');

// Paths to ffmpeg and ffprobe
const FFMPEG_PATH = '/opt/homebrew/bin/ffmpeg';
const FFPROBE_PATH = '/opt/homebrew/bin/ffprobe';

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
    if (urlObj.pathname === '/video') {
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
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading history file:', err);
  }
  return {};
});

ipcMain.handle('save-history', async (event, historyData) => {
  try {
    // Merge existing history with updates
    let currentHistory = {};
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        currentHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      } catch (e) {}
    }
    const updatedHistory = { ...currentHistory, ...historyData };
    
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing history file:', err);
    return false;
  }
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
