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
let currentViewerMode = 'welcome';
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
let mainViewerToken = 0;
let mainPdfState = null;
let mainPdfResizeObserver = null;
let mainDocumentState = null;
let mainDocumentResizeObserver = null;
let hasPersistedExpandedFolders = false;

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.rmvb', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.ts', '.3gp'];
const PDF_EXTENSIONS = ['.pdf'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif', '.tif', '.tiff'];
const DOCUMENT_EXTENSIONS = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
const MAIN_PDF_PAGE_MODE_STORAGE_KEY = 'rong_main_pdf_page_mode';

function getMediaKind(filePath, fallbackKind = null) {
  if (fallbackKind) return fallbackKind;
  const ext = path.extname(filePath || '').toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (DOCUMENT_EXTENSIONS.includes(ext)) return 'document';
  return null;
}

function getExpandedFolderList() {
  return Array.from(expandedFolders).filter(Boolean);
}

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
const mainImageViewer = document.getElementById('main-image-viewer');
const mainImagePreview = document.getElementById('main-image-preview');
const mainImageTitle = document.getElementById('main-image-title');
const mainImageStatus = document.getElementById('main-image-status');
const btnMainImageFit = document.getElementById('btn-main-image-fit');
const btnMainImageOpen = document.getElementById('btn-main-image-open');
const mainDocumentViewer = document.getElementById('main-document-viewer');
const mainDocumentBadge = document.getElementById('main-document-badge');
const mainDocumentTitle = document.getElementById('main-document-title');
const mainDocumentStatus = document.getElementById('main-document-status');
const mainDocumentStage = document.getElementById('main-document-stage');
const mainDocumentReader = document.getElementById('main-document-reader');
const mainDocumentPageViewport = document.getElementById('main-document-page-viewport');
const mainDocumentPagePaper = document.getElementById('main-document-page-paper');
const mainDocumentPageBody = document.getElementById('main-document-page-body');
const mainDocumentPageNumber = document.getElementById('main-document-page-number');
const mainDocumentPageInput = document.getElementById('main-document-page-input');
const mainDocumentPageCount = document.getElementById('main-document-page-count');
const mainDocumentZoomLabel = document.getElementById('main-document-zoom-label');
const mainDocumentPreviewShell = document.getElementById('main-document-preview-shell');
const mainDocumentPreview = document.getElementById('main-document-preview');
const mainDocumentPlaceholder = document.getElementById('main-document-placeholder');
const mainDocumentPlaceholderIcon = document.getElementById('main-document-placeholder-icon');
const btnMainDocumentOpen = document.getElementById('btn-main-document-open');
const btnMainDocumentRefresh = document.getElementById('btn-main-document-refresh');
const mainPdfViewer = document.getElementById('main-pdf-viewer');
const mainPdfTitle = document.getElementById('main-pdf-title');
const mainPdfStatus = document.getElementById('main-pdf-status');
const mainPdfSpread = document.getElementById('main-pdf-spread');
const mainPdfPageInput = document.getElementById('main-pdf-page-input');
const mainPdfPageCount = document.getElementById('main-pdf-page-count');
const mainPdfZoomLabel = document.getElementById('main-pdf-zoom-label');

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
  // Reflect the host platform in the About modal subtitle. Cheap and runs once.
  try {
    const subtitle = document.getElementById('about-version-subtitle');
    if (subtitle) {
      const style = process.platform === 'win32' ? 'Windows Native Style'
                  : process.platform === 'darwin' ? 'macOS Native Style'
                  : process.platform;
      subtitle.textContent = `Version 1.0.0 (${style})`;
    }
  } catch (e) {
    console.error('Error setting about subtitle:', e);
  }

  try {
    setupEventListeners();
  } catch (e) {
    console.error("Error in setupEventListeners:", e);
  }

  try {
    await loadHistoryAndResume();
  } catch (e) {
    console.error("Error in loadHistoryAndResume:", e);
  }

  try {
    initBilibiliDownloader();
  } catch (e) {
    console.error("Error in initBilibiliDownloader:", e);
  }

  try {
    initOnlineCommunity();
  } catch (e) {
    console.error("Error in initOnlineCommunity:", e);
  }

  try {
    initScreenshotsLibrary();
  } catch (e) {
    console.error("Error in initScreenshotsLibrary:", e);
  }

  try {
    initSettings();
  } catch (e) {
    console.error("Error in initSettings:", e);
  }

  try {
    initNotesFeature();
  } catch (e) {
    console.error("Error in initNotesFeature:", e);
  }
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
  videoElement.addEventListener('waiting', () => {
    if (currentViewerMode === 'video') showLoading('视频正在缓冲...');
  });
  videoElement.addEventListener('playing', () => {
    if (currentViewerMode === 'video') hideLoading();
  });
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

  // Main image/PDF viewer controls
  if (btnMainImageOpen) {
    btnMainImageOpen.addEventListener('click', () => {
      if (currentViewerMode === 'image' && currentFilePath) {
        ipcRenderer.invoke('open-path', currentFilePath);
      }
    });
  }
  if (btnMainImageFit) {
    btnMainImageFit.addEventListener('click', resetMainImageFit);
  }
  if (btnMainDocumentOpen) {
    btnMainDocumentOpen.addEventListener('click', () => {
      if (currentViewerMode === 'document' && currentFilePath) {
        ipcRenderer.invoke('open-path', currentFilePath);
      }
    });
  }
  if (btnMainDocumentRefresh) {
    btnMainDocumentRefresh.addEventListener('click', () => {
      if (currentViewerMode === 'document' && currentFilePath) {
        openDocumentInMainViewer(currentFilePath, { forceRefresh: true });
      }
    });
  }
  if (mainDocumentViewer) {
    mainDocumentViewer.addEventListener('click', (e) => {
      const button = e.target.closest('[data-main-document-action]');
      if (!button) return;
      handleMainDocumentAction(button.dataset.mainDocumentAction);
    });
  }
  if (mainDocumentPageInput) {
    mainDocumentPageInput.addEventListener('change', () => {
      goToMainDocumentPage(mainDocumentPageInput.value);
    });
    mainDocumentPageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goToMainDocumentPage(mainDocumentPageInput.value);
        mainDocumentPageInput.blur();
      }
    });
  }
  if (mainPdfViewer) {
    mainPdfViewer.addEventListener('click', (e) => {
      const button = e.target.closest('[data-main-pdf-action]');
      if (!button) return;
      handleMainPdfAction(button.dataset.mainPdfAction);
    });
  }
  if (mainPdfPageInput) {
    mainPdfPageInput.addEventListener('change', () => {
      goToMainPdfPage(mainPdfPageInput.value);
    });
    mainPdfPageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goToMainPdfPage(mainPdfPageInput.value);
      }
    });
  }

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
function saveMediaTreeState(extra = {}) {
  const payload = {
    lastDirectory: currentDirectory,
    expandedFolders: getExpandedFolderList(),
    ...extra
  };

  if (currentFilePath && !Object.prototype.hasOwnProperty.call(payload, 'lastMediaFile')) {
    payload.lastMediaFile = currentFilePath;
    payload.lastMediaKind = getMediaKind(currentFilePath, currentViewerMode) || currentViewerMode;
  }

  ipcRenderer.invoke('save-history', payload);
}

function getLastMediaRestoreTarget(history) {
  const filePath = history.lastMediaFile || history.lastPlayedFile || '';
  if (!filePath) return null;

  const mediaKind = getMediaKind(filePath, history.lastMediaKind);
  if (!mediaKind) return null;

  return { filePath, mediaKind };
}

function restoreLastMediaFromHistory(history, autoResume) {
  if (!autoResume) return;

  const target = getLastMediaRestoreTarget(history);
  if (!target) return;

  const { filePath, mediaKind } = target;
  const progress = mediaKind === 'video' && history.lastPlayedFile === filePath
    ? history.lastProgress || 0
    : 0;

  if (mediaKind === 'video') {
    showLoading('正在恢复上次播放进度...');
  } else if (mediaKind === 'pdf') {
    showLoading('正在恢复上次阅读的 PDF...');
  } else if (mediaKind === 'image') {
    showLoading('正在恢复上次查看的图片...');
  } else if (mediaKind === 'document') {
    showLoading('正在恢复上次查看的文档...');
  }

  setTimeout(() => {
    if (mediaKind === 'video') {
      playVideo(filePath, progress, false);
    } else {
      openMediaFile(filePath, mediaKind);
    }
  }, 500);
}

async function loadHistoryAndResume() {
  const history = await ipcRenderer.invoke('get-history');
  
  if (history.folderCategories) {
    folderCategories = history.folderCategories;
  }

  if (Array.isArray(history.expandedFolders)) {
    expandedFolders = new Set(history.expandedFolders.filter(Boolean));
    hasPersistedExpandedFolders = true;
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

  restoreLastMediaFromHistory(history, autoResume);
}

function savePlaybackProgress() {
  if (currentViewerMode !== 'video') return;
  if (!currentFilePath) return;

  const currentSec = isTranscoding 
    ? (transcodeStartTime + videoElement.currentTime) 
    : videoElement.currentTime;

  const progressPercent = currentFileDuration > 0 ? (currentSec / currentFileDuration) * 100 : 0;

  // Update recent list
  updateRecentList(currentFilePath, currentSec, currentFileDuration);

  ipcRenderer.invoke('save-history', {
    lastDirectory: currentDirectory,
    expandedFolders: getExpandedFolderList(),
    lastMediaFile: currentFilePath,
    lastMediaKind: 'video',
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
    showBottomTip('当前没有已播放完成的视频记录！');
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
  if (currentViewerMode !== 'video') return;
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
    expandedFolders = new Set();
    hasPersistedExpandedFolders = false;
    lastRenderedRootPath = '';
    renderDirectoryTree(result.tree);
    if (typeof updateSavePathLabel === 'function') updateSavePathLabel();
    
    // Save directory path to history
    saveMediaTreeState();
  }
}

function renderDirectoryTree(tree) {
  currentDirectoryTree = tree;
  directoryTree.innerHTML = '';
  
  if (!tree || !tree.children || tree.children.length === 0) {
    directoryTree.innerHTML = `
      <div class="tree-placeholder">
        <p>目录中无支持的媒体文件</p>
        <span>支持视频、PDF、图片以及 Word / Excel / PPT</span>
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
    if (isNewRoot && child.type === 'directory' && !hasPersistedExpandedFolders) {
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
  const mediaKind = node.type === 'file' ? getMediaKind(node.path, node.mediaKind) : null;
  
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

  // Icon (Folder vs supported media file)
  const iconSpan = document.createElement('span');
  iconSpan.className = `tree-icon ${mediaKind ? `tree-icon-${mediaKind}` : ''}`;
  if (node.type === 'directory') {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
    `;
  } else if (mediaKind === 'pdf') {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M8 15h1.5a1.5 1.5 0 0 0 0-3H8v5"></path>
        <path d="M13 12v5"></path>
        <path d="M16 12h2"></path>
      </svg>
    `;
  } else if (mediaKind === 'image') {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    `;
  } else if (mediaKind === 'document') {
    iconSpan.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="8" y1="13" x2="16" y2="13"></line>
        <line x1="8" y1="17" x2="16" y2="17"></line>
        <line x1="8" y1="9" x2="10" y2="9"></line>
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
  if (node.type === 'file' && mediaKind === 'video') {
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
        if (confirm(`警告：确认要彻底删除目录 "${node.name}" 及其所有子目录和媒体文件吗？此操作不可逆！`)) {
          const success = await ipcRenderer.invoke('delete-directory-folder', node.path);
          if (success) {
            // Re-scan parent tree or reload directory
            if (currentDirectory) {
              const tree = await ipcRenderer.invoke('get-directory-tree', currentDirectory);
              if (tree) renderDirectoryTree(tree);
            }
          } else {
            showBottomTip('删除目录失败，请检查目录权限或文件是否被占用。');
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
    // Click file to open with the matching viewer
    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      openMediaFile(node.path, mediaKind);
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

  saveMediaTreeState();
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

  // 搜索时将目录行隐藏，使结果只展示匹配的媒体文件名
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
function ensurePlayerContainerVisible() {
  const views = [
    ['downloader-view', 'btn-toggle-downloader'],
    ['community-view', 'btn-toggle-community'],
    ['screenshots-view', 'btn-toggle-screenshots'],
    ['settings-view', 'btn-toggle-settings'],
    ['notes-view', 'btn-toggle-notes']
  ];

  views.forEach(([viewId, toggleId]) => {
    const view = document.getElementById(viewId);
    const toggle = document.getElementById(toggleId);
    if (view && !view.classList.contains('hidden')) {
      if (toggle) toggle.classList.remove('active');
      view.classList.add('hidden');
    }
  });

  if (playerContainer) playerContainer.classList.remove('hidden');
}

function resetVideoControlsForDocumentMode() {
  stopHistorySaveTimer();
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
  timelineSlider.value = 0;
  timelineProgress.style.width = '0%';
  timelineBuffered.style.width = '0%';
  currentTimeLabel.textContent = '00:00';
  totalDurationLabel.textContent = '00:00';
  transcodeTag.classList.add('hidden');
  currentFileDuration = 0;
  isTranscoding = false;
  transcodeStartTime = 0;
}

function setMainViewerMode(mode) {
  currentViewerMode = mode;
  playerContainer.classList.remove('viewer-mode-video', 'viewer-mode-image', 'viewer-mode-document', 'viewer-mode-pdf', 'viewer-mode-welcome');
  playerContainer.classList.add(`viewer-mode-${mode}`);

  videoElement.classList.toggle('hidden', mode !== 'video');
  if (mainImageViewer) mainImageViewer.classList.toggle('hidden', mode !== 'image');
  if (mainDocumentViewer) mainDocumentViewer.classList.toggle('hidden', mode !== 'document');
  if (mainPdfViewer) mainPdfViewer.classList.toggle('hidden', mode !== 'pdf');

  if (mode === 'video') {
    controlsOverlay.classList.remove('hidden');
  } else {
    controlsOverlay.classList.add('hidden');
    playerContainer.style.cursor = 'default';
  }

  if (mode !== 'welcome') {
    welcomeOverlay.style.opacity = '0';
    welcomeOverlay.classList.add('hidden');
  }
}

function openMediaFile(filePath, mediaKind = null) {
  const kind = getMediaKind(filePath, mediaKind);
  if (kind === 'video') {
    playVideo(filePath, 0, true);
    return;
  }
  if (kind === 'pdf') {
    openPdfInMainViewer(filePath);
    return;
  }
  if (kind === 'image') {
    openImageInMainViewer(filePath);
    return;
  }
  if (kind === 'document') {
    openDocumentInMainViewer(filePath);
    return;
  }
  showBottomTip('暂不支持该文件类型');
}

function preloadMainImage(src, alt) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.alt = alt;
    img.decoding = 'async';
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') await img.decode();
      } catch (_) {
        // Cached or animated images may reject decode(); onload is sufficient for preview.
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function disconnectMainPdfResizeObserver() {
  if (mainPdfResizeObserver) {
    mainPdfResizeObserver.disconnect();
    mainPdfResizeObserver = null;
  }
}

function getStoredMainPdfPageMode() {
  try {
    const mode = localStorage.getItem(MAIN_PDF_PAGE_MODE_STORAGE_KEY);
    return mode === 'single' || mode === 'double' ? mode : 'double';
  } catch (_) {
    return 'double';
  }
}

function saveStoredMainPdfPageMode(mode) {
  if (mode !== 'single' && mode !== 'double') return;
  try {
    localStorage.setItem(MAIN_PDF_PAGE_MODE_STORAGE_KEY, mode);
  } catch (_) {
    // Ignore storage failures; reading can still continue with the default mode.
  }
}

function isMainPdfFullscreen() {
  return document.fullscreenElement === playerContainer;
}

function syncMainPdfFullscreenButton() {
  if (!mainPdfViewer) return;
  const fullscreenBtn = mainPdfViewer.querySelector('[data-main-pdf-action="toggle-fullscreen"]');
  if (!fullscreenBtn) return;

  const isFullscreen = isMainPdfFullscreen();
  const enterIcon = fullscreenBtn.querySelector('[data-role="fullscreen-enter"]');
  const exitIcon = fullscreenBtn.querySelector('[data-role="fullscreen-exit"]');
  fullscreenBtn.disabled = !mainPdfState?.pageCount;
  fullscreenBtn.classList.toggle('active', isFullscreen);
  fullscreenBtn.title = isFullscreen ? '恢复主界面显示' : '全屏阅读';
  fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  if (enterIcon) enterIcon.classList.toggle('hidden', isFullscreen);
  if (exitIcon) exitIcon.classList.toggle('hidden', !isFullscreen);
}

async function toggleMainPdfFullscreen() {
  if (!playerContainer || !mainPdfViewer || mainPdfViewer.classList.contains('hidden')) return;

  try {
    if (isMainPdfFullscreen()) {
      await document.exitFullscreen();
    } else {
      await playerContainer.requestFullscreen();
    }
  } catch (err) {
    console.error('PDF fullscreen toggle failed:', err);
  } finally {
    syncMainPdfFullscreenButton();
  }
}

function resetMainImageFit() {
  if (mainImagePreview) {
    mainImagePreview.style.maxWidth = '100%';
    mainImagePreview.style.maxHeight = '100%';
    mainImagePreview.style.transform = '';
  }
  const stage = document.querySelector('.main-image-stage');
  if (stage) stage.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  if (mainImageStatus) mainImageStatus.textContent = '适合窗口显示';
}

const MAIN_DOCUMENT_PAGE_WIDTH = 760;
const MAIN_DOCUMENT_PAGE_HEIGHT = 1040;
const MAIN_DOCUMENT_PAGE_PADDING_X = 64;
const MAIN_DOCUMENT_PAGE_PADDING_Y = 58;

function getDocumentMeta(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (['.doc', '.docx'].includes(ext)) {
    return { badge: 'WORD', type: 'Word 文档', placeholder: 'WORD' };
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return { badge: 'XLS', type: 'Excel 表格', placeholder: 'XLS' };
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return { badge: 'PPT', type: 'PowerPoint 演示文稿', placeholder: 'PPT' };
  }
  return { badge: 'DOC', type: 'Office 文档', placeholder: 'DOC' };
}

function getMainDocumentScopedStyleId() {
  return 'main-document-converted-style';
}

function scopeMainDocumentCss(cssText) {
  return String(cssText || '').replace(/([^{}]+)\{([^{}]*)\}/g, (match, selectorText, bodyText) => {
    const trimmedSelector = selectorText.trim();
    if (!trimmedSelector || trimmedSelector.startsWith('@')) return match;
    const scopedSelector = trimmedSelector.split(',')
      .map(selector => {
        const clean = selector.trim();
        if (!clean) return '';
        if (clean === 'body' || clean === 'html') return '.main-document-page-body';
        return `.main-document-page-body ${clean}`;
      })
      .filter(Boolean)
      .join(', ');
    return scopedSelector ? `${scopedSelector}{${bodyText}}` : match;
  });
}

function applyMainDocumentConvertedStyles(styles) {
  let styleEl = document.getElementById(getMainDocumentScopedStyleId());
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = getMainDocumentScopedStyleId();
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = styles ? scopeMainDocumentCss(styles) : '';
}

function extractMainDocumentHtml(html) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(String(html || ''), 'text/html');
  parsed.querySelectorAll('script, iframe, object, embed').forEach(node => node.remove());
  const styles = Array.from(parsed.querySelectorAll('style'))
    .map(style => style.textContent || '')
    .join('\n');
  const bodyHtml = parsed.body ? parsed.body.innerHTML : String(html || '');
  return { styles, bodyHtml };
}

function paginateMainDocumentHtml(html) {
  const { styles, bodyHtml } = extractMainDocumentHtml(html);
  applyMainDocumentConvertedStyles(styles);

  const source = document.createElement('div');
  source.innerHTML = bodyHtml;

  const measure = document.createElement('div');
  measure.className = 'main-document-pagination-measure main-document-page-body';
  const innerWidth = MAIN_DOCUMENT_PAGE_WIDTH - MAIN_DOCUMENT_PAGE_PADDING_X * 2;
  const innerHeight = MAIN_DOCUMENT_PAGE_HEIGHT - MAIN_DOCUMENT_PAGE_PADDING_Y * 2;
  measure.style.width = `${innerWidth}px`;
  document.body.appendChild(measure);

  const pages = [];
  const sourceNodes = Array.from(source.childNodes)
    .filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());

  const pushMeasurePage = () => {
    const pageHtml = measure.innerHTML.trim();
    if (pageHtml) pages.push(pageHtml);
    measure.replaceChildren();
  };

  sourceNodes.forEach(node => {
    const clone = node.cloneNode(true);
    measure.appendChild(clone);
    if (measure.scrollHeight > innerHeight && measure.childNodes.length > 1) {
      measure.removeChild(clone);
      pushMeasurePage();
      measure.appendChild(clone);
    }
  });

  pushMeasurePage();
  measure.remove();

  return pages.length > 0 ? pages : ['<p>文档内容为空</p>'];
}

function setMainDocumentPlaceholder(title, message) {
  if (mainDocumentReader) mainDocumentReader.classList.add('hidden');
  if (mainDocumentPreviewShell) mainDocumentPreviewShell.classList.remove('hidden');
  if (mainDocumentPlaceholder) {
    mainDocumentPlaceholder.classList.remove('hidden');
    const titleEl = mainDocumentPlaceholder.querySelector('h3');
    const messageEl = mainDocumentPlaceholder.querySelector('p');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
  }
  if (mainDocumentPreview) {
    mainDocumentPreview.classList.add('hidden');
    mainDocumentPreview.removeAttribute('src');
  }
}

function clearMainDocumentPreview() {
  mainDocumentState = null;
  disconnectMainDocumentResizeObserver();
  applyMainDocumentConvertedStyles('');
  if (mainDocumentReader) mainDocumentReader.classList.add('hidden');
  if (mainDocumentPreviewShell) mainDocumentPreviewShell.classList.remove('hidden');
  if (mainDocumentPageBody) mainDocumentPageBody.innerHTML = '';
  if (mainDocumentPreview) {
    mainDocumentPreview.classList.add('hidden');
    mainDocumentPreview.removeAttribute('src');
    mainDocumentPreview.style.width = '';
    mainDocumentPreview.style.maxWidth = '';
    mainDocumentPreview.style.maxHeight = '';
  }
  if (mainDocumentPlaceholder) mainDocumentPlaceholder.classList.remove('hidden');
  syncMainDocumentControls();
}

function disconnectMainDocumentResizeObserver() {
  if (mainDocumentResizeObserver) {
    mainDocumentResizeObserver.disconnect();
    mainDocumentResizeObserver = null;
  }
}

function connectMainDocumentResizeObserver() {
  disconnectMainDocumentResizeObserver();
  if (!mainDocumentStage || typeof ResizeObserver === 'undefined') return;
  mainDocumentResizeObserver = new ResizeObserver(() => {
    if (currentViewerMode === 'document' && mainDocumentState && !mainDocumentState.manualZoom) {
      applyMainDocumentAutoFit();
    }
  });
  mainDocumentResizeObserver.observe(mainDocumentStage);
}

function syncMainDocumentControls() {
  const state = mainDocumentState;
  const hasDocument = Boolean(state);
  const hasMultiplePages = Boolean(state && state.pageCount > 1);

  if (mainDocumentPageInput) {
    mainDocumentPageInput.value = state?.currentPage || 1;
    mainDocumentPageInput.max = state?.pageCount || 1;
    mainDocumentPageInput.disabled = !hasMultiplePages;
  }
  if (mainDocumentPageCount) {
    mainDocumentPageCount.textContent = state?.pageCount || '--';
  }
  if (mainDocumentZoomLabel) {
    mainDocumentZoomLabel.textContent = `${Math.round((state?.zoom || 1) * 100)}%`;
  }
  if (mainDocumentViewer) {
    const prevBtn = mainDocumentViewer.querySelector('[data-main-document-action="prev"]');
    const nextBtn = mainDocumentViewer.querySelector('[data-main-document-action="next"]');
    const zoomOutBtn = mainDocumentViewer.querySelector('[data-main-document-action="zoom-out"]');
    const zoomInBtn = mainDocumentViewer.querySelector('[data-main-document-action="zoom-in"]');
    const fitBtn = mainDocumentViewer.querySelector('[data-main-document-action="fit"]');
    if (prevBtn) prevBtn.disabled = !hasMultiplePages || state.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = !hasMultiplePages || state.currentPage >= state.pageCount;
    if (zoomOutBtn) zoomOutBtn.disabled = !hasDocument;
    if (zoomInBtn) zoomInBtn.disabled = !hasDocument;
    if (fitBtn) fitBtn.disabled = !hasDocument;
  }
}

function applyMainDocumentZoom() {
  const state = mainDocumentState;
  if (!state) {
    syncMainDocumentControls();
    return;
  }

  if (state.mode === 'html') {
    if (mainDocumentPageViewport) {
      mainDocumentPageViewport.style.width = `${state.basePageWidth * state.zoom}px`;
      mainDocumentPageViewport.style.height = `${state.basePageHeight * state.zoom}px`;
    }
    if (mainDocumentPagePaper) {
      mainDocumentPagePaper.style.width = `${state.basePageWidth}px`;
      mainDocumentPagePaper.style.height = `${state.basePageHeight}px`;
      mainDocumentPagePaper.style.setProperty('--main-document-zoom', state.zoom);
      mainDocumentPagePaper.style.transform = `scale(${state.zoom})`;
    }
  } else if (state.mode === 'image' && mainDocumentPreview) {
    mainDocumentPreview.style.maxWidth = 'none';
    mainDocumentPreview.style.maxHeight = 'none';
    mainDocumentPreview.style.width = `${state.basePageWidth * state.zoom}px`;
  }

  syncMainDocumentControls();
}

function applyMainDocumentAutoFit() {
  const state = mainDocumentState;
  if (!state || !mainDocumentStage) {
    syncMainDocumentControls();
    return;
  }
  if (state.manualZoom) {
    syncMainDocumentControls();
    return;
  }

  const stageStyle = window.getComputedStyle(mainDocumentStage);
  const paddingX = parseCssPx(stageStyle.paddingLeft) + parseCssPx(stageStyle.paddingRight);
  const paddingY = parseCssPx(stageStyle.paddingTop) + parseCssPx(stageStyle.paddingBottom);
  const pageNumberReserve = state.mode === 'html' ? 28 : 0;
  const availableWidth = Math.max(160, mainDocumentStage.clientWidth - paddingX);
  const availableHeight = Math.max(180, mainDocumentStage.clientHeight - paddingY - pageNumberReserve);
  const widthZoom = availableWidth / state.basePageWidth;
  const heightZoom = availableHeight / state.basePageHeight;
  state.zoom = Math.min(2.2, Math.max(0.2, Math.min(widthZoom, heightZoom)));
  applyMainDocumentZoom();
}

function renderMainDocumentPage(direction = 'forward') {
  const state = mainDocumentState;
  if (!state || state.mode !== 'html' || !mainDocumentPageBody) return;
  const pageHtml = state.pages[state.currentPage - 1] || '';
  mainDocumentPageBody.innerHTML = pageHtml;
  if (mainDocumentPageNumber) {
    mainDocumentPageNumber.textContent = `第 ${state.currentPage} 页`;
  }
  if (mainDocumentStatus) {
    mainDocumentStatus.textContent = `${state.currentPage} / ${state.pageCount} 页`;
  }
  if (mainDocumentPagePaper) {
    mainDocumentPagePaper.classList.remove('page-turn-forward', 'page-turn-backward');
    void mainDocumentPagePaper.offsetWidth;
    mainDocumentPagePaper.classList.add(direction === 'backward' ? 'page-turn-backward' : 'page-turn-forward');
    setTimeout(() => {
      if (mainDocumentPagePaper) {
        mainDocumentPagePaper.classList.remove('page-turn-forward', 'page-turn-backward');
      }
    }, 260);
  }
  applyMainDocumentZoom();
}

function goToMainDocumentPage(page) {
  const state = mainDocumentState;
  if (!state || state.mode !== 'html') return;
  const targetPage = Math.min(state.pageCount, Math.max(1, parseInt(page, 10) || 1));
  if (targetPage === state.currentPage) {
    syncMainDocumentControls();
    return;
  }
  const direction = targetPage < state.currentPage ? 'backward' : 'forward';
  state.currentPage = targetPage;
  renderMainDocumentPage(direction);
}

function turnMainDocumentPage(direction) {
  const state = mainDocumentState;
  if (!state || state.mode !== 'html') return;
  goToMainDocumentPage(state.currentPage + (direction === 'prev' ? -1 : 1));
}

function handleMainDocumentAction(action) {
  const state = mainDocumentState;
  if (!state) return;

  switch (action) {
    case 'prev':
      turnMainDocumentPage('prev');
      break;
    case 'next':
      turnMainDocumentPage('next');
      break;
    case 'zoom-out':
      state.manualZoom = true;
      state.zoom = Math.max(0.25, Math.round((state.zoom - 0.1) * 10) / 10);
      applyMainDocumentZoom();
      if (mainDocumentStatus) mainDocumentStatus.textContent = `${Math.round(state.zoom * 100)}% · 手动缩放`;
      break;
    case 'zoom-in':
      state.manualZoom = true;
      state.zoom = Math.min(2.4, Math.round((state.zoom + 0.1) * 10) / 10);
      applyMainDocumentZoom();
      if (mainDocumentStatus) mainDocumentStatus.textContent = `${Math.round(state.zoom * 100)}% · 手动缩放`;
      break;
    case 'fit':
      state.manualZoom = false;
      applyMainDocumentAutoFit();
      if (mainDocumentStatus) mainDocumentStatus.textContent = state.mode === 'html'
        ? `${state.currentPage} / ${state.pageCount} 页 · 适合窗口`
        : '适合窗口显示';
      break;
  }
}

function showMainDocumentHtml(html) {
  const pages = paginateMainDocumentHtml(html);
  mainDocumentState = {
    mode: 'html',
    pages,
    pageCount: pages.length,
    currentPage: 1,
    zoom: 1,
    manualZoom: false,
    basePageWidth: MAIN_DOCUMENT_PAGE_WIDTH,
    basePageHeight: MAIN_DOCUMENT_PAGE_HEIGHT
  };
  if (mainDocumentPreviewShell) mainDocumentPreviewShell.classList.add('hidden');
  if (mainDocumentReader) mainDocumentReader.classList.remove('hidden');
  if (mainDocumentPreview) {
    mainDocumentPreview.classList.add('hidden');
    mainDocumentPreview.removeAttribute('src');
  }
  renderMainDocumentPage('forward');
  connectMainDocumentResizeObserver();
  applyMainDocumentAutoFit();
}

function showMainDocumentImage(imageUrl, baseName, loadedImage) {
  mainDocumentState = {
    mode: 'image',
    pageCount: 1,
    currentPage: 1,
    zoom: 1,
    manualZoom: false,
    basePageWidth: loadedImage.naturalWidth || 900,
    basePageHeight: loadedImage.naturalHeight || 1200
  };
  if (mainDocumentReader) mainDocumentReader.classList.add('hidden');
  if (mainDocumentPreviewShell) mainDocumentPreviewShell.classList.remove('hidden');
  if (mainDocumentPlaceholder) mainDocumentPlaceholder.classList.add('hidden');
  if (mainDocumentPreview) {
    mainDocumentPreview.src = imageUrl;
    mainDocumentPreview.alt = `${baseName} 预览`;
    mainDocumentPreview.classList.remove('hidden');
  }
  connectMainDocumentResizeObserver();
  applyMainDocumentAutoFit();
}

function resetMainPdfSlots(message = '请选择 PDF 文件', className = 'main-viewer-loading') {
  if (!mainPdfSpread) return;
  mainPdfSpread.querySelectorAll('.main-pdf-page-slot').forEach(slot => {
    slot.classList.remove('empty', 'is-rendering-next', 'page-turn-forward', 'page-turn-backward');
    delete slot.dataset.pageNumber;
    const content = document.createElement('div');
    content.className = className;
    content.textContent = message;
    slot.replaceChildren(content);
  });
}

function syncMainPdfControls() {
  const state = mainPdfState;
  const hasPdf = Boolean(state && state.pageCount);
  const step = state?.pageMode === 'double' ? 2 : 1;

  if (mainPdfPageInput) {
    mainPdfPageInput.value = state?.currentPage || 1;
    mainPdfPageInput.max = state?.pageCount || 1;
    mainPdfPageInput.disabled = !hasPdf;
  }
  if (mainPdfPageCount) {
    mainPdfPageCount.textContent = state?.pageCount || '--';
  }
  if (mainPdfZoomLabel) {
    mainPdfZoomLabel.textContent = `${Math.round((state?.zoom || 1) * 100)}%`;
  }
  if (mainPdfSpread) {
    mainPdfSpread.style.setProperty('--main-pdf-page-zoom', state?.zoom || 1);
  }
  if (mainPdfViewer) {
    mainPdfViewer.classList.toggle('single-page-mode', state?.pageMode === 'single');
    const prevBtn = mainPdfViewer.querySelector('[data-main-pdf-action="prev"]');
    const nextBtn = mainPdfViewer.querySelector('[data-main-pdf-action="next"]');
    const zoomOutBtn = mainPdfViewer.querySelector('[data-main-pdf-action="zoom-out"]');
    const zoomInBtn = mainPdfViewer.querySelector('[data-main-pdf-action="zoom-in"]');
    const openBtn = mainPdfViewer.querySelector('[data-main-pdf-action="open-file"]');
    const modeBtn = mainPdfViewer.querySelector('[data-main-pdf-action="toggle-page-mode"]');
    const fullscreenBtn = mainPdfViewer.querySelector('[data-main-pdf-action="toggle-fullscreen"]');

    if (prevBtn) prevBtn.disabled = !hasPdf || state.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = !hasPdf || state.currentPage + step > state.pageCount;
    if (zoomOutBtn) zoomOutBtn.disabled = !hasPdf;
    if (zoomInBtn) zoomInBtn.disabled = !hasPdf;
    if (openBtn) openBtn.disabled = !state?.pdfPath;
    if (fullscreenBtn) fullscreenBtn.disabled = !hasPdf;
    if (modeBtn) {
      modeBtn.disabled = !hasPdf;
      modeBtn.textContent = state?.pageMode === 'single' ? '单页' : '双页';
      modeBtn.title = state?.pageMode === 'single'
        ? '当前单页展示，点击切换为双页'
        : '当前双页展示，点击切换为单页';
    }
    syncMainPdfFullscreenButton();
  }
}

function parseCssPx(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyMainPdfAutoFit() {
  const state = mainPdfState;
  if (!state || !mainPdfSpread) {
    syncMainPdfControls();
    return;
  }
  if (state.manualZoom) {
    syncMainPdfControls();
    return;
  }

  const pageSlots = state.pageMode === 'double' ? 2 : 1;
  const spreadStyle = window.getComputedStyle(mainPdfSpread);
  const paddingX = parseCssPx(spreadStyle.paddingLeft) + parseCssPx(spreadStyle.paddingRight);
  const paddingY = parseCssPx(spreadStyle.paddingTop) + parseCssPx(spreadStyle.paddingBottom);
  const gap = state.pageMode === 'double' ? parseCssPx(spreadStyle.columnGap || spreadStyle.gap || '0') : 0;
  const pageNumberReserve = 28;
  const availableWidth = Math.max(120, mainPdfSpread.clientWidth - paddingX - gap);
  const availableHeight = Math.max(160, mainPdfSpread.clientHeight - paddingY - pageNumberReserve);
  const widthZoom = availableWidth / (state.basePageWidth * pageSlots);
  const heightZoom = availableHeight / (state.basePageWidth * state.pageAspectRatio);
  state.zoom = Math.min(2.4, Math.max(0.2, Math.min(widthZoom, heightZoom)));
  syncMainPdfControls();
}

function updateMainPdfStatus(pages) {
  const state = mainPdfState;
  if (!state || !mainPdfStatus) return;
  const modeText = state.pageMode === 'double' ? '双页阅读' : '单页阅读';
  if (!state.pageCount) {
    mainPdfStatus.textContent = '正在读取 PDF...';
    return;
  }
  mainPdfStatus.textContent = pages && pages[1]
    ? `${pages[0]}-${pages[1]} / ${state.pageCount} 页 · ${modeText}`
    : `${state.currentPage} / ${state.pageCount} 页 · ${modeText}`;
}

function showMainPdfPageNotice(slot, message, type = 'info') {
  const oldNotice = slot.querySelector('.main-pdf-page-notice');
  if (oldNotice) oldNotice.remove();

  const notice = document.createElement('div');
  notice.className = `main-pdf-page-notice ${type}`;
  notice.textContent = message;
  slot.appendChild(notice);
  setTimeout(() => {
    if (notice.parentNode === slot) notice.remove();
  }, 2400);
}

function showMainPdfSlotMessage(slot, message, className = 'main-pdf-page-error') {
  if (!slot) return;
  const content = document.createElement('div');
  content.className = className;
  content.textContent = message;
  slot.replaceChildren(content);
}

function goToMainPdfPage(page) {
  const state = mainPdfState;
  if (!state || !state.pageCount) return;
  const targetPage = Math.min(state.pageCount, Math.max(1, parseInt(page, 10) || 1));
  if (targetPage === state.currentPage) {
    syncMainPdfControls();
    return;
  }
  state.currentPage = targetPage;
  renderMainPdfSpread();
}

function turnMainPdfPage(direction) {
  const state = mainPdfState;
  if (!state || !state.pageCount) return;
  const step = state.pageMode === 'double' ? 2 : 1;
  const targetPage = direction === 'prev'
    ? state.currentPage - step
    : state.currentPage + step;
  goToMainPdfPage(targetPage);
}

function handleMainPdfAction(action) {
  const state = mainPdfState;
  if (action === 'open-file') {
    if (state?.pdfPath) ipcRenderer.invoke('open-path', state.pdfPath);
    return;
  }
  if (action === 'toggle-fullscreen') {
    if (state?.pageCount) toggleMainPdfFullscreen();
    return;
  }
  if (!state || !state.pageCount) return;

  switch (action) {
    case 'prev':
      turnMainPdfPage('prev');
      break;
    case 'next':
      turnMainPdfPage('next');
      break;
    case 'zoom-out':
      state.manualZoom = true;
      state.zoom = Math.max(0.25, Math.round((state.zoom - 0.1) * 10) / 10);
      syncMainPdfControls();
      if (mainPdfStatus) mainPdfStatus.textContent = `${Math.round(state.zoom * 100)}% · 手动缩放`;
      break;
    case 'zoom-in':
      state.manualZoom = true;
      state.zoom = Math.min(2.4, Math.round((state.zoom + 0.1) * 10) / 10);
      syncMainPdfControls();
      if (mainPdfStatus) mainPdfStatus.textContent = `${Math.round(state.zoom * 100)}% · 手动缩放`;
      break;
    case 'toggle-page-mode':
      state.pageMode = state.pageMode === 'double' ? 'single' : 'double';
      saveStoredMainPdfPageMode(state.pageMode);
      if (!state.manualZoom) {
        applyMainPdfAutoFit();
      } else {
        syncMainPdfControls();
      }
      renderMainPdfSpread();
      break;
  }
}

async function openImageInMainViewer(filePath) {
  const token = ++mainViewerToken;
  ensurePlayerContainerVisible();
  if (currentViewerMode === 'video') savePlaybackProgress();
  setMainViewerMode('image');
  resetVideoControlsForDocumentMode();
  disconnectMainPdfResizeObserver();
  mainPdfState = null;
  clearMainDocumentPreview();
  currentFilePath = filePath;
  highlightActiveFileDOM(filePath);
  resetMainImageFit();
  saveMediaTreeState({ lastMediaFile: filePath, lastMediaKind: 'image' });

  const imageUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(filePath)}`;
  const baseName = path.basename(filePath);
  if (mainImageTitle) mainImageTitle.textContent = baseName;
  if (mainImageStatus) mainImageStatus.textContent = '正在加载图片...';
  if (mainImagePreview) mainImagePreview.removeAttribute('src');
  showLoading('正在加载图片...');

  try {
    await preloadMainImage(imageUrl, baseName);
    if (token !== mainViewerToken || currentViewerMode !== 'image') return;
    mainImagePreview.src = imageUrl;
    mainImagePreview.alt = baseName;
    if (mainImageStatus) mainImageStatus.textContent = '适合窗口显示';
  } catch (err) {
    if (token !== mainViewerToken || currentViewerMode !== 'image') return;
    if (mainImageStatus) mainImageStatus.textContent = `图片打开失败：${err.message}`;
    if (mainImagePreview) mainImagePreview.removeAttribute('src');
  } finally {
    if (token === mainViewerToken) hideLoading();
  }
}

async function openDocumentInMainViewer(filePath, options = {}) {
  const token = ++mainViewerToken;
  ensurePlayerContainerVisible();
  if (currentViewerMode === 'video') savePlaybackProgress();
  setMainViewerMode('document');
  resetVideoControlsForDocumentMode();
  disconnectMainPdfResizeObserver();
  mainPdfState = null;
  clearMainDocumentPreview();
  currentFilePath = filePath;
  highlightActiveFileDOM(filePath);
  saveMediaTreeState({ lastMediaFile: filePath, lastMediaKind: 'document' });

  const baseName = path.basename(filePath);
  const meta = getDocumentMeta(filePath);
  if (mainDocumentBadge) mainDocumentBadge.textContent = meta.badge;
  if (mainDocumentPlaceholderIcon) mainDocumentPlaceholderIcon.textContent = meta.placeholder;
  if (mainDocumentTitle) mainDocumentTitle.textContent = baseName;
  if (mainDocumentStatus) mainDocumentStatus.textContent = '正在准备文档预览...';
  setMainDocumentPlaceholder('正在准备文档预览', 'Word 文档会转换为分页阅读视图；其它 Office 文档会尝试生成系统预览。');
  showLoading('正在准备文档预览...');

  try {
    const result = await ipcRenderer.invoke('document-get-preview', {
      documentPath: filePath,
      forceRefresh: Boolean(options.forceRefresh)
    });
    if (token !== mainViewerToken || currentViewerMode !== 'document') return;

    if (!result || !result.success) {
      const message = result?.error || '当前文档暂时无法生成内置预览';
      if (mainDocumentStatus) mainDocumentStatus.textContent = `预览不可用：${message}`;
      setMainDocumentPlaceholder('预览不可用', `${message}。可以通过“系统打开/编辑”使用默认 Office 应用查看和修改。`);
      return;
    }

    if (result.mode === 'html' && result.html) {
      showMainDocumentHtml(result.html);
      if (token !== mainViewerToken || currentViewerMode !== 'document') return;
      if (mainDocumentStatus) mainDocumentStatus.textContent = `${mainDocumentState.pageCount} 页 · 适合窗口`;
      return;
    }

    if (result.absolutePath) {
      const imageUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(result.absolutePath)}`;
      const loadedImage = await preloadMainImage(imageUrl, `${baseName} 预览`);
      if (token !== mainViewerToken || currentViewerMode !== 'document') return;
      showMainDocumentImage(imageUrl, baseName, loadedImage);
      if (mainDocumentStatus) mainDocumentStatus.textContent = '已生成系统预览 · 可用系统应用继续查看/编辑';
      return;
    }

    if (mainDocumentStatus) mainDocumentStatus.textContent = '当前文档暂时无法生成内置预览';
    setMainDocumentPlaceholder('预览不可用', '当前文档暂时无法生成内置预览。可以通过“系统打开/编辑”使用默认 Office 应用查看和修改。');
  } catch (err) {
    if (token !== mainViewerToken || currentViewerMode !== 'document') return;
    if (mainDocumentStatus) mainDocumentStatus.textContent = `文档预览失败：${err.message}`;
    setMainDocumentPlaceholder('文档预览失败', `${err.message}。可以通过“系统打开/编辑”使用默认 Office 应用查看和修改。`);
  } finally {
    if (token === mainViewerToken) hideLoading();
  }
}

async function openPdfInMainViewer(filePath) {
  const token = ++mainViewerToken;
  ensurePlayerContainerVisible();
  if (currentViewerMode === 'video') savePlaybackProgress();
  setMainViewerMode('pdf');
  resetVideoControlsForDocumentMode();
  disconnectMainPdfResizeObserver();
  clearMainDocumentPreview();
  currentFilePath = filePath;
  highlightActiveFileDOM(filePath);
  saveMediaTreeState({ lastMediaFile: filePath, lastMediaKind: 'pdf' });

  const baseName = path.basename(filePath);
  if (mainPdfTitle) mainPdfTitle.textContent = baseName;
  if (mainPdfStatus) mainPdfStatus.textContent = '正在读取 PDF...';

  mainPdfState = {
    pdfPath: filePath,
    title: baseName,
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    manualZoom: false,
    pageMode: getStoredMainPdfPageMode(),
    renderScale: 2,
    renderToken: 0,
    basePageWidth: 430,
    pageAspectRatio: 1.294,
    lastRenderedPage: 1,
    hasRenderedSpread: false,
    turnDirection: 'forward'
  };

  resetMainPdfSlots('正在读取 PDF...', 'main-viewer-loading');
  syncMainPdfControls();
  showLoading('正在读取 PDF...');

  try {
    const info = await ipcRenderer.invoke('pdf-get-info', filePath);
    if (token !== mainViewerToken || currentViewerMode !== 'pdf') return;
    if (!info || !info.success) {
      throw new Error(info?.error || 'PDF 信息读取失败');
    }

    mainPdfState.pageCount = info.pageCount || 0;
    if (mainPdfState.pageCount <= 0) {
      throw new Error('PDF 没有可渲染页面');
    }
    applyMainPdfAutoFit();

    if (typeof ResizeObserver !== 'undefined' && mainPdfSpread) {
      mainPdfResizeObserver = new ResizeObserver(() => {
        if (mainPdfState && currentViewerMode === 'pdf' && !mainPdfState.manualZoom) {
          applyMainPdfAutoFit();
        }
      });
      mainPdfResizeObserver.observe(mainPdfSpread);
    }

    await renderMainPdfSpread();
  } catch (err) {
    if (token !== mainViewerToken || currentViewerMode !== 'pdf') return;
    console.error('Main PDF reader init failed:', err);
    if (mainPdfStatus) mainPdfStatus.textContent = `PDF 打开失败：${err.message}`;
    resetMainPdfSlots(`PDF 打开失败：${err.message}`, 'main-viewer-error');
  } finally {
    if (token === mainViewerToken) hideLoading();
  }
}

async function renderMainPdfSpread() {
  const state = mainPdfState;
  if (!state || !mainPdfViewer || !mainPdfSpread) return;

  const token = ++state.renderToken;
  const isInitialRender = !state.hasRenderedSpread;
  const leftSlot = mainPdfSpread.querySelector('[data-role="main-left-page"]');
  const rightSlot = mainPdfSpread.querySelector('[data-role="main-right-page"]');
  const pages = [
    state.currentPage,
    state.pageMode === 'double' && state.currentPage + 1 <= state.pageCount ? state.currentPage + 1 : null
  ];

  const previousPage = state.lastRenderedPage || state.currentPage;
  state.turnDirection = state.currentPage >= previousPage ? 'forward' : 'backward';

  syncMainPdfControls();
  updateMainPdfStatus(pages);

  await Promise.all([
    renderMainPdfPageIntoSlot(leftSlot, state, pages[0], token),
    renderMainPdfPageIntoSlot(rightSlot, state, pages[1], token)
  ]);

  if (token === state.renderToken && mainPdfState === state && currentViewerMode === 'pdf' && isInitialRender && !state.manualZoom) {
    applyMainPdfAutoFit();
  }

  if (token === state.renderToken && mainPdfState === state && currentViewerMode === 'pdf') {
    state.lastRenderedPage = state.currentPage;
    state.hasRenderedSpread = true;
    updateMainPdfStatus(pages);
  }
}

async function renderMainPdfPageIntoSlot(slot, state, pageNumber, token) {
  if (!slot) return;

  if (!pageNumber) {
    slot.classList.add('empty');
    slot.classList.remove('is-rendering-next', 'page-turn-forward', 'page-turn-backward');
    delete slot.dataset.pageNumber;
    showMainPdfSlotMessage(slot, '本书已到末页', 'main-pdf-page-empty');
    return;
  }

  if (slot.dataset.pageNumber === String(pageNumber) && slot.querySelector('img')) {
    slot.classList.remove('empty', 'is-rendering-next');
    return;
  }

  slot.classList.remove('empty');
  const hasRenderedPage = Boolean(slot.querySelector('img'));
  if (hasRenderedPage) {
    slot.classList.add('is-rendering-next');
  } else {
    showMainPdfSlotMessage(slot, `正在渲染第 ${pageNumber} 页...`, 'main-viewer-loading');
  }

  let result = null;
  try {
    result = await ipcRenderer.invoke('pdf-render-page', {
      pdfPath: state.pdfPath,
      pageIndex: pageNumber - 1,
      scale: state.renderScale
    });
  } catch (err) {
    result = { success: false, error: err.message };
  }

  if (token !== state.renderToken || mainPdfState !== state || currentViewerMode !== 'pdf') return;
  slot.classList.remove('is-rendering-next');

  if (!result || !result.success) {
    const message = `第 ${pageNumber} 页渲染失败：${result?.error || '未知错误'}`;
    if (hasRenderedPage) {
      showMainPdfPageNotice(slot, message, 'error');
    } else {
      showMainPdfSlotMessage(slot, message, 'main-pdf-page-error');
    }
    return;
  }

  const imageUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(result.absolutePath)}`;
  let img = null;
  try {
    img = await preloadMainImage(imageUrl, `PDF 第 ${pageNumber} 页`);
  } catch (err) {
    if (token !== state.renderToken || mainPdfState !== state || currentViewerMode !== 'pdf') return;
    const message = `第 ${pageNumber} 页加载失败：${err.message}`;
    if (hasRenderedPage) {
      showMainPdfPageNotice(slot, message, 'error');
    } else {
      showMainPdfSlotMessage(slot, message, 'main-pdf-page-error');
    }
    return;
  }

  if (token !== state.renderToken || mainPdfState !== state || currentViewerMode !== 'pdf') return;

  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    state.pageAspectRatio = img.naturalHeight / img.naturalWidth;
  }

  const pageContent = document.createElement('div');
  pageContent.className = 'main-pdf-page-content';
  const pageNumberEl = document.createElement('div');
  pageNumberEl.className = 'main-pdf-page-number';
  pageNumberEl.textContent = `第 ${pageNumber} 页`;

  pageContent.appendChild(img);
  pageContent.appendChild(pageNumberEl);

  const turnClass = state.turnDirection === 'backward' ? 'page-turn-backward' : 'page-turn-forward';
  slot.classList.remove('page-turn-forward', 'page-turn-backward');
  if (hasRenderedPage) slot.classList.add(turnClass);
  slot.dataset.pageNumber = String(pageNumber);
  slot.replaceChildren(pageContent);

  if (hasRenderedPage) {
    setTimeout(() => {
      slot.classList.remove('page-turn-forward', 'page-turn-backward');
    }, 320);
  }
}

function prepareMainVideoMode(nextFilePath) {
  ensurePlayerContainerVisible();
  if (currentViewerMode === 'video' && currentFilePath && currentFilePath !== nextFilePath) {
    savePlaybackProgress();
  }
  ++mainViewerToken;
  disconnectMainPdfResizeObserver();
  mainPdfState = null;
  if (mainImagePreview) mainImagePreview.removeAttribute('src');
  clearMainDocumentPreview();
  if (currentViewerMode !== 'video') {
    currentFilePath = '';
    currentFileDuration = 0;
  }
  setMainViewerMode('video');
}

async function playVideo(filePath, startSec = 0, autoplay = true) {
  prepareMainVideoMode(filePath);

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
    saveMediaTreeState({ lastMediaFile: filePath, lastMediaKind: 'video' });

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
      showBottomTip('视频加载失败，请检查文件是否存在！');
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
    saveMediaTreeState({ lastMediaFile: filePath, lastMediaKind: 'video' });

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
    showBottomTip('视频播放发生错误！');
    hideLoading();
  }
}

// Video Callbacks
function onVideoLoadedMetadata() {
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
  iconPlay.classList.add('hidden');
  iconPause.classList.remove('hidden');
  startHistorySaveTimer();
  triggerControlsVisibility();
}

function onVideoPause() {
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
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
    if (getMediaKind(node.path, node.mediaKind) === 'video') {
      list.push(node.path);
    }
  } else if (node.type === 'directory' && node.children) {
    node.children.forEach(child => flattenTreeFiles(child, list));
  }
  return list;
}

function onVideoTimeUpdate() {
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
  isTimelineDragging = true;
  const percent = parseFloat(timelineSlider.value);
  timelineProgress.style.width = `${percent}%`;
  
  const targetTime = (percent / 100) * currentFileDuration;
  currentTimeLabel.textContent = formatTime(targetTime);
}

function onTimelineChange() {
  if (currentViewerMode !== 'video') return;
  isTimelineDragging = false;
  if (!currentFilePath) return;

  const percent = parseFloat(timelineSlider.value);
  const targetTime = (percent / 100) * currentFileDuration;

  seekTo(targetTime);
}

function seekTo(targetTime) {
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
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
  const isFullscreen = Boolean(document.fullscreenElement);
  iconFullscreenEnter.classList.toggle('hidden', isFullscreen);
  iconFullscreenExit.classList.toggle('hidden', !isFullscreen);

  syncMainPdfFullscreenButton();
  if (currentViewerMode === 'pdf' && mainPdfState && !mainPdfState.manualZoom) {
    requestAnimationFrame(() => {
      if (currentViewerMode === 'pdf' && mainPdfState && !mainPdfState.manualZoom) {
        applyMainPdfAutoFit();
      }
    });
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

  if (currentViewerMode === 'pdf' && e.code === 'Escape' && isMainPdfFullscreen()) {
    e.preventDefault();
    toggleMainPdfFullscreen();
    return;
  }

  // If user is focused on any input or textarea, ignore hotkeys
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    return;
  }

  const activePdfReader = document.querySelector('.note-editor-view.pdf-reading-mode:not(.hidden) .pdf-native-reader[data-pdf-ready="1"]');
  if (activePdfReader && ['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
    const action = e.code === 'ArrowLeft' ? 'prev' : 'next';
    const btn = activePdfReader.querySelector(`[data-action="${action}"]`);
    if (btn && !btn.disabled) {
      btn.click();
    }
    return;
  }

  if (currentViewerMode === 'pdf' && ['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
    turnMainPdfPage(e.code === 'ArrowLeft' ? 'prev' : 'next');
    return;
  }

  if (currentViewerMode === 'document' && ['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
    turnMainDocumentPage(e.code === 'ArrowLeft' ? 'prev' : 'next');
    return;
  }

  if (currentViewerMode !== 'video') {
    if (e.code === 'KeyF') {
      e.preventDefault();
      toggleFullscreen();
    }
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
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
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
  if (currentViewerMode !== 'video') return;
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
let bottomTipTimer = null;

function showBottomTip(message, type = '') {
  let tip = document.getElementById('app-bottom-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'app-bottom-tip';
    tip.className = 'app-bottom-tip hidden';
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
  }
  if (tip.parentElement !== document.body) {
    document.body.appendChild(tip);
  }

  const text = String(message || '').trim();
  if (!text) return;

  const inferredType = type || (
    /(失败|错误|拒绝|无法|异常)/.test(text) ? 'error' :
      /(警告|确认|请先|请输入|不正确|不存在|没有|不能|暂不支持)/.test(text) ? 'warning' :
        /(成功|已保存|已删除|已复制|已上线|已进入|完成)/.test(text) ? 'success' : ''
  );

  tip.textContent = text;
  tip.classList.remove('hidden', 'success', 'error', 'warning');
  if (inferredType) tip.classList.add(inferredType);
  requestAnimationFrame(() => tip.classList.add('visible'));

  if (bottomTipTimer) clearTimeout(bottomTipTimer);
  bottomTipTimer = setTimeout(() => {
    tip.classList.remove('visible');
    bottomTipTimer = setTimeout(() => {
      tip.classList.add('hidden');
      tip.classList.remove('success', 'error', 'warning');
      bottomTipTimer = null;
    }, 240);
  }, 2000);
}

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
    showBottomTip('解析链接失败: ' + err.message);
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
    showBottomTip('请先勾选需要下载的选集');
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
        showBottomTip('该合集内不包含 B站 视频资源（均为直链），请点击单集一键播放！');
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
          showBottomTip('请输入正确的 Bilibili 视频链接，包含 BV 号！');
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
          showBottomTip('解析B站视频失败: ' + err.message + '，将采用单视频打底！');
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
          showBottomTip('请输入自定义播放直链列表！');
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
          showBottomTip('直链列表解析格式不正确，需符合：标题,直链链接，一行一条！');
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
      
      showBottomTip('提交成功！合集已进入管理员审核队列，通过后即可在广场展示。');
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
        showBottomTip('安全凭证错误，拒绝访问！');
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
            showBottomTip('请填满所有字段！');
            return;
          }
          if (!/^[a-z0-9_-]+$/.test(id)) {
            showBottomTip('分类标识只能包含小写英文、数字、下划线或连字符！');
            return;
          }
          if (id === 'all') {
            showBottomTip('“all” 是全部选项的保留字，请使用其他名称！');
            return;
          }
          if (communityCategories.some(c => c.id === id)) {
            showBottomTip('此分类标识已经存在！');
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
        showBottomTip('合集已上线！');
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
  if (currentViewerMode !== 'video') {
    showBottomTip('当前没有播放视频，无法截屏！');
    return;
  }
  if (!videoElement || videoElement.readyState < 2 || !currentFilePath) {
    showBottomTip('当前没有播放视频，无法截屏！');
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
        showBottomTip('图片已复制到剪贴板！');
      } else {
        showBottomTip('复制失败，请重试');
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
  const setNotesIcloud = document.getElementById('set-notes-icloud');
  const setNotesLibraryPath = document.getElementById('set-notes-library-path');
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

    await refreshNotesStorageStatus();

    // Categories list load
    screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
    renderSettingsCategories();
  }

  async function refreshNotesStorageStatus() {
    if (!setNotesIcloud && !setNotesLibraryPath) return null;

    const status = await ipcRenderer.invoke('get-notes-storage-status');
    if (setNotesIcloud) {
      setNotesIcloud.checked = Boolean(status.enabled);
      setNotesIcloud.disabled = !status.isMac || !status.iCloudAvailable;
    }
    if (setNotesLibraryPath) {
      if (!status.isMac) {
        setNotesLibraryPath.textContent = '仅 macOS 支持 iCloud 笔记同步';
      } else if (!status.iCloudAvailable) {
        setNotesLibraryPath.textContent = '未检测到 iCloud Drive，请先在系统设置中启用 iCloud Drive';
      } else {
        const modeText = status.enabled ? 'iCloud 笔记库' : '本地笔记库';
        setNotesLibraryPath.textContent = `${modeText}: ${status.activeDir}`;
        setNotesLibraryPath.title = status.activeDir;
      }
    }
    return status;
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

  if (setNotesIcloud) {
    setNotesIcloud.addEventListener('change', async () => {
      const enabled = setNotesIcloud.checked;
      setNotesIcloud.disabled = true;
      showLoading(enabled ? '正在迁移笔记库到 iCloud...' : '正在迁移笔记库到本地...');

      try {
        const result = await ipcRenderer.invoke('set-notes-icloud-enabled', enabled);
        if (!result || !result.success) {
          throw new Error(result?.error || '笔记库迁移失败');
        }
        await refreshNotesStorageStatus();
        notesDB = await ipcRenderer.invoke('get-notes-db');
        showBottomTip(enabled ? '笔记库已迁移到 iCloud' : '笔记库已迁移到本地', 'success');
      } catch (err) {
        console.error('Failed to switch notes iCloud setting:', err);
        showBottomTip(err.message || '笔记库迁移失败', 'error');
        await refreshNotesStorageStatus();
      } finally {
        hideLoading();
      }
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
        showBottomTip('分类已存在！');
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

// ========================================================
// 学习笔记功能前端逻辑 (Notes Feature Frontend Logic)
// ========================================================
let notesDB = { notes: [] };
let currentEditingNote = null;
let selectedNoteCategory = 'all';
let notesSearchQuery = '';

// Initialize notes
function initNotesFeature() {
  const btnToggleNotes = document.getElementById('btn-toggle-notes');
  const btnNotesBackToPlayer = document.getElementById('btn-notes-back-to-player');
  const notesView = document.getElementById('notes-view');
  const playerContainer = document.getElementById('player-container');
  
  const downloaderView = document.getElementById('downloader-view');
  const communityView = document.getElementById('community-view');
  const screenshotsView = document.getElementById('screenshots-view');
  const settingsView = document.getElementById('settings-view');
  
  const btnToggleDownloader = document.getElementById('btn-toggle-downloader');
  const btnToggleCommunity = document.getElementById('btn-toggle-community');
  const btnToggleScreenshots = document.getElementById('btn-toggle-screenshots');
  const btnToggleSettings = document.getElementById('btn-toggle-settings');

  // DOM Notes elements
  const btnToggleNotesSidebar = document.getElementById('btn-toggle-notes-sidebar');
  const notesSidebar = document.querySelector('.notes-sidebar');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnUploadMaterial = document.getElementById('btn-upload-material');
  const notesSearchInput = document.getElementById('notes-search-input');
  const notesCategoriesList = document.getElementById('notes-categories-list');
  const notesGridView = document.getElementById('notes-grid-view');
  const notesGrid = document.getElementById('notes-grid');
  
  // Editor elements
  const noteEditorView = document.getElementById('note-editor-view');
  const btnCloseEditor = document.getElementById('btn-close-editor');
  const btnEditNote = document.getElementById('btn-edit-note');
  const noteCategorySelect = document.getElementById('note-category-select');
  const btnInsertScreenshot = document.getElementById('btn-insert-screenshot');
  const btnSaveNote = document.getElementById('btn-save-note');
  const btnDeleteNote = document.getElementById('btn-delete-note');
  const noteTitleInput = document.getElementById('note-title-input');
  const noteTitleDisplay = document.getElementById('note-title-display');
  const noteContentInput = document.getElementById('note-content-input');
  const notePreviewContent = document.getElementById('note-preview-content');
  const editorLeftPane = document.getElementById('editor-left-pane');
  const markdownPreviewHeader = document.getElementById('markdown-preview-header');
  const editorActions = document.querySelector('.editor-actions');
  let materialCategoryControl = null;
  let materialCategorySelect = null;

  if (editorActions && btnDeleteNote) {
    materialCategoryControl = document.createElement('label');
    materialCategoryControl.className = 'material-category-control hidden';
    materialCategoryControl.title = '设置笔记分类';
    materialCategoryControl.innerHTML = `
      <span>分类</span>
      <select data-role="material-category-select"></select>
    `;
    materialCategorySelect = materialCategoryControl.querySelector('[data-role="material-category-select"]');
    editorActions.insertBefore(materialCategoryControl, btnDeleteNote);

    materialCategorySelect.addEventListener('change', async () => {
      await saveCurrentMaterialNoteCategory(materialCategorySelect.value);
    });
  }

  // Insert Screenshot Modal Elements
  const insertScreenshotModal = document.getElementById('insert-screenshot-modal');
  const btnCloseInsertShotModal = document.getElementById('btn-close-insert-shot-modal');
  const btnCancelInsertShot = document.getElementById('btn-cancel-insert-shot');
  const btnConfirmInsertShot = document.getElementById('btn-confirm-insert-shot');
  const insertShotCatSelect = document.getElementById('insert-shot-cat-select');
  const insertShotSearch = document.getElementById('insert-shot-search');
  const insertShotGrid = document.getElementById('insert-shot-grid');

  // Sidebar Toggling
  if (btnToggleNotesSidebar && notesSidebar) {
    btnToggleNotesSidebar.addEventListener('click', () => {
      notesSidebar.classList.toggle('collapsed');
      btnToggleNotesSidebar.classList.toggle('active');
    });
  }

  // Setup Mermaid
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  }

  // Toggle View
  if (btnToggleNotes && notesView) {
    btnToggleNotes.addEventListener('click', async () => {
      // Toggle active states
      btnToggleNotes.classList.add('active');
      if (btnToggleDownloader) btnToggleDownloader.classList.remove('active');
      if (btnToggleCommunity) btnToggleCommunity.classList.remove('active');
      if (btnToggleScreenshots) btnToggleScreenshots.classList.remove('active');
      if (btnToggleSettings) btnToggleSettings.classList.remove('active');

      playerContainer.classList.add('hidden');
      if (downloaderView) downloaderView.classList.add('hidden');
      if (communityView) communityView.classList.add('hidden');
      if (screenshotsView) screenshotsView.classList.add('hidden');
      if (settingsView) settingsView.classList.add('hidden');
      notesView.classList.remove('hidden');

      videoElement.pause();
      
      // Close editor and load notes list
      closeEditor();
      await loadAndRenderNotes();
    });
  }

  if (btnNotesBackToPlayer && notesView) {
    btnNotesBackToPlayer.addEventListener('click', () => {
      btnToggleNotes.classList.remove('active');
      notesView.classList.add('hidden');
      playerContainer.classList.remove('hidden');
    });
  }

  // Hook up other tab toggles to deactivate notes
  const otherToggles = [btnToggleDownloader, btnToggleCommunity, btnToggleScreenshots, btnToggleSettings];
  otherToggles.forEach(toggle => {
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (btnToggleNotes) btnToggleNotes.classList.remove('active');
        if (notesView) notesView.classList.add('hidden');
      });
    }
  });

  // Load and Render Notes
  async function loadAndRenderNotes() {
    // 1. Fetch notes DB
    notesDB = await ipcRenderer.invoke('get-notes-db');
    // Ensure screenshots DB is loaded for category names
    screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
    
    // 2. Render filters sidebar
    renderSidebarFilters();
    
    // 3. Render grid list
    renderNotesGrid();
  }

  // Render Sidebar Filters
  function renderSidebarFilters() {
    if (!notesCategoriesList) return;
    
    // Render Categories
    notesCategoriesList.innerHTML = '';
    
    // Total notes count
    const totalCount = notesDB.notes.length;
    const allCatItem = document.createElement('div');
    allCatItem.className = `notes-sidebar-item ${selectedNoteCategory === 'all' ? 'active' : ''}`;
    allCatItem.innerHTML = `<span>📂 所有笔记</span> <span style="font-size:11px; opacity:0.7;">(${totalCount})</span>`;
    allCatItem.addEventListener('click', () => {
      selectedNoteCategory = 'all';
      renderSidebarFilters();
      renderNotesGrid();
    });
    notesCategoriesList.appendChild(allCatItem);

    // Uncategorized count
    const uncatCount = notesDB.notes.filter(n => !n.categoryId || n.categoryId === 'uncategorized').length;
    const uncatItem = document.createElement('div');
    uncatItem.className = `notes-sidebar-item ${selectedNoteCategory === 'uncategorized' ? 'active' : ''}`;
    uncatItem.innerHTML = `<span>📁 未分类</span> <span style="font-size:11px; opacity:0.7;">(${uncatCount})</span>`;
    uncatItem.addEventListener('click', () => {
      selectedNoteCategory = 'uncategorized';
      renderSidebarFilters();
      renderNotesGrid();
    });
    notesCategoriesList.appendChild(uncatItem);

    // Custom categories
    if (screenshotsDB && screenshotsDB.categories) {
      screenshotsDB.categories.forEach(cat => {
        if (cat.id === 'uncategorized') return;
        const count = notesDB.notes.filter(n => n.categoryId === cat.id).length;
        
        const catItem = document.createElement('div');
        catItem.className = `notes-sidebar-item ${selectedNoteCategory === cat.id ? 'active' : ''}`;
        catItem.innerHTML = `<span>📁 ${cat.name}</span> <span style="font-size:11px; opacity:0.7;">(${count})</span>`;
        catItem.addEventListener('click', () => {
          selectedNoteCategory = cat.id;
          renderSidebarFilters();
          renderNotesGrid();
        });
        notesCategoriesList.appendChild(catItem);
      });
    }
  }

  function extractNoteImageUrl(note) {
    if (!note || !note.content) return null;

    const markdownMatch = note.content.match(/!\[.*?\]\((.*?)\)/);
    if (markdownMatch && markdownMatch[1]) return markdownMatch[1];

    const imgMatch = note.content.match(/<img.*?src=["'](.*?)["']/);
    if (imgMatch && imgMatch[1]) return imgMatch[1];

    return null;
  }

  function extractPdfMaterialInfo(note) {
    if (!note || !note.content) return null;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = note.content;

    const nativeReader = wrapper.querySelector('.pdf-native-reader[data-pdf-path]');
    if (nativeReader) {
      const pdfPath = nativeReader.getAttribute('data-pdf-path');
      if (!pdfPath) return null;
      return {
        pdfPath,
        title: nativeReader.getAttribute('data-pdf-title') || note.title || path.basename(pdfPath)
      };
    }

    const legacyFrame = wrapper.querySelector('.pdf-container iframe[src*="/screenshot?path="]');
    if (legacyFrame) {
      try {
        const frameUrl = new URL(legacyFrame.getAttribute('src'), 'http://localhost:30032');
        const pdfPath = frameUrl.searchParams.get('path');
        if (pdfPath && path.extname(pdfPath).toLowerCase() === '.pdf') {
          return {
            pdfPath,
            title: note.title || path.basename(pdfPath)
          };
        }
      } catch (err) {
        console.warn('Failed to parse legacy PDF preview path:', err);
      }
    }

    return null;
  }

  function createNoteExcerpt(note, pdfInfo) {
    if (pdfInfo) return 'PDF 资料 · 首页缩略图预览 · 点击打开阅读器';
    if (!note || !note.content) return '暂无内容';

    return note.content
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[.*?\]\(.*?\)/g, ' ')
      .replace(/[#*`~$\-[\]()]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '暂无内容';
  }

  function createNoteCardThumbnail(kind = 'image') {
    const thumbContainer = document.createElement('div');
    thumbContainer.className = `note-card-thumbnail ${kind === 'pdf' ? 'pdf-note-thumbnail is-loading' : 'image-note-thumbnail'}`;
    return thumbContainer;
  }

  function renderPdfThumbnailFallback(thumbContainer, text = 'PDF') {
    thumbContainer.classList.remove('is-loading');
    thumbContainer.classList.add('is-fallback');
    thumbContainer.innerHTML = `
      <div class="pdf-note-thumb-fallback">
        <div class="pdf-note-thumb-icon">PDF</div>
        <div>${escapeHtmlText(text)}</div>
      </div>
    `;
  }

  async function hydratePdfNoteThumbnail(thumbContainer, pdfInfo) {
    if (!thumbContainer || !pdfInfo || !pdfInfo.pdfPath) return;

    thumbContainer.innerHTML = `
      <div class="pdf-note-thumb-loading">
        <div class="pdf-note-thumb-icon">PDF</div>
        <div>正在生成首页预览...</div>
      </div>
    `;

    let result = null;
    try {
      result = await ipcRenderer.invoke('pdf-render-page', {
        pdfPath: pdfInfo.pdfPath,
        pageIndex: 0,
        scale: 1
      });
    } catch (err) {
      result = { success: false, error: err.message };
    }

    if (!thumbContainer.isConnected) return;

    if (!result || !result.success) {
      renderPdfThumbnailFallback(thumbContainer, '首页预览失败');
      return;
    }

    const imageUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(result.absolutePath)}`;
    try {
      const img = await preloadPdfPageImage(imageUrl, `${pdfInfo.title || 'PDF'} 首页缩略图`);
      if (!thumbContainer.isConnected) return;
      img.className = 'pdf-note-thumb-image';
      thumbContainer.classList.remove('is-loading', 'is-fallback');
      thumbContainer.replaceChildren(img);
    } catch (err) {
      if (!thumbContainer.isConnected) return;
      renderPdfThumbnailFallback(thumbContainer, '首页加载失败');
    }
  }

  // Render Notes Grid
  function renderNotesGrid() {
    if (!notesGrid) return;
    notesGrid.innerHTML = '';
    
    // Filter
    let filtered = notesDB.notes;
    
    // Category filter
    if (selectedNoteCategory !== 'all') {
      if (selectedNoteCategory === 'uncategorized') {
        filtered = filtered.filter(n => !n.categoryId || n.categoryId === 'uncategorized');
      } else {
        filtered = filtered.filter(n => n.categoryId === selectedNoteCategory);
      }
    }
    
    // Global search filter
    if (notesSearchQuery) {
      const q = notesSearchQuery.toLowerCase();
      filtered = filtered.filter(n => 
        (n.title && n.title.toLowerCase().includes(q)) || 
        (n.content && n.content.toLowerCase().includes(q))
      );
    }

    filtered = [...filtered].sort((a, b) => {
      const timeA = Number(a?.updatedAt || a?.createdAt || 0);
      const timeB = Number(b?.updatedAt || b?.createdAt || 0);
      return timeB - timeA;
    });
    
    if (filtered.length === 0) {
      notesGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 60px 20px; color: var(--text-muted);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px; height:48px; opacity:0.5; margin-bottom:12px;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p style="margin:0; font-size:14px;">没有找到符合条件的笔记</p>
          <span style="font-size:12px; opacity:0.7;">点击右上角“新建笔记”开始记录学习灵感！</span>
        </div>
      `;
      return;
    }
    
    filtered.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card';
      const pdfInfo = extractPdfMaterialInfo(note);
      const imageUrl = !pdfInfo ? extractNoteImageUrl(note) : null;
      const isImageMaterial = Boolean(note.isMaterial && imageUrl && !pdfInfo);
      let pdfThumbContainer = null;

      if (pdfInfo) {
        card.classList.add('pdf-note-card');
        pdfThumbContainer = createNoteCardThumbnail('pdf');
        card.appendChild(pdfThumbContainer);
      } else if (imageUrl) {
        if (isImageMaterial) card.classList.add('image-material-note-card');
        const thumbContainer = createNoteCardThumbnail('image');
        const img = document.createElement('img');
        img.src = imageUrl;
        thumbContainer.appendChild(img);
        card.appendChild(thumbContainer);
      }

      if (!isImageMaterial) {
        const title = document.createElement('h3');
        title.textContent = note.title || '无标题笔记';
        card.appendChild(title);
      }

      if (!isImageMaterial && !pdfInfo) {
        // Excerpt (strip markdown syntax briefly for preview)
        const excerpt = document.createElement('div');
        excerpt.className = 'note-card-excerpt';
        excerpt.textContent = createNoteExcerpt(note, pdfInfo);
        card.appendChild(excerpt);
      }
      
      // Meta row
      const meta = document.createElement('div');
      meta.className = 'note-card-meta';
      
      const cat = screenshotsDB.categories.find(c => c.id === (note.categoryId || 'uncategorized'));
      const catName = cat ? cat.name : '未分类';
      const catTag = document.createElement('span');
      catTag.className = 'note-card-category-tag';
      catTag.textContent = catName;
      meta.appendChild(catTag);
      
      card.appendChild(meta);
      
      card.addEventListener('click', () => {
        openNoteInEditor(note);
      });
      
      notesGrid.appendChild(card);

      if (pdfThumbContainer) {
        hydratePdfNoteThumbnail(pdfThumbContainer, pdfInfo);
      }
    });
  }

  // Open Note in Editor
  function openNoteInEditor(note, isNew = false) {
    currentEditingNote = note;
    
    // Toggle panels
    notesGridView.classList.add('hidden');
    noteEditorView.classList.remove('hidden');
    
    // Fill fields
    noteTitleInput.value = note.title || '';
    noteContentInput.value = note.content || '';
    
    // Populate Category dropdown
    noteCategorySelect.innerHTML = '';
    if (screenshotsDB && screenshotsDB.categories) {
      screenshotsDB.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        if (cat.id === (note.categoryId || 'uncategorized')) {
          opt.selected = true;
        }
        noteCategorySelect.appendChild(opt);
      });
    }

    renderPreview();
    toggleEditorMode(isNew);
  }

  // Toggle between View mode and Edit mode inside note detail pane
  function isPdfMaterialNote(note) {
    if (!note || !note.isMaterial || !note.content) return false;
    return note.content.includes('pdf-native-reader') || note.content.includes('pdf-container');
  }

  function isImageMaterialNote(note) {
    if (!note || !note.isMaterial || isPdfMaterialNote(note)) return false;
    return Boolean(extractNoteImageUrl(note));
  }

  function syncMaterialCategoryControl(visible) {
    if (!materialCategoryControl || !materialCategorySelect) return;

    materialCategoryControl.classList.toggle('hidden', !visible);
    if (!visible) return;

    materialCategorySelect.innerHTML = createPdfCategoryOptions(currentEditingNote?.categoryId || 'uncategorized');
    materialCategorySelect.value = currentEditingNote?.categoryId || 'uncategorized';
  }

  function toggleEditorMode(isEdit) {
    const isMaterial = currentEditingNote && currentEditingNote.isMaterial;
    const isPdfMaterial = isPdfMaterialNote(currentEditingNote);
    const isImageMaterial = isImageMaterialNote(currentEditingNote);
    const editorTitleRow = document.querySelector('.editor-title-row');
    const editorMetaInfo = document.querySelector('.editor-meta-info');

    if (noteEditorView) {
      noteEditorView.classList.toggle('pdf-reading-mode', isPdfMaterial);
    }
    syncMaterialCategoryControl(isImageMaterial);

    if (isMaterial) {
      if (editorTitleRow) {
        if (isPdfMaterial) {
          editorTitleRow.classList.add('hidden');
        } else {
          editorTitleRow.classList.remove('hidden');
        }
      }
      if (editorMetaInfo) editorMetaInfo.classList.add('hidden');
      if (btnEditNote) btnEditNote.classList.add('hidden');
      if (btnInsertScreenshot) btnInsertScreenshot.classList.add('hidden');
      if (btnSaveNote) btnSaveNote.classList.add('hidden');
      
      if (noteTitleInput) noteTitleInput.classList.add('hidden');
      if (noteTitleDisplay) noteTitleDisplay.style.display = 'none';
      if (editorLeftPane) editorLeftPane.classList.add('hidden');
      if (markdownPreviewHeader) markdownPreviewHeader.classList.add('hidden');
      return;
    }

    // Normal notes (non-material) - restore visibility of title row and meta info
    syncMaterialCategoryControl(false);
    if (noteEditorView) noteEditorView.classList.remove('pdf-reading-mode');
    if (editorTitleRow) editorTitleRow.classList.remove('hidden');
    if (editorMetaInfo) editorMetaInfo.classList.remove('hidden');

    if (isEdit) {
      if (btnEditNote) btnEditNote.classList.add('hidden');
      if (btnInsertScreenshot) btnInsertScreenshot.classList.remove('hidden');
      if (btnSaveNote) btnSaveNote.classList.remove('hidden');
      if (noteCategorySelect) noteCategorySelect.disabled = false;
      
      if (noteTitleInput) noteTitleInput.classList.remove('hidden');
      if (noteTitleDisplay) noteTitleDisplay.style.display = 'none';
      if (editorLeftPane) editorLeftPane.classList.remove('hidden');
      if (markdownPreviewHeader) {
        markdownPreviewHeader.classList.remove('hidden');
        markdownPreviewHeader.textContent = '实时渲染预览';
      }
    } else {
      if (btnEditNote) btnEditNote.classList.remove('hidden');
      if (btnInsertScreenshot) btnInsertScreenshot.classList.add('hidden');
      if (btnSaveNote) btnSaveNote.classList.add('hidden');
      if (noteCategorySelect) noteCategorySelect.disabled = true;
      
      if (noteTitleInput) noteTitleInput.classList.add('hidden');
      if (noteTitleDisplay) {
        noteTitleDisplay.style.display = 'block';
        noteTitleDisplay.textContent = noteTitleInput.value.trim() || '无标题笔记';
      }
      if (editorLeftPane) editorLeftPane.classList.add('hidden');
      if (markdownPreviewHeader) {
        markdownPreviewHeader.classList.add('hidden');
      }
    }
  }



  // Close editor and go back to grid
  function closeEditor() {
    currentEditingNote = null;
    if (noteEditorView) noteEditorView.classList.remove('pdf-reading-mode');
    noteEditorView.classList.add('hidden');
    notesGridView.classList.remove('hidden');
  }
  
  if (btnCloseEditor) {
    btnCloseEditor.addEventListener('click', () => {
      closeEditor();
      loadAndRenderNotes();
    });
  }

  // New Note button
  if (btnAddNote) {
    btnAddNote.addEventListener('click', () => {
      const newNote = {
        id: 'note_' + Date.now(),
        title: '',
        content: '',
        categoryId: selectedNoteCategory !== 'all' ? selectedNoteCategory : 'uncategorized',
        videoPath: currentFilePath || null,
        videoName: currentFilePath ? path.basename(currentFilePath) : null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      openNoteInEditor(newNote, true);
    });
  }

  // Edit Note button
  if (btnEditNote) {
    btnEditNote.addEventListener('click', () => {
      toggleEditorMode(true);
    });
  }

  // Open attachment file helper exposed globally so HTML string onclick can call it
  window.openAttachmentFile = (filePath) => {
    ipcRenderer.invoke('open-path', filePath);
  };

  function escapeHtmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createPdfReaderBlock(material) {
    const escapedPath = escapeHtmlText(material.absolutePath);
    const escapedName = escapeHtmlText(material.name);
    const sizeMb = (material.size / 1024 / 1024).toFixed(2);

    return [
      `<div class="pdf-native-reader" data-pdf-path="${escapedPath}" data-pdf-title="${escapedName}">`,
      `  <div class="pdf-reader-placeholder">`,
      `    <div class="pdf-reader-placeholder-icon">PDF</div>`,
      `    <div>`,
      `      <div class="pdf-reader-placeholder-title">${escapedName}</div>`,
      `      <div class="pdf-reader-placeholder-subtitle">${sizeMb} MB · 正在准备原生阅读器...</div>`,
      `    </div>`,
      `  </div>`,
      `</div>`
    ].join('\n');
  }

  function createPdfCategoryOptions(selectedCategoryId) {
    const categories = screenshotsDB && Array.isArray(screenshotsDB.categories)
      ? screenshotsDB.categories
      : [{ id: 'uncategorized', name: '未分类' }];
    const hasUncategorized = categories.some(cat => cat.id === 'uncategorized');
    const normalizedCategories = hasUncategorized
      ? categories
      : [{ id: 'uncategorized', name: '未分类' }, ...categories];

    return normalizedCategories.map(cat => {
      const selected = cat.id === (selectedCategoryId || 'uncategorized') ? ' selected' : '';
      return `<option value="${escapeHtmlText(cat.id)}"${selected}>${escapeHtmlText(cat.name)}</option>`;
    }).join('');
  }

  async function saveCurrentMaterialNoteCategory(categoryId) {
    if (!currentEditingNote) return;

    currentEditingNote.categoryId = categoryId || 'uncategorized';
    currentEditingNote.updatedAt = Date.now();
    const existingIdx = notesDB.notes.findIndex(n => n.id === currentEditingNote.id);
    if (existingIdx !== -1) {
      notesDB.notes[existingIdx] = currentEditingNote;
    }

    if (noteCategorySelect) {
      noteCategorySelect.value = currentEditingNote.categoryId;
    }
    if (materialCategorySelect) {
      materialCategorySelect.value = currentEditingNote.categoryId;
    }

    await ipcRenderer.invoke('save-notes-db', notesDB);
    renderSidebarFilters();
  }

  async function saveCurrentPdfNoteCategory(categoryId) {
    await saveCurrentMaterialNoteCategory(categoryId);
  }

  async function hydratePdfReaders(container) {
    upgradeLegacyPdfContainers(container);
    const readers = container.querySelectorAll('.pdf-native-reader[data-pdf-path]:not([data-pdf-ready])');
    readers.forEach(reader => {
      reader.dataset.pdfReady = '1';
      initPdfReader(reader);
    });
  }

  function upgradeLegacyPdfContainers(container) {
    const legacyFrames = container.querySelectorAll('.pdf-container iframe[src*="/screenshot?path="]');
    legacyFrames.forEach(frame => {
      const wrapper = frame.closest('.pdf-container');
      if (!wrapper || wrapper.dataset.pdfUpgraded) return;

      try {
        const src = frame.getAttribute('src');
        const url = new URL(src, `http://localhost:30032`);
        const pdfPath = url.searchParams.get('path');
        if (!pdfPath || path.extname(pdfPath).toLowerCase() !== '.pdf') return;

        const reader = document.createElement('div');
        reader.className = 'pdf-native-reader';
        reader.dataset.pdfPath = pdfPath;
        reader.dataset.pdfTitle = path.basename(pdfPath);
        wrapper.replaceWith(reader);
      } catch (err) {
        console.warn('Legacy PDF iframe upgrade failed:', err);
        wrapper.dataset.pdfUpgraded = 'failed';
      }
    });
  }

  async function initPdfReader(reader) {
    const pdfPath = reader.dataset.pdfPath;
    const pdfTitle = reader.dataset.pdfTitle || path.basename(pdfPath || 'PDF 资料');
    const categoryOptions = createPdfCategoryOptions(currentEditingNote?.categoryId || 'uncategorized');
    const state = {
      pdfPath,
      title: pdfTitle,
      pageCount: 0,
      currentPage: 1,
      zoom: 1,
      manualZoom: false,
      pageMode: 'double',
      renderScale: 2,
      renderToken: 0,
      basePageWidth: 430,
      pageAspectRatio: 1.294
    };

    reader.innerHTML = `
      <div class="pdf-reader-toolbar">
        <div class="pdf-reader-title-group">
          <div class="pdf-reader-badge">PDF</div>
          <div>
            <div class="pdf-reader-title">${escapeHtmlText(pdfTitle)}</div>
            <div class="pdf-reader-subtitle" data-role="pdf-status">正在读取 PDF...</div>
          </div>
        </div>
        <div class="pdf-reader-controls">
          <button type="button" data-action="back-list" title="返回笔记列表">返回</button>
          <span class="pdf-reader-divider"></span>
          <button type="button" data-action="prev" title="上一组页面">上一页</button>
          <div class="pdf-reader-page-jump">
            <input type="number" min="1" value="1" data-role="page-input">
            <span>/</span>
            <span data-role="page-count">--</span>
          </div>
          <button type="button" data-action="next" title="下一组页面">下一页</button>
          <span class="pdf-reader-divider"></span>
          <button type="button" data-action="zoom-out" title="缩小">-</button>
          <span data-role="zoom-label">100%</span>
          <button type="button" data-action="zoom-in" title="放大">+</button>
          <span class="pdf-reader-divider"></span>
          <button type="button" data-action="open-file" title="使用系统默认应用打开">系统打开</button>
          <label class="pdf-category-control" title="设置笔记分类">
            <span>分类</span>
            <select data-role="pdf-category-select">${categoryOptions}</select>
          </label>
          <button type="button" data-action="toggle-page-mode" title="切换单页/双页展示">双页</button>
        </div>
      </div>
      <div class="pdf-reader-spread" data-role="spread">
        <div class="pdf-page-slot" data-role="left-page">
          <div class="pdf-page-loading">正在载入...</div>
        </div>
        <div class="pdf-page-slot" data-role="right-page">
          <div class="pdf-page-loading">正在载入...</div>
        </div>
      </div>
    `;

    const statusEl = reader.querySelector('[data-role="pdf-status"]');
    const pageInput = reader.querySelector('[data-role="page-input"]');
    const pageCountEl = reader.querySelector('[data-role="page-count"]');
    const zoomLabel = reader.querySelector('[data-role="zoom-label"]');
    const spreadEl = reader.querySelector('[data-role="spread"]');
    const categorySelect = reader.querySelector('[data-role="pdf-category-select"]');

    const syncControls = () => {
      const step = state.pageMode === 'double' ? 2 : 1;
      pageInput.value = state.currentPage;
      pageInput.max = state.pageCount || 1;
      pageCountEl.textContent = state.pageCount || '--';
      zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
      reader.style.setProperty('--pdf-page-zoom', state.zoom);
      reader.classList.toggle('single-page-mode', state.pageMode === 'single');
      const prevBtn = reader.querySelector('[data-action="prev"]');
      const nextBtn = reader.querySelector('[data-action="next"]');
      const modeBtn = reader.querySelector('[data-action="toggle-page-mode"]');
      if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
      if (nextBtn) nextBtn.disabled = !state.pageCount || state.currentPage + step > state.pageCount;
      if (modeBtn) {
        modeBtn.textContent = state.pageMode === 'double' ? '双页' : '单页';
        modeBtn.title = state.pageMode === 'double' ? '当前双页展示，点击切换为单页' : '当前单页展示，点击切换为双页';
      }
    };

    const parseCssPx = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const applyAutoFit = () => {
      if (state.manualZoom || !spreadEl) {
        syncControls();
        return;
      }

      const pageSlots = state.pageMode === 'double' ? 2 : 1;
      const spreadStyle = window.getComputedStyle(spreadEl);
      const paddingX = parseCssPx(spreadStyle.paddingLeft) + parseCssPx(spreadStyle.paddingRight);
      const paddingY = parseCssPx(spreadStyle.paddingTop) + parseCssPx(spreadStyle.paddingBottom);
      const gap = state.pageMode === 'double' ? parseCssPx(spreadStyle.columnGap || spreadStyle.gap || '0') : 0;
      const pageNumberReserve = 26;
      const availableWidth = Math.max(180, spreadEl.clientWidth - paddingX - gap);
      const availableHeight = Math.max(220, spreadEl.clientHeight - paddingY - pageNumberReserve);
      const widthZoom = availableWidth / (state.basePageWidth * pageSlots);
      const heightZoom = availableHeight / (state.basePageWidth * state.pageAspectRatio);
      state.zoom = Math.min(2.4, Math.max(0.45, Math.min(widthZoom, heightZoom)));
      syncControls();
    };
    state.applyAutoFit = applyAutoFit;

    const goToPage = (page) => {
      if (!state.pageCount) return;
      state.currentPage = Math.min(state.pageCount, Math.max(1, parseInt(page, 10) || 1));
      renderPdfSpread(reader, state, statusEl, syncControls, applyAutoFit);
    };

    reader.querySelector('[data-action="back-list"]').addEventListener('click', () => {
      closeEditor();
      loadAndRenderNotes();
    });
    reader.querySelector('[data-action="prev"]').addEventListener('click', () => {
      const step = state.pageMode === 'double' ? 2 : 1;
      goToPage(state.currentPage - step);
    });
    reader.querySelector('[data-action="next"]').addEventListener('click', () => {
      const step = state.pageMode === 'double' ? 2 : 1;
      goToPage(state.currentPage + step);
    });
    reader.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
      state.manualZoom = true;
      state.zoom = Math.max(0.7, Math.round((state.zoom - 0.1) * 10) / 10);
      syncControls();
    });
    reader.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
      state.manualZoom = true;
      state.zoom = Math.min(1.8, Math.round((state.zoom + 0.1) * 10) / 10);
      syncControls();
    });
    reader.querySelector('[data-action="open-file"]').addEventListener('click', () => {
      ipcRenderer.invoke('open-path', state.pdfPath);
    });
    if (categorySelect) {
      categorySelect.addEventListener('change', async () => {
        await saveCurrentPdfNoteCategory(categorySelect.value);
      });
    }
    reader.querySelector('[data-action="toggle-page-mode"]').addEventListener('click', () => {
      state.pageMode = state.pageMode === 'double' ? 'single' : 'double';
      if (!state.manualZoom) {
        applyAutoFit();
      } else {
        syncControls();
      }
      renderPdfSpread(reader, state, statusEl, syncControls, applyAutoFit);
    });
    pageInput.addEventListener('change', () => goToPage(pageInput.value));
    pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goToPage(pageInput.value);
      }
    });

    try {
      const info = await ipcRenderer.invoke('pdf-get-info', state.pdfPath);
      if (!info || !info.success) {
        throw new Error(info?.error || 'PDF 信息读取失败');
      }
      state.pageCount = info.pageCount || 0;
      if (statusEl) statusEl.textContent = `${state.pageCount} 页 · 双页阅读`;
      applyAutoFit();
      if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(() => {
          if (!state.manualZoom) applyAutoFit();
        });
        resizeObserver.observe(spreadEl);
      }
      await renderPdfSpread(reader, state, statusEl, syncControls, applyAutoFit);
    } catch (err) {
      console.error('PDF reader init failed:', err);
      if (statusEl) statusEl.textContent = `PDF 打开失败：${err.message}`;
      reader.querySelector('[data-role="spread"]').innerHTML = `<div class="pdf-reader-error">PDF 打开失败：${escapeHtmlText(err.message)}</div>`;
    }
  }

  async function renderPdfSpread(reader, state, statusEl, syncControls, applyAutoFit) {
    const token = ++state.renderToken;
    const isInitialRender = !state.hasRenderedSpread;
    const leftSlot = reader.querySelector('[data-role="left-page"]');
    const rightSlot = reader.querySelector('[data-role="right-page"]');
    const pages = [
      state.currentPage,
      state.pageMode === 'double' && state.currentPage + 1 <= state.pageCount ? state.currentPage + 1 : null
    ];

    const previousPage = state.lastRenderedPage || state.currentPage;
    state.turnDirection = state.currentPage >= previousPage ? 'forward' : 'backward';

    syncControls();
    if (statusEl) {
      const modeText = state.pageMode === 'double' ? '双页阅读' : '单页阅读';
      statusEl.textContent = pages[1]
        ? `${pages[0]}-${pages[1]} / ${state.pageCount} 页 · ${modeText}`
        : `${pages[0]} / ${state.pageCount} 页 · ${modeText}`;
    }

    await Promise.all([
      renderPdfPageIntoSlot(leftSlot, state, pages[0], token, reader),
      renderPdfPageIntoSlot(rightSlot, state, pages[1], token, reader)
    ]);

    if (token === state.renderToken && isInitialRender && !state.manualZoom && typeof applyAutoFit === 'function') {
      applyAutoFit();
    }

    if (token === state.renderToken) {
      state.lastRenderedPage = state.currentPage;
      state.hasRenderedSpread = true;
    }
  }

  function preloadPdfPageImage(src, alt) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.alt = alt;
      img.decoding = 'async';
      img.onload = async () => {
        try {
          if (typeof img.decode === 'function') await img.decode();
        } catch (_) {
          // Some Electron/Chromium builds reject decode() for cached images; onload is enough here.
        }
        resolve(img);
      };
      img.onerror = () => reject(new Error('页面图片加载失败'));
      img.src = src;
    });
  }

  function showPdfPageNotice(slot, message, type = 'info') {
    const oldNotice = slot.querySelector('.pdf-page-notice');
    if (oldNotice) oldNotice.remove();

    const notice = document.createElement('div');
    notice.className = `pdf-page-notice ${type}`;
    notice.textContent = message;
    slot.appendChild(notice);
    setTimeout(() => {
      if (notice.parentNode === slot) notice.remove();
    }, 2400);
  }

  async function renderPdfPageIntoSlot(slot, state, pageNumber, token, reader) {
    if (!slot) return;

    if (!pageNumber) {
      slot.classList.add('empty');
      slot.classList.remove('is-rendering-next', 'page-turn-forward', 'page-turn-backward');
      delete slot.dataset.pageNumber;
      slot.innerHTML = `<div class="pdf-page-empty">本书已到末页</div>`;
      return;
    }

    if (slot.dataset.pageNumber === String(pageNumber) && slot.querySelector('img')) {
      slot.classList.remove('empty', 'is-rendering-next');
      return;
    }

    slot.classList.remove('empty');
    const hasRenderedPage = Boolean(slot.querySelector('img'));
    if (hasRenderedPage) {
      slot.classList.add('is-rendering-next');
    } else {
      slot.innerHTML = `<div class="pdf-page-loading">正在渲染第 ${pageNumber} 页...</div>`;
    }

    let result = null;
    try {
      result = await ipcRenderer.invoke('pdf-render-page', {
        pdfPath: state.pdfPath,
        pageIndex: pageNumber - 1,
        scale: state.renderScale
      });
    } catch (err) {
      result = { success: false, error: err.message };
    }

    if (token !== state.renderToken) return;
    slot.classList.remove('is-rendering-next');

    if (!result || !result.success) {
      const message = `第 ${pageNumber} 页渲染失败：${result?.error || '未知错误'}`;
      if (hasRenderedPage) {
        showPdfPageNotice(slot, message, 'error');
      } else {
        slot.innerHTML = `<div class="pdf-page-error">${escapeHtmlText(message)}</div>`;
      }
      return;
    }

    const imageUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(result.absolutePath)}`;
    let img = null;
    try {
      img = await preloadPdfPageImage(imageUrl, `PDF 第 ${pageNumber} 页`);
    } catch (err) {
      if (token !== state.renderToken) return;
      const message = `第 ${pageNumber} 页加载失败：${err.message}`;
      if (hasRenderedPage) {
        showPdfPageNotice(slot, message, 'error');
      } else {
        slot.innerHTML = `<div class="pdf-page-error">${escapeHtmlText(message)}</div>`;
      }
      return;
    }

    if (token !== state.renderToken) return;

    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      state.pageAspectRatio = img.naturalHeight / img.naturalWidth;
    }

    const pageContent = document.createElement('div');
    pageContent.className = 'pdf-page-content';
    const pageNumberEl = document.createElement('div');
    pageNumberEl.className = 'pdf-page-number';
    pageNumberEl.textContent = `第 ${pageNumber} 页`;

    pageContent.appendChild(img);
    pageContent.appendChild(pageNumberEl);

    const turnClass = state.turnDirection === 'backward' ? 'page-turn-backward' : 'page-turn-forward';
    slot.classList.remove('page-turn-forward', 'page-turn-backward');
    if (hasRenderedPage) slot.classList.add(turnClass);
    slot.dataset.pageNumber = String(pageNumber);
    slot.replaceChildren(pageContent);

    if (hasRenderedPage) {
      setTimeout(() => {
        slot.classList.remove('page-turn-forward', 'page-turn-backward');
      }, 320);
    }
  }

  // Upload Material button
  if (btnUploadMaterial) {
    btnUploadMaterial.addEventListener('click', async () => {
      try {
        const material = await ipcRenderer.invoke('upload-material');
        if (!material) return; // user cancelled selection

        let noteContent = '';
        const nameWithoutExt = material.name.includes('.') ? material.name.substring(0, material.name.lastIndexOf('.')) : material.name;
        const extLower = material.extension.toLowerCase();
        
        if (extLower === '.md' || extLower === '.txt') {
          noteContent = material.text || '';
        } else if (extLower === '.pdf') {
          noteContent = createPdfReaderBlock(material);
        } else if (['.png', '.jpg', '.jpeg'].includes(extLower)) {
          const streamUrl = `http://localhost:30032/screenshot?path=${encodeURIComponent(material.absolutePath)}`;
          noteContent = `\n![${material.name}](${streamUrl})\n`;
        } else {
          const sizeKb = (material.size / 1024).toFixed(1);
          const sizeMb = (material.size / 1024 / 1024).toFixed(2);
          
          noteContent = `### 📎 附件资料：${material.name}\n\n`;
          noteContent += `- **文件类型**: ${extLower.substring(1).toUpperCase()} 文档\n`;
          noteContent += `- **文件大小**: ${sizeMb} MB (${sizeKb} KB)\n`;
          noteContent += `- **存储路径**: \`${material.absolutePath}\`\n\n`;
          noteContent += `***\n\n`;
          noteContent += `<div class="attachment-box" onclick="window.openAttachmentFile('${material.absolutePath.replace(/\\/g, '\\\\')}')" style="cursor: pointer;">\n`;
          noteContent += `  <div class="attachment-icon">📎</div>\n`;
          noteContent += `  <div class="attachment-info">\n`;
          noteContent += `    <div class="attachment-name">${material.name}</div>\n`;
          noteContent += `    <div class="attachment-size">${sizeMb} MB</div>\n`;
          noteContent += `  </div>\n`;
          noteContent += `  <button class="btn-open-attachment btn-primary">点击打开文档</button>\n`;
          noteContent += `</div>\n`;
        }

        const newNote = {
          id: 'note_material_' + Date.now(),
          title: nameWithoutExt || material.name,
          content: noteContent,
          categoryId: selectedNoteCategory !== 'all' ? selectedNoteCategory : 'uncategorized',
          videoPath: currentFilePath || null,
          videoName: currentFilePath ? path.basename(currentFilePath) : null,
          isMaterial: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Add to database immediately since there is no "Save" button for materials
        notesDB.notes.push(newNote);
        await ipcRenderer.invoke('save-notes-db', notesDB);

        // Update list and reload grid
        renderSidebarFilters();
        renderNotesGrid();

        // Open in View Mode so they can see and click the attachment card!
        openNoteInEditor(newNote, false);

      } catch (e) {
        console.error('Failed to upload/import material:', e);
        showBottomTip('上传资料失败：' + e.message);
      }
    });
  }

  // Save Note
  if (btnSaveNote) {
    btnSaveNote.addEventListener('click', async () => {
      if (!currentEditingNote) return;
      
      const title = noteTitleInput.value.trim();
      const content = noteContentInput.value;
      const categoryId = noteCategorySelect.value;
      
      currentEditingNote.title = title || '无标题笔记';
      currentEditingNote.content = content;
      currentEditingNote.categoryId = categoryId;
      currentEditingNote.updatedAt = Date.now();
      
      // Update DB
      const existingIdx = notesDB.notes.findIndex(n => n.id === currentEditingNote.id);
      if (existingIdx !== -1) {
        notesDB.notes[existingIdx] = currentEditingNote;
      } else {
        notesDB.notes.push(currentEditingNote);
      }
      
      await ipcRenderer.invoke('save-notes-db', notesDB);
      
      showBottomTip('保存成功！');
      renderPreview();
      renderSidebarFilters();
      renderNotesGrid();
      toggleEditorMode(false);
    });
  }

  // Delete Note
  if (btnDeleteNote) {
    btnDeleteNote.addEventListener('click', async () => {
      if (!currentEditingNote) return;
      
      if (confirm('确认删除这篇笔记吗？此操作无法撤销。')) {
        notesDB.notes = notesDB.notes.filter(n => n.id !== currentEditingNote.id);
        await ipcRenderer.invoke('save-notes-db', notesDB);
        closeEditor();
        loadAndRenderNotes();
      }
    });
  }

  // Markdown rendering preview functions
  function renderPreview() {
    if (!noteContentInput || !notePreviewContent) return;
    
    const text = noteContentInput.value;
    
    // Parse Math and Markdown
    let html = text;
    
    // 1. Render display equations: $$ ... $$
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, equation) => {
      try {
        if (typeof katex !== 'undefined') {
          return `<div class="katex-display" style="padding:8px 0; overflow-x:auto;">${katex.renderToString(equation, { displayMode: true, throwOnError: false })}</div>`;
        }
      } catch (e) {
        console.error('KaTeX display render error:', e);
      }
      return match;
    });
    
    // 2. Render inline equations: $ ... $
    html = html.replace(/\$([^\$\n]+?)\$/g, (match, equation) => {
      try {
        if (typeof katex !== 'undefined') {
          return katex.renderToString(equation, { displayMode: false, throwOnError: false });
        }
      } catch (e) {
        console.error('KaTeX inline render error:', e);
      }
      return match;
    });

    // 3. Render Markdown
    if (typeof marked !== 'undefined') {
      try {
        notePreviewContent.innerHTML = marked.parse(html);
      } catch (err) {
        notePreviewContent.innerHTML = html;
      }
    } else {
      notePreviewContent.textContent = html;
    }

    hydratePdfReaders(notePreviewContent);
    
    // 4. Render Mermaid diagrams
    if (typeof mermaid !== 'undefined') {
      renderMermaidDiagrams(notePreviewContent);
    }
  }

  // Mermaid diagrams renderer
  async function renderMermaidDiagrams(container) {
    const codeBlocks = container.querySelectorAll('code.language-mermaid');
    if (codeBlocks.length === 0) return;
    
    let index = 0;
    for (const block of codeBlocks) {
      const code = block.textContent.trim();
      const pre = block.parentElement;
      
      const diagDivId = `mermaid-note-${Date.now()}-${index++}`;
      
      try {
        const { svg } = await mermaid.render(diagDivId, code);
        pre.outerHTML = `<div class="mermaid-diagram" style="text-align:center; padding:16px 0; background:rgba(0,0,0,0.1); border-radius:6px; margin: 12px 0;">${svg}</div>`;
      } catch (e) {
        console.error('Mermaid render error:', e);
        const errSvg = document.getElementById(diagDivId);
        if (errSvg) errSvg.remove();
      }
    }
  }

  // Trigger preview render on input text changes
  if (noteContentInput) {
    noteContentInput.addEventListener('input', renderPreview);
  }

  // Global search input handling
  if (notesSearchInput) {
    let searchTimeout = null;
    notesSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        notesSearchQuery = notesSearchInput.value.trim();
        renderNotesGrid();
      }, 250);
    });
  }

  // ==========================================
  // Insert Screenshot Modal Actions
  // ==========================================
  
  // Show modal
  if (btnInsertScreenshot && insertScreenshotModal) {
    btnInsertScreenshot.addEventListener('click', async () => {
      insertScreenshotModal.classList.remove('hidden');
      
      // Load screenshots DB
      screenshotsDB = await ipcRenderer.invoke('get-screenshots-db');
      
      // Populate category dropdown inside insert modal
      if (insertShotCatSelect) {
        insertShotCatSelect.innerHTML = '<option value="all">-- 所有分类 --</option>';
        if (screenshotsDB && screenshotsDB.categories) {
          screenshotsDB.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            insertShotCatSelect.appendChild(opt);
          });
        }
      }
      
      // Render screenshots inside modal
      selectedInsertShot = null;
      renderInsertScreenshotsList();
    });
  }

  // Hide modal
  const hideInsertShotModal = () => {
    if (insertScreenshotModal) insertScreenshotModal.classList.add('hidden');
  };
  if (btnCloseInsertShotModal) btnCloseInsertShotModal.addEventListener('click', hideInsertShotModal);
  if (btnCancelInsertShot) btnCancelInsertShot.addEventListener('click', hideInsertShotModal);

  // Render insert list
  function renderInsertScreenshotsList() {
    if (!insertShotGrid) return;
    insertShotGrid.innerHTML = '';
    
    const catFilter = insertShotCatSelect ? insertShotCatSelect.value : 'all';
    const searchQuery = insertShotSearch ? insertShotSearch.value.trim().toLowerCase() : '';
    
    let filtered = screenshotsDB.screenshots || [];
    if (catFilter !== 'all') {
      filtered = filtered.filter(s => s.categoryId === catFilter);
    }
    if (searchQuery) {
      filtered = filtered.filter(s => s.videoName && s.videoName.toLowerCase().includes(searchQuery));
    }
    
    if (filtered.length === 0) {
      insertShotGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); font-size:12px;">没有找到截图</div>`;
      return;
    }
    
    filtered.forEach(shot => {
      const card = document.createElement('div');
      card.className = `insert-shot-item ${selectedInsertShot === shot ? 'selected' : ''}`;
      
      const img = document.createElement('img');
      img.src = `http://localhost:30032/screenshot?path=${encodeURIComponent(shot.absolutePath)}`;
      card.appendChild(img);
      
      const meta = document.createElement('div');
      meta.className = 'insert-shot-item-meta';
      meta.textContent = `${shot.videoName} (${formatTime(shot.playbackTime)})`;
      card.appendChild(meta);
      
      card.addEventListener('click', () => {
        selectedInsertShot = shot;
        insertShotGrid.querySelectorAll('.insert-shot-item').forEach(i => i.classList.remove('selected'));
        card.classList.add('selected');
      });
      
      card.addEventListener('dblclick', () => {
        selectedInsertShot = shot;
        confirmAndInsertScreenshot();
      });
      
      insertShotGrid.appendChild(card);
    });
  }

  if (insertShotCatSelect) {
    insertShotCatSelect.addEventListener('change', renderInsertScreenshotsList);
  }
  if (insertShotSearch) {
    let searchTimeout = null;
    insertShotSearch.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(renderInsertScreenshotsList, 250);
    });
  }

  function confirmAndInsertScreenshot() {
    if (!selectedInsertShot) {
      showBottomTip('请先选择一张图片！');
      return;
    }
    
    if (noteContentInput) {
      const startPos = noteContentInput.selectionStart;
      const endPos = noteContentInput.selectionEnd;
      const text = noteContentInput.value;
      
      const imgSrc = `http://localhost:30032/screenshot?path=${encodeURIComponent(selectedInsertShot.absolutePath)}`;
      const mdImage = `\n![${selectedInsertShot.videoName}_${formatTime(selectedInsertShot.playbackTime)}](${imgSrc})\n`;
      
      noteContentInput.value = text.substring(0, startPos) + mdImage + text.substring(endPos);
      noteContentInput.selectionStart = noteContentInput.selectionEnd = startPos + mdImage.length;
      noteContentInput.focus();
      
      renderPreview();
    }
    
    hideInsertShotModal();
  }

  if (btnConfirmInsertShot) {
    btnConfirmInsertShot.addEventListener('click', confirmAndInsertScreenshot);
  }
}
