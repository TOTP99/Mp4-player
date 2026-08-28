/*
 * utils.js —— 时间格式化、YouTube 解析、全屏
 */
const fmt = sec => {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
};

const ytId = url => {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
};

const toggleFullscreen = async () => {
  const el = screenWrap || document.documentElement;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
    } else {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch {
    try {
      if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
    } catch {}
  }
};

const syncFsBtn = () => {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fsBtn.title = on ? '退出全屏 (F)' : '全屏 (F)';
};
