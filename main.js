/*
 * main.js —— 启动：缓存秒开 → 后台 HEAD 探测远程视频 → 合并列表 → 恢复进度
 * 策略：只增不减；探测失败不删已有；慢网下先显示缓存再增量更新
 * 刷新/增量合并时尽量不打断正在播放的视频
 *
 * 效率：
 * - 启动时对 knownVideos 做轻量抽检 + 只探测未知名，全量留给手动刷新
 * - showList 用 DocumentFragment；列表未变且 keepFile 时只同步高亮不重绘
 * - createCard 纯同步建 DOM，缩略图走 refreshAllThumbs
 */
const videoUrl = name => BASE_URL + name;
const allVideoNames = () => Array.from({ length: MAX }, (_, i) => i + 1 + '.mp4');

/** HEAD 探测（快、省流量）；失败再 fallback 到 video metadata */
const exists = async name => {
  const url = videoUrl(name);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      signal: ctrl.signal,
      cache: 'force-cache'
    });
    clearTimeout(timer);
    if (res.ok) return true;
  } catch {}
  // fallback：轻量 video 探测
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    const done = ok => {
      v.removeAttribute('src');
      v.load();
      resolve(ok);
    };
    v.addEventListener('loadedmetadata', () => done(true));
    v.addEventListener('error', () => done(false));
    setTimeout(() => done(false), 3500);
    v.src = url;
  });
};

/** 是否正在扫描（供 events.js 判断，防止重复点击刷新） */
let scanning = false;

/**
 * 并发探测指定文件名列表。
 * names 缺省时探测 1.mp4 ~ MAX.mp4（全量，用于手动刷新）。
 */
const probeNames = async names => {
  const list = names || allVideoNames();
  // 弱网略降并发，避免打爆
  let CONCURRENCY = 6;
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && (c.saveData || /2g|slow-2g|3g/i.test(c.effectiveType || ''))) {
      CONCURRENCY = 3;
    }
  } catch {}

  const scanned = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      const name = list[i];
      if (await exists(name)) scanned.push(name);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length || 1) }, () => worker()));
  return scanned;
};

/** 全量探测（手动刷新 / 无缓存首次） */
const probeAll = () => probeNames(null);

/**
 * 启动轻量探测：
 * - 对已缓存 known 抽检最多 4 个（头、尾、中间），确认仍可用则整表保留
 * - 只探测「不在 known 里」的候选名，找新增
 * - 抽检若大量失败，则回退全量探测（防缓存过期）
 */
const probeIncremental = async known => {
  const allNames = allVideoNames();
  const knownSet = new Set(known);
  const knownList = known.filter(n => allNames.includes(n));

  // 抽检：最多 4 个
  const sample = [];
  if (knownList.length) {
    sample.push(knownList[0]);
    if (knownList.length > 1) sample.push(knownList[knownList.length - 1]);
    if (knownList.length > 3) {
      sample.push(knownList[Math.floor(knownList.length / 3)]);
      sample.push(knownList[Math.floor((knownList.length * 2) / 3)]);
    } else if (knownList.length > 2) {
      sample.push(knownList[Math.floor(knownList.length / 2)]);
    }
  }
  const uniqueSample = [...new Set(sample)];
  let stillOk = 0;
  if (uniqueSample.length) {
    const okList = await probeNames(uniqueSample);
    stillOk = okList.length;
  }

  // 抽检失败过半 → 缓存可能过期，全量扫
  if (uniqueSample.length && stillOk < Math.ceil(uniqueSample.length / 2)) {
    return probeAll();
  }

  // 只探未知名
  const unknown = allNames.filter(n => !knownSet.has(n));
  const foundNew = unknown.length ? await probeNames(unknown) : [];

  // 已知仍保留 + 新增
  return Array.from(new Set([...knownList, ...foundNew]));
};

/** 当前 <video> 是否正在播指定文件名 */
const isPlayingFile = file => {
  if (!file || mode !== 'local') return false;
  const src = player.getAttribute('src') || '';
  return src === BASE_URL + file || src.endsWith('/' + file) || src.endsWith(file);
};

/**
 * 列表变了但还在播同一文件：只同步 index / 按钮 / 高亮 / 序号，不重载 src
 */
const syncPlayingUI = file => {
  const idx = videoList.indexOf(file);
  if (idx < 0) return;
  currentIndex = idx;
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= videoList.length - 1;
  nowPlaying.textContent = file;
  updatePosInfo();
  grid.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('active', c.dataset.file === file);
  });
};

/**
 * 扫描远程目录并与当前列表合并（只增不减）。
 * restoreOnFirst：合并后若此前列表为空，则尝试恢复上次播放进度（用于启动时首次扫描）。
 * 手动点刷新时不传，走"仅刷新列表不打断当前播放"的分支。
 */
const scanVideos = async ({ restoreOnFirst = false } = {}) => {
  if (scanning) return;
  scanning = true;
  scanBar?.classList.add('active');
  try {
    const before = videoList.slice();
    // 合并前记下正在播的文件，避免 videoList 替换后 index 对不上
    const playingFile =
      mode === 'local' && currentIndex >= 0 ? before[currentIndex] : null;

    // 启动且已有缓存 → 轻量增量；否则（手动刷新 / 无缓存）全量
    let scanned;
    if (restoreOnFirst && before.length) {
      scanned = await probeIncremental(before);
    } else {
      scanned = await probeAll();
    }

    const merged = Array.from(new Set([...before, ...scanned])).sort(
      (a, b) => parseInt(a, 10) - parseInt(b, 10)
    );

    const same =
      merged.length === videoList.length &&
      merged.every((n, i) => n === videoList[i]);

    if (!same) {
      videoList = merged;
      try {
        await idbSet('state', 'knownVideos', merged);
      } catch {}
      // 启动且此前无缓存：恢复进度；否则只重绘列表并尽量保持当前播放
      if (restoreOnFirst && !before.length) {
        await showList({ restore: true });
      } else {
        await showList({ keepFile: playingFile });
      }
    } else if (restoreOnFirst && !before.length && merged.length) {
      videoList = merged;
      await showList({ restore: true });
    }

    return { addedCount: merged.length - before.length, changed: !same };
  } finally {
    scanning = false;
    scanBar?.classList.remove('active');
  }
};

/**
 * 渲染卡片列表。
 * - restore: 启动时从 IDB 恢复上次播放
 * - keepFile: 刷新/增量时尽量保持该文件继续播，不跳回第一集
 * 若 DOM 已有且与 videoList 一一对应，只同步 active / 序号，避免整表重绘
 */
const showList = async ({ restore = false, keepFile = null } = {}) => {
  if (!videoList.length) {
    status.textContent = '未发现可用视频（远程 1.mp4 ~ 56.mp4）';
    grid.innerHTML = '';
    updatePosInfo();
    return;
  }
  status.textContent = '共 ' + videoList.length + ' 个视频';

  // DOM 已与 videoList 对齐时跳过整表重建（增量扫描无新增、或 keepFile 同列表）
  const existing = grid ? Array.from(grid.querySelectorAll('.card')) : [];
  const domMatches =
    existing.length === videoList.length &&
    existing.every((c, i) => c.dataset.file === videoList[i]);

  if (!domMatches) {
    const frag = document.createDocumentFragment();
    for (const name of videoList) {
      frag.appendChild(createCard(name));
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
    await refreshAllThumbs();
  }

  // 1) 启动恢复
  if (restore) {
    const state = await loadState();
    if (state?.file && videoList.includes(state.file)) {
      const idx = videoList.indexOf(state.file);
      const t =
        state.byFile && typeof state.byFile[state.file] === 'number'
          ? state.byFile[state.file]
          : state.time;
      openLocal(idx, t);
      return;
    }
  }

  // 2) 刷新/增量：当前文件还在列表里 → 不打断
  if (keepFile && videoList.includes(keepFile)) {
    if (isPlayingFile(keepFile)) {
      syncPlayingUI(keepFile);
      return;
    }
    // 记下了 keepFile 但实际没在播（少见）→ 打开它并读保存进度
    openLocal(videoList.indexOf(keepFile));
    return;
  }

  // 3) 仍在本地播放且文件还在（keepFile 为空时的兜底）
  if (mode === 'local' && currentIndex >= 0) {
    const cur = videoList[currentIndex];
    if (cur && isPlayingFile(cur)) {
      syncPlayingUI(cur);
      return;
    }
    // index 可能已错位：用 src 反查
    const src = player.getAttribute('src') || '';
    const hit = videoList.find(
      n => src === BASE_URL + n || src.endsWith('/' + n) || src.endsWith(n)
    );
    if (hit) {
      syncPlayingUI(hit);
      return;
    }
  }

  // 4) 没有任何可保持的播放 → 默认第一集
  if (videoList.length) openLocal(0);
};

(async () => {
  try {
    db = await openDB();
  } catch (e) {
    console.warn('IndexedDB', e);
  }

  // 恢复 UI 偏好（列表展开状态、连续循环播放开关）
  try {
    const ui = await loadUI();
    if (ui.listOpen) {
      listPanel.classList.add('open');
      toggleListBtn.classList.add('active');
      toggleListBtn.title = '收起列表';
    }
    if (ui.sequentialPlay) {
      sequentialPlay = true;
      loopBtn?.classList.add('active');
      if (loopBtn) loopBtn.title = '连续循环播放（开）';
    }
    if (typeof ui.audioEnhance === 'boolean') {
      setAudioEnhance(ui.audioEnhance);
    } else {
      setAudioEnhance(true);
    }
  } catch {}

  const allNames = allVideoNames();

  // 1) 缓存秒开：先用上次记住的列表立刻渲染
  let known = [];
  try {
    known = (await idbGet('state', 'knownVideos')) || [];
  } catch {}
  known = known.filter(n => allNames.includes(n));

  if (known.length) {
    videoList = known;
    await showList({ restore: true });
  } else {
    status.textContent = '正在扫描远程视频…';
  }

  // 2) 后台并行探测（限制并发，避免慢网打爆）
  await scanVideos({ restoreOnFirst: true });
})();
