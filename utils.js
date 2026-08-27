/*
 * utils.js —— 通用工具函数（时间格式化、YouTube ID 解析、全屏）
 */
      // ========== 工具 ==========
      const fmt = sec => {
        if (!isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
      };

      const ytId = url => {
        if (!url) return null;
        const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
      };

      const toggleFullscreen = async () => {
        const el = screenWrap || document.documentElement;
        try {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (el.requestFullscreen) await el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen(); // iOS video
          } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          }
        } catch (e) {
          // iOS 回退：尝试视频原生全屏
          try {
            if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
          } catch (_) {}
        }
      };

      // 全屏按钮图标固定不变，仅切换 title 提示文字（进入/退出）
      const syncFsBtn = () => {
        const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
        fsBtn.title = on ? '退出全屏 (F)' : '全屏 (F)';
      };

