/*
 * state.js —— 常量、DOM 引用与全局可变状态
 * 必须最先加载；其它脚本通过顶层变量共享作用域
 */
const MAX = 56;
const BASE_URL = 'https://totp99.github.io/source/mp4/';
const DB_NAME = 'cinema_db';
const DB_VER = 2; // 升版本：新增 ui 偏好等
const THUMB_MAX_W = 320;
const THUMB_QUALITY = 0.55;

// ---- DOM ----
const $ = id => document.getElementById(id);
const urlInput = $('urlInput');
const playUrlBtn = $('playUrlBtn');
const toggleListBtn = $('toggleListBtn');
const refreshBtn = $('refreshBtn');
const listPanel = $('listPanel');
const grid = $('grid');
const scanBar = $('scanBar');
const status = $('status');
const player = $('player');
const ytFrame = $('ytFrame');
const placeholder = $('placeholder');
const nowPlaying = $('nowPlaying');
const posInfo = $('posInfo');
const playBtn = $('playBtn');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const progressArea = $('progressArea');
const progressBar = $('progressBar');
const progressFilled = $('progressFilled');
const currentTimeEl = $('currentTime');
const durationEl = $('duration');
const progressBarLand = $('progressBarLand');
const progressFilledLand = $('progressFilledLand');
const currentTimeLand = $('currentTimeLand');
const durationLand = $('durationLand');
const fsBtn = $('fsBtn');
const stage = $('stage');
const screenWrap = document.querySelector('.screen-wrap');
const clockEl = $('clock');

// 远程视频需 CORS 才能截缩略图
player.crossOrigin = 'anonymous';

const setProgressUI = (pct, cur, dur) => {
  const w = pct + '%';
  progressFilled.style.width = w;
  if (progressFilledLand) progressFilledLand.style.width = w;
  const c = fmt(cur);
  const d = fmt(dur);
  currentTimeEl.textContent = c;
  durationEl.textContent = d;
  if (currentTimeLand) currentTimeLand.textContent = c;
  if (durationLand) durationLand.textContent = d;
};

/** 标题栏右侧：当前序号 / 总数（仅本地模式） */
const updatePosInfo = () => {
  if (!posInfo) return;
  if (mode === 'local' && currentIndex >= 0 && videoList.length) {
    posInfo.textContent = currentIndex + 1 + ' / ' + videoList.length;
    posInfo.hidden = false;
  } else {
    posInfo.textContent = '';
    posInfo.hidden = true;
  }
};

// ---- 全局状态 ----
let videoList = [];
let currentIndex = -1;
let mode = null; // 'local' | 'youtube' | null
const captured = new Set();
let db = null;

// ---- 实时时钟 ----
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = n => String(n).padStart(2, '0');
const updateClock = () => {
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent =
    `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]} ` +
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
};
updateClock();
setInterval(updateClock, 1000);
