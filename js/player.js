/*
 * player.js —— 播放状态持久化、显示切换、播放控制
 *
 * 进度自动保存：
 * - 每个本地视频各自记住进度（byFile）
 * - 同时记住「上次播放的是哪一集」（启动恢复）
 * - 触发点：暂停、换集、拖进度条结束、定时、页面隐藏/关闭
 * - 默认防抖 ~1.2s；换集/暂停/关页等传 true 立即落盘
 */

// 追踪当前挂起的 loadedmetadata 监听器：快速连续切换视频时，
// 前一次 openLocal() 挂的监听器可能还没触发（视频还没读完 metadata）
// 就被新的 src 打断而变成"孤儿监听器"。若不清掉，等新视频 metadata 就绪时
// 两个监听器会一起触发，导致进度先跳到旧视频的 restoreTime 再被新值覆盖、
// play() 也会被多余地调用一次。
let pendingMetaHandler = null;

function ensureAudioEnhance() {
  if (typeof createAudioEnhancer !== 'function') return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    if (!mediaSourceNode) {
      mediaSourceNode = audioCtx.createMediaElementSource(player);
    }
    if (!audioEnhancer) {
      audioEnhancer = createAudioEnhancer(audioCtx);
    }
    if (!audioEnhanceWired && audioEnhancer) {
      audioEnhanceWired = audioEnhancer.connectFrom(
        mediaSourceNode,
        audioCtx.destination
      );
    }
    if (audioEnhancer) {
      audioEnhancer.setEnabled(!!audioEnhanceOn);
      audioEnhancer.setWet(audioEnhanceOn ? 1 : 0);
      // 补恢复：增强器刚建好时应用待恢复的响度
      if (_pendingGainRestore != null && typeof audioEnhancer.setGain === 'function') {
        try { audioEnhancer.setGain(_pendingGainRestore); } catch {}
        _pendingGainRestore = null;
      }
    }
  } catch (e) {
    console.warn('ensureAudioEnhance', e);
  }
}

function resetAudioEnhanceAgc() {
  try {
    if (audioEnhancer) audioEnhancer.resetAgc();
  } catch {}
}

/* 每首歌响度记忆：直接读写内存缓存 _pb（同步），不再对 IDB 做并发的读-改-写 */
let _pendingGainRestore = null;
let _gainTok = 0;
function saveGainForFile(file, gain) {
  if (!file || !audioEnhanceOn || typeof gain !== 'number' || !isFinite(gain) || !_pb) return;
  if (!_pb.gainByFile || typeof _pb.gainByFile !== 'object') _pb.gainByFile = {};
  _pb.gainByFile[file] = gain;
}
async function restoreGainForFile(file) {
  const tok = ++_gainTok;
  _pendingGainRestore = null;
  if (!audioEnhanceOn) return; // 增强关闭时不应用增益，否则 AGC 已停、音量会卡在旧值
  try {
    const st = await loadState();
    if (tok !== _gainTok) return; // 等待期间又切了歌
    const g = st.gainByFile && typeof st.gainByFile[file] === 'number' ? st.gainByFile[file] : null;
    if (g == null) return;
    if (audioEnhancer && typeof audioEnhancer.setGain === 'function') {
      audioEnhancer.setGain(g);
    } else {
      _pendingGainRestore = g; // 增强器还没建好，等 ensure 后恢复
    }
  } catch {}
}

function setAudioEnhance(on) {
  audioEnhanceOn = !!on;
  if (audioEnhancer) {
    audioEnhancer.setEnabled(audioEnhanceOn);
    audioEnhancer.setWet(audioEnhanceOn ? 1 : 0);
  }
  if (audioEnhanceBtn) {
    audioEnhanceBtn.classList.toggle('active', audioEnhanceOn);
    audioEnhanceBtn.title = audioEnhanceOn
      ? '音质增强（开）：降噪 + 响度平衡'
      : '音质增强（关）';
  }
  // 重新打开增强：把当前这首记住的响度补上
  if (audioEnhanceOn && mode === 'local' && currentIndex >= 0) {
    restoreGainForFile(videoList[currentIndex]);
  }
}

/**
 * playback 状态的内存缓存（唯一真相）。
 * 之前每次存档都「异步读 IDB → 改 → 写」，切歌时多路并发会互相覆盖，
 * 且 pagehide 里的两次异步往返来不及完成。现在：读一次进缓存，之后同步改缓存、
 * 同步发起一次 put（事务在 pagehide 同步阶段即已提交给浏览器）。
 */
let _pb = null;
let _pbLoading = null;
async function loadState() {
  if (_pb) return _pb;
  if (!_pbLoading) {
    _pbLoading = (async () => {
      let s = null;
      try {
        s = await idbGet('state', 'playback');
      } catch {}
      if (!_pb) _pb = s && typeof s === 'object' ? s : {};
      _pbLoading = null;
      return _pb;
    })();
  }
  return _pbLoading;
}

/** 某文件已保存的进度秒数 */
async function getSavedTime(file) {
  if (!file) return 0;
  try {
    const state = await loadState();
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
 * 当前文件「进度可信」的标记：只有 loadedmetadata 之后且已应用恢复进度，
 * 才允许把 player.currentTime 写进存档。否则刚换 src 时 currentTime 还是 0，
 * 此时定时存档 / 切后台 / 关页会把该集已存进度覆盖成 0。
 */
let _readyFile = null;
let _openTok = 0; // 每次 openLocal / showYT 递增，用来作废过期的异步回调

/**
 * 把当前播放进度写入存档（同步改缓存 + 同步发起一次 put）。
 * - file / time：上次打开的那一集（启动时恢复用）
 * - byFile：每个文件各自的进度；播到结尾附近记 0，下次从头播
 * - gainByFile：每首歌响度记忆（只在该集已开播后才更新）
 */
let _saveStateTimer = null;

function flushState() {
  if (mode !== 'local' || currentIndex < 0) return;
  const file = videoList[currentIndex];
  if (!file) return;
  if (!_pb) {
    loadState().then(() => flushState());
    return;
  }
  if (_readyFile === file) {
    let time = player.currentTime || 0;
    const dur = player.duration;
    if (isFinite(dur) && dur > 0 && time >= dur - 1.5) time = 0; // 接近结束：视为看完
    if (!_pb.byFile || typeof _pb.byFile !== 'object') _pb.byFile = {};
    _pb.byFile[file] = time;
    _pb.file = file;
    _pb.time = time;
    if (audioEnhancer && typeof audioEnhancer.getGain === 'function') {
      saveGainForFile(file, audioEnhancer.getGain());
    }
  }
  idbSet('state', 'playback', _pb);
}

/** @param {boolean} [immediate] 为 true 时取消防抖并立刻写入 */
function saveState(immediate) {
  if (immediate) {
    if (_saveStateTimer) {
      clearTimeout(_saveStateTimer);
      _saveStateTimer = null;
    }
    return flushState();
  }
  if (_saveStateTimer) return;
  _saveStateTimer = setTimeout(() => {
    _saveStateTimer = null;
    flushState();
  }, 1200);
}

const hideAll = () => {
  player.style.display = 'none';
  ytFrame.style.display = 'none';
  placeholder.style.display = 'none';
  if (videoError) videoError.hidden = true;
};

const showLocal = () => {
  hideAll();
  // 切回本地前先断掉 YouTube，否则 iframe 在后台继续播声音
  ytFrame.removeAttribute('src');
  player.style.display = 'block';
  progressArea.classList.add('show');
  mode = 'local';
  ensureAudioEnhance();
};

/** 视频加载失败遮罩：普通模式给用户看错误+重试；循环模式由自动跳集接管 */
const showVideoError = (msg) => {
  if (!videoError) return;
  if (videoErrorText && msg) videoErrorText.textContent = msg;
  videoError.hidden = false;
};
const hideVideoError = () => {
  if (videoError) videoError.hidden = true;
};

const showYT = id => {
  // 切到 YouTube 前先把当前本地进度存好
  saveState(true);
  if (pendingMetaHandler) {
    player.removeEventListener('loadedmetadata', pendingMetaHandler);
    pendingMetaHandler = null;
  }
  player.pause();
  player.removeAttribute('src');
  player.load();
  _readyFile = null;
  _openTok++;
  hideAll();
  progressArea.classList.remove('show');
  // YouTube 模式无本地进度条：横竖屏两套都清零，避免停在旧值
  setProgressUI(0, 0, 0);
  ytFrame.style.display = 'block';
  ytFrame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
  mode = 'youtube';
  currentIndex = -1;
  playBtn.innerHTML = ICON_PLAY;
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
  // 切歌前：存当前歌的响度
  try {
    // 只有旧片已开播才存（否则刷歌时会把刚恢复/刚重置的 1 写回去）
    if (mode === 'local' && currentIndex >= 0 && videoList[currentIndex] && _readyFile === videoList[currentIndex] && audioEnhancer && typeof audioEnhancer.getGain === 'function') {
      saveGainForFile(videoList[currentIndex], audioEnhancer.getGain());
    }
  } catch {}
  _readyFile = null;
  const openTok = ++_openTok;
  currentIndex = index;
  const file = videoList[index];

  showLocal();
  hideVideoError();
  resetAudioEnhanceAgc();
  // 恢复这首歌的响度记忆（若有）
  restoreGainForFile(file);
  // 手动切歌：旧预加载作废
  if (typeof cancelPrefetch === 'function' && file !== _prefetchFile) cancelPrefetch();
  // 远程地址；crossOrigin 已在 state.js 设置
  player.src = BASE_URL + file;
  nowPlaying.textContent = file;
  updatePosInfo();

  grid.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('active', c.dataset.file === file);
  });

  const onMeta = async () => {
    player.removeEventListener('loadedmetadata', onMeta);
    if (pendingMetaHandler === onMeta) pendingMetaHandler = null;

    ensureAudioEnhance();

    let t = restoreTime;
    if (typeof t !== 'number') {
      t = await getSavedTime(file);
    }
    // 等待期间用户可能已切到别的视频 / YouTube：这个回调作废，别去动新片
    if (openTok !== _openTok || mode !== 'local') return;
    if (typeof t === 'number' && t > 0.5 && isFinite(player.duration) && t < player.duration - 1) {
      player.currentTime = t;
    }
    _readyFile = file; // 从此 currentTime 才可信，允许写进存档
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
  if (player.paused) {
    ensureAudioEnhance();
    player.play().catch(() => {});
  } else {
    player.pause();
  }
};

const playPrev = () => {
  if (currentIndex > 0) {
    saveState(true);
    openLocal(currentIndex - 1);
  }
};

const playNext = () => {
  if (currentIndex < videoList.length - 1) {
    saveState(true);
    openLocal(currentIndex + 1);
  }
};

/** 连续跳过失败次数；成功播出（play 事件）时清零，防止全列表挂掉时死循环 */
let sequentialSkipCount = 0;

function syncPlayModeUI() {
  if (loopBtn) {
    loopBtn.classList.toggle('active', sequentialPlay);
    loopBtn.title = sequentialPlay ? '顺序循环（开）' : '顺序循环（关）';
  }
  if (shuffleBtn) {
    shuffleBtn.classList.toggle('active', randomPlay);
    shuffleBtn.title = randomPlay ? '随机播放（开）' : '随机播放（关）';
  }
}

function setPlayMode(modeName) {
  if (modeName === 'sequential') {
    sequentialPlay = !sequentialPlay;
    if (sequentialPlay) randomPlay = false;
  } else if (modeName === 'random') {
    randomPlay = !randomPlay;
    if (randomPlay) sequentialPlay = false;
  } else {
    sequentialPlay = false;
    randomPlay = false;
  }
  syncPlayModeUI();
}

const playNextSequential = () => {
  if (mode !== 'local' || !videoList.length) return;
  sequentialSkipCount += 1;
  if (sequentialSkipCount > videoList.length) {
    sequentialSkipCount = 0;
    playBtn.innerHTML = ICON_PLAY;
    return;
  }
  saveState(true);
  const next = currentIndex + 1 < videoList.length ? currentIndex + 1 : 0;
  openLocal(next);
};

const playNextRandom = () => {
  if (mode !== 'local' || !videoList.length) return;
  sequentialSkipCount += 1;
  if (sequentialSkipCount > videoList.length) {
    sequentialSkipCount = 0;
    playBtn.innerHTML = ICON_PLAY;
    return;
  }
  saveState(true);
  if (videoList.length === 1) {
    openLocal(0);
    return;
  }
  let next = currentIndex;
  for (let i = 0; i < 12; i++) {
    next = Math.floor(Math.random() * videoList.length);
    if (next !== currentIndex) break;
  }
  if (next === currentIndex) next = (currentIndex + 1) % videoList.length;
  openLocal(next);
};

const autoAdvance = () => {
  if (randomPlay) playNextRandom();
  else if (sequentialPlay) playNextSequential();
};

/* ── 低网速优化：顺序播放时预加载下一首 ── */
let _prefetchVideo = null;
let _prefetchFile = null;
function prefetchNext() {
  if (mode !== 'local' || !videoList.length) return;
  if (!sequentialPlay && !randomPlay) return;
  const next = currentIndex + 1 < videoList.length ? currentIndex + 1 : 0;
  const file = videoList[next];
  if (!file || file === _prefetchFile) return;
  // 切掉旧的预加载
  try { if (_prefetchVideo) { _prefetchVideo.removeAttribute('src'); _prefetchVideo.load(); } } catch {}
  _prefetchFile = file;
  try {
    if (!_prefetchVideo) {
      _prefetchVideo = document.createElement('video');
      _prefetchVideo.preload = 'auto';
      _prefetchVideo.muted = true;
      _prefetchVideo.style.display = 'none';
      document.body.appendChild(_prefetchVideo);
    }
    _prefetchVideo.src = BASE_URL + file;
    _prefetchVideo.load();
  } catch {}
}
function cancelPrefetch() {
  _prefetchFile = null;
  try { if (_prefetchVideo) { _prefetchVideo.removeAttribute('src'); _prefetchVideo.load(); } } catch {}
}
