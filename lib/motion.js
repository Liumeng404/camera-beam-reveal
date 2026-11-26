// 动效共享运动工具（纯函数，不碰 DOM、不读时间、不用 Math.random，保证浏览器预览与逐帧渲染结果完全一致）
var M = (function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  // E(t, 开始秒, 持续秒) → 0..1 的线性进度
  const E = (t, a, d) => clamp((t - a) / d);
  const lerp = (a, b, p) => a + (b - a) * p;
  // 缓动
  const oc = p => 1 - Math.pow(1 - p, 3);                                                   // ease-out cubic
  const ob = p => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }; // ease-out back（过冲）
  const io = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;                   // ease-in-out cubic
  function bez(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = s => ((ax * s + bx) * s + cx) * s, Y = s => ((ay * s + by) * s + cy) * s;
    return p => { if (p <= 0) return 0; if (p >= 1) return 1; let lo = 0, hi = 1, s = p; for (let i = 0; i < 28; i++) { s = (lo + hi) / 2; if (X(s) < p) lo = s; else hi = s; } return Y(s); };
  }
  const travel = bez(.22, .72, .22, 1);   // 位移类默认缓动
  // 套印错版量：在 at 时刻从 amp 回落到 0（"印上去"的一下）
  const mis = (t, at, amp = 20) => { const p = E(t, at, .45); return p <= 0 || p >= 1 ? 0 : (1 - oc(p)) * amp; };
  // 0 → 1 → 0 的单次脉冲
  const bump = (t, at, d = .5) => { const p = E(t, at, d); return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p); };
  // 固定种子伪随机
  const rng = seed => { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
  // 文字进 SVG 前转义
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // 保留 n 位小数
  const r = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  return { clamp, E, lerp, oc, ob, io, bez, travel, mis, bump, rng, esc, r };
})();
if (typeof globalThis !== 'undefined') globalThis.M = M;
