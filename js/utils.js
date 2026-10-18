/*
 * utils.js —— 时间格式化、YouTube 解析、全屏
 */

// 播放/暂停按钮图标（SVG 替代原来的 ▶/⏸ emoji）
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

const fmt = sec => {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
};

const ytId = url => {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const ID = /^[a-zA-Z0-9_-]{11}$/;
  // 先按 URL 解析：支持 watch?list=…&v=ID 这类 v 不紧跟 watch? 的链接，以及不带协议的写法
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (ID.test(id)) return id;
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && ID.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  // 兜底：沿用原正则（粘贴了带前后文字的链接等）
  const m = s.match(
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
