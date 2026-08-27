/*
 * main.js —— 启动流程：扫描 1.mp4~56.mp4 → 建立列表 → 恢复上次播放状态
 */
      // ========== 扫描 ==========
      const exists = src => new Promise(resolve => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        const done = ok => {
          v.removeAttribute('src');
          v.load();
          resolve(ok);
        };
        v.addEventListener('loadedmetadata', () => done(true));
        v.addEventListener('error', () => done(false));
        setTimeout(() => done(false), 3000);
        v.src = src;
      });

      // 把当前 videoList 渲染成卡片列表；restoreState 为 true 时恢复上次播放进度
      const showList = async restoreState => {
        if (!videoList.length) {
          status.textContent = '未发现本地视频（请命名为 1.mp4 ~ 56.mp4）';
          grid.innerHTML = '';
          return;
        }
        status.textContent = '共 ' + videoList.length + ' 个本地视频';
        grid.innerHTML = '';
        const cards = await Promise.all(videoList.map(createCard));
        cards.forEach(c => grid.appendChild(c));
        await refreshAllThumbs();

        if (restoreState) {
          const state = await loadState();
          if (state?.file && videoList.includes(state.file)) {
            openLocal(videoList.indexOf(state.file), state.time);
            return;
          }
        }
        openLocal(0);
      };

      (async () => {
        try { db = await openDB(); } catch (e) { console.warn('IndexedDB', e); }

        const allNames = Array.from({ length: MAX }, (_, i) => (i + 1) + '.mp4');

        // 1) 先用上次记住的文件列表立即显示，不用等本次扫描/网速
        let known = [];
        try { known = (await idbGet('state', 'knownVideos')) || []; } catch (_) {}
        known = known.filter(n => allNames.includes(n));

        if (known.length) {
          videoList = known;
          await showList(true);
        }

        // 2) 后台重新扫描一遍，把新发现的文件合并进来（同目录文件不变，
        //    已记住的文件不会因为这次探测没扫到 / 超时而被移除，只增不减）
        const tasks = allNames.map(name => exists(name).then(ok => (ok ? name : null)));
        const scannedFound = (await Promise.all(tasks)).filter(Boolean);
        const merged = Array.from(new Set([...known, ...scannedFound]))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        const sameAsShown = merged.length === videoList.length && merged.every((n, i) => n === videoList[i]);
        if (!sameAsShown) {
          videoList = merged;
          try { await idbSet('state', 'knownVideos', merged); } catch (_) {}
          await showList(!known.length);
        }
      })();
