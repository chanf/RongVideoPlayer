const { ipcRenderer } = require('electron');
const path = require('path');

// State
let currentDirectory = '';
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

// DOM Elements
const btnOpenFolder = document.getElementById('btn-open-folder');
const searchInput = document.getElementById('search-input');
const directoryTree = document.getElementById('directory-tree');
const recentListContainer = document.getElementById('recent-list');
const btnClearHistory = document.getElementById('btn-clear-history');

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

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadHistoryAndResume();
});

// Event Listeners Setup
function setupEventListeners() {
  // Directory & UI
  btnOpenFolder.addEventListener('click', selectDirectory);
  searchInput.addEventListener('input', handleSearch);
  btnClearHistory.addEventListener('click', clearPlaybackHistory);

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
  });
  document.addEventListener('click', () => {
    speedDropdown.classList.remove('visible');
  });
  document.querySelectorAll('.speed-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const speed = parseFloat(e.target.dataset.speed);
      setPlaybackSpeed(speed);
    });
  });

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
    recentList: recentList
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
    
    // Save directory path to history
    ipcRenderer.invoke('save-history', { lastDirectory: currentDirectory });
  }
}

function renderDirectoryTree(tree) {
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

  // Name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-name';
  nameSpan.textContent = node.name;
  itemDiv.appendChild(nameSpan);

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
  const query = searchInput.value.toLowerCase().trim();
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
    return;
  }

  // Walk and filter files
  treeNodes.forEach(node => {
    if (node.dataset.type === 'file') {
      const name = node.querySelector('.tree-name').textContent.toLowerCase();
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
    videoTitle.textContent = path.basename(filePath);
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
  showControls(); // keep visible when paused
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

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}
