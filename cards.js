/*
 * cards.js —— 本地视频列表卡片渲染
 */
      // ========== 卡片 ==========
      const createCard = async name => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.file = name;

        const thumb = document.createElement('div');
        thumb.className = 'thumb';

        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.style.cssText = 'width:100%;height:100%;background:#0a0e14;display:flex;align-items:center;justify-content:center;color:#3a4a5c;font-size:0.65rem;';
        ph.textContent = '加载中…';
        thumb.appendChild(ph);

        const num = document.createElement('div');
        num.className = 'num';
        num.textContent = name.replace(/\.mp4$/i, '');
        thumb.appendChild(num);

        const label = document.createElement('div');
        label.className = 'name';
        label.textContent = name;

        card.append(thumb, label);

        // 先挂到结构上，再读库显示缩略图
        try {
          const rec = await getThumbRecord(name);
          if (rec) {
            captured.add(name);
            const srcInfo = recordToSrc(rec);
            if (srcInfo) applyThumbToCard(card, srcInfo);
            else ph.textContent = '播放后截图';
          } else {
            ph.textContent = '播放后截图';
          }
        } catch (_) {
          ph.textContent = '播放后截图';
        }

        card.addEventListener('click', () => {
          const i = videoList.indexOf(name);
          if (i >= 0) openLocal(i);
        });
        return card;
      };

