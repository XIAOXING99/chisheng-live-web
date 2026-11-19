/* Browser-only persistence adapter. No speech keys or scripts are sent to a server. */
(function () {
  'use strict';
  const STATE_KEY = 'chisheng.web.state.v1';
  const BLOCK_KEY = 'chisheng.web.blocklist.v1';
  const musicUrls = new Map();
  let database;
  function json(value, status) {
    return new Response(JSON.stringify(value), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  function read(key, fallback) {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  }
  function db() {
    if (!database) database = new Promise(function (resolve, reject) {
      const request = indexedDB.open('chisheng-web-music-v1', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('tracks', { keyPath: 'id' }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return database;
  }
  async function musicTransaction(mode, action) {
    const connection = await db();
    return new Promise(function (resolve, reject) {
      const transaction = connection.transaction('tracks', mode);
      const operation = action(transaction.objectStore('tracks'));
      transaction.oncomplete = function () { resolve(operation.result); };
      transaction.onerror = transaction.onabort = function () { reject(transaction.error || new Error('音乐保存失败')); };
    });
  }
  async function request(input, options) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      throw new Error('网页模式不支持访问外部服务');
    }
    const method = (options && options.method || 'GET').toUpperCase();
    const body = options && options.body;
    try {
      if (url.pathname === '/api/health') return json({ ok: true, browserOnly: true, cloud: false, edgeTts: false, app: 'chisheng-car-live', version: 'web-1.0.0' });
      if (url.pathname === '/api/state') {
        if (method === 'POST') {
          const state = JSON.parse(body);
          localStorage.setItem(STATE_KEY, JSON.stringify(state));
          return json({ ok: true, updatedAt: state.updatedAt });
        }
        return json({ ok: true, state: read(STATE_KEY, null) });
      }
      if (url.pathname === '/api/blocklist') {
        if (method === 'POST') localStorage.setItem(BLOCK_KEY, body);
        return json(Object.assign({ ok: true }, read(BLOCK_KEY, { words: [], replacements: [], updatedAt: 0 })));
      }
      if (url.pathname === '/api/music/list') {
        const records = await musicTransaction('readonly', store => store.getAll());
        const tracks = records.map(function (record) {
          if (!musicUrls.has(record.id)) musicUrls.set(record.id, URL.createObjectURL(record.blob));
          return { id: record.id, name: record.name, size: record.blob.size, url: musicUrls.get(record.id) };
        });
        return json({ ok: true, tracks: tracks, maxUploadMB: 80 });
      }
      if (url.pathname === '/api/music/upload' && method === 'POST') {
        if (!(body instanceof Blob) || body.size > 80 * 1024 * 1024) return json({ message: '请选择 80MB 以内的音频' }, 400);
        const record = { id: crypto.randomUUID(), name: url.searchParams.get('name') || '背景音乐', blob: body };
        await musicTransaction('readwrite', store => store.put(record));
        return json({ ok: true });
      }
      if (url.pathname === '/api/music/delete' && method === 'POST') {
        const id = JSON.parse(body).id;
        await musicTransaction('readwrite', store => store.delete(id));
        if (musicUrls.has(id)) URL.revokeObjectURL(musicUrls.get(id));
        musicUrls.delete(id);
        return json({ ok: true });
      }
      if (url.pathname === '/api/music/clear' && method === 'POST') {
        await musicTransaction('readwrite', store => store.clear());
        musicUrls.forEach(value => URL.revokeObjectURL(value));
        musicUrls.clear();
        return json({ ok: true });
      }
      if (url.pathname === '/api/kokoro/status') return json({ ok: true, ready: false, voices: [] });
      return json({ ok: false, message: '此功能需要运行完整版的后端服务。' }, 501);
    } catch (error) {
      return json({ ok: false, message: error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请先导出讲稿备份并删除不需要的音乐。' : '本地保存失败，请确认浏览器允许网站存储。' }, 500);
    }
  }
  window.ChishengWeb = { fetch: request, stateKey: STATE_KEY, blockKey: BLOCK_KEY };
})();
