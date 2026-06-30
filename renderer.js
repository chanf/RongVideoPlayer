const { ipcRenderer } = require('electron');
const path = require('path');

// State
let currentDirectory = '';
let lastRenderedRootPath = '';
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
let currentDetailCollection = null;
let communityCollections = [];
let communityCategories = [];
let screenshotsDB = { categories: [], screenshots: [] };
let folderCategories = {}; // { [folderPath]: categoryId }

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
const btnScreenshot = document.getElementById('btn-screenshot');
const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
const screenshotsView = document.getElementById('screenshots-view');

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadHistoryAndResume();
  initBilibiliDownloader();
  initOnlineCommunity();
  initScreenshotsLibrary();
  initSettings();
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
  
  if (history.folderCategories) {
    folderCategories = history.folderCategories;
  }
  
  // Load screenshots DB so categories are available for rendering badges
  screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
  
  // Read autoResume setting first
  const autoResume = localStorage.getItem('rong_setting_auto_resume_folder') !== 'false';
  
  if (autoResume && history.lastDirectory) {
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

  // Default Playback Speed
  const defaultSpeed = localStorage.getItem('rong_setting_default_speed');
  if (defaultSpeed) {
    playbackSpeed = parseFloat(defaultSpeed);
    const btnSpeed = document.getElementById('btn-speed');
    if (btnSpeed) {
      btnSpeed.textContent = defaultSpeed === '1.0' ? '1.0x' : `${defaultSpeed}x`;
    }
    document.querySelectorAll('.speed-option').forEach(option => {
      if (option.dataset.speed === defaultSpeed) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
  }

  // Restore last played file and progress
  if (autoResume && history.lastPlayedFile && history.lastProgress !== undefined) {
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
    theme: currentTheme,
    folderCategories: folderCategories
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

  recentList.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <button class="btn-delete-recent" title="删除记录">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
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
      // 进度接近播完（>= 98%）时从头开始，避免续播到结尾导致无法播放
      const startSec = item.progress >= 98 ? 0 : item.time;
      playVideo(item.path, startSec, true);
    });

    const btnDelete = div.querySelector('.btn-delete-recent');
    if (btnDelete) {
      btnDelete.addEventListener('click', async (e) => {
        e.stopPropagation(); // Avoid triggering video launch
        await deleteRecentItem(index);
      });
    }

    recentListContainer.appendChild(div);
  });
}

async function deleteRecentItem(index) {
  const deletedItem = recentList[index];
  recentList.splice(index, 1);
  renderRecentList();
  
  // 删除卡片即清除该视频的播放进度记录：若它正是上次播放的文件，一并清空启动续播字段
  const historyUpdate = { recentList: recentList };
  if (deletedItem && deletedItem.path) {
    const history = await ipcRenderer.invoke('get-history');
    if (history && history.lastPlayedFile === deletedItem.path) {
      historyUpdate.lastPlayedFile = '';
      historyUpdate.lastProgress = 0;
    }
  }

  // Persist to history json
  await ipcRenderer.invoke('save-history', historyUpdate);
  
  // Update UI directory tree folder progress indicators
  if (currentDirectoryTree) {
    renderDirectoryTree(currentDirectoryTree);
  }
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

  const isNewRoot = lastRenderedRootPath !== tree.path;
  lastRenderedRootPath = tree.path;

  // Render children of root directly at depth 0
  tree.children.forEach(child => {
    const childElement = createTreeNodeDOM(child, 0);
    directoryTree.appendChild(childElement);
    
    // Auto-expand first-level directories if we are loading a new root directory
    if (isNewRoot && child.type === 'directory') {
      expandedFolders.add(child.path);
    }
  });
  
  // Restore expanded folders states
  restoreFolderExpandedStates(directoryTree);
  
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

  // Add Category Badge if categorized
  const resolvedCatId = resolveCategoryForPath(node.path);
  if (resolvedCatId !== 'uncategorized' && screenshotsDB && screenshotsDB.categories) {
    const cat = screenshotsDB.categories.find(c => c.id === resolvedCatId);
    if (cat) {
      const isExplicit = folderCategories[node.path] === resolvedCatId;
      const badge = document.createElement('span');
      badge.className = 'tree-cat-badge';
      if (!isExplicit) {
        badge.classList.add('inherited');
        badge.title = `继承自上级分类: ${cat.name}`;
      } else {
        badge.title = `分类: ${cat.name}`;
      }
      badge.textContent = cat.name;
      itemDiv.appendChild(badge);
    }
  }

  // Hook up directory specific Finder open events, hover buttons and Context Menu
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

    // Context Menu event listener
    itemDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close existing menu
      if (currentContextMenu) {
        currentContextMenu.remove();
        currentContextMenu = null;
      }
      
      // Build context menu
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      
      // 1. Open in Finder
      const itemFinder = document.createElement('div');
      itemFinder.className = 'context-menu-item';
      itemFinder.textContent = '在 Finder 中打开';
      itemFinder.addEventListener('click', () => {
        ipcRenderer.invoke('open-in-finder', node.path);
      });
      menu.appendChild(itemFinder);
      
      // 2. Delete
      const itemDelete = document.createElement('div');
      itemDelete.className = 'context-menu-item';
      itemDelete.style.color = '#ef4444';
      itemDelete.textContent = '删除目录';
      itemDelete.addEventListener('click', async () => {
        if (confirm(`警告：确认要彻底删除目录 "${node.name}" 及其所有子目录和视频文件吗？此操作不可逆！`)) {
          const success = await ipcRenderer.invoke('delete-directory-folder', node.path);
          if (success) {
            // Re-scan parent tree or reload directory
            if (currentDirectory) {
              const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
              if (tree) renderDirectoryTree(tree);
            }
          } else {
            alert('删除目录失败，请检查目录权限或文件是否被占用。');
          }
        }
      });
      menu.appendChild(itemDelete);
      
      // Separator
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      
      // 3. Set Category (with submenu)
      const itemCat = document.createElement('div');
      itemCat.className = 'context-menu-item has-submenu';
      itemCat.innerHTML = `
        <span>设置分类</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:10px; height:10px; opacity: 0.6;">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;
      
      const submenu = document.createElement('div');
      submenu.className = 'context-menu-submenu';
      
      // Retrieve current folder category
      const currentCatId = resolveCategoryForPath(node.path);
      const isExplicitSelf = folderCategories[node.path] === currentCatId;
      
      // Submenu option: Uncategorized (to clear category)
      const subUncat = document.createElement('div');
      subUncat.className = 'context-menu-item';
      subUncat.textContent = '清除分类 (未分类)';
      if (!folderCategories[node.path]) {
        subUncat.style.fontWeight = 'bold';
        subUncat.textContent += ' ✓';
      }
      subUncat.addEventListener('click', () => {
        setFolderCategory(node.path, 'uncategorized');
      });
      submenu.appendChild(subUncat);
      
      if (screenshotsDB && screenshotsDB.categories && screenshotsDB.categories.length > 0) {
        const subSep = document.createElement('div');
        subSep.className = 'context-menu-separator';
        submenu.appendChild(subSep);
      }
      
      // Load current categories from screenshotsDB
      if (screenshotsDB && screenshotsDB.categories) {
        screenshotsDB.categories.forEach(cat => {
          if (cat.id === 'uncategorized') return;
          
          const subItem = document.createElement('div');
          subItem.className = 'context-menu-item';
          subItem.textContent = cat.name;
          if (isExplicitSelf && currentCatId === cat.id) {
            subItem.style.fontWeight = 'bold';
            subItem.textContent += ' ✓';
          }
          subItem.addEventListener('click', () => {
            setFolderCategory(node.path, cat.id);
          });
          submenu.appendChild(subItem);
        });
      }
      
      itemCat.appendChild(submenu);
      menu.appendChild(itemCat);
      
      document.body.appendChild(menu);
      currentContextMenu = menu;
      
      // Keep menu inside window bounds
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 5}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 5}px`;
      }
    });
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

// -------------------------------------------------------------
// Folder Categories & Context Menu Helpers
// -------------------------------------------------------------
let currentContextMenu = null;

window.addEventListener('click', () => {
  if (currentContextMenu) {
    currentContextMenu.remove();
    currentContextMenu = null;
  }
});

window.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.tree-item')) {
    if (currentContextMenu) {
      currentContextMenu.remove();
      currentContextMenu = null;
    }
  }
});

function resolveCategoryForPath(targetPath) {
  if (!targetPath) return 'uncategorized';
  let currentDir = targetPath;
  
  if (path.extname(targetPath)) {
    currentDir = path.dirname(targetPath);
  }
  
  while (currentDir && currentDir !== '.' && currentDir !== '/' && currentDir !== path.dirname(currentDir)) {
    if (folderCategories[currentDir]) {
      return folderCategories[currentDir];
    }
    currentDir = path.dirname(currentDir);
  }
  if (currentDir && folderCategories[currentDir]) {
    return folderCategories[currentDir];
  }
  return 'uncategorized';
}

function isPathUnderFolder(childPath, parentPath) {
  if (childPath === parentPath) return true;
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function updateScreenshotsCategoryForFolder(folderPath, newCategoryId) {
  let dbChanged = false;
  if (screenshotsDB && screenshotsDB.screenshots) {
    screenshotsDB.screenshots.forEach(s => {
      if (s.videoPath && isPathUnderFolder(s.videoPath, folderPath)) {
        s.categoryId = newCategoryId;
        dbChanged = true;
      }
    });
  }
  if (dbChanged) {
    await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
  }
}

async function setFolderCategory(folderPath, categoryId) {
  if (categoryId === 'uncategorized') {
    delete folderCategories[folderPath];
  } else {
    folderCategories[folderPath] = categoryId;
  }
  
  // Persist to history
  await ipcRenderer.invoke('save-history', { folderCategories });
  
  // Cascade to screenshots
  await updateScreenshotsCategoryForFolder(folderPath, categoryId);
  
  // Refresh screenshots view
  if (typeof refreshScreenshotsUI === 'function') {
    refreshScreenshotsUI();
  }
  
  // Refresh directory tree
  if (currentDirectory) {
    const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
    if (tree) renderDirectoryTree(tree);
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
  // If playing a direct HTTP/HTTPS URL
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    const downloaderView = document.getElementById('downloader-view');
    const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
    const communityView = document.getElementById('community-view');
    const btnToggleCommunity = document.getElementById('btn-toggle-community');
    const playerContainer = document.getElementById('player-container');
    
    if (downloaderView && !downloaderView.classList.contains('hidden')) {
      if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
      downloaderView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    }
    if (communityView && !communityView.classList.contains('hidden')) {
      if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
      communityView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    }
    const screenshotsView = document.getElementById('screenshots-view');
    const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
    if (screenshotsView && !screenshotsView.classList.contains('hidden')) {
      if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');
      screenshotsView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    }

    showLoading('正在缓冲网络流媒体...');
    stopHistorySaveTimer();

    currentFilePath = filePath;
    currentFileDuration = 0; // Will be resolved by video element metadata
    isTranscoding = false;
    transcodeStartTime = startSec;

    // UI Updates
    videoTitle.textContent = filePath.substring(filePath.lastIndexOf('/') + 1) || '网络流媒体';
    transcodeTag.classList.add('hidden');

    videoElement.src = filePath;
    videoElement.load();
    
    if (autoplay) {
      videoElement.play().then(() => {
        startHistorySaveTimer();
      }).catch(err => {
        console.warn('Autoplay blocked:', err);
      });
    }
    hideLoading();
    return;
  }

  // 如果当前下载界面或社区界面是开启的，直接切换回播放器界面（后台下载将自动静默运行）
  const downloaderView = document.getElementById('downloader-view');
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const communityView = document.getElementById('community-view');
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  const playerContainer = document.getElementById('player-container');
  
  if (downloaderView && !downloaderView.classList.contains('hidden')) {
    if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
    downloaderView.classList.add('hidden');
    playerContainer.classList.remove('hidden');
  }
  if (communityView && !communityView.classList.contains('hidden')) {
    if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
    communityView.classList.add('hidden');
    playerContainer.classList.remove('hidden');
  }
  const screenshotsView = document.getElementById('screenshots-view');
  const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
  if (screenshotsView && !screenshotsView.classList.contains('hidden')) {
    if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');
    screenshotsView.classList.add('hidden');
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

  // Apply default or current playback speed to the video
  videoElement.playbackRate = playbackSpeed;

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
  // If Lightbox is open, handle Arrow keys and Escape for image navigation
  const lightboxModal = document.getElementById('lightbox-modal');
  if (lightboxModal && !lightboxModal.classList.contains('hidden')) {
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      const btnPrev = document.getElementById('btn-lightbox-prev');
      if (btnPrev && btnPrev.style.display !== 'none') {
        btnPrev.click();
      }
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      const btnNext = document.getElementById('btn-lightbox-next');
      if (btnNext && btnNext.style.display !== 'none') {
        btnNext.click();
      }
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      const btnClose = document.getElementById('btn-close-lightbox');
      if (btnClose) btnClose.click();
      return;
    }
  }

  // If user is focused on any input or textarea, ignore hotkeys
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    return;
  }

  // Capture Option + 1 (Alt + 1) for Screenshot
  if (e.altKey && e.code === 'Digit1') {
    e.preventDefault();
    captureVideoFrame();
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
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  const communityView = document.getElementById('community-view');
  
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
  const btnPauseAllTasks = document.getElementById('btn-pause-all-tasks');
  const btnStartAllTasks = document.getElementById('btn-start-all-tasks');

  // Toggle View
  if (btnToggleDownloader && downloaderView) {
    btnToggleDownloader.addEventListener('click', () => {
      btnToggleDownloader.classList.add('active');
      if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
      if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');
      const btnToggleSettings = document.getElementById('btn-toggle-settings');
      if (btnToggleSettings) btnToggleSettings.classList.remove('active');
      
      playerContainer.classList.add('hidden');
      if (communityView) communityView.classList.add('hidden');
      if (screenshotsView) screenshotsView.classList.add('hidden');
      const settingsView = document.getElementById('settings-view');
      if (settingsView) settingsView.classList.add('hidden');
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

  // Pause all tasks
  if (btnPauseAllTasks) {
    btnPauseAllTasks.addEventListener('click', async () => {
      await ipcRenderer.invoke('bili-pause-all');
      refreshTasksList();
    });
  }

  // Start/Resume all tasks
  if (btnStartAllTasks) {
    btnStartAllTasks.addEventListener('click', async () => {
      await ipcRenderer.invoke('bili-start-all');
      refreshTasksList();
    });
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
  updateSubfolderList();
}

async function updateSubfolderList() {
  const select = document.getElementById('bili-subfolder-select');
  if (!select) return;
  
  // Clear options but keep the default one
  select.innerHTML = '<option value="">-- 直接下载到根目录 --</option>';
  
  const customPath = localStorage.getItem('rong_setting_download_path') || null;
  const baseDir = currentDirectory || customPath;
  
  try {
    const subdirs = await ipcRenderer.invoke('list-subdirectories', baseDir);
    if (subdirs && subdirs.length > 0) {
      subdirs.forEach(dir => {
        const opt = document.createElement('option');
        opt.value = dir;
        opt.textContent = dir;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to update subfolder list:', e);
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
  
  const customPath = localStorage.getItem('rong_setting_download_path') || null;
  const subfolderSelect = document.getElementById('bili-subfolder-select');
  const subFolder = subfolderSelect ? subfolderSelect.value : '';

  await ipcRenderer.invoke('bili-start-download', {
    episodes: episodesToDownload,
    quality: quality,
    savePath: currentDirectory || customPath,
    subFolder: subFolder,
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
  
  let warningHtml = '';
  if (task.warning) {
    warningHtml = `<div class="task-warning-text" style="color: #eab308; font-size: 11px; margin-top: 4px; text-align: left; line-height: 1.4;">⚠️ ${task.warning}</div>`;
  }
  
  let errorHtml = '';
  if (task.status === 'failed' && task.error) {
    errorHtml = `<div class="task-error-text" style="color: #ef4444; font-size: 11px; margin-top: 4px; text-align: left; line-height: 1.4; white-space: pre-wrap; word-break: break-all;">❌ ${task.error}</div>`;
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
      ${warningHtml}
      ${errorHtml}
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

function initOnlineCommunity() {
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  const btnCommunityBackToPlayer = document.getElementById('btn-community-back-to-player');
  const communityView = document.getElementById('community-view');
  const playerContainer = document.getElementById('player-container');
  const downloaderView = document.getElementById('downloader-view');
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
  const screenshotsView = document.getElementById('screenshots-view');
  
  // Category tabs & search
  const categoryTabs = document.getElementById('community-category-tabs');
  const sortSelect = document.getElementById('community-sort-select');
  const searchInput = document.getElementById('community-search-input');
  const gridContainer = document.getElementById('community-grid');
  
  // Detail Modal
  const detailModal = document.getElementById('collection-detail-modal');
  const btnCloseDetail = document.getElementById('btn-close-detail-modal');
  const detailCover = document.getElementById('detail-cover-img');
  const detailCat = document.getElementById('detail-cat-tag');
  const detailTitle = document.getElementById('detail-title');
  const detailCreator = document.getElementById('detail-creator');
  const btnDetailPlay = document.getElementById('btn-detail-play-all');
  const btnDetailDownload = document.getElementById('btn-detail-download-all');
  const btnDetailLike = document.getElementById('btn-detail-like');
  const detailLikesCount = document.getElementById('detail-likes-count');
  const detailDesc = document.getElementById('detail-desc');
  const detailEpCount = document.getElementById('detail-episode-count');
  const detailEpList = document.getElementById('detail-episodes-list');
  
  // Share Modal
  const shareModal = document.getElementById('share-collection-modal');
  const btnCloseShare = document.getElementById('btn-close-share-modal');
  const btnShareOpen = document.getElementById('btn-share-collection');
  const btnShareCancel = document.getElementById('btn-cancel-share');
  const shareForm = document.getElementById('share-collection-form');
  const sourceTypeSelect = document.getElementById('share-source-type');
  const biliContainer = document.getElementById('source-bili-container');
  const customContainer = document.getElementById('source-custom-container');
  
  // Admin Modal
  const adminModal = document.getElementById('admin-modal');
  const btnCloseAdmin = document.getElementById('btn-close-admin-modal');
  const btnAdminOpen = document.getElementById('btn-admin-entrance');
  const adminLoginScreen = document.getElementById('admin-login-screen');
  const adminLoginForm = document.getElementById('admin-login-form');
  const adminDashboardScreen = document.getElementById('admin-dashboard-screen');
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  const adminTabPending = document.getElementById('admin-tab-pending');
  const adminTabApproved = document.getElementById('admin-tab-approved');
  const adminTabCategories = document.getElementById('admin-tab-categories');
  const adminPendingCount = document.getElementById('admin-pending-count');
  const adminApprovedCount = document.getElementById('admin-approved-count');
  const adminEmpty = document.getElementById('admin-empty-placeholder');
  const adminList = document.getElementById('admin-list-container');
  
  const shareCategory = document.getElementById('share-category');
  
  let selectedCategory = 'all';
  let searchQuery = '';
  let activeAdminTab = 'pending';
  let isAdminAuthenticated = false;
  
  // Load or initialize categories database
  const defaultCategories = [
    { id: 'study', name: '科技商务' },
    { id: 'academic', name: '学术研讨' },
    { id: 'entertainment', name: '影音娱乐' },
    { id: 'anime', name: '国漫番剧' },
    { id: 'life', name: '日常生活' }
  ];

  const storedCategories = localStorage.getItem('rong_community_categories');
  if (storedCategories) {
    try {
      communityCategories = JSON.parse(storedCategories);
    } catch(e) {
      communityCategories = [...defaultCategories];
    }
  } else {
    communityCategories = [...defaultCategories];
    localStorage.setItem('rong_community_categories', JSON.stringify(communityCategories));
  }
  
  // Render functions
  function renderCommunityCategoryTabs() {
    if (!categoryTabs) return;
    categoryTabs.innerHTML = `<div class="category-tab ${selectedCategory === 'all' ? 'active' : ''}" data-category="all">全部</div>`;
    communityCategories.forEach(cat => {
      categoryTabs.innerHTML += `<div class="category-tab ${selectedCategory === cat.id ? 'active' : ''}" data-category="${cat.id}">${cat.name}</div>`;
    });
  }

  function renderShareCategoryOptions() {
    if (!shareCategory) return;
    shareCategory.innerHTML = '';
    communityCategories.forEach(cat => {
      shareCategory.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
    });
  }

  // Run initial renders
  renderCommunityCategoryTabs();
  renderShareCategoryOptions();

  // Define default mock database of collections (if not already stored in localStorage)
  const storedCollections = localStorage.getItem('rong_community_collections');
  if (storedCollections) {
    try {
      communityCollections = JSON.parse(storedCollections);
    } catch(e) {
      console.error(e);
    }
  }
  
  if (!communityCollections || communityCollections.length === 0) {
    communityCollections = [
      {
        id: 1,
        title: "B站最强 Rust 语言基础教程",
        description: "精选自B站系列基础教程，适合零基础极速入门 Rust 程序设计与高级所有权机制，包含丰富的编码实战演练。",
        cover_url: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=400&q=80",
        category: "study",
        creator: "Rust工程师",
        likes: 42,
        imports: 120,
        status: "approved",
        items: [
          { title: "P1 Rust 安装与编译环境配置", index: 1, bvid: "BV1Y7411K7Jd", cid: "16578491" },
          { title: "P2 Rust 基础语法：变量与所有权", index: 2, bvid: "BV1Y7411K7Jd", cid: "16578920" },
          { title: "P3 Rust 复合数据类型：Struct & Enum", index: 3, bvid: "BV1Y7411K7Jd", cid: "16579344" }
        ]
      },
      {
        id: 2,
        title: "Web前端 HTML5/CSS3 动画特效实战",
        description: "收集了前端开发的经典 Canvas 动画、SVG 微交互、3D 翻转卡片等高级视觉动效实战教程。",
        cover_url: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=400&q=80",
        category: "study",
        creator: "前端大师",
        likes: 28,
        imports: 95,
        status: "approved",
        items: [
          { title: "P1 极其优雅的毛玻璃渐变卡片悬停动效", index: 1, bvid: "BV1xx411xx", cid: "111223" },
          { title: "P2 CSS3 Grid 栅格布局弹性卡片实战", index: 2, bvid: "BV1xx411xx", cid: "111224" }
        ]
      },
      {
        id: 3,
        title: "经典科幻电影预告直链合集",
        description: "本合集分享了多部好莱坞科幻巨作的高清预告片直链，采用 m3u8 与 mp4 直链，支持一键流畅秒播测试。",
        cover_url: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80",
        category: "entertainment",
        creator: "影评人",
        likes: 15,
        imports: 34,
        status: "approved",
        items: [
          { title: "Sintel 开源电影高清演示片 (MP4 直链)", index: 1, url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4" },
          { title: "Big Buck Bunny 经典动画测试片 (MP4 直链)", index: 2, url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
        ]
      },
      {
        id: 4,
        title: "国漫史诗：雾山五行与大圣归来幕后解析",
        description: "精选国漫史诗画风设计幕后深度探讨。看中国画师如何将传统水墨风格与硬核热血打斗动画完美融合。",
        cover_url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80",
        category: "anime",
        creator: "国漫魂",
        likes: 85,
        imports: 210,
        status: "approved",
        items: [
          { title: "P1 雾山五行极度硬核的水墨分镜打斗制作幕后", index: 1, bvid: "BV1zz411zz", cid: "333441" }
        ]
      }
    ];
    saveCollections();
  }

  function saveCollections() {
    localStorage.setItem('rong_community_collections', JSON.stringify(communityCollections));
  }
  
  // Toggle views
  if (btnToggleCommunity && communityView) {
    btnToggleCommunity.addEventListener('click', () => {
      btnToggleCommunity.classList.add('active');
      if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
      if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');
      const btnToggleSettings = document.getElementById('btn-toggle-settings');
      if (btnToggleSettings) btnToggleSettings.classList.remove('active');
      
      playerContainer.classList.add('hidden');
      if (downloaderView) downloaderView.classList.add('hidden');
      if (screenshotsView) screenshotsView.classList.add('hidden');
      const settingsView = document.getElementById('settings-view');
      if (settingsView) settingsView.classList.add('hidden');
      communityView.classList.remove('hidden');
      
      videoElement.pause(); // Auto pause on tab switch
      renderCommunityGrid();
    });
  }

  if (btnCommunityBackToPlayer && communityView) {
    btnCommunityBackToPlayer.addEventListener('click', () => {
      btnToggleCommunity.classList.remove('active');
      communityView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    });
  }
  
  // Category filter tabs
  if (categoryTabs) {
    categoryTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.category-tab');
      if (tab) {
        categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedCategory = tab.dataset.category;
        renderCommunityGrid();
      }
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderCommunityGrid();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.toLowerCase().trim();
      renderCommunityGrid();
    });
  }
  
  // Render grid cards
  function renderCommunityGrid() {
    gridContainer.innerHTML = '';
    
    // Filter approved items
    let filtered = communityCollections.filter(c => c.status === 'approved');
    
    // Category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(c => c.category === selectedCategory);
    }
    
    // Search query filter
    if (searchQuery) {
      filtered = filtered.filter(c => 
        c.title.toLowerCase().includes(searchQuery) || 
        c.description.toLowerCase().includes(searchQuery) ||
        c.creator.toLowerCase().includes(searchQuery)
      );
    }
    
    // Sort
    const sortVal = sortSelect ? sortSelect.value : 'newest';
    if (sortVal === 'likes') {
      filtered.sort((a, b) => b.likes - a.likes);
    } else if (sortVal === 'imports') {
      filtered.sort((a, b) => (b.imports || 0) - (a.imports || 0));
    } else { // newest (id descending)
      filtered.sort((a, b) => b.id - a.id);
    }
    
    if (filtered.length === 0) {
      gridContainer.innerHTML = `
        <div class="tree-placeholder" style="grid-column: 1 / -1; padding: 40px 0;">
          <p>没有找到相关合集</p>
          <span>尝试更换分类或搜索词</span>
        </div>
      `;
      return;
    }
    
    const catMap = {};
    communityCategories.forEach(c => {
      catMap[c.id] = c.name;
    });

    filtered.forEach(col => {
      const card = document.createElement('div');
      card.className = 'collection-card';
      
      const coverUrl = col.cover_url || 'https://images.unsplash.com/photo-1542204172-e70528091b50?w=400&q=80';
      const catText = catMap[col.category] || "其他";
      
      card.innerHTML = `
        <div class="card-cover" style="background-image: url('${coverUrl}')">
          <span class="card-badge">${catText}</span>
          <span class="card-episodes-count">${col.items.length}P</span>
        </div>
        <div class="card-info">
          <h4 class="card-title" title="${col.title}">${col.title}</h4>
          <span class="card-author">By @${col.creator}</span>
          <div class="card-footer">
            <span class="card-likes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
              </svg>
              ${col.likes}
            </span>
            <span>${col.imports || 0} 导入</span>
          </div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        openDetailModal(col);
      });
      
      gridContainer.appendChild(card);
    });
  }

  // Details Modal logic
  function openDetailModal(collection) {
    currentDetailCollection = collection;
    
    // Bind detail fields
    detailTitle.textContent = collection.title;
    detailCreator.textContent = `@${collection.creator}`;
    detailDesc.textContent = collection.description;
    detailEpCount.textContent = collection.items.length;
    detailLikesCount.textContent = collection.likes;
    
    const catMap = {};
    communityCategories.forEach(c => {
      catMap[c.id] = c.name;
    });
    detailCat.textContent = catMap[collection.category] || "其他";
    
    const coverUrl = collection.cover_url || 'https://images.unsplash.com/photo-1542204172-e70528091b50?w=400&q=80';
    detailCover.style.backgroundImage = `url('${coverUrl}')`;
    
    // Check if user already liked
    const likedKey = `liked_col_${collection.id}`;
    if (localStorage.getItem(likedKey)) {
      btnDetailLike.classList.add('liked');
    } else {
      btnDetailLike.classList.remove('liked');
    }
    
    // Bind episodes list
    detailEpList.innerHTML = '';
    collection.items.forEach(item => {
      const epItem = document.createElement('div');
      epItem.className = 'detail-episode-item';
      
      const typeText = item.url ? "直链播放" : "B站解析";
      epItem.innerHTML = `
        <div>
          <span class="detail-episode-num">P${item.index}</span>
          <span class="detail-episode-title">${item.title}</span>
        </div>
        <span class="detail-episode-type">${typeText}</span>
      `;
      
      // Click single episode to play
      epItem.addEventListener('click', () => {
        closeDetailModal();
        if (item.url) {
          playVideo(item.url);
        } else if (item.bvid) {
          // If B站 video, auto paste and parse in downloader
          openBiliItemInDownloader(item);
        }
      });
      
      detailEpList.appendChild(epItem);
    });
    
    detailModal.classList.remove('hidden');
  }

  function closeDetailModal() {
    detailModal.classList.add('hidden');
    currentDetailCollection = null;
  }

  if (btnCloseDetail) {
    btnCloseDetail.addEventListener('click', closeDetailModal);
  }
  
  // Like collection
  if (btnDetailLike) {
    btnDetailLike.addEventListener('click', () => {
      if (!currentDetailCollection) return;
      const colId = currentDetailCollection.id;
      const likedKey = `liked_col_${colId}`;
      const col = communityCollections.find(c => c.id === colId);
      
      if (!localStorage.getItem(likedKey)) {
        localStorage.setItem(likedKey, 'true');
        btnDetailLike.classList.add('liked');
        col.likes += 1;
      } else {
        localStorage.removeItem(likedKey);
        btnDetailLike.classList.remove('liked');
        col.likes = Math.max(0, col.likes - 1);
      }
      
      detailLikesCount.textContent = col.likes;
      saveCollections();
      renderCommunityGrid();
    });
  }

  // 一键播放合集
  if (btnDetailPlay) {
    btnDetailPlay.addEventListener('click', () => {
      if (!currentDetailCollection || currentDetailCollection.items.length === 0) return;
      
      const firstItem = currentDetailCollection.items[0];
      closeDetailModal();
      
      if (firstItem.url) {
        playVideo(firstItem.url);
      } else if (firstItem.bvid) {
        openBiliItemInDownloader(firstItem);
      }
      
      // Increment imports
      const col = communityCollections.find(c => c.id === currentDetailCollection?.id || c.title === currentDetailCollection?.title);
      if (col) {
        col.imports = (col.imports || 0) + 1;
        saveCollections();
        renderCommunityGrid();
      }
    });
  }

  // 一键下载合集
  if (btnDetailDownload) {
    btnDetailDownload.addEventListener('click', async () => {
      if (!currentDetailCollection || currentDetailCollection.items.length === 0) return;
      
      const col = currentDetailCollection;
      
      // Check if B站 items exist
      const biliEpisodes = col.items.filter(item => item.bvid);
      
      if (biliEpisodes.length > 0) {
        // Increment imports
        const dbCol = communityCollections.find(c => c.id === col.id);
        if (dbCol) {
          dbCol.imports = (dbCol.imports || 0) + 1;
          saveCollections();
          renderCommunityGrid();
        }
        
        closeDetailModal();
        
        // Convert to downloader format
        const episodesToDownload = biliEpisodes.map(item => ({
          bvid: item.bvid,
          cid: item.cid || '0',
          title: col.title,
          partTitle: item.title,
          index: item.index
        }));
        
        // Start download IPC
        await ipcRenderer.invoke('bili-start-download', {
          episodes: episodesToDownload,
          quality: '80', // 1080P
          savePath: currentDirectory || null,
          collectionTitle: col.title,
          collectionType: 'collection'
        });
        
        // Switch to downloader view
        btnToggleCommunity.classList.remove('active');
        btnToggleDownloader.classList.add('active');
        communityView.classList.add('hidden');
        downloaderView.classList.remove('hidden');
        
        refreshTasksList();
      } else {
        alert('该合集内不包含 B站 视频资源（均为直链），请点击单集一键播放！');
      }
    });
  }
  
  function openBiliItemInDownloader(item) {
    // Paste BVID link in downloader, switch tab and trigger parse
    const biliUrlInput = document.getElementById('bili-url-input');
    if (biliUrlInput) {
      biliUrlInput.value = `https://www.bilibili.com/video/${item.bvid}`;
      
      // Switch tab
      btnToggleCommunity.classList.remove('active');
      btnToggleDownloader.classList.add('active');
      communityView.classList.add('hidden');
      downloaderView.classList.remove('hidden');
      
      // Trigger parse
      parseBiliUrl();
    }
  }

  // ==========================================
  // Share Modal Logic
  // ==========================================
  if (btnShareOpen) {
    btnShareOpen.addEventListener('click', () => {
      shareForm.reset();
      biliContainer.style.display = 'block';
      customContainer.style.display = 'none';
      shareModal.classList.remove('hidden');
    });
  }

  function closeShareModal() {
    shareModal.classList.add('hidden');
  }

  if (btnCloseShare) btnCloseShare.addEventListener('click', closeShareModal);
  if (btnShareCancel) btnShareCancel.addEventListener('click', closeShareModal);

  if (sourceTypeSelect) {
    sourceTypeSelect.addEventListener('change', () => {
      if (sourceTypeSelect.value === 'bilibili') {
        biliContainer.style.display = 'block';
        customContainer.style.display = 'none';
      } else {
        biliContainer.style.display = 'none';
        customContainer.style.display = 'block';
      }
    });
  }

  if (shareForm) {
    shareForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const title = document.getElementById('share-title').value.trim();
      const category = document.getElementById('share-category').value;
      const creator = document.getElementById('share-creator').value.trim();
      const cover = document.getElementById('share-cover').value.trim();
      const desc = document.getElementById('share-desc').value.trim();
      const sourceType = sourceTypeSelect.value;
      
      let items = [];
      
      if (sourceType === 'bilibili') {
        const biliUrl = document.getElementById('share-bili-url').value.trim();
        const bvidMatch = biliUrl.match(/video\/(BV[a-zA-Z0-9]+)/);
        if (!bvidMatch) {
          alert('请输入正确的 Bilibili 视频链接，包含 BV 号！');
          return;
        }
        
        const bvid = bvidMatch[1];
        
        showLoading('正在解析B站视频信息以构建合集...');
        try {
          const playlist = await ipcRenderer.invoke('bili-parse-url', biliUrl);
          if (playlist && playlist.videos) {
            items = playlist.videos.map(v => ({
              title: v.title,
              index: v.index,
              bvid: v.bvid,
              cid: v.cid
            }));
          }
        } catch (err) {
          alert('解析B站视频失败: ' + err.message + '，将采用单视频打底！');
          items = [{
            title: title,
            index: 1,
            bvid: bvid,
            cid: '0'
          }];
        } finally {
          hideLoading();
        }
      } else {
        // Custom link list parsing
        const rawLinks = document.getElementById('share-custom-links').value.trim();
        if (!rawLinks) {
          alert('请输入自定义播放直链列表！');
          return;
        }
        
        const lines = rawLinks.split('\n');
        lines.forEach((line, idx) => {
          const parts = line.split(',');
          if (parts.length >= 2) {
            items.push({
              title: parts[0].trim(),
              index: idx + 1,
              url: parts[1].trim()
            });
          }
        });
        
        if (items.length === 0) {
          alert('直链列表解析格式不正确，需符合：标题,直链链接，一行一条！');
          return;
        }
      }
      
      // Construct pending collection
      const newCol = {
        id: Date.now(),
        title: title,
        description: desc,
        cover_url: cover || null,
        category: category,
        creator: creator,
        likes: 0,
        imports: 0,
        status: 'pending',
        items: items
      };
      
      communityCollections.push(newCol);
      saveCollections();
      
      alert('提交成功！合集已进入管理员审核队列，通过后即可在广场展示。');
      closeShareModal();
      
      // Refresh admin tab values
      updateAdminCounts();
    });
  }

  // ==========================================
  // Admin Modal Logic
  // ==========================================
  if (btnAdminOpen) {
    btnAdminOpen.addEventListener('click', () => {
      adminLoginForm.reset();
      
      if (isAdminAuthenticated) {
        adminLoginScreen.style.display = 'none';
        adminDashboardScreen.style.display = 'flex';
        loadAdminDashboard();
      } else {
        adminLoginScreen.style.display = 'block';
        adminDashboardScreen.style.display = 'none';
      }
      
      adminModal.classList.remove('hidden');
    });
  }

  if (btnCloseAdmin) {
    btnCloseAdmin.addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });
  }

  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = document.getElementById('admin-password').value;
      
      // Let's use simple mock password protection
      if (pw === 'admin888') {
        isAdminAuthenticated = true;
        adminLoginScreen.classList.add('hidden');
        adminDashboardScreen.classList.remove('hidden');
        adminDashboardScreen.style.display = 'flex';
        loadAdminDashboard();
      } else {
        alert('安全凭证错误，拒绝访问！');
      }
    });
  }

  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', () => {
      isAdminAuthenticated = false;
      adminLoginScreen.classList.remove('hidden');
      adminDashboardScreen.classList.add('hidden');
      adminDashboardScreen.style.display = 'none';
    });
  }

  function updateAdminCounts() {
    if (adminPendingCount && adminApprovedCount) {
      const pending = communityCollections.filter(c => c.status === 'pending').length;
      const approved = communityCollections.filter(c => c.status === 'approved').length;
      adminPendingCount.textContent = pending;
      adminApprovedCount.textContent = approved;
    }
  }

  function loadAdminDashboard() {
    updateAdminCounts();
    
    // Bind click events on Admin Tabs
    adminTabPending.addEventListener('click', () => {
      adminTabPending.classList.add('active');
      adminTabApproved.classList.remove('active');
      adminTabCategories.classList.remove('active');
      activeAdminTab = 'pending';
      renderAdminWorkspace();
    });
    
    adminTabApproved.addEventListener('click', () => {
      adminTabApproved.classList.add('active');
      adminTabPending.classList.remove('active');
      adminTabCategories.classList.remove('active');
      activeAdminTab = 'approved';
      renderAdminWorkspace();
    });

    adminTabCategories.addEventListener('click', () => {
      adminTabCategories.classList.add('active');
      adminTabPending.classList.remove('active');
      adminTabApproved.classList.remove('active');
      activeAdminTab = 'categories';
      renderAdminWorkspace();
    });
    
    renderAdminWorkspace();
  }

  function renderAdminWorkspace() {
    adminList.innerHTML = '';
    
    if (activeAdminTab === 'categories') {
      adminEmpty.style.display = 'none';
      
      const catManageCard = document.createElement('div');
      catManageCard.style.cssText = 'display: flex; flex-direction: column; gap: 20px; width: 100%;';
      catManageCard.innerHTML = `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: var(--text-main);">添加新分类</h4>
          <div style="display: flex; gap: 12px; align-items: flex-end;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 6px; font-size: 11px; color: var(--text-muted);">分类标识 (仅英文数字，如 tech)</label>
              <input type="text" id="admin-new-cat-id" placeholder="如: games" style="width: 100%; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-main); outline: none; font-size: 12px;">
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 6px; font-size: 11px; color: var(--text-muted);">显示名称 (如 游戏专区)</label>
              <input type="text" id="admin-new-cat-name" placeholder="如: 游戏天地" style="width: 100%; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-main); outline: none; font-size: 12px;">
            </div>
            <button id="btn-admin-add-category" class="btn-primary" style="padding: 7px 16px; font-size: 12px; border-radius: 4px; height: 30px;">创建分类</button>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: var(--text-main);">全部合集分类列表</h4>
          <div style="display: flex; flex-direction: column; gap: 8px;" id="admin-categories-list">
            <!-- Dynamic categories list -->
          </div>
        </div>
      `;

      adminList.appendChild(catManageCard);

      // Bind dynamic addition event
      const btnAddCat = document.getElementById('btn-admin-add-category');
      if (btnAddCat) {
        btnAddCat.addEventListener('click', () => {
          const idInput = document.getElementById('admin-new-cat-id');
          const nameInput = document.getElementById('admin-new-cat-name');
          const id = idInput.value.trim().toLowerCase();
          const name = nameInput.value.trim();

          if (!id || !name) {
            alert('请填满所有字段！');
            return;
          }
          if (!/^[a-z0-9_-]+$/.test(id)) {
            alert('分类标识只能包含小写英文、数字、下划线或连字符！');
            return;
          }
          if (id === 'all') {
            alert('“all” 是全部选项的保留字，请使用其他名称！');
            return;
          }
          if (communityCategories.some(c => c.id === id)) {
            alert('此分类标识已经存在！');
            return;
          }

          communityCategories.push({ id, name });
          localStorage.setItem('rong_community_categories', JSON.stringify(communityCategories));
          
          idInput.value = '';
          nameInput.value = '';
          
          renderCommunityCategoryTabs();
          renderShareCategoryOptions();
          renderAdminWorkspace();
        });
      }

      // Render category list rows
      const listContainer = document.getElementById('admin-categories-list');
      if (listContainer) {
        communityCategories.forEach(cat => {
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px;';
          
          row.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-main);">${cat.name}</span>
              <span style="font-size: 11px; color: var(--text-muted);">标识: ${cat.id}</span>
            </div>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px; color: #ef4444; border-color: rgba(239, 68, 68, 0.2); cursor: pointer;" onclick="window.adminDeleteCategory('${cat.id}')">
              删除分类
            </button>
          `;
          listContainer.appendChild(row);
        });
      }
      return;
    }

    const itemsToRender = communityCollections.filter(c => c.status === activeAdminTab);
    
    if (itemsToRender.length === 0) {
      adminEmpty.style.display = 'block';
      return;
    }
    
    adminEmpty.style.display = 'none';
    
    itemsToRender.forEach(col => {
      const card = document.createElement('div');
      card.className = 'admin-audit-card';
      
      let actionHtml = '';
      if (col.status === 'pending') {
        actionHtml = `
          <div class="audit-actions">
            <button class="btn-secondary" onclick="window.auditCollection(${col.id}, 'reject')" style="padding: 4px 10px; font-size: 11px; cursor:pointer;">拒绝驳回</button>
            <button class="btn-primary" onclick="window.auditCollection(${col.id}, 'approve')" style="padding: 4px 10px; font-size: 11px; cursor:pointer;">批准上线</button>
          </div>
        `;
      } else {
        actionHtml = `
          <div class="audit-actions">
            <button class="btn-secondary" onclick="window.auditCollection(${col.id}, 'offline')" style="padding: 4px 10px; font-size: 11px; color:#ef4444; border-color: rgba(239, 68, 68, 0.2); cursor:pointer;">强制下架</button>
          </div>
        `;
      }
      
      const epTitles = col.items.map(it => `[P${it.index}] ${it.title}`).slice(0, 3).join(', ');
      const dotsStr = col.items.length > 3 ? '...' : '';
      
      card.innerHTML = `
        <h4 class="audit-title">${col.title}</h4>
        <div class="audit-meta">
          <span>创建者: @${col.creator}</span>
          <span>分类: ${col.category}</span>
          <span>共 ${col.items.length} 集</span>
        </div>
        <p class="audit-desc">${col.description}</p>
        <div style="font-size: 11px; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 8px;">
          集目: ${epTitles}${dotsStr}
        </div>
        ${actionHtml}
      `;
      
      adminList.appendChild(card);
    });
  }

  // Make audit global for onClick bindings
  window.auditCollection = (id, decision) => {
    const colIdx = communityCollections.findIndex(c => c.id === id);
    if (colIdx > -1) {
      if (decision === 'approve') {
        communityCollections[colIdx].status = 'approved';
        alert('合集已上线！');
      } else if (decision === 'reject') {
        const reason = prompt('请输入驳回原因:', '内容不符合分享规范');
        if (reason === null) return; // cancelled
        communityCollections[colIdx].status = 'rejected';
        communityCollections[colIdx].reject_reason = reason;
      } else if (decision === 'offline') {
        if (confirm('确认强制下架该合集吗？')) {
          communityCollections[colIdx].status = 'offline';
        } else {
          return;
        }
      }
      
      saveCollections();
      updateAdminCounts();
      renderAdminWorkspace();
      renderCommunityGrid();
    }
  };

  window.adminDeleteCategory = (catId) => {
    if (confirm('确定删除该分类吗？删除后，该分类下的分享合集将被自动归类到“其它分享”中。')) {
      communityCategories = communityCategories.filter(c => c.id !== catId);
      localStorage.setItem('rong_community_categories', JSON.stringify(communityCategories));
      
      renderCommunityCategoryTabs();
      renderShareCategoryOptions();
      renderAdminWorkspace();
      renderCommunityGrid();
    }
  };
}

// =============================================================
// Video Screen Capture & Library Management Logic
// =============================================================

// Capture Video Frame function
async function captureVideoFrame() {
  if (!videoElement || videoElement.readyState < 2 || !currentFilePath) {
    alert('当前没有播放视频，无法截屏！');
    return;
  }

  // 1. Shutter flash effect
  const flash = document.getElementById('screenshot-flash');
  if (flash) {
    flash.classList.remove('hidden');
    flash.classList.add('active');
    // Force reflow
    flash.offsetWidth;
    // Fade out
    flash.style.transition = 'opacity 0.2s ease';
    flash.classList.remove('active');
    setTimeout(() => {
      flash.classList.add('hidden');
      flash.style.transition = '';
    }, 200);
  }

  try {
    // 2. Draw frame onto canvas
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");

    const currentSec = isTranscoding 
      ? (transcodeStartTime + videoElement.currentTime) 
      : videoElement.currentTime;

    const baseName = path.basename(currentFilePath);

    // 3. Resolve category from path and Invoke IPC main saving
    const resolvedCatId = resolveCategoryForPath(currentFilePath);
    const result = await ipcRenderer.invoke('save-screenshot', {
      base64Data,
      videoPath: currentFilePath,
      videoName: baseName,
      playbackTime: currentSec,
      categoryId: resolvedCatId
    });

    if (result && result.success) {
      // 4. Slide-out toast card showing thumbnail preview
      const toast = document.getElementById('screenshot-toast');
      const toastImg = document.getElementById('screenshot-toast-img');
      const toastTime = document.getElementById('screenshot-toast-time');
      
      if (toast && toastImg && toastTime) {
        // We serve the image through our HTTP server route to bypass file:// blocks
        const imgSrc = `http://localhost:30032/screenshot?path=${encodeURIComponent(result.screenshot.absolutePath)}`;
        toastImg.src = imgSrc;
        toastTime.textContent = `${baseName} | ${formatTime(currentSec)}`;
        
        toast.classList.remove('hidden');
        toast.classList.add('visible');
        
        // Hide after 3 seconds
        if (window.screenshotToastTimeout) {
          clearTimeout(window.screenshotToastTimeout);
        }
        window.screenshotToastTimeout = setTimeout(() => {
          toast.classList.remove('visible');
          setTimeout(() => toast.classList.add('hidden'), 300);
        }, 3000);
      }
      
      // If we are currently viewing the screenshots library grid, refresh it!
      if (typeof refreshScreenshotsUI === 'function') {
        refreshScreenshotsUI();
      }
    } else {
      console.error('Failed to save screenshot:', result?.error);
    }
  } catch (err) {
    console.error('Error capturing video frame:', err);
  }
}

// Global scope UI refresh hook
let refreshScreenshotsUI = null;

function initScreenshotsLibrary() {
  const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
  const btnScreenshotsBackToPlayer = document.getElementById('btn-screenshots-back-to-player');
  const screenshotsView = document.getElementById('screenshots-view');
  
  const playerContainer = document.getElementById('player-container');
  const downloaderView = document.getElementById('downloader-view');
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const communityView = document.getElementById('community-view');
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  
  // Scrubber button
  const btnScreenshot = document.getElementById('btn-screenshot');
  
  // Library Elements
  const categoriesList = document.getElementById('screenshot-categories-list');
  const screenshotsGrid = document.getElementById('screenshots-grid');
  const searchInput = document.getElementById('screenshot-search-input');
  const btnCreateCategory = document.getElementById('btn-create-category');

  // Multi-select mode Elements
  const btnToggleMultiselect = document.getElementById('btn-toggle-multiselect');
  const screenshotsActionbar = document.getElementById('screenshots-actionbar');
  const selectedCountLabel = document.getElementById('selected-count-label');
  const btnSelectAll = document.getElementById('btn-screenshot-select-all');
  const batchCategorySelect = document.getElementById('batch-category-select');
  const btnDeleteSelected = document.getElementById('btn-delete-selected');
  const btnCancelMultiselect = document.getElementById('btn-cancel-multiselect');
  
  // Create Category Modal Elements
  const createCatModal = document.getElementById('create-category-modal');
  const btnCloseCatModal = document.getElementById('btn-close-cat-modal');
  const btnCancelCatModal = document.getElementById('btn-cancel-cat-modal');
  const createCatForm = document.getElementById('create-category-form');
  const newCatNameInput = document.getElementById('new-category-name-input');
  
  // Lightbox Modal
  const lightboxModal = document.getElementById('lightbox-modal');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxVideoMeta = document.getElementById('lightbox-video-meta');
  const btnLightboxPlay = document.getElementById('btn-lightbox-play-here');
  const btnLightboxCopy = document.getElementById('btn-lightbox-copy');
  const btnLightboxReveal = document.getElementById('btn-lightbox-reveal');
  const btnLightboxDelete = document.getElementById('btn-lightbox-delete');
  const btnLightboxPrev = document.getElementById('btn-lightbox-prev');
  const btnLightboxNext = document.getElementById('btn-lightbox-next');
  let selectedCategoryId = 'all';
  let searchQuery = '';
  let activeLightboxItem = null;
  let multiSelectMode = false;
  let selectedScreenshotIds = new Set();
  
  // Set up Scrubber button click listener
  if (btnScreenshot) {
    btnScreenshot.addEventListener('click', (e) => {
      e.stopPropagation();
      captureVideoFrame();
    });
  }

  // View toggle
  if (btnToggleScreenshots && screenshotsView) {
    btnToggleScreenshots.addEventListener('click', () => {
      // Toggle active states on buttons
      btnToggleScreenshots.classList.add('active');
      if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
      if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
      const btnToggleSettings = document.getElementById('btn-toggle-settings');
      if (btnToggleSettings) btnToggleSettings.classList.remove('active');
      
      // Hide all other views
      playerContainer.classList.add('hidden');
      if (downloaderView) downloaderView.classList.add('hidden');
      if (communityView) communityView.classList.add('hidden');
      const settingsView = document.getElementById('settings-view');
      if (settingsView) settingsView.classList.add('hidden');
      screenshotsView.classList.remove('hidden');
      
      // Pause playing video
      videoElement.pause();
      
      // Load and render
      loadAndRenderScreenshots();
    });
  }
  
  if (btnScreenshotsBackToPlayer && screenshotsView) {
    btnScreenshotsBackToPlayer.addEventListener('click', () => {
      btnToggleScreenshots.classList.remove('active');
      screenshotsView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
      if (multiSelectMode) exitMultiSelectMode();
    });
  }
  
  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.toLowerCase().trim();
      renderScreenshotsGrid();
    });
  }

  // Multi-select mode wiring
  if (btnToggleMultiselect) {
    btnToggleMultiselect.addEventListener('click', () => {
      if (multiSelectMode) exitMultiSelectMode();
      else enterMultiSelectMode();
    });
  }
  if (btnCancelMultiselect) {
    btnCancelMultiselect.addEventListener('click', () => exitMultiSelectMode());
  }
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      // Toggle: if every visible item is already selected, clear; otherwise select all
      const visible = getFilteredScreenshots();
      const allSelected = visible.length > 0 && visible.every(s => selectedScreenshotIds.has(s.id));
      selectAllFiltered(!allSelected);
    });
  }
  if (btnDeleteSelected) {
    btnDeleteSelected.addEventListener('click', () => window.batchDeleteScreenshots());
  }
  if (batchCategorySelect) {
    batchCategorySelect.addEventListener('change', () => {
      const catId = batchCategorySelect.value;
      if (catId) window.batchMoveCategory(catId);
    });
  }

  
  // Load database
  async function loadAndRenderScreenshots() {
    screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
    renderCategoriesSidebar();
    renderScreenshotsGrid();
    
    // Also update the directory tree badges to reflect any category updates
    if (currentDirectory) {
      ipcRenderer.invoke('get-directory-tree', currentDirectory).then(tree => {
        if (tree) renderDirectoryTree(tree);
      });
    }
  }
  
  // Render Left categories
  function renderCategoriesSidebar() {
    categoriesList.innerHTML = '';
    
    // Add "All" category item
    const allCount = screenshotsDB.screenshots.length;
    const allItem = document.createElement('div');
    allItem.className = `screenshot-cat-item ${selectedCategoryId === 'all' ? 'active' : ''}`;
    allItem.innerHTML = `
      <span>📂 全部截图</span>
      <span style="font-size: 10px; opacity:0.7;">(${allCount})</span>
    `;
    allItem.addEventListener('click', () => {
      selectedCategoryId = 'all';
      renderCategoriesSidebar();
      renderScreenshotsGrid();
    });
    categoriesList.appendChild(allItem);
    
    // Add other categories
    screenshotsDB.categories.forEach(cat => {
      const count = screenshotsDB.screenshots.filter(s => s.categoryId === cat.id).length;
      const catItem = document.createElement('div');
      catItem.className = `screenshot-cat-item ${selectedCategoryId === cat.id ? 'active' : ''}`;
      
      // Delete option for custom categories
      let deleteHtml = '';
      if (cat.id !== 'uncategorized') {
        deleteHtml = `
          <div class="cat-actions">
            <button class="cat-action-btn delete" title="删除分类" onclick="event.stopPropagation(); window.deleteScreenshotCategory('${cat.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 10px; height: 10px;">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `;
      }
      
      catItem.innerHTML = `
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:110px;">📁 ${cat.name}</span>
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="font-size: 10px; opacity:0.7;">(${count})</span>
          ${deleteHtml}
        </div>
      `;
      
      catItem.addEventListener('click', () => {
        selectedCategoryId = cat.id;
        renderCategoriesSidebar();
        renderScreenshotsGrid();
      });
      
      categoriesList.appendChild(catItem);
    });
  }

  // Delete Category Global Binding
  window.deleteScreenshotCategory = async (catId) => {
    if (!confirm('确认删除该分类吗？分类下的截图将自动移至“未分类”。')) return;
    
    // Remove category
    screenshotsDB.categories = screenshotsDB.categories.filter(c => c.id !== catId);
    
    // Relocate screenshots of this category to uncategorized
    screenshotsDB.screenshots.forEach(s => {
      if (s.categoryId === catId) {
        s.categoryId = 'uncategorized';
      }
    });
    
    await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
    selectedCategoryId = 'all';
    loadAndRenderScreenshots();
  };
  
  // Compute the currently-visible (filtered + sorted) screenshot list. Shared by
  // renderScreenshotsGrid() and selectAllFiltered() so "全选" only affects the
  // screenshots actually on screen (respecting category filter + search).
  function getFilteredScreenshots() {
    let filtered = screenshotsDB.screenshots;

    if (selectedCategoryId !== 'all') {
      filtered = filtered.filter(s => s.categoryId === selectedCategoryId);
    }

    if (searchQuery) {
      filtered = filtered.filter(s =>
        s.filename.toLowerCase().includes(searchQuery) ||
        s.videoName.toLowerCase().includes(searchQuery)
      );
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered;
  }

  // Render main Grid gallery
  function renderScreenshotsGrid() {
    screenshotsGrid.innerHTML = '';

    const filtered = getFilteredScreenshots();
    
    if (filtered.length === 0) {
      screenshotsGrid.innerHTML = `
        <div class="tree-placeholder" style="grid-column: 1 / -1; padding: 60px 0;">
          <p>暂无截图文件</p>
          <span>在播放视频时按下 Option + 1 即可快速截屏保存</span>
        </div>
      `;
      return;
    }
    
    filtered.forEach(item => {
      const card = document.createElement('div');
      const isSelected = selectedScreenshotIds.has(item.id);
      card.className = 'screenshot-card' + (multiSelectMode ? ' selectable' : '') + (isSelected ? ' selected' : '');
      
      // Serve through server
      const imgSrc = `http://localhost:30032/screenshot?path=${encodeURIComponent(item.absolutePath)}`;
      
      // Build select categories option menu items
      let optionsHtml = '';
      screenshotsDB.categories.forEach(c => {
        optionsHtml += `<option value="${c.id}" ${item.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`;
      });
      
      card.innerHTML = `
        <div class="screenshot-card-img" style="background-image: url('${imgSrc}')">
          <div class="screenshot-checkmark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:13px; height:13px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="screenshot-card-info">
          <h4 class="screenshot-card-title" title="${item.filename}">${item.filename}</h4>
          <span class="screenshot-card-sub" title="${item.videoName}">源: ${item.videoName}</span>
          <span class="screenshot-card-sub">时刻: ${formatTime(item.playbackTime)}</span>
          <div class="screenshot-card-actions">
            <select class="dropdown-select" style="font-size:10px; padding:2px; height:20px; flex:1; max-width: 90px;" onchange="window.moveScreenshotCategory('${item.id}', this.value)" onclick="event.stopPropagation()">
              ${optionsHtml}
            </select>
            <button class="card-action-icon-btn" onclick="event.stopPropagation(); window.revealScreenshotInFinder('${item.absolutePath}')" title="在 Finder 中显示">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
            <button class="card-action-icon-btn delete" onclick="event.stopPropagation(); window.deleteScreenshotItem('${item.id}')" title="删除截图">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
      
      // In multi-select mode, clicking a card toggles its selection;
      // otherwise open the Lightbox preview.
      card.addEventListener('click', () => {
        if (multiSelectMode) {
          toggleScreenshotSelection(item, card);
        } else {
          openLightbox(item, filtered);
        }
      });
      
      screenshotsGrid.appendChild(card);
    });
  }

  // Move category global function
  window.moveScreenshotCategory = async (itemId, catId) => {
    const item = screenshotsDB.screenshots.find(s => s.id === itemId);
    if (item) {
      item.categoryId = catId;
      await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
      loadAndRenderScreenshots();
    }
  };

  // Reveal in Finder global function
  window.revealScreenshotInFinder = async (absolutePath) => {
    await ipcRenderer.invoke('open-image-in-finder', absolutePath);
  };

  // Delete Screenshot global function
  window.deleteScreenshotItem = async (itemId) => {
    if (!confirm('确定要永久删除这张截图吗？（将同步删除本地物理文件）')) return;
    
    const idx = screenshotsDB.screenshots.findIndex(s => s.id === itemId);
    if (idx > -1) {
      const item = screenshotsDB.screenshots[idx];
      
      // 1. Delete physical file
      await ipcRenderer.invoke('delete-screenshot-file', item.absolutePath);
      
      // 2. Remove metadata
      screenshotsDB.screenshots.splice(idx, 1);
      
      await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
      loadAndRenderScreenshots();
      
      if (activeLightboxItem && activeLightboxItem.id === itemId) {
        closeLightbox();
      }
    }
  };

  // ==========================================
  // Multi-select mode (batch categorize / batch delete)
  // ==========================================
  function enterMultiSelectMode() {
    multiSelectMode = true;
    selectedScreenshotIds.clear();
    if (screenshotsView) screenshotsView.classList.add('multiselect-active');
    if (btnToggleMultiselect) btnToggleMultiselect.classList.add('active');

    // Populate the batch "move to category" dropdown with current categories
    if (batchCategorySelect) {
      batchCategorySelect.innerHTML = '<option value="" disabled selected>移动到分类…</option>';
      screenshotsDB.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        batchCategorySelect.appendChild(opt);
      });
    }

    renderScreenshotsGrid();
    updateMultiSelectActionBar();
  }

  function exitMultiSelectMode() {
    multiSelectMode = false;
    selectedScreenshotIds.clear();
    if (screenshotsView) screenshotsView.classList.remove('multiselect-active');
    if (btnToggleMultiselect) btnToggleMultiselect.classList.remove('active');
    if (batchCategorySelect) batchCategorySelect.value = '';
    renderScreenshotsGrid();
    updateMultiSelectActionBar();
  }

  // Toggle one card's selected state. Updates only this card's class + the
  // action-bar count (no full grid re-render) to avoid flicker.
  function toggleScreenshotSelection(item, card) {
    if (selectedScreenshotIds.has(item.id)) {
      selectedScreenshotIds.delete(item.id);
      card.classList.remove('selected');
    } else {
      selectedScreenshotIds.add(item.id);
      card.classList.add('selected');
    }
    updateMultiSelectActionBar();
  }

  function updateMultiSelectActionBar() {
    const n = selectedScreenshotIds.size;
    if (selectedCountLabel) selectedCountLabel.textContent = `已选 ${n} 项`;
    const hasSelection = n > 0;
    if (btnDeleteSelected) btnDeleteSelected.disabled = !hasSelection;
    if (batchCategorySelect) batchCategorySelect.disabled = !hasSelection;
  }

  // Select / deselect all currently-visible (filtered) screenshots.
  function selectAllFiltered(selectAll) {
    const visible = getFilteredScreenshots();
    selectedScreenshotIds.clear();
    if (selectAll) {
      visible.forEach(s => selectedScreenshotIds.add(s.id));
    }
    renderScreenshotsGrid();
    updateMultiSelectActionBar();
  }

  // Batch delete: confirm → delete physical files → remove DB entries → persist → refresh.
  window.batchDeleteScreenshots = async () => {
    const n = selectedScreenshotIds.size;
    if (n === 0) return;
    if (!confirm(`确定要永久删除选中的 ${n} 张截图吗？（将同步删除本地物理文件）`)) return;

    // Collect items + indices up front (ids alone don't carry absolutePath)
    const targets = screenshotsDB.screenshots
      .map((s, idx) => selectedScreenshotIds.has(s.id) ? { item: s, idx } : null)
      .filter(Boolean);

    for (const t of targets) {
      try {
        await ipcRenderer.invoke('delete-screenshot-file', t.item.absolutePath);
      } catch (err) {
        console.error('Failed to delete screenshot file:', t.item.absolutePath, err);
      }
    }

    // Remove metadata in descending index order so earlier splices don't shift later indices
    targets.sort((a, b) => b.idx - a.idx);
    for (const t of targets) {
      screenshotsDB.screenshots.splice(t.idx, 1);
    }

    await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
    exitMultiSelectMode();
    loadAndRenderScreenshots();
  };

  // Batch move to category: non-destructive, applied immediately (matches the
  // per-card dropdown behavior, which also applies without a confirm dialog).
  window.batchMoveCategory = async (catId) => {
    if (!catId || selectedScreenshotIds.size === 0) return;
    for (const s of screenshotsDB.screenshots) {
      if (selectedScreenshotIds.has(s.id)) {
        s.categoryId = catId;
      }
    }
    await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
    exitMultiSelectMode();
    loadAndRenderScreenshots();
  };

  // ==========================================
  // Lightbox Modal Logic
  // ==========================================
  let lightboxPlaylist = [];
  
  function openLightbox(item, playlist) {
    activeLightboxItem = item;
    lightboxPlaylist = playlist;
    
    const imgSrc = `http://localhost:30032/screenshot?path=${encodeURIComponent(item.absolutePath)}`;
    lightboxImg.src = imgSrc;
    
    lightboxTitle.textContent = item.filename;
    lightboxVideoMeta.textContent = `源视频: ${item.videoName} | 截图时刻: ${formatTime(item.playbackTime)}`;
    
    lightboxModal.classList.remove('hidden');
    
    // Show/hide arrows
    updateLightboxArrows();
  }
  
  function updateLightboxArrows() {
    const idx = lightboxPlaylist.findIndex(s => s.id === activeLightboxItem.id);
    btnLightboxPrev.style.display = idx > 0 ? 'flex' : 'none';
    btnLightboxNext.style.display = idx < lightboxPlaylist.length - 1 ? 'flex' : 'none';
  }
  
  function closeLightbox() {
    lightboxModal.classList.add('hidden');
    activeLightboxItem = null;
  }
  
  if (btnCloseLightbox) {
    btnCloseLightbox.addEventListener('click', closeLightbox);
  }
  
  if (btnLightboxPrev) {
    btnLightboxPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = lightboxPlaylist.findIndex(s => s.id === activeLightboxItem.id);
      if (idx > 0) {
        openLightbox(lightboxPlaylist[idx - 1], lightboxPlaylist);
      }
    });
  }
  
  if (btnLightboxNext) {
    btnLightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = lightboxPlaylist.findIndex(s => s.id === activeLightboxItem.id);
      if (idx < lightboxPlaylist.length - 1) {
        openLightbox(lightboxPlaylist[idx + 1], lightboxPlaylist);
      }
    });
  }
  
  // Jump and Play from Lightbox
  if (btnLightboxPlay) {
    btnLightboxPlay.addEventListener('click', () => {
      if (!activeLightboxItem) return;
      const item = activeLightboxItem;
      closeLightbox();
      
      // Go back to player and play
      btnToggleScreenshots.classList.remove('active');
      screenshotsView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
      
      playVideo(item.videoPath, item.playbackTime, true);
    });
  }
  
  // Copy to clipboard
  if (btnLightboxCopy) {
    btnLightboxCopy.addEventListener('click', async () => {
      if (!activeLightboxItem) return;
      const success = await ipcRenderer.invoke('copy-image-to-clipboard', activeLightboxItem.absolutePath);
      if (success) {
        alert('图片已复制到剪贴板！');
      } else {
        alert('复制失败，请重试');
      }
    });
  }
  
  // Reveal in Finder
  if (btnLightboxReveal) {
    btnLightboxReveal.addEventListener('click', () => {
      if (!activeLightboxItem) return;
      window.revealScreenshotInFinder(activeLightboxItem.absolutePath);
    });
  }
  
  // Delete from lightbox
  if (btnLightboxDelete) {
    btnLightboxDelete.addEventListener('click', () => {
      if (!activeLightboxItem) return;
      window.deleteScreenshotItem(activeLightboxItem.id);
    });
  }
  
  // Expose refresh hook
  refreshScreenshotsUI = loadAndRenderScreenshots;
}

function initSettings() {
  const btnToggleSettings = document.getElementById('btn-toggle-settings');
  const btnSettingsBackToPlayer = document.getElementById('btn-settings-back-to-player');
  const settingsView = document.getElementById('settings-view');
  
  const playerContainer = document.getElementById('player-container');
  const downloaderView = document.getElementById('downloader-view');
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const communityView = document.getElementById('community-view');
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  const screenshotsView = document.getElementById('screenshots-view');
  const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');

  // Tab switching
  const menuItems = document.querySelectorAll('.settings-sidebar-menu .settings-menu-item');
  const tabContents = document.querySelectorAll('.settings-main-panel .settings-tab-content');

  // Controls
  const setAutoResume = document.getElementById('set-auto-resume');
  const setAutoplayNext = document.getElementById('set-autoplay-next');
  const setthemeSelect = document.getElementById('set-theme-select');
  const setDefaultSpeed = document.getElementById('set-default-speed');
  const setMaxDownloads = document.getElementById('set-max-downloads');
  const btnChangeDownloadPath = document.getElementById('btn-change-download-path');
  const setDownloadPathLabel = document.getElementById('set-download-path-label');
  
  // Category management controls
  const setNewCatName = document.getElementById('set-new-cat-name');
  const btnSetAddCat = document.getElementById('btn-set-add-cat');
  const setCategoriesList = document.getElementById('set-categories-list');

  // Load and apply settings from history / localStorage
  async function loadSettings() {
    // Auto resume folder
    const autoResume = localStorage.getItem('rong_setting_auto_resume_folder') !== 'false';
    if (setAutoResume) {
      setAutoResume.checked = autoResume;
    }

    // Autoplay Next
    if (setAutoplayNext) {
      setAutoplayNext.checked = autoplayNext;
    }

    // Theme selector
    if (setthemeSelect) {
      setthemeSelect.value = currentTheme;
    }

    // Default Playback Speed
    const defaultSpeed = localStorage.getItem('rong_setting_default_speed') || '1.0';
    if (setDefaultSpeed) {
      setDefaultSpeed.value = defaultSpeed;
      playbackSpeed = parseFloat(defaultSpeed);
      const btnSpeed = document.getElementById('btn-speed');
      if (btnSpeed) {
        btnSpeed.textContent = defaultSpeed === '1.0' ? '1.0x' : `${defaultSpeed}x`;
      }
    }

    // Max Concurrent Downloads
    const maxDownloads = await ipcRenderer.invoke('get-max-downloads');
    if (setMaxDownloads) {
      setMaxDownloads.value = maxDownloads;
    }

    // Default Download path
    const customDownloadPath = localStorage.getItem('rong_setting_download_path');
    if (setDownloadPathLabel) {
      setDownloadPathLabel.textContent = customDownloadPath || '系统默认下载目录';
    }

    // Categories list load
    screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
    renderSettingsCategories();
  }

  // Render categories inside settings panel
  function renderSettingsCategories() {
    if (!setCategoriesList) return;
    setCategoriesList.innerHTML = '';
    
    if (!screenshotsDB || !screenshotsDB.categories || screenshotsDB.categories.length === 0) {
      setCategoriesList.innerHTML = `<div style="text-align:center; padding: 16px; color: var(--text-muted); font-size:12px;">暂无分类，在上方输入框中添加新分类</div>`;
      return;
    }
    
    screenshotsDB.categories.forEach(cat => {
      const isUncategorized = cat.id === 'uncategorized';
      
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 6px;';
      
      const label = document.createElement('span');
      label.style.cssText = 'font-size: 13px; color: var(--text-main); font-weight: 500;';
      label.textContent = isUncategorized ? `📁 ${cat.name} (默认内置)` : `📁 ${cat.name}`;
      
      row.appendChild(label);
      
      if (!isUncategorized) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-secondary';
        delBtn.style.cssText = 'padding: 4px 10px; font-size: 11px; color: #ef4444; border-color: rgba(239, 68, 68, 0.2); cursor: pointer; border-radius: 4px;';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`确认删除分类 "${cat.name}" 吗？该分类下的所有截图将自动归入 "未分类" 中。`)) {
            // Remove category
            screenshotsDB.categories = screenshotsDB.categories.filter(c => c.id !== cat.id);
            // Relocate screenshots of this category to uncategorized
            screenshotsDB.screenshots.forEach(s => {
              if (s.categoryId === cat.id) {
                s.categoryId = 'uncategorized';
              }
            });
            
            await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
            renderSettingsCategories();
            
            // Sync with screenshots library view
            if (typeof refreshScreenshotsUI === 'function') {
              refreshScreenshotsUI();
            }
          }
        });
        row.appendChild(delBtn);
      } else {
        const lockLabel = document.createElement('span');
        lockLabel.style.cssText = 'font-size: 11px; color: var(--text-muted); padding-right: 8px;';
        lockLabel.textContent = '系统默认';
        row.appendChild(lockLabel);
      }
      
      setCategoriesList.appendChild(row);
    });
  }

  // Switch between setting tabs
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      menuItems.forEach(i => i.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      item.classList.add('active');
      const tabId = `tab-${item.dataset.tab}`;
      const content = document.getElementById(tabId);
      if (content) {
        content.classList.remove('hidden');
      }
    });
  });

  // Wire up change events
  if (setAutoResume) {
    setAutoResume.addEventListener('change', () => {
      localStorage.setItem('rong_setting_auto_resume_folder', setAutoResume.checked);
    });
  }

  if (setAutoplayNext) {
    setAutoplayNext.addEventListener('change', () => {
      autoplayNext = setAutoplayNext.checked;
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
      ipcRenderer.invoke('save-history', { autoplayNext });
    });
  }

  if (setthemeSelect) {
    setthemeSelect.addEventListener('change', () => {
      const selectedTheme = setthemeSelect.value;
      setTheme(selectedTheme);
      // Synchronize player theme dropdown selection UI if exists
      const themeDropdown = document.getElementById('theme-dropdown');
      if (themeDropdown) {
        themeDropdown.querySelectorAll('.theme-option').forEach(opt => {
          if (opt.dataset.theme === selectedTheme) {
            opt.classList.add('active');
          } else {
            opt.classList.remove('active');
          }
        });
      }
    });
  }

  if (setDefaultSpeed) {
    setDefaultSpeed.addEventListener('change', () => {
      const speedVal = setDefaultSpeed.value;
      localStorage.setItem('rong_setting_default_speed', speedVal);
      playbackSpeed = parseFloat(speedVal);
      // Synchronize player controls
      const btnSpeed = document.getElementById('btn-speed');
      if (btnSpeed) {
        btnSpeed.textContent = speedVal === '1.0' ? '1.0x' : `${speedVal}x`;
      }
      const speedDropdown = document.getElementById('speed-dropdown');
      if (speedDropdown) {
        speedDropdown.querySelectorAll('.speed-option').forEach(opt => {
          if (opt.dataset.speed === speedVal) {
            opt.classList.add('active');
          } else {
            opt.classList.remove('active');
          }
        });
      }
      // Apply to video element if currently loaded
      if (videoElement && !videoElement.paused) {
        videoElement.playbackRate = playbackSpeed;
      }
    });
  }

  if (setMaxDownloads) {
    setMaxDownloads.addEventListener('change', async () => {
      const val = parseInt(setMaxDownloads.value, 10);
      if (val >= 1 && val <= 5) {
        await ipcRenderer.invoke('set-max-downloads', val);
      } else {
        setMaxDownloads.value = 3;
        await ipcRenderer.invoke('set-max-downloads', 3);
      }
    });
  }

  if (btnChangeDownloadPath) {
    btnChangeDownloadPath.addEventListener('click', async () => {
      const selectedPath = await ipcRenderer.invoke('select-download-directory');
      if (selectedPath) {
        localStorage.setItem('rong_setting_download_path', selectedPath);
        if (setDownloadPathLabel) {
          setDownloadPathLabel.textContent = selectedPath;
        }
      }
    });
  }

  // Add screenshot category handler
  if (btnSetAddCat && setNewCatName) {
    const addNewCatHandler = async () => {
      const name = setNewCatName.value.trim();
      if (!name) return;
      
      // Load screenshots DB first to make sure we have latest copy
      screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
      
      // Prevent duplicates
      if (screenshotsDB.categories.some(c => c.name === name)) {
        alert('分类已存在！');
        return;
      }
      
      const newId = 'cat_' + Date.now();
      screenshotsDB.categories.push({
        id: newId,
        name: name
      });
      
      await ipcRenderer.invoke('save-screenshots-db', screenshotsDB);
      setNewCatName.value = '';
      
      renderSettingsCategories();
      
      // Sync with screenshots library UI
      if (typeof refreshScreenshotsUI === 'function') {
        refreshScreenshotsUI();
      }
    };

    btnSetAddCat.addEventListener('click', addNewCatHandler);
    setNewCatName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNewCatHandler();
      }
    });
  }

  // Toggle view settings
  if (btnToggleSettings && settingsView) {
    btnToggleSettings.addEventListener('click', () => {
      btnToggleSettings.classList.add('active');
      if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
      if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
      if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');

      playerContainer.classList.add('hidden');
      if (downloaderView) downloaderView.classList.add('hidden');
      if (communityView) communityView.classList.add('hidden');
      if (screenshotsView) screenshotsView.classList.add('hidden');
      settingsView.classList.remove('hidden');

      videoElement.pause();
      loadSettings();
    });
  }

  if (btnSettingsBackToPlayer && settingsView) {
    btnSettingsBackToPlayer.addEventListener('click', () => {
      btnToggleSettings.classList.remove('active');
      settingsView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    });
  }
}



