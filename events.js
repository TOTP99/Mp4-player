/*
 * events.js —— 按钮、播放器、进度条拖拽、键盘快捷键
 */
playUrlBtn.addEventListener('click', () => {
  const id = ytId(urlInput.value.trim());
  if (!id) return alert('无法识别 YouTube 链接');
  nowPlaying.textContent = 'YouTube · ' + id;
  showYT(id);
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') playUrlBtn.click();
});

toggleListBtn.addEventListener('click', async () => {
  const open = listPanel.classList.toggle('open');
  toggleListBtn.textContent = open ? '📂' : '📁';
  toggleListBtn.title = open ? '收起列表' : '视频列表';
  await saveUI({ listOpen: open });
  if (open) refreshAllThumbs();
});

refreshBtn.addEventListener('click', async () => {
  if (scanning) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  const prevStatus = status.textContent;
  status.textContent = '正在刷新视频列表…';
  try {
    const result = await scanVideos();
    if (result) {
      status.textContent = result.changed
        ? '共 ' + videoList.length + ' 个视频（新增 ' + result.addedCount + ' 个）'
        : '共 ' + videoList.length + ' 个视频（无新增）';
    } else {
      status.textContent = prevStatus;
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
});

playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);
fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFsBtn);
document.addEventListener('webkitfullscreenchange', syncFsBtn);

// ---- <video> 事件 ----
player.addEventListener('play', () => {
  playBtn.textContent = '⏸';
});
player.addEventListener('pause', () => {
  playBtn.textContent = '▶';
  saveState();
  tryCapture();
});
player.addEventListener('ended', () => {
  playBtn.textContent = '▶';
  tryCapture();
});
player.addEventListener('timeupdate', () => {
  if (seeking) return;
  const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0;
  setProgressUI(pct, player.currentTime, player.duration || 0);
  tryCapture();
});
player.addEventListener('loadedmetadata', () => {
  setProgressUI(
    player.duration ? (player.currentTime / player.duration) * 100 : 0,
    player.currentTime,
    player.duration || 0
  );
});

// 双击画面 → 设为代表图（覆盖）
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

// ---- 进度条拖拽（pointer + touch 兼容） ----
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
  saveState();
};

const bindSeekBar = bar => {
  if (!bar) return;
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

setInterval(saveState, 5000);

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
