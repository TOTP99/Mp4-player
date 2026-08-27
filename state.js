/*
 * state.js —— 常量、DOM 引用与全局可变状态
 * 页面上其它脚本共享此处定义的变量（本文件需最先加载）
 */
      const MAX = 56;
      const DB_NAME = 'cinema_db';
      const DB_VER = 1;
      const THUMB_MAX_W = 320;
      const THUMB_QUALITY = 0.55;

      // ---- DOM 引用 ----
      const $ = id => document.getElementById(id);
      const urlInput = $('urlInput');
      const playUrlBtn = $('playUrlBtn');
      const toggleListBtn = $('toggleListBtn');
      const listPanel = $('listPanel');
      const grid = $('grid');
      const status = $('status');
      const player = $('player');
      const ytFrame = $('ytFrame');
      const placeholder = $('placeholder');
      const nowPlaying = $('nowPlaying');
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

      const setProgressUI = (pct, cur, dur) => {
        const w = pct + '%';
        progressFilled.style.width = w;
        if (progressFilledLand) progressFilledLand.style.width = w;
        const c = fmt(cur), d = fmt(dur);
        currentTimeEl.textContent = c;
        durationEl.textContent = d;
        if (currentTimeLand) currentTimeLand.textContent = c;
        if (durationLand) durationLand.textContent = d;
      };
      const fsBtn = $('fsBtn');
      const screenWrap = document.querySelector('.screen-wrap');
      const clockEl = $('clock');

      let videoList = [];
      let currentIndex = -1;
      let mode = null;
      const captured = new Set();
      let db = null;
      // ========== 实时时钟（品牌栏右侧）==========
      const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
      const pad2 = n => String(n).padStart(2, '0');
      const updateClock = () => {
        if (!clockEl) return;
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const week = WEEKDAYS[now.getDay()];
        const h = pad2(now.getHours());
        const m = pad2(now.getMinutes());
        const s = pad2(now.getSeconds());
        clockEl.textContent = `${month}月${day}日 星期${week} ${h}:${m}:${s}`;
      };
      updateClock();
      setInterval(updateClock, 1000);
