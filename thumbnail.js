/*
 * thumbnail.js —— 缩略图相关：读取/保存缩略图记录、截图、渲染到卡片
 */
      async function getThumbRecord(name) {
        try {
          return await idbGet('thumbs', name);
        } catch {
          return null;
        }
      }

      // 把库里的记录转成可给 <img src> 用的地址（兼容 Blob / dataURL 字符串）
      function recordToSrc(rec) {
        if (!rec) return null;
        try {
          if (typeof rec === 'string') {
            // 旧数据可能是 dataURL
            return { src: rec, blobUrl: null };
          }
          if (rec instanceof Blob) {
            const u = URL.createObjectURL(rec);
            return { src: u, blobUrl: u };
          }
          // 部分浏览器读出 ArrayBuffer
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
        const rec = await getThumbRecord(name);
        return !!rec;
      }

      async function saveThumb(name, dataUrl) {
        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          await idbSet('thumbs', name, blob);
        } catch (e) {
          // 回退：直接存 dataURL 字符串
          try {
            await idbSet('thumbs', name, dataUrl);
          } catch (e2) {
            console.warn('saveThumb', e2);
          }
        }
      }
      // ========== 截图 ==========
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
        } catch { return null; }
      };

      // 更新列表卡片上的缩略图显示
      const applyThumbToCard = (card, srcInfo) => {
        if (!card || !srcInfo || !srcInfo.src) return;
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
          try { URL.revokeObjectURL(img.dataset.blobUrl); } catch {}
          delete img.dataset.blobUrl;
        }
        if (srcInfo.blobUrl) img.dataset.blobUrl = srcInfo.blobUrl;
        img.src = srcInfo.src;
        img.loading = 'eager';
        img.decoding = 'async';
      };

      const updateCardThumb = async (name) => {
        const card = grid.querySelector(`[data-file="${name}"]`);
        if (!card) return;
        const rec = await getThumbRecord(name);
        const srcInfo = recordToSrc(rec);
        if (srcInfo) applyThumbToCard(card, srcInfo);
      };

      // 启动时 / 打开列表时：把 IndexedDB 里已有缩略图全部刷到卡片上
      const refreshAllThumbs = async () => {
        if (!videoList.length) return;
        await Promise.all(videoList.map(async (name) => {
          const rec = await getThumbRecord(name);
          if (!rec) return;
          captured.add(name);
          const card = grid.querySelector(`[data-file="${name}"]`);
          if (!card) return;
          const srcInfo = recordToSrc(rec);
          if (srcInfo) applyThumbToCard(card, srcInfo);
        }));
      };

      // 将当前画面设为代表图（可覆盖旧图）
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

      // 自动截图：仅当该视频还没有代表图时
      const tryCapture = async () => {
        if (mode !== 'local' || currentIndex < 0) return;
        const name = videoList[currentIndex];
        if (captured.has(name) || player.currentTime < 0.8) return;
        if (await hasThumb(name)) {
          captured.add(name);
          await updateCardThumb(name);
          return;
        }
        await setThumbFromCurrent();
      };

