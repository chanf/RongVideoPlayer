const { ipcRenderer } = require('electron');
const path = require('path');

// State
let currentDirectory = '';
let currentDirectoryTree = null;
let autoplayNext = true;
let expandedFolders = new Set();
let currentFilePath = '';
let currentFileDuration = 0;
let isTranscoding = false;
let transcodeStartTime = 0;
let playbackSpeed = 1.0;
let recentList = [];
let controlsTimeout = null;
let isTimelineDragging = false;
let historySaveInterval = null;
let currentTheme = 'default';

// DOM Elements
const btnOpenFolder = document.getElementById('btn-open-folder');
const searchInput = document.getElementById('search-input');
const directoryTree = document.getElementById('directory-tree');
const recentListContainer = document.getElementById('recent-list');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnClearCompleted = document.getElementById('btn-clear-completed');

const videoElement = document.getElementById('video-element');
const playerContainer = document.getElementById('player-container');
const controlsOverlay = document.getElementById('controls-overlay');
const welcomeOverlay = document.getElementById('welcome-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const videoTitle = document.getElementById('video-title');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnRewind = document.getElementById('btn-rewind');
const btnForward = document.getElementById('btn-forward');
const currentTimeLabel = document.getElementById('current-time');
const totalDurationLabel = document.getElementById('total-duration');
const transcodeTag = document.getElementById('transcode-tag');

const btnMute = document.getElementById('btn-mute');
const iconVolumeHigh = document.getElementById('icon-volume-high');
const iconVolumeMuted = document.getElementById('icon-volume-muted');
const volumeSlider = document.getElementById('volume-slider');

const btnSpeed = document.getElementById('btn-speed');
const speedDropdown = document.getElementById('speed-dropdown');
const btnFullscreen = document.getElementById('btn-fullscreen');
const iconFullscreenEnter = document.getElementById('icon-fullscreen-enter');
const iconFullscreenExit = document.getElementById('icon-fullscreen-exit');

const timelineSlider = document.getElementById('timeline-slider');
const timelineProgress = document.getElementById('timeline-progress');
const timelineBuffered = document.getElementById('timeline-buffered');
const btnTheme = document.getElementById('btn-theme');
const themeDropdown = document.getElementById('theme-dropdown');

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadHistoryAndResume();
  initBilibiliDownloader();
});

// Event Listeners Setup
function setupEventListeners() {
  // Directory & UI
  btnOpenFolder.addEventListener('click', selectDirectory);
  
  // 支持中文输入法拼音输入合成优化
  let isComposing = false;
  searchInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  searchInput.addEventListener('compositionend', () => {
    isComposing = false;
    handleSearch();
  });
  searchInput.addEventListener('input', () => {
    if (!isComposing) {
      handleSearch();
    }
  });

  btnClearHistory.addEventListener('click', clearPlaybackHistory);
  if (btnClearCompleted) {
    btnClearCompleted.addEventListener('click', clearCompletedHistory);
  }

  const btnRefreshTree = document.getElementById('btn-refresh-tree');
  if (btnRefreshTree) {
    btnRefreshTree.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (currentDirectory) {
        // Rotate refresh icon briefly for visual feedback
        const svg = btnRefreshTree.querySelector('svg');
        if (svg) {
          svg.style.transition = 'transform 0.5s ease';
          svg.style.transform = 'rotate(360deg)';
          setTimeout(() => {
            svg.style.transition = 'none';
            svg.style.transform = 'none';
          }, 500);
        }
        
        const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
        if (tree) {
          renderDirectoryTree(tree);
        }
      }
    });
  }

  // Video Events
  videoElement.addEventListener('play', onVideoPlay);
  videoElement.addEventListener('pause', onVideoPause);
  videoElement.addEventListener('timeupdate', onVideoTimeUpdate);
  videoElement.addEventListener('progress', onVideoProgress);
  videoElement.addEventListener('loadedmetadata', onVideoLoadedMetadata);
  videoElement.addEventListener('waiting', () => showLoading('视频正在缓冲...'));
  videoElement.addEventListener('playing', hideLoading);
  videoElement.addEventListener('click', togglePlayPause);
  videoElement.addEventListener('dblclick', toggleFullscreen);
  videoElement.addEventListener('ended', onVideoEnded);

  // Playback Control Buttons
  btnPlayPause.addEventListener('click', togglePlayPause);
  btnRewind.addEventListener('click', () => seekRelative(-15));
  btnForward.addEventListener('click', () => seekRelative(15));

  // Timeline Scrubber
  timelineSlider.addEventListener('input', onTimelineInput);
  timelineSlider.addEventListener('change', onTimelineChange);

  // Volume Controls
  btnMute.addEventListener('click', toggleMute);
  volumeSlider.addEventListener('input', onVolumeSliderInput);

  // Speed Selector
  btnSpeed.addEventListener('click', (e) => {
    e.stopPropagation();
    speedDropdown.classList.toggle('visible');
    themeDropdown.classList.remove('visible');
  });
  document.addEventListener('click', () => {
    speedDropdown.classList.remove('visible');
    themeDropdown.classList.remove('visible');
  });
  document.querySelectorAll('.speed-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const speed = parseFloat(e.target.dataset.speed);
      setPlaybackSpeed(speed);
    });
  });

  // Theme Selector
  btnTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    themeDropdown.classList.toggle('visible');
    speedDropdown.classList.remove('visible');
  });
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const target = e.target.closest('.theme-option');
      if (target) {
        const theme = target.dataset.theme;
        setTheme(theme);
      }
    });
  });

  // Autoplay Toggle
  const btnAutoplay = document.getElementById('btn-autoplay');
  const iconAutoplayOn = document.getElementById('icon-autoplay-on');
  const iconAutoplayOff = document.getElementById('icon-autoplay-off');
  if (btnAutoplay) {
    btnAutoplay.addEventListener('click', () => {
      autoplayNext = !autoplayNext;
      if (autoplayNext) {
        btnAutoplay.classList.add('active');
        btnAutoplay.title = '自动连播: 已开启';
        iconAutoplayOn.classList.remove('hidden');
        iconAutoplayOff.classList.add('hidden');
      } else {
        btnAutoplay.classList.remove('active');
        btnAutoplay.title = '自动连播: 已关闭';
        iconAutoplayOn.classList.add('hidden');
        iconAutoplayOff.classList.remove('hidden');
      }
      ipcRenderer.invoke('save-history', { autoplayNext });
    });
  }

  // Fullscreen
  btnFullscreen.addEventListener('click', toggleFullscreen);

  // Keyboard Shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);

  // Hover Overlay Logic for Controls
  playerContainer.addEventListener('mousemove', triggerControlsVisibility);
  playerContainer.addEventListener('mouseleave', () => {
    if (!videoElement.paused) {
      hideControls();
    }
  });
}

// Format Time helper (seconds -> MM:SS or HH:MM:SS)
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (val) => String(val).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

// -------------------------------------------------------------
// History Management & Recovery
// -------------------------------------------------------------
async function loadHistoryAndResume() {
  const history = await ipcRenderer.invoke('get-history');
  
  if (history.lastDirectory) {
    currentDirectory = history.lastDirectory;
    const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
    if (tree) {
      renderDirectoryTree(tree);
    }
    if (typeof updateSavePathLabel === 'function') updateSavePathLabel();
  }

  if (history.recentList) {
    recentList = history.recentList;
    renderRecentList();
  }

  // Restore Volume
  if (history.volume !== undefined) {
    videoElement.volume = history.volume;
    volumeSlider.value = Math.round(history.volume * 100);
    updateVolumeIcon();
  }

  // Restore Theme
  if (history.theme) {
    setTheme(history.theme);
  }


  // Restore Autoplay Toggle State
  if (history.autoplayNext !== undefined) {
    autoplayNext = history.autoplayNext;
    const btnAutoplay = document.getElementById('btn-autoplay');
    const iconAutoplayOn = document.getElementById('icon-autoplay-on');
    const iconAutoplayOff = document.getElementById('icon-autoplay-off');
    if (btnAutoplay) {
      if (autoplayNext) {
        btnAutoplay.classList.add('active');
        btnAutoplay.title = '自动连播: 已开启';
        iconAutoplayOn.classList.remove('hidden');
        iconAutoplayOff.classList.add('hidden');
      } else {
        btnAutoplay.classList.remove('active');
        btnAutoplay.title = '自动连播: 已关闭';
        iconAutoplayOn.classList.add('hidden');
        iconAutoplayOff.classList.remove('hidden');
      }
    }
  }

  // Restore last played file and progress
  if (history.lastPlayedFile && history.lastProgress !== undefined) {
    const filePath = history.lastPlayedFile;
    const progress = history.lastProgress;
    
    // Check if the file still exists in the local filesystem by checking the tree
    const fileExists = checkFileExists(filePath);
    if (fileExists) {
      // Auto-load but don't autoplay, let user click or resume
      showLoading('正在恢复上次播放进度...');
      
      // We load the video and seek to progress, but keep paused initially
      setTimeout(() => {
        playVideo(filePath, progress, false);
      }, 500);
    }
  }
}

function checkFileExists(filePath) {
  // Quick check inside tree structure, or let probe fail
  return true;
}

function savePlaybackProgress() {
  if (!currentFilePath) return;

  const currentSec = isTranscoding 
    ? (transcodeStartTime + videoElement.currentTime) 
    : videoElement.currentTime;

  const progressPercent = currentFileDuration > 0 ? (currentSec / currentFileDuration) * 100 : 0;

  // Update recent list
  updateRecentList(currentFilePath, currentSec, currentFileDuration);

  ipcRenderer.invoke('save-history', {
    lastDirectory: currentDirectory,
    lastPlayedFile: currentFilePath,
    lastProgress: currentSec,
    volume: videoElement.volume,
    recentList: recentList,
    theme: currentTheme
  });
}

function updateRecentList(filePath, currentSec, duration) {
  const existingIdx = recentList.findIndex(item => item.path === filePath);
  const name = path.basename(filePath);
  
  const newItem = {
    name: name,
    path: filePath,
    time: currentSec,
    duration: duration,
    progress: duration > 0 ? (currentSec / duration) * 100 : 0,
    timestamp: Date.now()
  };

  if (existingIdx > -1) {
    recentList.splice(existingIdx, 1);
  }
  
  recentList.unshift(newItem);
  
  // Cap at 10 items
  if (recentList.length > 10) {
    recentList.pop();
  }

  renderRecentList();
}

function renderRecentList() {
  recentListContainer.innerHTML = '';
  
  if (recentList.length === 0) {
    recentListContainer.innerHTML = '<div class="tree-placeholder" style="padding: 15px; font-size:11px;">无最近播放记录</div>';
    return;
  }

  recentList.forEach(item => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <div class="recent-name" title="${item.name}">${item.name}</div>
      <div class="recent-progress-container">
        <div class="recent-progress-bar" style="width: ${item.progress}%"></div>
      </div>
      <div class="recent-time">
        <span>${formatTime(item.time)} / ${formatTime(item.duration)}</span>
        <span>进度 ${Math.round(item.progress)}%</span>
      </div>
    `;
    
    div.addEventListener('click', () => {
      playVideo(item.path, item.time, true);
    });

    recentListContainer.appendChild(div);
  });
}

async function clearPlaybackHistory() {
  if (recentList.length === 0) return;
  
  if (confirm('是否确定清空所有的播放记录和进度？')) {
    recentList = [];
    renderRecentList();
    
    await ipcRenderer.invoke('save-history', {
      lastPlayedFile: '',
      lastProgress: 0,
      recentList: []
    });
  }
}

async function clearCompletedHistory() {
  const completedItems = recentList.filter(item => item.progress >= 95);
  if (completedItems.length === 0) {
    alert('当前没有已播放完成的视频记录！');
    return;
  }

  if (confirm(`是否确定清空这 ${completedItems.length} 条已播放完成的记录？`)) {
    recentList = recentList.filter(item => item.progress < 95);
    renderRecentList();

    await ipcRenderer.invoke('save-history', {
      recentList: recentList
    });

    if (currentDirectoryTree) {
      renderDirectoryTree(currentDirectoryTree);
    }
  }
}

function setTheme(theme) {
  currentTheme = theme;
  if (theme === 'default') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
  
  // Update active option inside dropdown
  document.querySelectorAll('.theme-option').forEach(option => {
    if (option.dataset.theme === theme) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });

  // Persist theme immediately
  ipcRenderer.invoke('save-history', { theme: theme });
}

// Start periodic history saving
function startHistorySaveTimer() {
  stopHistorySaveTimer();
  historySaveInterval = setInterval(savePlaybackProgress, 2000);
}

function stopHistorySaveTimer() {
  if (historySaveInterval) {
    clearInterval(historySaveInterval);
    historySaveInterval = null;
  }
}

// -------------------------------------------------------------
// Directory Tree Scanning & Search
// -------------------------------------------------------------
async function selectDirectory() {
  const result = await ipcRenderer.invoke('select-directory');
  if (result) {
    currentDirectory = result.folderPath;
    renderDirectoryTree(result.tree);
    if (typeof updateSavePathLabel === 'function') updateSavePathLabel();
    
    // Save directory path to history
    ipcRenderer.invoke('save-history', { lastDirectory: currentDirectory });
  }
}

function renderDirectoryTree(tree) {
  currentDirectoryTree = tree;
  directoryTree.innerHTML = '';
  
  if (!tree || !tree.children || tree.children.length === 0) {
    directoryTree.innerHTML = `
      <div class="tree-placeholder">
        <p>目录中无支持的视频文件</p>
        <span>支持扩展名：mp4, mkv, rmvb, avi, flv, mov, wmv 等</span>
      </div>
    `;
    return;
  }

  const rootElement = createTreeNodeDOM(tree, 0);
  directoryTree.appendChild(rootElement);
  
  // Expand root folder by default
  const rootChildren = rootElement.querySelector('.tree-children');
  const rootArrow = rootElement.querySelector('.tree-arrow');
  if (rootChildren && rootArrow) {
    rootChildren.classList.remove('collapsed');
    rootArrow.classList.add('expanded');
    expandedFolders.add(tree.path);
  }

  // Restore other expanded folders
  restoreFolderExpandedStates(rootElement);
  
  // Highlight currently playing file if active
  if (currentFilePath) {
    highlightActiveFileDOM(currentFilePath);
  }
}

function createTreeNodeDOM(node, depth = 0) {
  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'tree-node';
  nodeDiv.dataset.path = node.path;
  nodeDiv.dataset.type = node.type;

  const itemDiv = document.createElement('div');
  itemDiv.className = 'tree-item';
  
  // Indentation spacers
  for (let i = 0; i < depth; i++) {
    const spacer = document.createElement('span');
    spacer.className = 'tree-indent';
    itemDiv.appendChild(spacer);
  }

  // Arrow for Directory
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'tree-arrow';
  if (node.type === 'directory') {
    arrowSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:10px; height:10px;">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
    
    // caret arrow clicks toggle folder expansion
    arrowSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolderDOM(itemDiv, nodeDiv);
    });
  } else {
    arrowSpan.classList.add('hidden-arrow');
  }
  itemDiv.appendChild(arrowSpan);

  // Icon (Folder vs Video)
  const iconSpan = document.createElement('span');
  iconSpan.className = 'tree-icon';
  if (node.type === 'directory') {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
    `;
  } else {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="23 7 16 12 23 17 23 7"></polygon>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
      </svg>
    `;
  }
  itemDiv.appendChild(iconSpan);

  // Prepend watch status dot for file items
  let fileProgress = 0;
  if (node.type === 'file') {
    const historyItem = recentList.find(item => item.path === node.path);
    const dotSpan = document.createElement('span');
    dotSpan.className = 'tree-watch-dot';
    
    if (historyItem && historyItem.progress > 0) {
      fileProgress = Math.round(historyItem.progress);
      if (fileProgress < 95) {
        dotSpan.classList.add('partial');
        dotSpan.title = `已播 ${fileProgress}%`;
        itemDiv.appendChild(dotSpan);
      }
    } else {
      dotSpan.classList.add('unplayed');
      dotSpan.title = '未播放';
      itemDiv.appendChild(dotSpan);
    }
  }

  // Name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-name';
  if (node.type === 'file' && fileProgress > 0 && fileProgress < 95) {
    nameSpan.innerHTML = `${node.name} <span class="tree-file-progress">(${fileProgress}%)</span>`;
  } else {
    nameSpan.textContent = node.name;
  }
  itemDiv.appendChild(nameSpan);

  // Hook up directory specific Finder open events and hover buttons
  if (node.type === 'directory') {
    const handleFinderOpen = (e) => {
      e.stopPropagation();
      ipcRenderer.invoke('open-in-finder', node.path);
    };
    
    // Add Finder hover button
    const revealBtn = document.createElement('button');
    revealBtn.className = 'btn-reveal-finder';
    revealBtn.title = '在 Finder 中打开目录';
    revealBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    `;
    revealBtn.addEventListener('click', handleFinderOpen);
    itemDiv.appendChild(revealBtn);
  }

  nodeDiv.appendChild(itemDiv);

  // Handle Children rendering for Directories
  if (node.type === 'directory' && node.children) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children collapsed'; // Collapsed by default
    
    node.children.forEach(child => {
      const childNode = createTreeNodeDOM(child, depth + 1);
      if (childNode) childrenDiv.appendChild(childNode);
    });
    
    nodeDiv.appendChild(childrenDiv);

    // Expand / Collapse interaction
    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolderDOM(itemDiv, nodeDiv);
    });
  } else if (node.type === 'file') {
    // Click file to play video
    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      playVideo(node.path, 0, true);
    });
  }

  return nodeDiv;
}

function toggleFolderDOM(itemDiv, nodeDiv) {
  const childrenDiv = nodeDiv.querySelector('.tree-children');
  const arrow = itemDiv.querySelector('.tree-arrow');
  const path = nodeDiv.dataset.path;

  if (childrenDiv.classList.contains('collapsed')) {
    childrenDiv.classList.remove('collapsed');
    arrow.classList.add('expanded');
    expandedFolders.add(path);
  } else {
    childrenDiv.classList.add('collapsed');
    arrow.classList.remove('expanded');
    expandedFolders.delete(path);
  }
}

function restoreFolderExpandedStates(rootElement) {
  const nodes = rootElement.querySelectorAll('.tree-node[data-type="directory"]');
  nodes.forEach(node => {
    const path = node.dataset.path;
    if (expandedFolders.has(path)) {
      const children = node.querySelector('.tree-children');
      const arrow = node.querySelector('.tree-arrow');
      if (children) children.classList.remove('collapsed');
      if (arrow) arrow.classList.add('expanded');
    }
  });
}

function highlightActiveFileDOM(filePath) {
  // Clear existing active items
  document.querySelectorAll('.tree-item.active').forEach(item => {
    item.classList.remove('active');
  });

  // Find node by path
  const node = document.querySelector(`.tree-node[data-path="${filePath}"]`);
  if (node) {
    const item = node.querySelector('.tree-item');
    if (item) {
      item.classList.add('active');
      
      // Ensure all parent directories are expanded
      let parent = node.parentElement;
      while (parent && parent.classList.contains('tree-children')) {
        parent.classList.remove('collapsed');
        
        // Find arrow of parent tree-node
        const parentNode = parent.parentElement;
        if (parentNode) {
          const parentItem = parentNode.querySelector('.tree-item');
          if (parentItem) {
            const arrow = parentItem.querySelector('.tree-arrow');
            if (arrow) arrow.classList.add('expanded');
          }
          expandedFolders.add(parentNode.dataset.path);
        }
        parent = parentNode.parentElement;
      }
    }
  }
}

// Tree Search / Filter
function handleSearch() {
  const query = searchInput.value.toLowerCase().trim().normalize('NFC');
  const treeNodes = document.querySelectorAll('.tree-node');

  if (!query) {
    // Restore nodes visibility
    treeNodes.forEach(node => {
      node.style.display = '';
      node.querySelector('.tree-item').classList.remove('matched');
      const children = node.querySelector('.tree-children');
      if (children && node.dataset.path !== currentDirectory) {
        // Re-collapse folders that are not in the expanded set
        if (!expandedFolders.has(node.dataset.path)) {
          children.classList.add('collapsed');
          const arrow = node.querySelector('.tree-arrow');
          if (arrow) arrow.classList.remove('expanded');
        }
      }
    });

    // 恢复所有目录节点本身的树项显示
    document.querySelectorAll('.tree-node[data-type="directory"] > .tree-item').forEach(item => {
      item.style.display = '';
    });

    return;
  }

  // 搜索时将目录行隐藏，使结果只展示匹配的视频文件名
  document.querySelectorAll('.tree-node[data-type="directory"] > .tree-item').forEach(item => {
    item.style.display = 'none';
  });

  // Walk and filter files
  treeNodes.forEach(node => {
    if (node.dataset.type === 'file') {
      const name = node.querySelector('.tree-name').textContent.toLowerCase().normalize('NFC');
      const item = node.querySelector('.tree-item');
      if (name.includes(query)) {
        node.style.display = '';
        item.classList.add('matched');
        
        // Expand parents
        let parent = node.parentElement;
        while (parent && parent.classList.contains('tree-children')) {
          parent.classList.remove('collapsed');
          const parentNode = parent.parentElement;
          if (parentNode) {
            const parentItem = parentNode.querySelector('.tree-item');
            if (parentItem) {
              const arrow = parentItem.querySelector('.tree-arrow');
              if (arrow) arrow.classList.add('expanded');
            }
          }
          parent = parentNode.parentElement;
        }
      } else {
        node.style.display = 'none';
        item.classList.remove('matched');
      }
    }
  });

  // Folders visibility: show only if containing visible children
  const folderNodes = Array.from(document.querySelectorAll('.tree-node[data-type="directory"]'));
  // Sort by depth descending to filter leaf folders first
  folderNodes.sort((a, b) => {
    const depthA = a.querySelectorAll('.tree-indent').length;
    const depthB = b.querySelectorAll('.tree-indent').length;
    return depthB - depthA;
  });

  folderNodes.forEach(folder => {
    const childrenContainer = folder.querySelector('.tree-children');
    if (childrenContainer) {
      const visibleChildren = Array.from(childrenContainer.children).filter(child => child.style.display !== 'none');
      if (visibleChildren.length > 0) {
        folder.style.display = '';
      } else {
        folder.style.display = 'none';
      }
    }
  });
}

// -------------------------------------------------------------
// Video Player Controls & Streaming
// -------------------------------------------------------------
async function playVideo(filePath, startSec = 0, autoplay = true) {
  // 如果当前下载界面是开启的，直接切换回播放器界面（后台下载将自动静默运行）
  const downloaderView = document.getElementById('downloader-view');
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const playerContainer = document.getElementById('player-container');
  if (downloaderView && !downloaderView.classList.contains('hidden')) {
    if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
    downloaderView.classList.add('hidden');
    playerContainer.classList.remove('hidden');
  }

  showLoading('正在分析媒体格式...');
  stopHistorySaveTimer();

  try {
    const meta = await ipcRenderer.invoke('probe-video', filePath);
    
    if (!meta) {
      alert('视频加载失败，请检查文件是否存在！');
      hideLoading();
      return;
    }

    currentFilePath = filePath;
    currentFileDuration = meta.duration;
    isTranscoding = meta.needsTranscode;
    transcodeStartTime = startSec;


    // UI Updates
    const baseName = path.basename(filePath);
    const existing = recentList.find(item => item.path === filePath);
    const prog = existing ? existing.progress : 0;
    if (prog > 0 && prog < 95) {
      videoTitle.textContent = `${baseName} (${Math.round(prog)}%)`;
    } else {
      videoTitle.textContent = baseName;
    }
    totalDurationLabel.textContent = formatTime(meta.duration);
    welcomeOverlay.style.opacity = '0';
    setTimeout(() => { welcomeOverlay.classList.add('hidden'); }, 500);

    if (isTranscoding) {
      transcodeTag.classList.remove('hidden');
    } else {
      transcodeTag.classList.add('hidden');
    }

    // Highlighting in Tree
    highlightActiveFileDOM(filePath);

    // Build Streaming URL
    let streamUrl = '';
    if (!isTranscoding) {
      streamUrl = `http://localhost:30032/video?path=${encodeURIComponent(filePath)}`;
    } else {
      // Seek transcode via server startParam
      streamUrl = `http://localhost:30032/video?path=${encodeURIComponent(filePath)}&start=${startSec}`;
    }

    showLoading(isTranscoding ? '正在实时转码视频...' : '正在缓冲视频...');

    // Load in HTML5 video
    videoElement.src = streamUrl;
    videoElement.load();
    
    if (autoplay) {
      videoElement.play().then(() => {
        startHistorySaveTimer();
      }).catch(err => {
        console.warn('Autoplay blocked:', err);
      });
    }

  } catch (err) {
    console.error('Error during playVideo:', err);
    alert('视频播放发生错误！');
    hideLoading();
  }
}

// Video Callbacks
function onVideoLoadedMetadata() {
  hideLoading();

  // 兜底逻辑：如果后端 ffprobe 获取时长失败返回 0，使用 HTML5 video 自身的时长
  if ((!currentFileDuration || isNaN(currentFileDuration) || currentFileDuration === 0) && videoElement.duration) {
    currentFileDuration = videoElement.duration;
    totalDurationLabel.textContent = formatTime(currentFileDuration);
  }
  
  if (!isTranscoding && transcodeStartTime > 0) {
    videoElement.currentTime = transcodeStartTime;
    transcodeStartTime = 0; // reset
  }
}

function onVideoPlay() {
  iconPlay.classList.add('hidden');
  iconPause.classList.remove('hidden');
  startHistorySaveTimer();
  triggerControlsVisibility();
}

function onVideoPause() {
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
  stopHistorySaveTimer();
  savePlaybackProgress();
  
  // 暂停时立刻刷新目录树和历史列表中的播放进度
  renderRecentList();
  if (currentDirectoryTree) {
    renderDirectoryTree(currentDirectoryTree);
  }
  
  showControls(); // keep visible when paused
}

function onVideoEnded() {
  if (!currentFilePath) return;
  
  // 播放结束，强制写入 100% 进度
  updateRecentList(currentFilePath, currentFileDuration, currentFileDuration);
  savePlaybackProgress();
  
  // 刷新界面
  renderRecentList();
  if (currentDirectoryTree) {
    renderDirectoryTree(currentDirectoryTree);
  }
  
  // 播放器标题重置为文件名即可，已播完视频不展示圆点
  const baseName = path.basename(currentFilePath);
  videoTitle.textContent = baseName;
  
  // 自动连播下一集
  if (autoplayNext && currentDirectoryTree) {
    const allFiles = flattenTreeFiles(currentDirectoryTree);
    const currentIndex = allFiles.indexOf(currentFilePath);
    if (currentIndex > -1 && currentIndex + 1 < allFiles.length) {
      const nextFile = allFiles[currentIndex + 1];
      console.log('自动连播下一集：', nextFile);
      playVideo(nextFile, 0, true);
    }
  }
}

// 深度优先展平媒体树的所有文件节点，以获得与其在侧边栏显示次序完全一致的平铺文件列表
function flattenTreeFiles(node, list = []) {
  if (!node) return list;
  if (node.type === 'file') {
    list.push(node.path);
  } else if (node.type === 'directory' && node.children) {
    node.children.forEach(child => flattenTreeFiles(child, list));
  }
  return list;
}

function onVideoTimeUpdate() {
  if (isTimelineDragging) return;

  const currentSec = isTranscoding 
    ? (transcodeStartTime + videoElement.currentTime) 
    : videoElement.currentTime;

  currentTimeLabel.textContent = formatTime(currentSec);

  // Update slider position
  if (currentFileDuration > 0) {
    const percent = (currentSec / currentFileDuration) * 100;
    timelineSlider.value = percent;
    timelineProgress.style.width = `${percent}%`;
  } else {
    timelineSlider.value = 0;
    timelineProgress.style.width = '0%';
  }
}

function onVideoProgress() {
  if (videoElement.buffered.length > 0 && currentFileDuration > 0) {
    const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
    
    let percent = 0;
    if (isTranscoding) {
      // For transcoding, the buffered range is relative to video.currentTime which maps to transcodeStartTime
      percent = ((transcodeStartTime + bufferedEnd) / currentFileDuration) * 100;
    } else {
      percent = (bufferedEnd / currentFileDuration) * 100;
    }
    
    timelineBuffered.style.width = `${Math.min(percent, 100)}%`;
  }
}

// -------------------------------------------------------------
// Scrubber seeks (Timeline dragging)
// -------------------------------------------------------------
function onTimelineInput() {
  isTimelineDragging = true;
  const percent = parseFloat(timelineSlider.value);
  timelineProgress.style.width = `${percent}%`;
  
  const targetTime = (percent / 100) * currentFileDuration;
  currentTimeLabel.textContent = formatTime(targetTime);
}

function onTimelineChange() {
  isTimelineDragging = false;
  if (!currentFilePath) return;

  const percent = parseFloat(timelineSlider.value);
  const targetTime = (percent / 100) * currentFileDuration;

  seekTo(targetTime);
}

function seekTo(targetTime) {
  if (isTranscoding) {
    // For transcode streams, seek requires restarting the ffmpeg stream at target time
    const isPlaying = !videoElement.paused;
    playVideo(currentFilePath, targetTime, isPlaying);
  } else {
    // Native files seek instantly inside video element
    videoElement.currentTime = targetTime;
  }
}

function seekRelative(seconds) {
  if (!currentFilePath) return;

  const currentSec = isTranscoding 
    ? (transcodeStartTime + videoElement.currentTime) 
    : videoElement.currentTime;

  let targetTime = currentSec + seconds;
  targetTime = Math.max(0, Math.min(targetTime, currentFileDuration));

  seekTo(targetTime);
}

// -------------------------------------------------------------
// Volume Controls
// -------------------------------------------------------------
function onVolumeSliderInput() {
  const vol = parseFloat(volumeSlider.value) / 100;
  videoElement.volume = vol;
  
  if (vol > 0) {
    videoElement.muted = false;
  }
  
  updateVolumeIcon();
  savePlaybackProgress();
}

function toggleMute() {
  videoElement.muted = !videoElement.muted;
  updateVolumeIcon();
}

function updateVolumeIcon() {
  if (videoElement.muted || videoElement.volume === 0) {
    iconVolumeHigh.classList.add('hidden');
    iconVolumeMuted.classList.remove('hidden');
    volumeSlider.value = 0;
  } else {
    iconVolumeHigh.classList.remove('hidden');
    iconVolumeMuted.classList.add('hidden');
    volumeSlider.value = Math.round(videoElement.volume * 100);
  }
}

function adjustVolumeRelative(delta) {
  let vol = videoElement.volume + delta;
  vol = Math.max(0, Math.min(vol, 1));
  videoElement.volume = vol;
  videoElement.muted = false;
  updateVolumeIcon();
  
  // Show visual hint in volume slider
  volumeSlider.value = Math.round(vol * 100);
  savePlaybackProgress();
}

// -------------------------------------------------------------
// Playback Speed
// -------------------------------------------------------------
function setPlaybackSpeed(rate) {
  playbackSpeed = rate;
  videoElement.playbackRate = rate;
  btnSpeed.textContent = `${rate}x`;
  
  document.querySelectorAll('.speed-option').forEach(option => {
    if (parseFloat(option.dataset.speed) === rate) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });
}

// -------------------------------------------------------------
// Fullscreen Control
// -------------------------------------------------------------
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    playerContainer.requestFullscreen().then(() => {
      iconFullscreenEnter.classList.add('hidden');
      iconFullscreenExit.classList.remove('hidden');
    }).catch(err => {
      console.error('Fullscreen request failed:', err);
    });
  } else {
    document.exitFullscreen().then(() => {
      iconFullscreenEnter.classList.remove('hidden');
      iconFullscreenExit.classList.add('hidden');
    });
  }
}

// Fullscreen escape key change listener
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    iconFullscreenEnter.classList.remove('hidden');
    iconFullscreenExit.classList.add('hidden');
  }
});

// -------------------------------------------------------------
// Keyboard Hotkeys
// -------------------------------------------------------------
function handleKeyboardShortcuts(e) {
  // If user is focused on search box, ignore hotkeys
  if (document.activeElement === searchInput) {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      seekRelative(-15);
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekRelative(15);
      break;
    case 'ArrowUp':
      e.preventDefault();
      adjustVolumeRelative(0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      adjustVolumeRelative(-0.05);
      break;
    case 'KeyF':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'KeyM':
      e.preventDefault();
      toggleMute();
      break;
  }
}

function togglePlayPause() {
  if (!currentFilePath) return;

  if (videoElement.paused) {
    videoElement.play();
  } else {
    videoElement.pause();
  }
}

// -------------------------------------------------------------
// Interactive Controls Auto-hide Overlays
// -------------------------------------------------------------
function triggerControlsVisibility() {
  showControls();
  
  if (controlsTimeout) {
    clearTimeout(controlsTimeout);
  }

  // Only hide if video is currently playing
  if (!videoElement.paused) {
    controlsTimeout = setTimeout(() => {
      // Check if mouse is currently over bottom panel elements or speed dropdown
      const isHoveringControlsBottom = document.querySelector('.controls-bottom:hover');
      const isHoveringControlsTop = document.querySelector('.controls-top:hover');
      
      if (!isHoveringControlsBottom && !isHoveringControlsTop && !speedDropdown.classList.contains('visible')) {
        hideControls();
      } else {
        // Keep checking
        triggerControlsVisibility();
      }
    }, 2500);
  }
}

function showControls() {
  controlsOverlay.classList.remove('hidden');
  playerContainer.style.cursor = 'default';
}

function hideControls() {
  controlsOverlay.classList.add('hidden');
  playerContainer.style.cursor = 'none';
}

// -------------------------------------------------------------
// Loading overlay helper
// -------------------------------------------------------------
function showLoading(text) {
  loadingText.textContent = text;
  loadingOverlay.classList.add('visible');
}

// Global hook to hide loading
window.hideGlobalLoading = () => {
  hideLoading();
};

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

// ========================================================
// Bilibili 登录与下载器前端逻辑 (Bilibili Frontend Logic)
// ========================================================

let biliLoginPollInterval = null;
let biliQrcodeKey = null;
let parsedEpisodesList = [];
let selectedEpisodesSet = new Set();
let parsedCollectionTitle = '';
let parsedCollectionType = 'single';

function initBilibiliDownloader() {
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const btnBackToPlayer = document.getElementById('btn-back-to-player');
  const downloaderView = document.getElementById('downloader-view');
  
  const btnBiliLogin = document.getElementById('btn-bili-login');
  const btnBiliLogout = document.getElementById('btn-bili-logout');
  const biliLoginModal = document.getElementById('bili-login-modal');
  const btnCloseLoginModal = document.getElementById('btn-close-login-modal');
  const btnRefreshQrcode = document.getElementById('btn-refresh-qrcode');
  
  const btnParseBili = document.getElementById('btn-parse-bili');
  const biliUrlInput = document.getElementById('bili-url-input');
  
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  const chkHeadSelect = document.getElementById('chk-head-select');
  const btnStartDownload = document.getElementById('btn-start-download');
  const btnClearCompletedTasks = document.getElementById('btn-clear-completed-tasks');

  // Toggle View
  if (btnToggleDownloader && downloaderView) {
    btnToggleDownloader.addEventListener('click', () => {
      btnToggleDownloader.classList.add('active');
      playerContainer.classList.add('hidden');
      downloaderView.classList.remove('hidden');
      videoElement.pause(); // 切换时自动暂停视频
      updateSavePathLabel();
      refreshTasksList();
    });
  }

  if (btnBackToPlayer && downloaderView) {
    btnBackToPlayer.addEventListener('click', () => {
      btnToggleDownloader.classList.remove('active');
      downloaderView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    });
  }

  // QR Login triggers
  if (btnBiliLogin) {
    btnBiliLogin.addEventListener('click', showBiliLoginModal);
  }
  if (btnCloseLoginModal) {
    btnCloseLoginModal.addEventListener('click', hideBiliLoginModal);
  }
  if (btnRefreshQrcode) {
    btnRefreshQrcode.addEventListener('click', showBiliLoginModal);
  }
  if (btnBiliLogout) {
    btnBiliLogout.addEventListener('click', handleBiliLogout);
  }

  // URL Parse
  if (btnParseBili && biliUrlInput) {
    btnParseBili.addEventListener('click', parseBiliUrl);
    biliUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') parseBiliUrl();
    });
  }

  // Selection actions
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      chkHeadSelect.checked = true;
      toggleAllEpisodesSelection(true);
    });
  }
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      chkHeadSelect.checked = false;
      toggleAllEpisodesSelection(false);
    });
  }
  if (chkHeadSelect) {
    chkHeadSelect.addEventListener('change', (e) => {
      toggleAllEpisodesSelection(e.target.checked);
    });
  }

  // Start Download
  if (btnStartDownload) {
    btnStartDownload.addEventListener('click', startBiliDownload);
  }

  // Clear completed tasks
  if (btnClearCompletedTasks) {
    btnClearCompletedTasks.addEventListener('click', clearCompletedTasksFromUI);
  }

  // IPC progress receiver
  ipcRenderer.on('download-task-update', (event, task) => {
    renderTaskItem(task);
  });

  // IPC directory tree rescan receiver
  ipcRenderer.on('rescan-directory', async (event, savePath) => {
    if (savePath === currentDirectory) {
      const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
      if (tree) {
        renderDirectoryTree(tree);
      }
    }
  });

  // Query Profile on Startup
  checkBiliProfile();
  updateSavePathLabel();
  refreshTasksList();
}

// -------------------------------------------------------------
// Bilibili Profile Card & Logout
// -------------------------------------------------------------
async function checkBiliProfile() {
  const profile = await ipcRenderer.invoke('bili-get-profile');
  const biliAvatar = document.getElementById('bili-avatar');
  const biliName = document.getElementById('bili-name');
  const biliStatus = document.getElementById('bili-status');
  const btnBiliLogin = document.getElementById('btn-bili-login');
  const btnBiliLogout = document.getElementById('btn-bili-logout');

  if (profile && profile.isLogin) {
    biliAvatar.innerHTML = `<img src="${profile.face}" alt="avatar">`;
    biliName.textContent = profile.uname;
    biliStatus.textContent = '大会员/高清下载已解锁';
    biliStatus.style.color = '#fb7299';
    btnBiliLogin.classList.add('hidden');
    btnBiliLogout.classList.remove('hidden');
  } else {
    biliAvatar.innerHTML = `
      <svg class="avatar-placeholder" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path>
      </svg>
    `;
    biliName.textContent = '未登录 B 站';
    biliStatus.textContent = '无法下载高清视频';
    biliStatus.style.color = '';
    btnBiliLogin.classList.remove('hidden');
    btnBiliLogout.classList.add('hidden');
  }
}

async function handleBiliLogout() {
  await ipcRenderer.invoke('save-history', { sessdata: null });
  checkBiliProfile();
}

// -------------------------------------------------------------
// Bilibili QR code Login Actions
// -------------------------------------------------------------
async function showBiliLoginModal() {
  const modal = document.getElementById('bili-login-modal');
  const qrcodeOverlay = document.getElementById('qrcode-overlay');
  const biliQrcode = document.getElementById('bili-qrcode');
  
  qrcodeOverlay.classList.add('hidden');
  biliQrcode.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">正在生成二维码...</span>';
  modal.classList.remove('hidden');

  const qrcodeData = await ipcRenderer.invoke('bili-get-qrcode');
  if (qrcodeData && qrcodeData.url) {
    biliQrcodeKey = qrcodeData.qrcode_key;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrcodeData.url)}`;
    biliQrcode.innerHTML = `<img src="${qrUrl}" alt="Scan Me">`;
    
    // Poll Login Status
    if (biliLoginPollInterval) clearInterval(biliLoginPollInterval);
    biliLoginPollInterval = setInterval(pollBiliLoginStatus, 3000);
  } else {
    biliQrcode.innerHTML = '<span style="color:#ef4444; font-size:12px;">生成二维码失败，请关闭重试</span>';
  }
}

function hideBiliLoginModal() {
  const modal = document.getElementById('bili-login-modal');
  modal.classList.add('hidden');
  if (biliLoginPollInterval) {
    clearInterval(biliLoginPollInterval);
    biliLoginPollInterval = null;
  }
}

async function pollBiliLoginStatus() {
  if (!biliQrcodeKey) return;
  
  const pollRes = await ipcRenderer.invoke('bili-poll-login', biliQrcodeKey);
  const qrcodeOverlay = document.getElementById('qrcode-overlay');
  const qrcodeStatusText = document.getElementById('qrcode-status-text');
  
  if (pollRes.success) {
    hideBiliLoginModal();
    // Save SESSDATA cookie to history
    await ipcRenderer.invoke('save-history', { sessdata: pollRes.sessdata });
    await checkBiliProfile();
  } else {
    const code = pollRes.code;
    if (code === 86038) {
      // Expired
      clearInterval(biliLoginPollInterval);
      biliLoginPollInterval = null;
      qrcodeStatusText.textContent = '二维码已过期';
      qrcodeOverlay.classList.remove('hidden');
    } else if (code === 86090) {
      // Scanned but not confirmed
      const modalSubtitle = document.querySelector('.modal-subtitle');
      if (modalSubtitle) modalSubtitle.textContent = '已扫描，请在手机上点击确认';
    }
  }
}

// -------------------------------------------------------------
// Download Workbench Actions & UI Rendering
// -------------------------------------------------------------
function updateSavePathLabel() {
  const lblSavePath = document.getElementById('lbl-save-path');
  if (lblSavePath) {
    lblSavePath.textContent = currentDirectory ? currentDirectory : '系统下载目录';
  }
}

async function parseBiliUrl() {
  const input = document.getElementById('bili-url-input');
  const url = input.value.trim();
  if (!url) return;

  showLoading('正在解析 B站 链接，请稍候...');
  
  try {
    const parsed = await ipcRenderer.invoke('bili-parse-url', url);
    const resultsSection = document.getElementById('parsed-results-section');
    const lblCollectionTitle = document.getElementById('lbl-collection-title');
    const episodesTbody = document.getElementById('episodes-tbody');
    
    // Save to state
    parsedEpisodesList = parsed.videos || [];
    selectedEpisodesSet = new Set(parsedEpisodesList.map(v => v.cid));
    parsedCollectionTitle = parsed.title || '';
    parsedCollectionType = parsed.type || 'single';
    
    lblCollectionTitle.textContent = parsed.title || '已解析视频';
    episodesTbody.innerHTML = '';
    
    parsedEpisodesList.forEach(video => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="chk-episode" data-cid="${video.cid}" checked></td>
        <td>P${video.index}</td>
        <td class="video-title-td" style="font-weight: 500;">${video.title}</td>
        <td style="text-align: right; color: var(--text-muted); font-size: 11px;">待下载</td>
      `;
      episodesTbody.appendChild(tr);
    });

    // Attach listeners to checks
    document.querySelectorAll('.chk-episode').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const cid = parseInt(e.target.dataset.cid);
        if (e.target.checked) {
          selectedEpisodesSet.add(cid);
        } else {
          selectedEpisodesSet.delete(cid);
        }
        updateSelectedCountLabel();
      });
    });

    updateSelectedCountLabel();
    resultsSection.classList.remove('hidden');
    input.value = ''; // clean input
    
  } catch (err) {
    alert('解析链接失败: ' + err.message);
  } finally {
    hideLoading();
  }
}

function toggleAllEpisodesSelection(checked) {
  document.querySelectorAll('.chk-episode').forEach(chk => {
    chk.checked = checked;
    const cid = parseInt(chk.dataset.cid);
    if (checked) {
      selectedEpisodesSet.add(cid);
    } else {
      selectedEpisodesSet.delete(cid);
    }
  });
  updateSelectedCountLabel();
}

function updateSelectedCountLabel() {
  const lblCount = document.getElementById('lbl-selected-count');
  if (lblCount) {
    lblCount.textContent = `已选中 ${selectedEpisodesSet.size} / ${parsedEpisodesList.length} 项`;
  }
}

async function startBiliDownload() {
  if (selectedEpisodesSet.size === 0) {
    alert('请先勾选需要下载的选集');
    return;
  }

  const episodesToDownload = parsedEpisodesList.filter(v => selectedEpisodesSet.has(v.cid));
  const quality = document.getElementById('bili-quality-select').value;
  
  const resultsSection = document.getElementById('parsed-results-section');
  resultsSection.classList.add('hidden'); // hide workbench select
  
  await ipcRenderer.invoke('bili-start-download', {
    episodes: episodesToDownload,
    quality: quality,
    savePath: currentDirectory || null,
    collectionTitle: parsedCollectionTitle,
    collectionType: parsedCollectionType
  });

  refreshTasksList();
}

async function refreshTasksList() {
  const tasks = await ipcRenderer.invoke('bili-get-tasks');
  const container = document.getElementById('tasks-container');
  const placeholder = document.getElementById('queue-empty-placeholder');
  
  if (tasks.length > 0) {
    if (placeholder) placeholder.classList.add('hidden');
    tasks.forEach(task => renderTaskItem(task));
  } else {
    if (placeholder) placeholder.classList.remove('hidden');
    // Clear list
    container.innerHTML = '';
    container.appendChild(placeholder);
  }
}

function renderTaskItem(task) {
  let taskEl = document.getElementById(`task-item-${task.id}`);
  if (!taskEl) {
    taskEl = document.createElement('div');
    taskEl.id = `task-item-${task.id}`;
    taskEl.className = 'task-item';
    
    const container = document.getElementById('tasks-container');
    const placeholder = document.getElementById('queue-empty-placeholder');
    if (placeholder) placeholder.classList.add('hidden');
    container.appendChild(taskEl);
  }
  
  const formatSize = (bytes) => {
    if (!bytes) return '0.0 MB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  
  const downloadedStr = formatSize(task.bytesDownloaded);
  const totalStr = formatSize(task.bytesTotal);
  
  let statusText = '等待中';
  let statusClass = 'pending';
  let barFillClass = '';
  
  if (task.status === 'downloading') {
    statusText = `下载中 (${task.progress}%)`;
    statusClass = 'downloading';
  } else if (task.status === 'merging') {
    statusText = '合并音视频轨...';
    statusClass = 'merging';
    barFillClass = 'merging';
  } else if (task.status === 'completed') {
    statusText = '已完成';
    statusClass = 'completed';
    barFillClass = 'completed';
  } else if (task.status === 'failed') {
    statusText = '下载失败';
    statusClass = 'failed';
    barFillClass = 'failed';
  } else if (task.status === 'paused') {
    statusText = '已暂停';
    statusClass = 'paused';
  }
  
  let actionHtml = '';
  if (task.status === 'pending' || task.status === 'downloading' || task.status === 'merging') {
    actionHtml = `
      <button class="btn-task-action delete" onclick="cancelBiliTask('${task.id}')" title="取消任务">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
  } else {
    actionHtml = `
      <button class="btn-task-action delete" onclick="removeBiliTaskFromUI('${task.id}')" title="清除记录">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;
  }
  
  taskEl.innerHTML = `
    <div class="task-meta">
      <div class="task-title-info">
        <span class="task-title" title="${task.partTitle || task.title}">${task.partTitle || task.title}</span>
        <span class="task-subtitle">${task.bvid} | CID: ${task.cid}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="task-status-tag ${statusClass}">${statusText}</span>
        <div class="task-item-actions">
          ${actionHtml}
        </div>
      </div>
    </div>
    <div class="task-progress-section">
      <div class="task-progress-bar-bg">
        <div class="task-progress-bar-fill ${barFillClass}" style="width: ${task.progress}%"></div>
      </div>
      <span class="task-stats">
        ${task.status === 'downloading' ? `${task.speed} MB/s | ` : ''}
        ${downloadedStr}/${totalStr}
      </span>
    </div>
  `;
}

// Expose actions to window for onclick triggers
window.cancelBiliTask = async (taskId) => {
  await ipcRenderer.invoke('bili-cancel-task', taskId);
  refreshTasksList();
};

window.removeBiliTaskFromUI = (taskId) => {
  const taskEl = document.getElementById(`task-item-${taskId}`);
  if (taskEl) taskEl.remove();
  
  const container = document.getElementById('tasks-container');
  const taskItems = container.querySelectorAll('.task-item');
  if (taskItems.length === 0) {
    const placeholder = document.getElementById('queue-empty-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
  }
};

async function clearCompletedTasksFromUI() {
  const tasks = await ipcRenderer.invoke('bili-get-tasks');
  tasks.forEach(task => {
    if (task.status === 'completed' || task.status === 'failed') {
      window.removeBiliTaskFromUI(task.id);
    }
  });
}


