/*
 * db.js —— IndexedDB 封装
 * 两个 object store：
 *   thumbs：key = 文件名，value = 缩略图 Blob（用于本地视频列表卡片封面）
 *   state ：key = 'playback'，value = { file, time }，用于刷新后恢复播放进度
 */
      // ========== IndexedDB ==========
      // 两个 object store：
      //   thumbs：key = 文件名，value = 缩略图 Blob（用于本地视频列表卡片封面）
      //   state ：key = 'playback'，value = { file, time }，用于刷新后恢复播放进度
      function openDB() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VER);
          req.onupgradeneeded = e => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('thumbs')) database.createObjectStore('thumbs');
            if (!database.objectStoreNames.contains('state')) database.createObjectStore('state');
          };
          req.onsuccess = e => resolve(e.target.result);
          req.onerror = e => reject(e.target.error);
        });
      }

      function idbGet(store, key) {
        return new Promise((resolve, reject) => {
          if (!db) return resolve(null);
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        });
      }

      function idbSet(store, key, value) {
        return new Promise((resolve, reject) => {
          if (!db) return resolve();
          const tx = db.transaction(store, 'readwrite');
          const req = tx.objectStore(store).put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
