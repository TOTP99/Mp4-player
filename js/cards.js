/*
 * cards.js —— 本地（远程）视频列表卡片
 * 点击由 events.js 在 #grid 上事件委托处理（避免每个 card 单独绑监听器）
 * 只建 DOM，不读 IDB；缩略图统一由 refreshAllThumbs / updateCardThumb 填充
 */
const createCard = name => {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.file = name;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = '播放后截图';
  thumb.appendChild(ph);

  const num = document.createElement('div');
  num.className = 'num';
  num.textContent = name.replace(/\.mp4$/i, '');
  thumb.appendChild(num);

  const hoverPlay = document.createElement('div');
  hoverPlay.className = 'hover-play';
  hoverPlay.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  thumb.appendChild(hoverPlay);

  const label = document.createElement('div');
  label.className = 'name';
  label.textContent = name;

  card.append(thumb, label);
  return card;
};

/**
 * 从列表移除一项（失效视频）：同步 videoList / knownVideos / 进度 / 卡片，并接着播相邻一项。
 * 不加黑名单：若之后手动刷新仍能探测到这个文件，它会重新出现（适合偶发网络错误的误删）。
 */
const removeFromList = async file => {
  const idx = videoList.indexOf(file);
  if (idx < 0) return;
  videoList = videoList.filter(n => n !== file);
  captured.delete(file);
  try {
    await idbSet('state', 'knownVideos', videoList);
  } catch {}
  try {
    const st = await loadState();
    if (st.byFile) delete st.byFile[file];
    if (st.gainByFile) delete st.gainByFile[file];
    if (st.file === file) {
      delete st.file;
      st.time = 0;
    }
    st.ts = Date.now();
    lsBackup(st);
    idbSet('state', 'playback', st);
  } catch {}
  const card = grid.querySelector(`[data-file="${safeFileSel(file)}"]`);
  if (card) card.remove();

  if (!videoList.length) {
    mode = null;
    currentIndex = -1;
    _readyFile = null;
    _openTok++;
    try {
      player.pause();
      player.removeAttribute('src');
      player.load();
    } catch {}
    hideAll();
    placeholder.style.display = '';
    progressArea.classList.remove('show');
    setProgressUI(0, 0, 0);
    nowPlaying.textContent = '准备播放';
    playBtn.innerHTML = ICON_PLAY;
    updatePosInfo();
    status.textContent = `未发现可用视频（远程 1.mp4 ~ ${MAX}.mp4）`;
    return;
  }
  status.textContent = '共 ' + videoList.length + ' 个视频（已移除 ' + file + '）';
  openLocal(Math.min(idx, videoList.length - 1));
};
