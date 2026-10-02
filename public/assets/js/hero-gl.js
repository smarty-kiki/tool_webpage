/* ============================================================
   Hero 背景（全站共享）：手写 WebGL2 着色器 / three.js 场景

   页面里放一个 canvas 就自动接管该 hero 的背景：
     <section class="hero">
       <canvas id="hero-gl" aria-hidden="true" data-...></canvas>
       ...
     </section>

   配置（canvas 的 data 属性）：
     data-engine="gl"（默认）| "three"
     data-mode="flow"（默认）| "queue" | "trace" | "net" | "wire" | "sop" | "cue" —— gl 引擎
     data-scene="cards" | "nebula"                     —— three 引擎
     data-colors="#a,#b,#c"   三色品牌色，缺省从 --accent 推导
     data-speed="1"           速度倍率
     data-dot="1"             点阵强度倍率

   降级契约（与旧版首页一致，任何一步失败都静默退回 CSS）：
     · 拿不到 WebGL2 / 编译链接失败 → 什么都不做，.hero::before/::after 光斑保留
     · prefers-reduced-motion → 只画静态一帧，画面依旧成立
     · 滚出视口即停渲染，省电
     · DPR 上限 1.5
     · 一切就绪后才给 .hero 加 .gl-on（CSS 淡入 canvas 并隐藏回退层）
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('hero-gl');
  if (!canvas) return;
  var hero = canvas.closest('.hero');
  if (!hero) return;

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- 配置解析 ---------------- */

  function parseHex(s) {
    if (!s) return null;
    s = s.trim();
    if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [
      parseInt(s.slice(0, 2), 16) / 255,
      parseInt(s.slice(2, 4), 16) / 255,
      parseInt(s.slice(4, 6), 16) / 255
    ];
  }

  var colors = (canvas.getAttribute('data-colors') || '').split(',');
  var colA = parseHex(colors[0]) ||
    parseHex(getComputedStyle(hero).getPropertyValue('--accent')) ||
    [1.000, 0.761, 0.302];                       /* 缺省琥珀 */
  var colB = parseHex(colors[1]) || [0.369, 0.647, 0.980];   /* 蓝 */
  var colC = parseHex(colors[2]) || [0.541, 0.592, 1.000];   /* 紫 */

  var MODES = { flow: 0, queue: 1, trace: 2, net: 3, wire: 4, sop: 5, cue: 6 };
  var mode = MODES[canvas.getAttribute('data-mode')] || 0;
  var speed = parseFloat(canvas.getAttribute('data-speed')) || 1;
  var dot = parseFloat(canvas.getAttribute('data-dot'));
  if (!isFinite(dot) || dot <= 0) dot = 1;

  var engine = canvas.getAttribute('data-engine') || 'gl';
  if (engine === 'three') {
    /* three.js 场景单独成模块，能动态加载才下载（无 WebGL 就不白下 three） */
    import('./hero-3d.js').then(function (m) {
      m.init({
        canvas: canvas,
        hero: hero,
        colors: [colA, colB, colC],
        scene: canvas.getAttribute('data-scene') || 'cards',
        speed: speed,
        reduceMotion: reduceMotion
      });
    }).catch(function () { /* 保持 CSS 回退 */ });
    return;
  }

  /* ---------------- WebGL2 上下文 ---------------- */

  var gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power'
    });
  } catch (err) { gl = null; }
  if (!gl) return; /* 回退 CSS 背景 */

  /* ---------------- 着色器 ---------------- */

  var VERT = [
    '#version 300 es',
    'void main() {',
    '  vec2 v[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));',
    '  gl_Position = vec4(v[gl_VertexID], 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 outColor;',
    'uniform vec2  u_res;',
    'uniform float u_dpr;',
    'uniform float u_time;',
    'uniform vec2  u_mouse;',
    'uniform float u_reveal;',
    'uniform int   u_mode;',
    'uniform vec3  u_colA;',
    'uniform vec3  u_colB;',
    'uniform vec3  u_colC;',
    'uniform float u_dot;',
    '',
    'float hash(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    '',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    '',
    'float fbm(vec2 p) {',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);',
    '  for (int i = 0; i < 5; i++) {',
    '    v += a * vnoise(p);',
    '    p = rot * p * 2.03;',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    '',
    '/* net 模式：格子里抖出一个节点，随时间缓慢游移 */',
    'vec2 netNode(vec2 oid, float ut) {',
    '  float h1 = hash(oid + 11.3);',
    '  float h2 = hash(oid + 27.9);',
    '  vec2 np = oid + 0.5 + (vec2(h1, h2) - 0.5) * 0.62;',
    '  np += 0.10 * vec2(sin(ut * 0.09 + h1 * 40.0), cos(ut * 0.08 + h2 * 53.0));',
    '  return np;',
    '}',
    '',
    '/* net 模式：两个节点间的连线，带沿线奔跑的信号 */',
    'float netLink(vec2 gv, vec2 np, vec2 nb, float h, float gate, float ut) {',
    '  if (gate < 0.30) return 0.0;',
    '  vec2 pa = gv - np;',
    '  vec2 ba = nb - np;',
    '  float dd = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
    '  float ld = length(pa - ba * dd);',
    '  float reach = 1.0 - smoothstep(0.95, 1.45, length(ba));',
    '  float run = pow(0.5 + 0.5 * sin(ut * 1.55 - dd * 4.7 + h * 6.28), 3.0);',
    '  return smoothstep(0.030, 0.0, ld) * reach * (0.30 + 0.85 * run);',
    '}',
    '',
    '/* sop 模式：第 gi 个检查点的 x 坐标（每道轻微错位，避免列对齐太死板） */',
    'float sopGateX(float row, float gi) {',
    '  return (gi + 0.5) * 0.34 + (hash(vec2(row * 3.1, gi + 17.0)) - 0.5) * 0.11;',
    '}',
    '',
    '/* cue 模式：第 k 个目标的位置（哈希散布；同一 k 位置恒定，光标不会跳） */',
    '/* 只取左区：右侧是大块不透明卡片（app mock），落到那里会被遮住 */',
    'vec2 cueTarget(float k, float aspect) {',
    '  float hx = hash(vec2(k, 3.1));',
    '  float hy = hash(vec2(k, 8.7));',
    '  return vec2(0.10 + hx * (aspect * 0.56 - 0.10), 0.14 + hy * 0.70);',
    '}',
    '',
    '/* cue 模式：点到线段的距离与线上参数（轨迹用） */',
    'vec2 segDistQ(vec2 pa, vec2 a, vec2 b) {',
    '  vec2 ba = b - a;',
    '  float q = clamp(dot(pa - a, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);',
    '  return vec2(length(pa - a - ba * q), q);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  float aspect = u_res.x / u_res.y;',
    '  vec3 base = vec3(0.980, 0.973, 0.957);',   /* #faf8f4 页面底色 */
    '  vec2 p = vec2(uv.x * aspect, uv.y);',
    '  vec2 m = vec2(u_mouse.x * aspect, u_mouse.y);',
    '  float md = length(p - m);',
    '  float t = u_time * 0.055;',
    '',
    '  /* 光标附近的流体牵引，让画面随手动 */',
    '  vec2 sway = (p - m) * (0.22 / (1.0 + md * md * 4.0));',
    '  float halo = exp(-md * md * 7.0);',
    '  float density = 0.0;',
    '  vec3 col = base;',
    '',
    '  if (u_mode == 0) {',
    '    /* ---- flow：两级域扭曲 fbm 极光（首页同款语言）---- */',
    '    vec2 q = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 + vec2(5.2, 1.3) - t * 0.8));',
    '    vec2 r = vec2(fbm(p * 2.0 + q * 1.7 + vec2(1.7, 9.2) + t * 1.3 + sway),',
    '                  fbm(p * 2.0 + q * 1.7 + vec2(8.3, 2.8) - t * 1.1 + sway));',
    '    float n = fbm(p * 2.4 + r * 1.9 + t * 0.5);',
    '    float wA = smoothstep(0.15, 0.75, r.x) * (1.0 - smoothstep(0.45, 0.95, r.y));',
    '    float wB = smoothstep(0.35, 0.95, q.y) * smoothstep(0.0, 0.9, uv.x);',
    '    float wC = smoothstep(0.40, 0.95, r.y) * (0.35 + 0.65 * smoothstep(0.4, 1.0, uv.y));',
    '    density = pow(smoothstep(0.30, 0.92, n), 1.5);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.52), clamp(wA * density, 0.0, 1.0) * 0.85);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.42), clamp(wB * density, 0.0, 1.0) * 0.70);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.40), clamp(wC * density, 0.0, 1.0) * 0.70);',
    '    col = mix(col, vec3(1.0, 0.92, 0.78), halo * 0.5 * (0.35 + 0.65 * density));',
    '  } else if (u_mode == 1) {',
    '    /* ---- queue：多任务并行推进，陆续停下排队，再被挨个确认、继续跑 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.35;',
    '    float heads = 0.0;    /* 奔跑中的任务头 */',
    '    float tails = 0.0;    /* 身后的拖尾 */',
    '    float waved = 0.0;    /* 停下排队的光点 */',
    '    float pulses = 0.0;   /* 轮到自己、正在亮起脉冲的那颗 */',
    '    float flash = 0.0;    /* 确认通过：亮一下 */',
    '    float cring = 0.0;    /* 确认通过：扩散的环 */',
    '    float travel = aspect * 0.51 + 0.22;',
    '    for (int n = 0; n < 6; n++) {',
    '      float r = float(n);',
    '      float per = 24.0;',                                     /* 共享相位：确认按行号依次轮转，一次只会有一个亮起 */
    '      float ph = fract(ut / per);',
    '      float durF = (2.0 + 0.9 * hash(vec2(r, 4.7))) / per;',  /* 亮起确认的窗口长度 */
    '      float lagF = (1.2 + 2.8 * hash(vec2(r, 6.1))) / per;',  /* 提前停下、排队等着的时长 */
    '      float pauseF = lagF + durF;',
    '      float phw = fract(ph - ((r + 0.5) / 6.0 - lagF));',     /* 以「停下」为原点 */
    '      float waiting = 1.0 - smoothstep(pauseF - 0.004, pauseF + 0.004, phw);',
    '      float current = smoothstep(lagF - 0.004, lagF + 0.004, phw) * waiting;',  /* 轮到自己才脉冲 */
    '      float runT = 1.0 - pauseF;',
    '      float qf = 0.28 + 0.45 * hash(vec2(r, 8.4));',          /* 停在半路的哪个位置 */
    '      float runA = max(runT * qf, 1e-3);',
    '      float runB = max(runT * (1.0 - qf), 1e-3);',
    '      float qb = qf + clamp((phw - pauseF) / runB, 0.0, 1.0) * (1.0 - qf);',
    '      float qa = clamp((phw - pauseF - runB) / runA, 0.0, 1.0) * qf;',
    '      float q = mix(mix(qf, qb, step(pauseF, phw)), qa, step(pauseF + runB, phw));',
    '      float ry = 0.15 + (r + (hash(vec2(r, 7.1)) - 0.5) * 0.5) * 0.118;',
    '      float dy = wp.y - ry;',
    '      float dxh = wp.x - (-0.20 + q * travel);',
    '      float runFade = smoothstep(1.0, 0.94, q) * (1.0 - waiting);',  /* 跑完淡出；停下即收尾 */
    '      float d2h = dxh * dxh + dy * dy;',
    '      heads += (exp(-d2h * 2000.0) * 1.0 + exp(-d2h * 9000.0) * 0.60 + exp(-d2h * 240.0) * 0.16) * runFade;',
    '      tails += exp(-max(-dxh, 0.0) * 6.5) * exp(-dy * dy * 3000.0) * 0.80 * runFade;',
    '      float hd = length(vec2(wp.x - (-0.20 + qf * travel), dy));',  /* 离停下位置的距离 */
    '      waved += (smoothstep(0.032, 0.008, hd) * 0.95 + smoothstep(0.13, 0.0, hd) * 0.20) * waiting;',
    '      pulses += smoothstep(0.170, 0.0, hd) * 0.12 * current;',
    '      float pr = fract(ut / 0.9 + hash(vec2(r, 5.5)));',      /* 每 0.9s 一圈脉冲描边 */
    '      pulses += smoothstep(0.006, 0.0, abs(hd - (0.024 + 0.085 * pr))) * (1.0 - pr) * current;',
    '      float pr2 = fract(ut / 0.9 + hash(vec2(r, 5.5)) + 0.5);',
    '      pulses += smoothstep(0.006, 0.0, abs(hd - (0.024 + 0.085 * pr2))) * (1.0 - pr2) * current * 0.60;',
    '      float since = (phw - pauseF) * per;',                   /* 确认通过后的秒数 */
    '      float tick = exp(-since * since * 50.0) * step(0.0, since);',
    '      flash += smoothstep(0.07, 0.02, hd) * tick * 1.4;',
    '      float cr = clamp(since / 1.1, 0.0, 1.0);',
    '      cring += smoothstep(0.005, 0.0, abs(hd - cr * 0.10)) * (1.0 - cr) * step(0.0, since);',
    '    }',
    '    float focus = 0.70 + 0.75 * halo;',
    '    vec3 runCol = mix(u_colC, u_colA, 0.65);',
    '    float lT = clamp(tails * focus, 0.0, 1.0);',
    '    float lH = clamp(heads * focus, 0.0, 1.0);',
    '    float lW = clamp(waved * focus, 0.0, 1.0);',
    '    float lP = clamp(pulses * focus, 0.0, 1.0);',
    '    float lF = clamp(flash * focus, 0.0, 1.0);',
    '    float lC = clamp(cring * focus, 0.0, 1.0);',
    '    density = clamp(heads * 0.60 + tails * 0.35 + waved * 0.45 + pulses * 0.55 + flash * 0.60, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), runCol, 0.50), lT * 0.60);',
    '    col = mix(col, mix(vec3(1.0), runCol, 0.72), lH * 0.85);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.85), lW * 0.60);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.90), lP * 0.85);',
    '    col = mix(col, vec3(1.0), lF * 0.65);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.80), lC * 0.60);',
    '    col = mix(col, vec3(1.0), halo * 0.28);',
    '  } else if (u_mode == 2) {',
    '    /* ---- trace：实时监护——活动像波形扫过每条会话道，到端点一下灯，然后归于平静 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.4;',
    '    float ly = (wp.y - 0.10) / 0.19;',
    '    float row = floor(ly);',
    '    float fy = fract(ly) - 0.5;',
    '    float h = hash(vec2(row, 4.2));',
    '    float laneOn = smoothstep(0.14, 0.30, hash(vec2(row, 8.8)));',  /* 留白几道，别铺满 */
    '    float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);',
    '    float cyc = 6.5 + 4.5 * hash(vec2(row, 2.6));',                 /* 每道自己的忙闲周期 */
    '    float ph = fract(ut / cyc + h);',
    '    float onRun = 1.0 - step(0.60, ph);',                           /* 前 60%：一次活动扫过 */
    '    float cx = mix(-0.30, aspect + 0.30, clamp(ph / 0.60, 0.0, 1.0));',
    '    float ex = wp.x - cx;',
    '    float env = exp(-ex * ex * 42.0);',                             /* 活动包本体 */
    '    env += 0.70 * exp(-max(-ex, 0.0) * 6.5) * step(ex, 0.0);',      /* 身后拖尾：刚忙过，慢慢平静 */
    '    env *= onRun;',
    '    float wig = (vnoise(vec2(wp.x * 2.3 - ut * 0.55, row * 7.7 + h * 13.0)) - 0.5) * 1.4',
    '              + (vnoise(vec2(wp.x * 5.1 - ut * 2.10, row * 3.3 - h * 7.0)) - 0.5) * 0.7;',
    '    float off = wig * (0.010 + 0.070 * env);',                      /* 忙=起伏，闲=近乎平线 */
    '    float ld = fy * 0.19 - off;',
    '    float line = exp(-ld * ld * 42000.0) * laneOn;',
    '    float heat = clamp(env, 0.0, 1.0);',
    '    vec3 lineCol = mix(u_colC, mix(u_colA, u_colB, 0.30), smoothstep(0.06, 0.45, heat));',
    '    float head = exp(-(ex * ex * 700.0 + ld * ld * 20000.0)) * onRun;',
    '    float headGlow = exp(-(ex * ex * 180.0 + ld * ld * 9000.0)) * onRun * 0.14;',
    '    float xe = aspect - 0.10;',                                     /* 每道右端的状态灯 */
    '    float de = length(vec2(wp.x - xe, fy * 0.19));',
    '    float lit = exp(-pow(xe - cx, 2.0) * 42.0) * onRun;',
    '    float ph2 = ph - 0.60;',                                        /* 活动到站：叮一下 */
    '    float done = exp(-ph2 * ph2 * 220.0) * step(0.0, ph2) * laneOn;',
    '    float rr = clamp(ph2 / 0.12, 0.0, 1.0) * 0.090;',
    '    float ring = smoothstep(0.010, 0.0, abs(de - rr)) * (1.0 - clamp(ph2 * 7.0, 0.0, 1.0)) * step(0.0, ph2) * laneOn;',
    '    float endDot = smoothstep(0.024, 0.006, de) * laneOn;',
    '    float focus = 0.55 + 0.85 * halo;',
    '    float lLine = clamp(line * (0.18 + 0.72 * heat) * focus * edge, 0.0, 1.0);',
    '    float lHead = clamp((head + headGlow) * focus * edge, 0.0, 1.0);',
    '    float lDot  = clamp(endDot * (0.16 + 0.40 * lit) * focus, 0.0, 1.0);',
    '    float lDone = clamp(endDot * done * focus, 0.0, 1.0);',
    '    float lRing = clamp(ring * focus, 0.0, 1.0);',
    '    density = clamp(line * (0.2 + 0.5 * heat) + head * 0.8 + endDot * (0.1 + done), 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), lineCol, 0.55), lLine * 0.90);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.72), lDot * 0.85);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.75), lHead * 0.95);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.70), lRing * 0.80);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.80), lDone * 0.95);',
    '    col = mix(col, vec3(1.0), halo * 0.28);',
    '  } else if (u_mode == 3) {',
    '    /* ---- net：知识网络——节点织成网，连线间信号奔跑，光标附近整片被唤醒 ---- */',
    '    float ut = u_time;',
    '    vec2 gv = (p + sway * 0.35) * 6.5;',
    '    vec2 id = floor(gv);',
    '    float nA = 0.0;   /* 偏亮蓝的节点 */',
    '    float nB = 0.0;   /* 偏紫的节点 */',
    '    float nGlow = 0.0;',
    '    float links = 0.0;',
    '    for (int j = -1; j <= 1; j++) {',
    '      for (int i = -1; i <= 1; i++) {',
    '        vec2 oid = id + vec2(float(i), float(j));',
    '        float h = hash(oid);',
    '        vec2 np = netNode(oid, ut);',
    '        float d = length(gv - np);',
    '        float tw = 0.45 + 0.35 * sin(ut * 0.7 + h * 39.0);',                 /* 呼吸 */
    '        float speak = smoothstep(0.86, 1.0, sin(ut * 0.23 + h * 91.0));',    /* 随机「发言」闪亮 */
    '        float core = smoothstep(0.11, 0.0, d) * (tw + speak * 0.9);',
    '        float m = step(0.55, fract(h * 7.31));',
    '        nA += core * (1.0 - m);',
    '        nB += core * m;',
    '        nGlow += smoothstep(0.32, 0.0, d) * 0.10;',                          /* 外圈柔光 */
    '        links += netLink(gv, np, netNode(oid + vec2(1.0, 0.0), ut), h, h, ut);',
    '        links += netLink(gv, np, netNode(oid + vec2(0.0, 1.0), ut), h, hash(oid + 5.7), ut);',
    '      }',
    '    }',
    '    float focus = 0.55 + 0.85 * halo;',   /* 光标附近更活跃 */
    '    density = clamp((nA + nB) * 0.30 + links * 0.25, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.50), clamp(nGlow * focus, 0.0, 1.0) * 0.55);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.85), clamp(nA * focus, 0.0, 1.0) * 0.85);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.85), clamp(nB * focus, 0.0, 1.0) * 0.80);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.55), clamp(links * focus, 0.0, 1.0) * 0.42);',
    '    col = mix(col, vec3(1.0), halo * 0.28);',
    '  } else if (u_mode == 4) {',
    '    /* ---- wire：讯流——新闻讯号线横贯画面，三色光点沿线奔跑 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.5;',
    '    float rowF = wp.y * 6.0 + 0.12 * sin(wp.x * 1.3 + ut * 0.4);',  /* 线体随信号轻微起伏 */
    '    float row = floor(rowF);',
    '    float ry = fract(rowF) - 0.5;',
    '    float h = hash(vec2(row, 3.7));',
    '    float laneOn = smoothstep(0.16, 0.32, hash(vec2(row, 9.1)));',    /* 留白行，别铺满 */
    '    float dir = h > 0.5 ? 1.0 : -1.0;',
    '    float x = wp.x * dir - ut * (0.22 + h * 0.35);',                  /* 各线异速、左右交替 */
    '    float laneY = exp(-ry * ry * 380.0);',                            /* 细亮线 */
    '    float line = laneY * laneOn * (0.45 + 0.25 * sin(ut * 0.5 + h * 40.0));',
    '    float pk = fract(x * 0.8 + h * 1.7);',
    '    float pack = exp(-pk * pk * 110.0) + exp(-pow(pk - 0.55, 2.0) * 110.0) * 0.6;',
    '    float packet = laneY * laneOn * pack * (0.6 + 0.4 * sin(ut * 2.0 + h * 20.0));',
    '    float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);',
    '    vec3 laneCol = hash(vec2(row, 5.1)) > 0.5 ? u_colB : u_colC;',    /* 三色分门别类 */
    '    laneCol = mix(laneCol, u_colA, step(0.75, h));',
    '    density = clamp(line * 0.35 + packet * 0.7, 0.0, 1.0) * edge;',
    '    col = mix(col, mix(vec3(1.0), laneCol, 0.80), clamp(line * 0.40 * edge, 0.0, 1.0));',
    '    col = mix(col, mix(vec3(1.0), laneCol, 0.92), clamp(packet * 0.80 * edge, 0.0, 1.0));',
    '    col = mix(col, vec3(1.0), halo * 0.30);',
    '  } else if (u_mode == 5) {',
    '    /* ---- sop：工序流水线——进度头沿工序道同向推进，依次点亮检查点，身后留完成轨迹 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.5;',
    '    float ly = (wp.y - 0.10) / 0.205;',
    '    float row = floor(ly);',
    '    float fy = fract(ly) - 0.5;',
    '    float h = hash(vec2(row, 2.2));',
    '    float laneOn = step(-0.6, row) * step(row, 3.6) * smoothstep(0.10, 0.22, hash(vec2(row, 7.7)));',
    '    float hx = fract(ut * (0.085 + 0.055 * h) + h * 3.7) * (aspect + 0.4) - 0.2;',  /* 各道异速、同向左→右 */
    '    float db = hx - wp.x;',
    '    float tail = 1.0 - smoothstep(0.0, 0.42, db);',        /* 头部正后方 */
    '    float passedLine = smoothstep(0.0, 0.12, -db);',       /* 已完成的路段 */
    '    float trackLine = exp(-fy * fy * 300.0);',
    '    float headDot = exp(-(db * db * 900.0 + fy * fy * 320.0));',
    '    float gi0 = floor(wp.x / 0.34);',
    '    float done = 0.0;',
    '    float pend = 0.0;',
    '    for (int i = -1; i <= 2; i++) {',
    '      float gi = gi0 + float(i);',
    '      float nx = sopGateX(row, gi);',
    '      float gd = length(vec2(wp.x - nx, fy * 0.205));',
    '      float gate = smoothstep(0.034, 0.008, gd);',
    '      float glow = smoothstep(0.062, 0.0, gd) * 0.12;',
    '      float hxGap = db - (nx - wp.x);',                   /* = 进度头 − 该检查点 */
    '      float fr = max(hxGap, 0.0);',
    '      float sn = max(-hxGap, 0.0);',
    '      float passed = smoothstep(0.0, 0.045, hxGap);',
    '      float fresh = exp(-fr * fr * 48.0);',               /* 刚点亮的检查点余辉 */
    '      float soon = exp(-sn * sn * 260.0);',               /* 即将到达的检查点 */
    '      float pulse = 0.5 + 0.5 * sin(ut * 6.5 + gi * 2.1);',
    '      done += gate * passed * (0.30 + 0.70 * fresh) + glow * passed * fresh * 0.6;',
    '      pend += (gate * 0.26 + glow) * (1.0 - passed) + gate * soon * pulse * 0.75;',
    '    }',
    '    float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);',
    '    float focus = 0.55 + 0.85 * halo;',
    '    float lDone = clamp(done * focus, 0.0, 1.0) * laneOn * edge;',
    '    float lPend = clamp(pend * focus, 0.0, 1.0) * laneOn * edge;',
    '    float lLine = clamp(trackLine * (0.20 + 0.35 * passedLine + 0.55 * tail) * focus, 0.0, 1.0) * laneOn * edge;',
    '    float lHead = clamp(headDot * focus, 0.0, 1.0) * laneOn * edge;',
    '    density = clamp(lDone * 0.6 + lPend * 0.22 + lLine * 0.35 + lHead * 0.9, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.55), lPend * 0.30);',   /* 未到检查点：淡紫蓝 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.85), lDone * 0.80);',   /* 已完成：主品牌蓝 */
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.55), lLine * 0.50);',   /* 工序道 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.70), lHead * 0.90);',   /* 进度头 */
    '    col = mix(col, vec3(1.0), halo * 0.30);',
    '  } else {',
    '    /* ---- cue：指哪打哪——光标弧线飞向目标、收缩锁定圈、点中泛起红色涟漪 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.4;',
    '    float stepF = ut / 1.8;',                       /* 每步 1.8s：飞行 + 停留 */
    '    float kk = floor(stepF);',
    '    float lt = fract(stepF);',
    '    float flyFrac = 0.62;',
    '    float e = clamp(lt / flyFrac, 0.0, 1.0);',
    '    float eS = e * e * (3.0 - 2.0 * e);',           /* 缓入缓出 */
    '    vec2 Pk = cueTarget(kk, aspect);',
    '    vec2 Pp = cueTarget(kk - 1.0, aspect);',
    '    vec2 dir = Pk - Pp;',
    '    vec2 nrm = vec2(-dir.y, dir.x) / max(length(dir), 1e-3);',
    '    vec2 cursor = mix(Pp, Pk, eS) + nrm * (0.055 * sin(3.14159 * e));',  /* 弧线飞行 */
    '    if (lt >= flyFrac) cursor = Pk;',                                    /* 到了就停在那儿 */
    '    float dw = clamp((lt - flyFrac) / (1.0 - flyFrac), 0.0, 1.0);',      /* 停留进度 */
    '    float dc = length(wp - cursor);',
    '    float core = exp(-dc * dc * 3000.0);',           /* 光标核心 */
    '    float soft = exp(-dc * dc * 200.0);',            /* 光标柔光 */
    '    float trailFade = lt < flyFrac ? 1.0 : 1.0 - dw;',
    '    vec2 sd = segDistQ(wp, Pp, cursor);',
    '    float trail = smoothstep(0.013, 0.0, sd.x) * smoothstep(eS - 0.55, eS, sd.y) * trailFade;',
    '    float di = length(wp - Pk);',
    '    float ringR = mix(0.16, 0.058, eS);',            /* 锁定圈随接近收缩 */
    '    float ring = smoothstep(0.011, 0.0, abs(di - ringR));',
    '    float ringA = lt < flyFrac ? (0.20 + 0.80 * e) : (1.0 - 0.8 * dw);',
    '    float leave = 1.0 - smoothstep(0.0, 0.5, e);',   /* 刚离开的目标渐暗 */
    '    float scen = 0.0;',
    '    float tgt = 0.0;',
    '    for (int j = -11; j <= 11; j++) {',
    '      vec2 tp = cueTarget(kk + float(j), aspect);',
    '      float d = length(wp - tp);',
    '      float hb = hash(vec2(kk + float(j), 1.7));',
    '      float breath = 0.45 + 0.30 * sin(ut * 0.9 + hb * 40.0);',
    '      float dot = smoothstep(0.024, 0.005, d);',
    '      float glow = smoothstep(0.075, 0.0, d);',
    '      float win = 1.0 - smoothstep(8.0, 11.0, abs(float(j)));',   /* 窗边淡入淡出，滑动不跳 */
    '      scen += (dot * 0.65 + glow * 0.09) * breath * win;',
    '      float isCur = 1.0 - step(0.5, abs(float(j)));',
    '      float isPrev = 1.0 - step(0.5, abs(float(j) + 1.0));',
    '      tgt += (dot * 1.15 + glow * 0.38) * isCur * smoothstep(0.25, 1.0, e);',
    '      tgt += (dot * 1.15 + glow * 0.32) * isPrev * leave;',
    '    }',
    '    float rr = dw * 0.16;',                          /* 落点涟漪扩散 */
    '    float ripple = smoothstep(0.020, 0.004, abs(di - rr)) * (1.0 - dw) * (1.0 - 0.6 * dw) * (lt < flyFrac ? 0.0 : 1.0);',
    '    float focus = 0.55 + 0.85 * halo;',
    '    float lScen = clamp(scen * focus, 0.0, 1.0);',
    '    float lTgt  = clamp(tgt * focus, 0.0, 1.0);',
    '    float lRing = clamp(ring * ringA * focus, 0.0, 1.0);',
    '    float lTrail = clamp(trail * focus, 0.0, 1.0);',
    '    float lSoft = clamp(soft * focus, 0.0, 1.0);',
    '    float lCore = clamp(core * (0.7 + 0.3 * focus), 0.0, 1.0);',
    '    float lRip  = clamp(ripple * focus, 0.0, 1.0);',
    '    density = clamp(lScen * 0.35 + lTgt * 0.55 + lSoft * 0.6 + lCore * 0.8 + lRip * 0.6, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.60), lScen * 0.55);',   /* 屏幕上的小东西：紫罗兰 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.70), lTgt * 0.60);',    /* 被指住的目标：紫 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.55), lRing * 0.70);',   /* 锁定圈 */
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.50), lTrail * 0.62);',  /* 飞行轨迹 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.60), lSoft * 0.60);',   /* 光标柔光 */
    '    col = mix(col, vec3(1.0), lCore * 0.90);',                      /* 光标核心：近白 */
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.85), lRip * 0.90);',    /* 点中的涟漪：红 */
    '    col = mix(col, vec3(1.0), halo * 0.26);',
    '  }',
    '',
    '  /* 点阵：26 CSS 像素网格，靠近光标变深、顶部密底部淡（浅底上压暗） */',
    '  vec2 cssPx = gl_FragCoord.xy / u_dpr;',
    '  vec2 g = fract(cssPx / 26.0) - 0.5;',
    '  float dotA = smoothstep(0.14, 0.03, length(g));',
    '  float dotVis = (0.05 + 0.30 * halo + 0.10 * smoothstep(0.45, 1.0, density)) * u_dot;',
    '  dotVis *= smoothstep(0.30, 1.05, uv.y);',
    '  col -= vec3(0.90, 0.97, 1.05) * dotA * dotVis * 0.22;',
    '',
    '  /* 底部融回页面底色，与下文无缝衔接 */',
    '  col = mix(base, col, smoothstep(0.0, 0.16, uv.y));',
    '',
    '  /* 抖动，避免大面积渐变出现色带 */',
    '  col += (hash(gl_FragCoord.xy * 0.37) - 0.5) * (2.2 / 255.0);',
    '',
    '  col = mix(base, col, u_reveal);',
    '  outColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  }
  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var uRes = gl.getUniformLocation(prog, 'u_res');
  var uDpr = gl.getUniformLocation(prog, 'u_dpr');
  var uTime = gl.getUniformLocation(prog, 'u_time');
  var uMouse = gl.getUniformLocation(prog, 'u_mouse');
  var uReveal = gl.getUniformLocation(prog, 'u_reveal');
  gl.uniform1i(gl.getUniformLocation(prog, 'u_mode'), mode);
  gl.uniform3fv(gl.getUniformLocation(prog, 'u_colA'), colA);
  gl.uniform3fv(gl.getUniformLocation(prog, 'u_colB'), colB);
  gl.uniform3fv(gl.getUniformLocation(prog, 'u_colC'), colC);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_dot'), dot);

  var dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uDpr, dpr);
  }

  /* 指针：目标点 + 平滑跟随；无指针时缓慢漂移，画面保持活着 */
  var target = { x: 0.5, y: 0.58 };
  var cur = { x: target.x, y: target.y };
  var hasPointer = false;
  hero.addEventListener('pointermove', function (e) {
    var rect = hero.getBoundingClientRect();
    target.x = (e.clientX - rect.left) / Math.max(1, rect.width);
    target.y = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
    hasPointer = true;
  });
  hero.addEventListener('pointerleave', function () { hasPointer = false; });

  var t = 20 + Math.random() * 40; /* 随机相位：每次打开构图不同 */
  var reveal = reduceMotion ? 1 : 0;
  var last = performance.now();

  function frame(now) {
    var dt = Math.min(Math.max((now - last) / 1000, 0), 0.06);
    last = now;
    t += dt * speed;
    if (!hasPointer && !reduceMotion) {
      target.x = 0.5 + 0.30 * Math.sin(t * 0.11);
      target.y = 0.60 + 0.16 * Math.sin(t * 0.07 + 1.7);
    }
    var k = Math.min(1, dt * 3.2);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    reveal = Math.min(1, reveal + dt / 0.9);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, cur.x, cur.y);
    gl.uniform1f(uReveal, reveal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();

  if (reduceMotion) {
    /* 静态一帧：画面依旧好看，但完全不动 */
    cur.x = target.x;
    cur.y = target.y;
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, cur.x, cur.y);
    gl.uniform1f(uReveal, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    hero.classList.add('gl-on');
    window.addEventListener('resize', function () {
      resize();
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, cur.x, cur.y);
      gl.uniform1f(uReveal, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    return;
  }

  frame(last); /* 先画一帧再揭开，避免黑闪 */
  hero.classList.add('gl-on');
  window.addEventListener('resize', resize);

  var raf = null;
  function loop(now) {
    frame(now);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (raf !== null) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  /* 只在 Hero 可见时渲染，滚到下面内容就停下 */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else stop();
    }).observe(hero);
  }
  start();
})();
