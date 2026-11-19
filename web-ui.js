(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const adapter = window.ChishengWeb;
  const completeUrl = 'https://github.com/XIAOXING99/chisheng-car-live-assistant';
  function message(text) { $('webBackupStatus').textContent = text; }
  function download(name, object) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('exportWebBackup').addEventListener('click', function () {
    // Flush the editor's existing save handler before reading its saved state.
    $('scriptInput').dispatchEvent(new Event('blur'));
    const state = JSON.parse(localStorage.getItem(adapter.stateKey) || 'null');
    if (!state) return message('请先录入讲稿再导出。');
    download('驰声讲稿备份-' + new Date().toISOString().slice(0, 10) + '.json', {
      format: 'chisheng-web-backup', version: 1, state: state,
      blocklist: JSON.parse(localStorage.getItem(adapter.blockKey) || '{"words":[],"replacements":[]}')
    });
    message('已导出讲稿、设置与禁用词；音乐文件请在新电脑重新添加。');
  });
  $('importWebBackup').addEventListener('click', () => $('webBackupFile').click());
  $('webBackupFile').addEventListener('change', async function () {
    const file = this.files[0];
    this.value = '';
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('备份文件不能超过 4MB。');
      const data = JSON.parse(await file.text());
      const state = data.state || data;
      if (!state || typeof state.scripts !== 'object' || !state.scripts || Array.isArray(state.scripts)) throw new Error('不是有效的驰声讲稿备份。');
      const known = new Set(['common'].concat(window.CarLiveCore.CAR_MODELS.map(model => model.id)));
      const scripts = {};
      for (const [key, value] of Object.entries(state.scripts)) {
        if (known.has(key) && typeof value === 'string') scripts[key] = value.slice(0, 800000);
      }
      if (!Object.keys(scripts).length) throw new Error('备份里没有可识别的车型讲稿。');
      if (!confirm('导入会覆盖此浏览器的现有讲稿和设置。建议先导出备份。是否继续？')) return;
      const settings = Object.assign({}, state.settings || {}, { engine: 'local', autoKokoro: false });
      for (const key of ['azureKey', 'volcToken', 'volcAppId', 'cosyKey']) settings[key] = '';
      const restored = { version: 2, scripts, settings, activeModel: known.has(state.activeModel) ? state.activeModel : 'common', updatedAt: Date.now() };
      adapter.restoring = true;
      localStorage.setItem(adapter.stateKey, JSON.stringify(restored));
      if (data.blocklist) {
        const blocklist = { words: Array.isArray(data.blocklist.words) ? data.blocklist.words : [], replacements: Array.isArray(data.blocklist.replacements) ? data.blocklist.replacements : [], updatedAt: Date.now() };
        localStorage.setItem(adapter.blockKey, JSON.stringify(blocklist));
      }
      location.reload();
    } catch (error) { adapter.restoring = false; message(error.message || '导入失败，请检查文件。'); }
  });
  $('chatView').innerHTML = '<section class="web-feature-note"><h2>直播互动需要完整版</h2><p>当前网页版支持讲稿管理、文本编排、浏览器语音和背景音乐。读取抖音公屏、自动回复与高级语音合成，需要本地版或云端后端服务。</p><p>直播时，请让口播页面保持打开，通过 OBS 采集当前电脑的声音。</p><a class="btn primary" href="' + completeUrl + '" target="_blank" rel="noopener">查看我的完整版仓库</a><p class="web-small">完整版仓库为私有，仅仓库账号及被授权用户可访问。</p></section>';
  const help = $('helpDialog').querySelectorAll('.help-note');
  help.forEach(function (note) {
    const heading = note.querySelector('b');
    const paragraph = note.querySelector('p');
    if (!heading || !paragraph) return;
    if (heading.textContent === '关于直播声音') paragraph.textContent = '网页版使用当前浏览器可用的语音，音色因电脑和浏览器而异。点击播放或试听后才会出声；保持网页打开，可通过 OBS 采集当前电脑的声音。';
    if (heading.textContent === '关于直播互动') paragraph.textContent = '抖音自动互动及高级语音需要完整版服务。此网页不连接抖音，也不会把你的讲稿和音乐上传到服务器。';
  });
  document.title = '驰声 · 在线直播口播助手';
})();
