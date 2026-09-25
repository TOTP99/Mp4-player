/*
 * events.js —— 按钮、播放器、进度条拖拽、键盘快捷键、左右滑动换片
 */

/** 在 YouTube 输入框短暂显示操作提示（不覆盖已输入内容） */
let _tipTimer = null;
const DEFAULT_URL_PLACEHOLDER = '粘贴 YouTube 链接';
function flashTip(msg, ms = 1600) {
  if (!urlInput) return;
  if (_tipTimer) clearTimeout(_tipTimer);
  const hadFocus = document.activeElement === urlInput;
  const prevPh = urlInput.placeholder || DEFAULT_URL_PLACEHOLDER;
  urlInput.placeholder = msg;
  // 若用户已输入内容，不改 value，仅换 placeholder 也能看到提示
  _tipTimer = setTimeout(() => {
    urlInput.placeholder = prevPh === msg ? DEFAULT_URL_PLACEHOLDER : prevPh;
    _tipTimer = null;
    if (hadFocus) urlInput.focus();
  }, ms);
}

playUrlBtn.addEventListener('click', () => {
  const id = ytId(urlInput.value.trim());
  if (!id) return alert('无法识别 YouTube 链接');
  showYT(id);
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') playUrlBtn.click();
});

toggleListBtn.addEventListener('click', async () => {
  const open = listPanel.classList.toggle('open');
  toggleListBtn.classList.toggle('active', open);
  toggleListBtn.title = open ? '收起列表' : '视频列表';
  await saveUI({ listOpen: open });
  flashTip(open ? '列表 · 开' : '列表 · 关');
  if (open) refreshAllThumbs();
});

// 顺序 / 随机：仅 click；互斥
loopBtn?.addEventListener('click', async () => {
  setPlayMode('sequential');
  await saveUI({ sequentialPlay, randomPlay });
  flashTip(sequentialPlay ? '顺序循环 · 开' : '顺序循环 · 关');
});
shuffleBtn?.addEventListener('click', async () => {
  setPlayMode('random');
  await saveUI({ sequentialPlay, randomPlay });
  flashTip(randomPlay ? '随机播放 · 开' : '随机播放 · 关');
});
// 音质增强：仅 local
audioEnhanceBtn?.addEventListener('click', async () => {
  setAudioEnhance(!audioEnhanceOn);
  await saveUI({ audioEnhance: audioEnhanceOn });
  flashTip(audioEnhanceOn ? '降噪音质 · 开' : '降噪音质 · 关');
});

refreshBtn.addEventListener('click', async () => {
  if (scanning) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  const prevStatus = status.textContent;
  status.textContent = '正在刷新视频列表…';
  flashTip('正在刷新列表…');
  try {
    const result = await scanVideos();
    if (result) {
      status.textContent = result.changed
        ? '共 ' + videoList.length + ' 个视频（新增 ' + result.addedCount + ' 个）'
        : '共 ' + videoList.length + ' 个视频（无新增）';
      // 列表变长时刷新标题栏序号/总数（当前片可能还在播）
      updatePosInfo();
      flashTip(
        result.changed
          ? '刷新完成 · 新增 ' + result.addedCount + ' 个'
          : '刷新完成 · 无新增'
      );
    } else {
      status.textContent = prevStatus;
      flashTip('刷新完成');
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
});

playBtn.addEventListener('click', () => {
  if (mode !== 'local') return;
  const wasPaused = player.paused;
  togglePlay();
  flashTip(wasPaused ? '播放中' : '已暂停');
});
prevBtn.addEventListener('click', () => {
  playPrev();
  if (mode === 'local' && currentIndex >= 0) flashTip('上一集');
});
nextBtn.addEventListener('click', () => {
  playNext();
  if (mode === 'local' && currentIndex >= 0) flashTip('下一集');
});
fsBtn.addEventListener('click', () => {
  toggleFullscreen();
  // 全屏切换有延迟，稍后再读状态
  setTimeout(() => {
    const nowOn = !!(document.fullscreenElement || document.webkitFullscreenElement);
    flashTip(nowOn ? '全屏 · 开' : '全屏 · 关');
  }, 80);
});
document.addEventListener('fullscreenchange', syncFsBtn);
document.addEventListener('webkitfullscreenchange', syncFsBtn);

// ---- <video> 事件 ----
player.addEventListener('play', () => {
  playBtn.innerHTML = ICON_PAUSE;
  sequentialSkipCount = 0; // 成功开始播放，清零失败跳过计数
});
player.addEventListener('pause', () => {
  playBtn.innerHTML = ICON_PLAY;
  saveState(true);
  tryCapture();
});
player.addEventListener('ended', () => {
  playBtn.innerHTML = ICON_PLAY;
  // 播完：进度记为 0，下次该片从头播
  saveState(true);
  tryCapture();
  autoAdvance();
});
player.addEventListener('error', () => {
  if (mode !== 'local' || !videoList.length) return;
  if (!sequentialPlay && !randomPlay) return;
  autoAdvance();
});
// timeupdate 高频：仅更新进度条，节流 ~5 次/秒；截图与 timeupdate 解耦
let lastProgressUI = 0;
player.addEventListener('timeupdate', () => {
  if (seeking) return;
  const now = performance.now();
  if (now - lastProgressUI < 200) return;
  lastProgressUI = now;
  const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0;
  setProgressUI(pct, player.currentTime, player.duration || 0);
});
player.addEventListener('loadedmetadata', () => {
  setProgressUI(
    player.duration ? (player.currentTime / player.duration) * 100 : 0,
    player.currentTime,
    player.duration || 0
  );
});

// 双击画面 → 设为代表图（覆盖）；不改动右侧序号
player.addEventListener('dblclick', async e => {
  e.preventDefault();
  const ok = await setThumbFromCurrent();
  if (ok) {
    const prev = nowPlaying.textContent;
    nowPlaying.textContent = '✓ 已设为代表图';
    setTimeout(() => {
      if (nowPlaying.textContent === '✓ 已设为代表图') nowPlaying.textContent = prev;
    }, 1200);
  }
});

// ---- 画面左右滑动换视频（仅本地模式） ----
let swipeStartX = 0;
let swipeStartY = 0;
let swipeTracking = false;

if (stage) {
  stage.addEventListener(
    'touchstart',
    e => {
      if (mode !== 'local' || e.touches.length !== 1) return;
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
      swipeTracking = true;
    },
    { passive: true }
  );

  stage.addEventListener(
    'touchend',
    e => {
      if (!swipeTracking || mode !== 'local') return;
      swipeTracking = false;
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - swipeStartX;
      const dy = t.clientY - swipeStartY;
      // 水平位移足够大，且明显大于竖直，才算换片手势
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (dx < 0) playNext();
      else playPrev();
    },
    { passive: true }
  );

  stage.addEventListener(
    'touchcancel',
    () => {
      swipeTracking = false;
    },
    { passive: true }
  );
}

// ---- 进度条拖拽（优先 Pointer Events，旧环境 fallback touch） ----
let seeking = false;
let seekBar = null;

const ratioFromEvent = (bar, e) => {
  const point =
    e.touches?.[0] || e.changedTouches?.[0] || e;
  const rect = bar.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (point.clientX - rect.left) / rect.width));
};

const applySeek = (bar, e) => {
  if (mode !== 'local' || !bar || !player.duration) return;
  const ratio = ratioFromEvent(bar, e);
  const t = ratio * player.duration;
  player.currentTime = t;
  setProgressUI(ratio * 100, t, player.duration);
};

const onSeekStart = (bar, e) => {
  if (mode !== 'local' || !bar) return;
  if (e.cancelable) e.preventDefault();
  seeking = true;
  seekBar = bar;
  bar.classList.add('is-dragging');
  applySeek(bar, e);
};

const onSeekMove = e => {
  if (!seeking || !seekBar) return;
  if (e.cancelable) e.preventDefault();
  applySeek(seekBar, e);
};

const onSeekEnd = e => {
  if (!seeking) return;
  if (seekBar && e) applySeek(seekBar, e);
  if (seekBar) seekBar.classList.remove('is-dragging');
  seeking = false;
  seekBar = null;
  saveState(true);
};

const bindSeekBar = bar => {
  if (!bar) return;

  // 现代浏览器：只用 Pointer Events，避免与 touch 双触发
  if (typeof window.PointerEvent === 'function') {
    bar.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {}
      onSeekStart(bar, e);
    });
    bar.addEventListener('pointermove', e => {
      if (!seeking || seekBar !== bar) return;
      onSeekMove(e);
    });
    bar.addEventListener('pointerup', onSeekEnd);
    bar.addEventListener('pointercancel', onSeekEnd);
    return;
  }

  // 旧环境 fallback：仅 touch
  bar.addEventListener('touchstart', e => onSeekStart(bar, e), { passive: false });
  bar.addEventListener(
    'touchmove',
    e => {
      if (!seeking || seekBar !== bar) return;
      onSeekMove(e);
    },
    { passive: false }
  );
  bar.addEventListener('touchend', onSeekEnd);
  bar.addEventListener('touchcancel', onSeekEnd);
};

bindSeekBar(progressBar);
bindSeekBar(progressBarLand);

// 截图 / 定时落盘：页面可见时跑，切到后台停掉（省电）
let captureTimer = null;
let saveTimer = null;

const startBgTimers = () => {
  if (!captureTimer) {
    captureTimer = setInterval(() => {
      if (mode === 'local' && !player.paused && !player.ended) tryCapture();
    }, 3000);
  }
  if (!saveTimer) {
    // 防抖版 saveState：约 1.2s 合并一次实际写入
    saveTimer = setInterval(() => saveState(), 4000);
  }
};

const stopBgTimers = () => {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
};

startBgTimers();

// 列表卡片事件委托（cards.js 不再绑 click）
// 已是当前片不重载；切片前落盘，避免丢进度
if (grid) {
  grid.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card || !grid.contains(card)) return;
    const file = card.dataset.file;
    if (!file || !videoList.length) return;
    const idx = videoList.indexOf(file);
    if (idx < 0) return;
    if (mode === 'local' && idx === currentIndex) return;
    saveState(true);
    openLocal(idx);
  });
}

// 切后台：立刻落盘 + 停时钟/截图/定时存；回前台再开
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveState(true);
    stopBgTimers();
    stopClock();
  } else {
    startBgTimers();
    startClock();
  }
});
window.addEventListener('pagehide', () => {
  saveState(true);
});

// ---- 键盘（输入框聚焦时忽略） ----
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ':
    case 'k':
    case 'K':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      playPrev();
      break;
    case 'ArrowRight':
      e.preventDefault();
      playNext();
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'r':
    case 'R':
      e.preventDefault();
      refreshBtn.click();
      break;
  }
});
