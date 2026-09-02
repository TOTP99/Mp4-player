/*
 * player.js —— 播放状态持久化、显示切换、播放控制
 *
 * 进度自动保存：
 * - 每个本地视频各自记住进度（byFile）
 * - 同时记住「上次播放的是哪一集」（启动恢复）
 * - 触发点：暂停、换集、拖进度条结束、定时、页面隐藏/关闭
 */

// 追踪当前挂起的 loadedmetadata 监听器：快速连续切换视频时，
// 前一次 openLocal() 挂的监听器可能还没触发（视频还没读完 metadata）
// 就被新的 src 打断而变成"孤儿监听器"。若不清掉，等新视频 metadata 就绪时
// 两个监听器会一起触发，导致进度先跳到旧视频的 restoreTime 再被新值覆盖、
// play() 也会被多余地调用一次。
let pendingMetaHandler = null;

/** 读取完整 playback 对象（兼容旧数据：只有 file/time） */
async function loadState() {
  try {
    return (await idbGet('state', 'playback')) || null;
  } catch {
    return null;
  }
}

/** 某文件已保存的进度秒数 */
async function getSavedTime(file) {
  if (!file) return 0;
  try {
    const state = await loadState();
    if (!state) return 0;
    if (state.byFile && typeof state.byFile[file] === 'number') {
      return state.byFile[file];
    }
    // 旧格式：只有最后一次播放记录
    if (state.file === file && typeof state.time === 'number') return state.time;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 把当前播放进度写入 IndexedDB。
 * - file / time：上次打开的那一集（启动时恢复用）
 * - byFile：每个文件各自的进度
 * 播到结尾附近时记 0，下次从头播。
 */
async function saveState() {
  if (mode !== 'local' || currentIndex < 0) return;
  const file = videoList[currentIndex];
  if (!file) return;

  let time = player.currentTime || 0;
  const dur = player.duration;
  // 接近结束：视为看完，下次从头开始
  if (isFinite(dur) && dur > 0 && time >= dur - 1.5) {
    time = 0;
  }

  try {
    const prev = (await loadState()) || {};
    const byFile =
      prev.byFile && typeof prev.byFile === 'object' ? { ...prev.byFile } : {};
    byFile[file] = time;
    await idbSet('state', 'playback', {
      file,
      time,
      byFile
    });
  } catch {}
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
  // 切到 YouTube 前先把当前本地进度存好
  saveState();
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
  nowPlaying.textContent = 'YouTube · ' + id;
  updatePosInfo();
  grid.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
};

/**
 * @param {number} index
 * @param {number} [restoreTime] 显式指定进度；不传则自动读该文件的保存进度
 */
const openLocal = (index, restoreTime) => {
  if (index < 0 || index >= videoList.length) return;
  currentIndex = index;
  const file = videoList[index];

  showLocal();
  // 远程地址；crossOrigin 已在 state.js 设置
  player.src = BASE_URL + file;
  nowPlaying.textContent = file;
  updatePosInfo();
  prevBtn.disabled = index <= 0;
  nextBtn.disabled = index >= videoList.length - 1;

  grid.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('active', c.dataset.file === file);
  });

  const onMeta = async () => {
    player.removeEventListener('loadedmetadata', onMeta);
    pendingMetaHandler = null;

    let t = restoreTime;
    if (typeof t !== 'number') {
      t = await getSavedTime(file);
    }
    if (typeof t === 'number' && t > 0.5 && isFinite(player.duration) && t < player.duration - 1) {
      player.currentTime = t;
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
