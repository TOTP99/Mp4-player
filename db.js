/*
 * db.js —— IndexedDB 封装
 * object stores:
 *   thumbs  : key = 文件名, value = Blob | dataURL（缩略图）
 *   state   : key = 'playback' | 'knownVideos' | 'ui', value = 对应数据
 * 强化：所有读写都吞掉异常并返回安全默认值，避免 IDB 故障拖垮播放
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('thumbs')) {
        database.createObjectStore('thumbs');
      }
      if (!database.objectStoreNames.contains('state')) {
        database.createObjectStore('state');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function idbGet(store, key) {
  return new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbSet(store, key, value) {
  return new Promise(resolve => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 读取 UI 偏好（列表是否展开等） */
async function loadUI() {
  try {
    return (await idbGet('state', 'ui')) || {};
  } catch {
    return {};
  }
}

/** 写入 UI 偏好（合并） */
async function saveUI(partial) {
  try {
    const cur = await loadUI();
    await idbSet('state', 'ui', { ...cur, ...partial });
  } catch {}
}
