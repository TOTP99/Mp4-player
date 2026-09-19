/*
 * thumbnail.js —— 缩略图读写、截图、刷到卡片（性能优化版）
 * - 复用 canvas，避免每次 createElement
 * - toBlob 直接存 Blob，去掉 dataURL → fetch → blob 双工
 * - 内存缓存 + 截图中互斥，避免重复 IDB / 重复截帧
 * - Blob URL 复用：同一 Blob 只 createObjectURL 一次
 * - refreshAllThumbs 一次 cursor 批量读，再按需刷 DOM；已有稳定 src 的卡片跳过
 * - 卡片图 loading=lazy
 * - 自动截图仅在页面可见时进行
 */
const safeFileSel = name => {
  try {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(name);
    return String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  } catch {
    return String(name).replace(/"/g, '');
  }
};

const thumbMem = new Map(); // name -> IDB 记录（Blob | string）
const thumbUrlCache = new Map(); // name -> { src, blobUrl } 稳定 objectURL，避免重复 create/revoke
let thumbCanvas = null;
let thumbCtx = null;
let captureInFlight = null; // Promise | null，同一时刻只截一张

function getThumbSurface(w, h) {
  if (!thumbCanvas) {
    thumbCanvas = document.createElement('canvas');
    // alpha:false 略快，缩略图不需要透明
    thumbCtx = thumbCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
  }
  if (thumbCanvas.width !== w) thumbCanvas.width = w;
  if (thumbCanvas.height !== h) thumbCanvas.height = h;
  return { canvas: thumbCanvas, ctx: thumbCtx };
}

async function getThumbRecord(name) {
  if (thumbMem.has(name)) return thumbMem.get(name);
  try {
    const rec = await idbGet('thumbs', name);
    if (rec) thumbMem.set(name, rec);
    return rec;
  } catch {
    return null;
  }
}

/**
 * 将 IDB 记录转为可赋给 img.src 的信息。
 * Blob / ArrayBuffer：同一 name 复用已创建的 objectURL，不反复 create/revoke。
 */
function recordToSrc(name, rec) {
  if (!rec) return null;
  try {
    if (typeof rec === 'string') return { src: rec, blobUrl: null };

    // 已有缓存且仍指向同一条记录 → 直接复用
    const cached = thumbUrlCache.get(name);
    if (cached && thumbMem.get(name) === rec) return cached;

    let blob = null;
    if (rec instanceof Blob) {
      blob = rec;
    } else if (rec instanceof ArrayBuffer || ArrayBuffer.isView(rec)) {
      blob = new Blob([rec], { type: 'image/jpeg' });
    }
    if (!blob) return null;

    // 旧 URL 可释放（同一 name 换了新 Blob 时）
    if (cached?.blobUrl) {
      try {
        URL.revokeObjectURL(cached.blobUrl);
      } catch {}
    }

    const u = URL.createObjectURL(blob);
    const info = { src: u, blobUrl: u };
    thumbUrlCache.set(name, info);
    return info;
  } catch (e) {
    console.warn('recordToSrc', e);
  }
  return null;
}

/** 直接存 Blob；若传入 dataURL 则降级转换 */
async function saveThumb(name, data) {
  try {
    let blob = null;
    if (data instanceof Blob) {
      blob = data;
    } else if (typeof data === 'string') {
      const res = await fetch(data);
      blob = await res.blob();
    }
    if (blob) {
      await idbSet('thumbs', name, blob);
      // 换新 Blob 时清掉旧 objectURL，下次 recordToSrc 会重建
      const old = thumbUrlCache.get(name);
      if (old?.blobUrl) {
        try {
          URL.revokeObjectURL(old.blobUrl);
        } catch {}
        thumbUrlCache.delete(name);
      }
      thumbMem.set(name, blob);
      return;
    }
  } catch {}
  try {
    if (typeof data === 'string') {
      await idbSet('thumbs', name, data);
      thumbMem.set(name, data);
      thumbUrlCache.delete(name);
    }
  } catch (e2) {
    console.warn('saveThumb', e2);
  }
}

/** 截当前帧 → JPEG Blob（优先）或 dataURL */
const captureBlob = () =>
  new Promise(resolve => {
    try {
      if (!player.videoWidth) return resolve(null);
      const scale = Math.min(1, THUMB_MAX_W / player.videoWidth);
      const w = Math.max(1, Math.round(player.videoWidth * scale));
      const h = Math.max(1, Math.round(player.videoHeight * scale));
      const { canvas, ctx } = getThumbSurface(w, h);
      ctx.drawImage(player, 0, 0, w, h);
      if (canvas.toBlob) {
        canvas.toBlob(
          b => resolve(b || null),
          'image/jpeg',
          THUMB_QUALITY
        );
      } else {
        resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
      }
    } catch {
      resolve(null);
    }
  });

const applyThumbToCard = (card, srcInfo) => {
  if (!card || !srcInfo?.src) return;
  const thumb = card.querySelector('.thumb');
  if (!thumb) return;
  let img = thumb.querySelector('img');
  if (!img) {
    const ph = thumb.querySelector('.ph');
    if (ph) ph.remove();
    img = document.createElement('img');
    img.alt = card.dataset.file || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    const num = thumb.querySelector('.num');
    if (num) thumb.insertBefore(img, num);
    else thumb.appendChild(img);
  }
  // 同一 src 不重复赋值；objectURL 生命周期由 thumbUrlCache 统一管理，此处不 revoke
  if (img.src === srcInfo.src) return;
  if (srcInfo.blobUrl) img.dataset.blobUrl = srcInfo.blobUrl;
  else delete img.dataset.blobUrl;
  img.src = srcInfo.src;
};

const updateCardThumb = async (name, rec) => {
  const card = grid.querySelector(`[data-file="${safeFileSel(name)}"]`);
  if (!card) return;
  if (rec === undefined) rec = await getThumbRecord(name);
  const srcInfo = recordToSrc(name, rec);
  if (srcInfo) applyThumbToCard(card, srcInfo);
};

/** 批量刷：一次 cursor 读完 thumbs，再只更新列表里存在的卡片；已有相同 src 的跳过 */
const refreshAllThumbs = async () => {
  if (!videoList.length || !grid) return;
  let entries = [];
  try {
    entries = await idbEntries('thumbs');
  } catch {
    // fallback：逐个（旧环境）
    await Promise.all(
      videoList.map(async name => {
        const rec = await getThumbRecord(name);
        if (!rec) return;
        thumbMem.set(name, rec);
        captured.add(name);
        const card = grid.querySelector(`[data-file="${safeFileSel(name)}"]`);
        if (card) {
          const srcInfo = recordToSrc(name, rec);
          if (srcInfo) applyThumbToCard(card, srcInfo);
        }
      })
    );
    return;
  }

  const want = new Set(videoList);
  const pending = [];
  for (const [key, rec] of entries) {
    if (!want.has(key) || !rec) continue;
    thumbMem.set(key, rec);
    captured.add(key);
    pending.push([key, rec]);
  }

  const CHUNK = 8;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    for (const [name, rec] of slice) {
      const card = grid.querySelector(`[data-file="${safeFileSel(name)}"]`);
      if (!card) continue;
      const srcInfo = recordToSrc(name, rec);
      if (srcInfo) applyThumbToCard(card, srcInfo);
    }
    if (i + CHUNK < pending.length) {
      await new Promise(r => requestAnimationFrame(r));
    }
  }
};

const setThumbFromCurrent = async () => {
  if (mode !== 'local' || currentIndex < 0) return false;
  if (!player.videoWidth) return false;
  const name = videoList[currentIndex];
  const data = await captureBlob();
  if (!data) return false;
  await saveThumb(name, data);
  captured.add(name);
  await updateCardThumb(name);
  return true;
};

/** 自动截图：仅首次；互斥；页面不可见时跳过，省后台 CPU */
const tryCapture = async () => {
  if (mode !== 'local' || currentIndex < 0) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const name = videoList[currentIndex];
  if (captured.has(name) || player.currentTime < 0.8) return;
  if (captureInFlight) return;

  captureInFlight = (async () => {
    try {
      const rec = await getThumbRecord(name);
      if (rec) {
        captured.add(name);
        await updateCardThumb(name, rec);
        return;
      }
      await setThumbFromCurrent();
    } finally {
      captureInFlight = null;
    }
  })();

  await captureInFlight;
};
