/*
 * cards.js —— 本地（远程）视频列表卡片
 * 点击由 events.js 在 #grid 上事件委托处理（避免每个 card 单独绑监听器）
 * 只建 DOM，不读 IDB；缩略图统一由 refreshAllThumbs / updateCardThumb 填充
 */
const createCard = name => {
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
  return card;
};
