/*
 * cards.js —— 本地（远程）视频列表卡片
 */
const createCard = async name => {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.file = name;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = '播放后截图';
  thumb.appendChild(ph);

  const num = document.createElement('div');
  num.className = 'num';
  num.textContent = name.replace(/\.mp4$/i, '');
  thumb.appendChild(num);

  const label = document.createElement('div');
  label.className = 'name';
  label.textContent = name;

  card.append(thumb, label);

  try {
    const rec = await getThumbRecord(name);
    if (rec) {
      captured.add(name);
      const srcInfo = recordToSrc(rec);
      if (srcInfo) applyThumbToCard(card, srcInfo);
    }
  } catch {}

  card.addEventListener('click', () => {
    const i = videoList.indexOf(name);
    if (i < 0) return;
    // 已是当前片：不重载
    if (mode === 'local' && i === currentIndex) return;
    // 切片前先落盘，避免丢掉上一集进度
    saveState();
    openLocal(i);
  });
  return card;
};
