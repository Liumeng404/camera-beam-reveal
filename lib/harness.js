// 动效预览壳：读取页面里的 effect-meta / card / effect-core，生成「配方卡 + 舞台 + 时间轴 + 参数面板」。
// URL 参数：?embed=1 只显示舞台；?t=1.5 定格在 1.5 秒；?p.scale=2.4 覆盖参数。
(function () {
  const SELF = document.currentScript && document.currentScript.src;
  const ASSET_BASE = SELF ? new URL('../assets/', SELF).href : './assets/';
  const FPS = 30;

  function defaults(meta) {
    const o = {};
    for (const f of meta.params || []) o[f.key] = f.default;
    return o;
  }

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  function md(src) {
    const lines = src.replace(/\r/g, '').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{2,3})\s+(.*)/))) { html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^\s*\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
        html += '<table>' + body.map((r, k) => '<tr>' + cells(r).map(c => k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>';
        continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        html += '<ul>';
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`;
        html += '</ul>';
        continue;
      }
      const para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{2,3})\s|^\s*\||^\s*[-*]\s+/.test(lines[i])) para.push(lines[i++]);
      html += `<p>${inline(para.join(' '))}</p>`;
    }
    return html;
  }

  function field(f, value, onChange) {
    const row = document.createElement('label');
    row.className = 'f';
    row.title = f.hint || f.key;
    const name = document.createElement('span');
    name.textContent = f.label || f.key;
    row.appendChild(name);
    const v = document.createElement('span');
    v.className = 'v';
    let input;
    switch (f.type) {
      case 'number':
      case 'slider': {
        input = document.createElement('input');
        const ranged = f.min != null && f.max != null;
        input.type = ranged ? 'range' : 'number';
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        input.step = f.step != null ? f.step : 'any';
        input.value = value;
        const show = () => { v.textContent = ranged ? input.value + (f.unit || '') : ''; };
        show();
        input.oninput = () => { show(); onChange(parseFloat(input.value)); };
        break;
      }
      case 'color':
        input = document.createElement('input');
        input.type = 'color'; input.value = value;
        v.textContent = value;
        input.oninput = () => { v.textContent = input.value; onChange(input.value); };
        break;
      case 'boolean':
        input = document.createElement('input');
        input.type = 'checkbox'; input.checked = !!value;
        input.onchange = () => onChange(input.checked);
        break;
      case 'select':
        input = document.createElement('select');
        for (const o of f.options || []) {
          const opt = document.createElement('option');
          const val = typeof o === 'object' ? o.value : o;
          opt.value = val; opt.textContent = typeof o === 'object' ? (o.label || o.value) : o;
          if (val === value) opt.selected = true;
          input.appendChild(opt);
        }
        input.onchange = () => onChange(input.value);
        break;
      case 'textarea':
        input = document.createElement('textarea');
        input.value = value;
        input.oninput = () => onChange(input.value);
        break;
      default:
        input = document.createElement('input');
        input.type = 'text'; input.value = value;
        input.oninput = () => onChange(input.value);
    }
    row.appendChild(input);
    row.appendChild(v);
    return row;
  }

  function boot() {
    const metaEl = document.getElementById('effect-meta');
    const meta = JSON.parse(metaEl.textContent);
    const cardEl = document.getElementById('card');
    const cardMd = cardEl ? cardEl.textContent : '';
    const q = new URLSearchParams(location.search);
    const embed = q.has('embed');
    const freezeAt = q.has('t') ? parseFloat(q.get('t')) : null;
    if (embed) document.body.classList.add('embed');
    document.title = `${meta.name} · HTML/SVG Motion`;

    const [W, H] = meta.size || [1920, 1080];
    const DUR = meta.duration || 3;
    const base = defaults(meta);
    let p = { ...base };
    for (const [k, v] of q) {
      if (!k.startsWith('p.')) continue;
      const key = k.slice(2), d = base[key];
      p[key] = typeof d === 'number' ? parseFloat(v) : typeof d === 'boolean' ? v === '1' || v === 'true' : v;
    }
    const ctx = { M: window.M, W, H, duration: DUR, uid: meta.id, asset: rel => ASSET_BASE + rel };

    document.body.insertAdjacentHTML('beforeend', `
      <div id="app">
        <aside id="recipe"></aside>
        <section id="right">
          <div id="stageWrap"><div id="stage"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"></svg><div class="guide"></div></div><div id="err"></div></div>
          <div id="bar">
            <button id="play">⏸</button>
            <input id="scrub" type="range" min="0" max="${DUR}" step="${1 / FPS}" value="0">
            <span class="tc" id="tc"></span>
            <label class="spd" title="播放速度（快捷键 [ 减速、] 加速）">速度 <select id="speed"><option value="0.1">0.1×</option><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
            <label><input type="checkbox" id="loop" checked> 循环</label>
            <label><input type="checkbox" id="safe"> 字幕安全区</label>
            <label><input type="checkbox" id="grid"> 网格</label>
          </div>
          <div id="params"></div>
        </section>
      </div>`);

    const tags = (meta.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    document.getElementById('recipe').innerHTML = `
      <div class="head">
        <div class="cat">${esc(meta.category || '')}</div>
        <h1>${esc(meta.name)}</h1>
        <div class="id" title="点击复制 ID">${esc(meta.id)} · v${meta.version || 1} · ${esc(meta.updated || '')}</div>
      </div>
      <div class="summary">${inline(meta.summary || '')}</div>
      <dl class="facts">
        <dt>适用</dt><dd>${inline(meta.use || '—')}</dd>
        <dt>时长</dt><dd>${DUR}s（${Math.round(DUR * FPS)}f@${FPS}）· ${W}×${H}</dd>
        <dt>能量</dt><dd>${inline(meta.energy || '—')}</dd>
        <dt>标签</dt><dd>${tags || '—'}</dd>
      </dl>
      ${md(cardMd)}`;
    document.querySelector('#recipe .id').onclick = () => navigator.clipboard && navigator.clipboard.writeText(meta.id);

    const svg = document.querySelector('#stage svg');
    const stage = document.getElementById('stage');
    const wrap = document.getElementById('stageWrap');
    const err = document.getElementById('err');
    const guide = stage.querySelector('.guide');
    if (meta.background) stage.style.background = meta.background;

    function fit() {
      const pad = embed ? 0 : 36;
      const k = Math.min((wrap.clientWidth - pad) / W, (wrap.clientHeight - pad) / H);
      stage.style.width = W * k + 'px';
      stage.style.height = H * k + 'px';
      const safe = guide.querySelector('.safe');
      if (safe) safe.style.height = (meta.safeBottom || 130) * k + 'px';
    }
    window.addEventListener('resize', fit);

    let t = freezeAt != null ? freezeAt : 0;
    function draw() {
      try {
        svg.innerHTML = render(t, p, ctx);
        err.style.display = 'none';
      } catch (e) {
        err.textContent = `render(${t.toFixed(2)}) 出错：${e && e.stack || e}`;
        err.style.display = 'block';
      }
      const f = Math.round(t * FPS);
      const tc = document.getElementById('tc');
      if (tc) tc.textContent = `${t.toFixed(2)}s / ${DUR}s · f${f}`;
      const sc = document.getElementById('scrub');
      if (sc) sc.value = t;
    }

    // 暴露给无头浏览器逐帧渲染的确定性 API
    window.__renderAt = function (sec) {
      playing = false;
      t = Math.max(0, Math.min(DUR, sec));
      draw();
    };
    window.__meta = meta;

    let playing = freezeAt == null, last = null;
    const speedEl = document.getElementById('speed'), loopEl = document.getElementById('loop');
    try {
      const saved = q.get('speed') || localStorage.getItem('motionlib-speed');
      if (saved && [...speedEl.options].some(o => o.value === saved)) speedEl.value = saved;
    } catch (e) {}
    speedEl.onchange = () => { try { localStorage.setItem('motionlib-speed', speedEl.value); } catch (e) {} };
    const stepSpeed = d => {
      const i = Math.max(0, Math.min(speedEl.options.length - 1, speedEl.selectedIndex + d));
      speedEl.selectedIndex = i; speedEl.onchange();
    };
    const playBtn = document.getElementById('play');
    const HOLD = embed ? .8 : 0;
    function tick(now) {
      if (playing) {
        if (last != null) {
          t += (now - last) / 1000 * parseFloat(speedEl.value);
          if (t > DUR + HOLD) {
            if (loopEl.checked || embed) t = 0;
            else { t = DUR; playing = false; playBtn.textContent = '▶'; }
          }
        }
        last = now;
        const shown = t;
        t = Math.min(t, DUR);
        draw();
        t = shown;
      } else last = null;
      requestAnimationFrame(tick);
    }
    const setPlaying = v => { playing = v; playBtn.textContent = v ? '⏸' : '▶'; if (v && t >= DUR) t = 0; };
    playBtn.onclick = () => setPlaying(!playing);
    stage.onclick = () => !embed && setPlaying(!playing);
    document.getElementById('scrub').oninput = e => { setPlaying(false); t = parseFloat(e.target.value); draw(); };
    document.getElementById('safe').onchange = e => {
      guide.querySelector('.safe')?.remove();
      if (e.target.checked) { guide.insertAdjacentHTML('beforeend', '<div class="safe" title="平台字幕区"></div>'); fit(); }
    };
    document.getElementById('grid').onchange = e => {
      guide.querySelector('.grid')?.remove();
      if (e.target.checked) {
        guide.insertAdjacentHTML('beforeend', '<div class="grid"></div>');
        const k = stage.clientWidth / W;
        guide.querySelector('.grid').style.backgroundSize = `${120 * k}px ${120 * k}px`;
      }
    };
    window.addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const step = e.shiftKey ? 1 : 1 / FPS;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      else if (e.code === 'ArrowRight') { setPlaying(false); t = Math.min(DUR, t + step); draw(); }
      else if (e.code === 'ArrowLeft') { setPlaying(false); t = Math.max(0, t - step); draw(); }
      else if (e.code === 'Home') { t = 0; draw(); }
      else if (e.code === 'BracketLeft') stepSpeed(-1);
      else if (e.code === 'BracketRight') stepSpeed(1);
    });

    const panel = document.getElementById('params');
    function buildPanel() {
      panel.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'ph';
      head.innerHTML = `<b>内容参数</b><span>（节奏命门写死在代码里，不在这里调）</span><span class="sp"></span>`;
      const reset = document.createElement('button');
      reset.textContent = '恢复默认';
      reset.onclick = () => { p = { ...base }; buildPanel(); draw(); };
      const copy = document.createElement('button');
      copy.textContent = '复制 props';
      copy.title = '只复制和默认值不同的参数';
      copy.onclick = () => {
        const diff = {};
        for (const k of Object.keys(p)) if (p[k] !== base[k]) diff[k] = p[k];
        navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(diff, null, 2));
        copy.textContent = '已复制'; setTimeout(() => (copy.textContent = '复制 props'), 1200);
      };
      head.append(reset, copy);
      panel.appendChild(head);
      for (const f of meta.params || []) panel.appendChild(field(f, p[f.key], v => { p[f.key] = v; if (!playing) draw(); }));
      if (!(meta.params || []).length) panel.insertAdjacentHTML('beforeend', '<span style="color:var(--dim)">无可调参数</span>');
    }
    buildPanel();

    if (typeof render !== 'function') {
      err.textContent = '没找到 render(t, p, ctx)：检查 <script id="effect-core"> 是否写在 harness.js 之前。';
      err.style.display = 'block';
    }
    fit();
    draw();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
