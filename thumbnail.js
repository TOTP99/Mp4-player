/*
 * thumbnail.js —— 缩略图读写、截图、刷到卡片
 * 远程视频已设 crossOrigin，可安全截图；失败时静默忽略
 */
async function getThumbRecord(name) {
  try {
    return await idbGet('thumbs', name);
  } catch {
    return null;
  }
}

function recordToSrc(rec) {
  if (!rec) return null;
  try {
    if (typeof rec === 'string') return { src: rec, blobUrl: null };
    if (rec instanceof Blob) {
      const u = URL.createObjectURL(rec);
      return { src: u, blobUrl: u };
    }
    if (rec instanceof ArrayBuffer || ArrayBuffer.isView(rec)) {
      const blob = new Blob([rec], { type: 'image/jpeg' });
      const u = URL.createObjectURL(blob);
      return { src: u, blobUrl: u };
    }
  } catch (e) {
    console.warn('recordToSrc', e);
  }
  return null;
}

async function hasThumb(name) {
  return !!(await getThumbRecord(name));
}

async function saveThumb(name, dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await idbSet('thumbs', name, blob);
  } catch {
    try {
      await idbSet('thumbs', name, dataUrl);
    } catch (e2) {
      console.warn('saveThumb', e2);
    }
  }
}

const capture = () => {
  try {
    if (!player.videoWidth) return null;
    const scale = Math.min(1, THUMB_MAX_W / player.videoWidth);
    const w = Math.round(player.videoWidth * scale);
    const h = Math.round(player.videoHeight * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(player, 0, 0, w, h);
    return c.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    return null;
  }
};

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
    const num = thumb.querySelector('.num');
    if (num) thumb.insertBefore(img, num);
    else thumb.appendChild(img);
  }
  if (img.dataset.blobUrl) {
    try {
      URL.revokeObjectURL(img.dataset.blobUrl);
    } catch {}
    delete img.dataset.blobUrl;
  }
  if (srcInfo.blobUrl) img.dataset.blobUrl = srcInfo.blobUrl;
  img.src = srcInfo.src;
  img.loading = 'eager';
  img.decoding = 'async';
};

const updateCardThumb = async (name, rec) => {
  const card = grid.querySelector(`[data-file="${name}"]`);
  if (!card) return;
  if (rec === undefined) rec = await getThumbRecord(name);
  const srcInfo = recordToSrc(rec);
  if (srcInfo) applyThumbToCard(card, srcInfo);
};

const refreshAllThumbs = async () => {
  if (!videoList.length) return;
  await Promise.all(
    videoList.map(async name => {
      const rec = await getThumbRecord(name);
      if (!rec) return;
      captured.add(name);
      const card = grid.querySelector(`[data-file="${name}"]`);
      if (!card) return;
      const srcInfo = recordToSrc(rec);
      if (srcInfo) applyThumbToCard(card, srcInfo);
    })
  );
};

const setThumbFromCurrent = async () => {
  if (mode !== 'local' || currentIndex < 0) return false;
  if (!player.videoWidth) return false;
  const name = videoList[currentIndex];
  const dataUrl = capture();
  if (!dataUrl) return false;
  await saveThumb(name, dataUrl);
  captured.add(name);
  await updateCardThumb(name);
  return true;
};

/** 自动截图：仅首次（该文件尚无缩略图时） */
const tryCapture = async () => {
  if (mode !== 'local' || currentIndex < 0) return;
  const name = videoList[currentIndex];
  if (captured.has(name) || player.currentTime < 0.8) return;
  // 只查一次 IDB：有记录就直接拿来用，不再多查一次 hasThumb()
  const rec = await getThumbRecord(name);
  if (rec) {
    captured.add(name);
    await updateCardThumb(name, rec);
    return;
  }
  await setThumbFromCurrent();
};
