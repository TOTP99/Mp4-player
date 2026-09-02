/*
 * player.js —— 播放状态持久化、显示切换、播放控制
 */

// 追踪当前挂起的 loadedmetadata 监听器：快速连续切换视频时，
// 前一次 openLocal() 挂的监听器可能还没触发（视频还没读完 metadata）
// 就被新的 src 打断而变成"孤儿监听器"。若不清掉，等新视频 metadata 就绪时
// 两个监听器会一起触发，导致进度先跳到旧视频的 restoreTime 再被新值覆盖、
// play() 也会被多余地调用一次。
let pendingMetaHandler = null;

async function saveState() {
  if (mode !== 'local' || currentIndex < 0) return;
  try {
    await idbSet('state', 'playback', {
      file: videoList[currentIndex],
      time: player.currentTime || 0
    });
  } catch {}
}

async function loadState() {
  try {
    return await idbGet('state', 'playback');
  } catch {
    return null;
  }
}

const hideAll = () => {
  player.style.display = 'none';
  ytFrame.style.display = 'none';
  placeholder.style.display = 'none';
};

const showLocal = () => {
  hideAll();
  player.style.display = 'block';
  progressArea.classList.add('show');
  mode = 'local';
};

const showYT = id => {
  if (pendingMetaHandler) {
    player.removeEventListener('loadedmetadata', pendingMetaHandler);
    pendingMetaHandler = null;
  }
  player.pause();
  player.removeAttribute('src');
  player.load();
  hideAll();
  progressArea.classList.remove('show');
  ytFrame.style.display = 'block';
  ytFrame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
  mode = 'youtube';
  currentIndex = -1;
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  playBtn.textContent = '▶';
  grid.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
};

const openLocal = (index, restoreTime) => {
  if (index < 0 || index >= videoList.length) return;
  currentIndex = index;
  const file = videoList[index];

  showLocal();
  // 远程地址；crossOrigin 已在 state.js 设置
  player.src = BASE_URL + file;
  nowPlaying.textContent = file;
  prevBtn.disabled = index <= 0;
  nextBtn.disabled = index >= videoList.length - 1;

  grid.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('active', c.dataset.file === file);
  });

  const onMeta = () => {
    player.removeEventListener('loadedmetadata', onMeta);
    pendingMetaHandler = null;
    if (typeof restoreTime === 'number' && restoreTime > 0 && restoreTime < player.duration) {
      player.currentTime = restoreTime;
    }
    player.play().catch(() => {});
  };

  if (pendingMetaHandler) {
    player.removeEventListener('loadedmetadata', pendingMetaHandler);
  }
  pendingMetaHandler = onMeta;
  player.addEventListener('loadedmetadata', onMeta);
};

const togglePlay = () => {
  if (mode !== 'local') return;
  player.paused ? player.play().catch(() => {}) : player.pause();
};

const playPrev = () => {
  if (currentIndex > 0) {
    saveState();
    openLocal(currentIndex - 1);
  }
};

const playNext = () => {
  if (currentIndex < videoList.length - 1) {
    saveState();
    openLocal(currentIndex + 1);
  }
};
