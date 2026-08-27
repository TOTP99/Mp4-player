/*
 * player.js —— 播放状态持久化、显示切换（本地视频 / YouTube / 占位图）、播放控制
 */
      async function saveState() {
        if (mode !== 'local' || currentIndex < 0) return;
        try {
          await idbSet('state', 'playback', {
            file: videoList[currentIndex],
            time: player.currentTime || 0
          });
        } catch {}
      }

      async function loadState() {
        try { return await idbGet('state', 'playback'); }
        catch { return null; }
      }
      // ========== 显示 ==========
      const hideAll = () => {
        player.style.display = 'none';
        ytFrame.style.display = 'none';
        placeholder.style.display = 'none';
      };

      const showLocal = () => {
        hideAll();
        player.style.display = 'block';
        progressArea.classList.add('show');
        mode = 'local';
      };

      const showYT = id => {
        player.pause();
        player.removeAttribute('src');
        player.load();
        hideAll();
        progressArea.classList.remove('show');
        ytFrame.style.display = 'block';
        ytFrame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`;
        mode = 'youtube';
        currentIndex = -1;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        playBtn.textContent = '▶';
        grid.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
      };

      const openLocal = (index, restoreTime) => {
        if (index < 0 || index >= videoList.length) return;
        currentIndex = index;
        const file = videoList[index];

        showLocal();
        player.src = file;
        nowPlaying.textContent = file;
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= videoList.length - 1;

        grid.querySelectorAll('.card').forEach(c => {
          c.classList.toggle('active', c.dataset.file === file);
        });

        const onMeta = () => {
          player.removeEventListener('loadedmetadata', onMeta);
          if (typeof restoreTime === 'number' && restoreTime > 0 && restoreTime < player.duration) {
            player.currentTime = restoreTime;
          }
          player.play().catch(() => {});
        };
        player.addEventListener('loadedmetadata', onMeta);
      };

      const togglePlay = () => {
        if (mode !== 'local') return;
        player.paused ? player.play().catch(() => {}) : player.pause();
      };

      const playPrev = () => {
        if (currentIndex > 0) { saveState(); openLocal(currentIndex - 1); }
      };

      const playNext = () => {
        if (currentIndex < videoList.length - 1) { saveState(); openLocal(currentIndex + 1); }
      };

