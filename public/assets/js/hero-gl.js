/* ============================================================
   Hero 背景（全站共享）：手写 WebGL2 着色器 / three.js 场景

   页面里放一个 canvas 就自动接管该 hero 的背景：
     <section class="hero">
       <canvas id="hero-gl" aria-hidden="true" data-...></canvas>
       ...
     </section>

   配置（canvas 的 data 属性）：
     data-engine="gl"（默认）| "three"
     data-mode="flow"（默认）| "queue" | "scan" | "net" | "wire" | "sop" | "cue" | "local" | "slot" | "listen" —— gl 引擎
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

  var MODES = { flow: 0, queue: 1, scan: 2, net: 3, wire: 4, sop: 5, cue: 6, local: 7, slot: 8, listen: 9 };
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
    'uniform sampler2D u_glyphs;',   /* scan 模式：64 个字符的图集（8x8 格） */
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
    '/* local 模式：超椭圆（squircle）在方向 d 上的边界半径（|d| 为单位向量时，',
    '   返回中心沿该方向到边界的距离；点 R(d)*d 恰好落在曲线上） */',
    'float localEdge(vec2 d, vec2 hh, float n) {',
    '  vec2 a = abs(d) / hh;',
    '  float e = pow(a.x, n) + pow(a.y, n);',
    '  return pow(max(e, 1e-6), -1.0 / n);',
    '}',
    '',
    '/* local 模式：点到超椭圆边界的近似距离（f / |∇f|，够画细线） */',
    'float localDist(vec2 c, vec2 hh, float n) {',
    '  vec2 a = abs(c) / hh;',
    '  vec2 g = n * vec2(pow(a.x, n - 1.0) / hh.x, pow(a.y, n - 1.0) / hh.y);',
    '  return (pow(a.x, n) + pow(a.y, n) - 1.0) / max(length(g), 1e-4);',
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
    '/* scan 模式：从字符图集里取出第 g 个字的形状；f 是格内坐标（f.y：1 = 格子顶部） */',
    '/* 图集上传时没翻转 Y（画布顶行 → v=0），所以这里把 f.y 翻过来采样，字才是正的 */',
    'float glyphMask(float g, vec2 f) {',
    '  g = mod(g, 64.0);',
    '  vec2 auv = (vec2(mod(g, 8.0), floor(g / 8.0)) + clamp(vec2(f.x, 1.0 - f.y), 0.03, 0.97)) / 8.0;',
    '  return textureLod(u_glyphs, auv, 1.0).r;',   /* 固定 mip 层：格子在屏幕上约 32px，正好对上 LOD1 */
    '}',
    '',
    '/* slot 模式：以 (xc,yc) 为中心、半宽 hw / 半高 hh 的超椭圆日程块 */',
    '/* 返回 vec2(块体遮罩, 描边遮罩) */',
    'vec2 slotBox(vec2 wp, float xc, float yc, float hw, float hh) {',
    '  float d = localDist(wp - vec2(xc, yc), vec2(hw, hh), 4.0);',
    '  float body = 1.0 - smoothstep(-0.007, 0.004, d);',
    '  float edge = smoothstep(0.0028, 0.0, abs(d));',
    '  return vec2(body, edge);',
    '}',
    '',
    '/* slot 模式：第 k 套剧本 —— .x = 撞上去时的中心 y，.y = 挪进空档后的中心 y',
    '   （两者相同 = 这段时间本来就空着，直接落位） */',
    'vec2 slotPlan(float k) {',
    '  if (k < 0.5) return vec2(0.635, 0.770);',    /* 撞上中午那场长的 → 挪到它上面 */
    '  if (k < 1.5) return vec2(0.895, 0.770);',    /* 撞上早晨那场 → 挪到它下面 */
    '  return vec2(0.770, 0.770);',                 /* 本来空着：直接落位 */
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
    '    /* ---- scan：数码字符流穿过画面，扫描头从后面追上来，把它们成片读走分析 ---- */',
    '    float ut = mod(u_time, 7200.0);',
    '    vec2 wp = p + sway * 0.35;',
    '    float chars = 0.0;   /* 字符流本体 */',
    '    float warm  = 0.0;   /* 刚被读过的余温 */',
    '    float beams = 0.0;   /* 扫描头的光带 */',
    '    float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);',
    '    for (int n = 0; n < 7; n++) {',
    '      float L = float(n);',
    '      float rl = hash(vec2(L, 2.2));',
    '      float cy = 0.12 + (L + (hash(vec2(L, 9.3)) - 0.5) * 0.6) * 0.108;',  /* 行高 */
    '      float dy = wp.y - cy;',
    '      if (abs(dy) < 0.046) {',
    '        float cellW = 0.030;',
    '        float off = ut * (0.055 + 0.045 * rl) + rl * 7.0;',      /* 每道流速略不同 */
    '        float px = wp.x - off;',
    '        float ci = floor(px / cellW);',
    '        float ciw = mod(ci, 128.0);',
    '        vec2 f = vec2(fract(px / cellW), dy / 0.040 + 0.5);',
    '        float flick = floor(ut * (2.5 + 2.0 * rl) + hash(vec2(ciw, L)) * 9.0);',  /* 逐格换字 */
    '        float g = floor(hash(vec2(ciw * 1.7 + L * 7.3, flick)) * 64.0);',
    '        float m = glyphMask(g, f);',
    '        float gate = smoothstep(0.046, 0.014, abs(dy));',
    '        /* 扫描头：每道自有节奏，比字符跑得快，从后面一路追上去 */',
    '        float ph = fract(ut / (7.0 + 5.0 * hash(vec2(L, 6.6))) + hash(vec2(L, 1.8)));',
    '        float onRun = 1.0 - step(0.55, ph);',
    '        float sx = -0.45 + clamp(ph / 0.55, 0.0, 1.0) * (aspect + 0.9);',
    '        float cx = wp.x + (0.5 - fract(px / cellW)) * cellW;',   /* 这一格此刻的位置 */
    '        float lead = cx - sx;',
    '        float pre  = exp(-max(lead, 0.0) * 7.0) * onRun;',       /* 即将被读到：提亮 */
    '        float read = exp(-max(-lead, 0.0) * 5.0) * step(lead, 0.0)',
    '                   * (1.0 - smoothstep(0.55, 0.78, ph));',       /* 读过：余温慢慢退去 */
    '        float bx = wp.x - sx;',
    '        beams += exp(-bx * bx * 1700.0) * gate * onRun * 0.42;',
    '        chars += m * gate * (0.15 + 0.30 * pre);',
    '        warm  += m * gate * read * 0.95;',
    '      }',
    '    }',
    '    float focus = 0.55 + 0.85 * halo;',
    '    vec3 ink = vec3(0.40, 0.45, 0.56);',                         /* 冷灰蓝的数码墨水 */
    '    float lChars = clamp(chars * focus * edge, 0.0, 1.0);',
    '    float lWarm = clamp(warm * focus * edge, 0.0, 1.0);',
    '    float lBeam = clamp(beams * focus * edge, 0.0, 1.0);',
    '    density = clamp(chars * 0.50 + warm * 0.60 + beams * 0.50, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), ink, 0.60), lChars * 0.55);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.80), lWarm * 0.78);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.70), lBeam * 0.50);',
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
    '  } else if (u_mode == 7) {',
    '    /* ---- local：本机闭环——推理核心被超椭圆边界环抱，光点沿轨道奔跑、',
    '            定期螺旋俯冲进核心算一发再回轨道；所有动静都不出最外圈 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.4;',
    '    vec2 C = vec2(aspect * 0.335, 0.50);',
    '    vec2 rel = wp - C;',
    '    vec3 ringC = vec3(0.0);',                        /* 轨道线（按主色累积） */
    '    vec3 orbitC = vec3(0.0);',                       /* 沿线奔跑的光点 */
    '    vec3 diveC = vec3(0.0);',                        /* 俯冲进核心的光点 */
    '    float coreHit = 0.0;',                           /* 本帧核心是否被喂到 */
    '    float grow = 1.0 + 0.05 * sin(ut * 0.7);',       /* 最外圈轻轻呼吸 */
    '    for (int k = 0; k < 3; k++) {',
    '      float fk = float(k);',
    '      vec3 tc = k == 0 ? u_colA : (k == 1 ? u_colB : u_colC);',
    '      vec2 hh = vec2(0.098) * (1.0 + fk * 0.62) * mix(1.0, grow, step(1.5, fk));',
    '      float ld = localDist(rel, hh, 4.0);',
    '      float edge = smoothstep(0.0028, 0.0, abs(ld));',
    '      ringC += tc * (edge * (0.50 + 0.28 * fk) + exp(-ld * ld * 1600.0) * 0.09);',
    '      float dir = mod(fk, 2.0) < 0.5 ? 1.0 : -1.0;',   /* 相邻轨道反向跑 */
    '      float sp = dir * (0.40 + 0.13 * fk);',
    '      for (int j = 0; j < 2; j++) {',
    '        float fj = float(j);',
    '        float th = ut * sp + fk * 2.4 + fj * 3.14159 + hash(vec2(fk, fj)) * 0.8;',
    '        vec2 d2 = vec2(cos(th), sin(th));',
    '        vec2 q = C + d2 * localEdge(d2, hh, 4.0);',    /* 光点贴着轨道线跑 */
    '        float dd = length(wp - q);',
    '        orbitC += tc * (exp(-dd * dd * 15000.0) * 0.95 + exp(-dd * dd * 900.0) * 0.16);',
    '      }',
    '      /* 俯冲：每颗光点按自己的周期螺旋进核心，算完一发再回轨道 */',
    '      float per = 8.2 - 1.7 * fk;',
    '      float ph = fract(ut / per + hash(vec2(fk, 3.3)));',
    '      float dw = smoothstep(0.52, 0.70, ph) * (1.0 - smoothstep(0.80, 0.97, ph));',
    '      float de = dw * dw * (3.0 - 2.0 * dw);',
    '      float thd = ut * sp * 0.55 + fk * 2.4 + 1.3;',
    '      vec2 d3 = vec2(cos(thd), sin(thd));',
    '      float rad = mix(localEdge(d3, hh, 4.0), 0.014, de);',
    '      vec2 qd = C + d3 * rad;',
    '      float ddq = length(wp - qd);',
    '      diveC += tc * exp(-ddq * ddq * mix(15000.0, 30000.0, de)) * 1.10;',
    '      coreHit = max(coreHit, (1.0 - smoothstep(0.02, 0.07, rad)) * de);',
    '    }',
    '    /* 核心：一枚小芯片轮廓，被俯冲光点喂出心跳式的闪光 */',
    '    float dcen = length(rel);',
    '    float dcore = localDist(rel, vec2(0.042), 4.0);',
    '    float chip = smoothstep(0.0026, 0.0, abs(dcore));',
    '    float coreBody = (1.0 - smoothstep(-0.004, 0.010, dcore)) * 0.16;',
    '    float flash = coreHit * (exp(-dcen * dcen * 760.0) + exp(-dcen * dcen * 90.0) * 0.28);',
    '    /* 最外圈之内：极淡一层底色，把「机器里」的范围圈出来 */',
    '    float inside = 1.0 - smoothstep(-0.030, 0.006, localDist(rel, vec2(0.098 * 2.24) * grow, 4.0));',
    '    float focus = 0.55 + 0.85 * halo;',
    '    float lRing = clamp(length(ringC) * focus, 0.0, 1.0);',
    '    float lOrbit = clamp(length(orbitC) * focus, 0.0, 1.0);',
    '    float lDive = clamp(length(diveC) * focus, 0.0, 1.0);',
    '    float lCore = clamp((chip * 0.90 + coreBody + flash * 0.90) * focus, 0.0, 1.0);',
    '    vec3 cRing = ringC / max(length(ringC), 1e-4);',
    '    vec3 cOrbit = orbitC / max(length(orbitC), 1e-4);',
    '    vec3 cDive = diveC / max(length(diveC), 1e-4);',
    '    density = clamp(lRing * 0.55 + lOrbit * 0.70 + lDive * 0.80 + lCore * 0.70, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.10), inside * 0.22);',
    '    col = mix(col, mix(vec3(1.0), cRing, 0.55), lRing * 0.45);',
    '    col = mix(col, mix(vec3(1.0), cOrbit, 0.80), lOrbit * 0.70);',
    '    col = mix(col, mix(vec3(1.0), cDive, 0.85), lDive * 0.80);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.40), lCore * 0.80);',   /* 核心：淡青芯片 */
    '    col = mix(col, vec3(1.0), clamp(flash, 0.0, 1.0) * focus * 0.45);',
    '    col = mix(col, vec3(1.0), halo * 0.30);',
    '  } else if (u_mode == 8) {',
    '    /* ---- slot：复制进来的日程先撞上已有安排（红一下），',
    '            再滑进最近的空档落定；空档本来空着就直接落位 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.4;',
    '    float T = 11.0;',
    '    float ph = fract(ut / T);',
    '    float cyc = floor(ut / T);',
    '    float pick = floor(hash(vec2(cyc, 4.4)) * 3.0);',
    '    vec2 plan = slotPlan(pick);',
    '    float yHit = plan.x;',                       /* 撞上去时的中心 */
    '    float yFit = plan.y;',                       /* 挪进空档后的中心 */
    '    float railX = aspect * 0.505;',              /* 时间轴竖轨：落在文案与截图之间的空档 */
    '    float xk = clamp(aspect / 1.9, 0.30, 1.0);',  /* 窄画布（手机）上把日历列收紧，别出血 */
    '    float bx = railX + 0.150 * xk;',             /* 日程块中心 x */
    '    float bw = 0.105 * xk;',                     /* 半宽 */
    '    float bh = 0.040;',                          /* 半高：比撞上的那场略矮，露出来才看得出撞了谁 */
    '    float e1c = 0.895, e1h = 0.055;',            /* 已有安排：早晨一场 */
    '    float e2c = 0.635, e2h = 0.065;',            /* 中午一场（长） */
    '    float e3c = 0.505, e3h = 0.035;',            /* 傍晚一条（短） */
    '    /* 时间轴：竖轨 + 12 道刻度（常驻） */',
    '    float rail = smoothstep(0.0022, 0.0, abs(wp.x - railX))',
    '               * smoothstep(0.44, 0.48, wp.y) * smoothstep(0.97, 0.93, wp.y);',
    '    float ticks = 0.0;',
    '    for (int i = 0; i < 12; i++) {',
    '      float ty = 0.470 + float(i) * 0.0427;',
    '      ticks += (1.0 - step(0.030 * xk, wp.x - railX)) * step(0.0, wp.x - railX)',
    '             * smoothstep(0.0022, 0.0, abs(wp.y - ty));',
    '    }',
    '    ticks = clamp(ticks, 0.0, 1.0);',
    '    /* 日历上已有的三场 */',
    '    vec2 b1 = slotBox(wp, bx, e1c, bw, e1h);',
    '    vec2 b2 = slotBox(wp, bx, e2c, bw, e2h);',
    '    vec2 b3 = slotBox(wp, bx, e3c, bw, e3h);',
    '    float evBody = clamp(b1.x + b2.x + b3.x, 0.0, 1.0);',
    '    float evEdge = clamp(b1.y + b2.y + b3.y, 0.0, 1.0);',
    '    /* 这次撞上的是哪一场：与 slotPlan 一一对应（直接落位那套没有对手，拉到画面外） */',
    '    float eC = pick < 0.5 ? e2c : (pick < 1.5 ? e1c : 1.5);',
    '    float eH = pick < 0.5 ? e2h : (pick < 1.5 ? e1h : 0.02);',
    '    float hasC = step(0.001, abs(yFit - yHit));',    /* 0 = 本来就空，不红不紫 */
    '    /* 四拍：飞入 → 撞上（红） → 滑进空档（紫转蓝） → 落定涟漪 */',
    '    float flyE = smoothstep(0.02, 0.20, ph);',
    '    flyE = flyE * flyE * (3.0 - 2.0 * flyE);',
    '    float mvE = smoothstep(0.46, 0.66, ph);',
    '    mvE = mvE * mvE * (3.0 - 2.0 * mvE);',
    '    float settled = smoothstep(0.66, 0.82, ph);',
    '    float vis = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.87, 0.99, ph));',
    '    float conf = smoothstep(0.20, 0.25, ph) * (1.0 - smoothstep(0.44, 0.52, ph));',
    '    float pulse = 0.55 + 0.45 * sin(ut * 6.3);',    /* 撞上时的心跳 */
    '    float xc = bx + (1.0 - flyE) * 0.46 * xk;',      /* 从右侧（截图背后）滑入 */
    '    float yc = mix(yHit, yFit, mvE);',
    '    vec2 nb = slotBox(wp, xc, yc, bw, bh);',
    '    /* 重叠区：撞上的那一小段，泛红闪 */',
    '    float lo = max(yHit - bh, eC - eH);',
    '    float hi = min(yHit + bh, eC + eH);',
    '    vec2 ov = slotBox(wp, bx, (lo + hi) * 0.5, bw * 0.92, max(hi - lo, 0.0) * 0.5);',
    '    float ovA = ov.x * step(0.001, hi - lo);',
    '    /* 滑走后留下的一段轨迹 */',
    '    vec2 sd = segDistQ(wp, vec2(bx, yHit), vec2(bx, yc));',
    '    float trail = smoothstep(0.006, 0.0, sd.x) * smoothstep(0.15, 0.75, sd.y) * mvE * (1.0 - settled) * hasC;',
    '    /* 落定：一圈涟漪从块心扩开 */',
    '    float rp = clamp((ph - 0.66) / 0.18, 0.0, 1.0);',
    '    float dq = length(wp - vec2(bx, yFit));',
    '    float ripple = smoothstep(0.007, 0.0, abs(dq - rp * 0.18)) * (1.0 - rp) * step(0.66, ph);',
    '    vec3 confCol = mix(vec3(1.0), u_colB, 0.72);',   /* 撞上：红 */
    '    vec3 midCol  = mix(vec3(1.0), u_colC, 0.70);',   /* 挪动中：紫 */
    '    vec3 fitCol  = mix(vec3(1.0), u_colA, 0.85);',   /* 落定：品牌蓝 */
    '    vec3 ghostCol = mix(vec3(1.0), u_colA, 0.30);',  /* 飞入途中：淡蓝空壳，还没落位 */
    '    float hitT = smoothstep(0.19, 0.25, ph);',       /* 撞上那一刻起才开始变色 */
    '    vec3 landed = hasC < 0.5 ? fitCol',
    '                : (mvE < 0.5 ? mix(confCol, midCol, mvE * 2.0)',
    '                             : mix(midCol, fitCol, (mvE - 0.5) * 2.0));',
    '    vec3 nCol = mix(ghostCol, landed, hitT);',       /* 块体：撞上才染红，落定成品牌蓝 */
    '    vec3 nEdgeCol = mix(fitCol, nCol, hitT);',       /* 描边：飞入时先用品牌蓝立住 */
    '    float flash = settled * (1.0 - settled) * 4.0;', /* 落定那一下的白光 */
    '    float focus = 0.55 + 0.85 * halo;',
    '    float lRail = clamp(rail * 0.85 + ticks * 0.70, 0.0, 1.0);',
    '    float lEv = clamp(evBody * 0.55 + evEdge * 0.85, 0.0, 1.0);',
    '    float lOv = clamp(ovA * (0.35 + 0.65 * pulse) * conf, 0.0, 1.0);',
    '    float lNewBody = clamp(nb.x * vis, 0.0, 1.0);',
    '    float lNewEdge = clamp(nb.y * vis * 1.25, 0.0, 1.0);',
    '    float lTrail = clamp(trail, 0.0, 1.0);',
    '    float lRip = clamp(ripple * 0.90, 0.0, 1.0);',
    '    density = clamp((lRail * 0.35 + lEv * 0.50 + lOv * 0.55',
    '                     + lNewBody * 0.80 + lNewEdge * 0.45',
    '                     + lTrail * 0.30 + lRip * 0.60) * focus, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.35), lRail * 0.35);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.22), evBody * 0.42);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.45), evEdge * 0.62);',
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.55), lOv * 0.55);',
    '    col = mix(col, nCol, lNewBody * 0.85);',
    '    col = mix(col, nEdgeCol, lNewEdge * 0.62);',
    '    col = mix(col, mix(vec3(1.0), u_colC, 0.55), lTrail * 0.40);',
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.35), lRip * 0.45);',
    '    col = mix(col, vec3(1.0), flash * 0.35);',
    '    col = mix(col, vec3(1.0), halo * 0.30);',
    '  } else if (u_mode == 9) {',
    '    /* ---- listen：两路声音同时在跑（麦克风里是我、电脑里是对方），',
    '            跑到右边凝成一条条待办：落定一颗涟漪，补全的亮一下橙、',
    '            作废的划一道红 ---- */',
    '    float ut = u_time;',
    '    vec2 wp = p + sway * 0.4;',
    '    float xk = clamp(aspect / 1.9, 0.30, 1.0);',    /* 窄画布上把待办列收紧 */
    '    float pillX = aspect * 0.565;',                  /* 待办列：落在文案与截图中间的空档 */
    '    float phw = 0.082 * xk;',
    '    float phh = 0.035;',
    '    /* 两路声音：一段一段地说，不是一直在响 */',
    '    float lanes = 0.0;',
    '    vec3 laneCol = vec3(0.0);',
    '    for (int L = 0; L < 2; L++) {',
    '      float fl = float(L);',
    '      vec3 lc = L == 0 ? u_colC : u_colA;',          /* 0 = 麦克风（我），1 = 电脑里（对方） */
    '      float yc0 = L == 0 ? 0.615 : 0.470;',
    '      float yc1 = L == 0 ? 0.578 : 0.512;',          /* 越往右越汇拢 */
    '      float yc = mix(yc0, yc1, clamp(wp.x / max(pillX, 1e-3), 0.0, 1.0));',
    '      float dy = wp.y - yc;',
    '      float along = smoothstep(-0.03, 0.05, wp.x) * (1.0 - smoothstep(pillX - 0.08, pillX - 0.012, wp.x));',   /* 一直流到待办列底下：声波流进去凝成待办 */
    '      float sp = wp.x * 0.55 - ut * 0.20 + fl * 3.7;',   /* 说话的节奏 */
    '      float env = smoothstep(0.28, 0.60, vnoise(vec2(sp, fl * 7.3 + 1.1)));',   /* 门槛压低：两路一直是“在说”的，不会有一条突然哑掉 */
    '      float amp = (0.009 + 0.031 * env) * along;',
    '      float cell = 0.024;',                          /* 波形柱：一根根竖条 */
    '      float cx = floor(wp.x / cell) * cell + cell * 0.5;',
    '      float barX = smoothstep(0.0085, 0.0030, abs(wp.x - cx));',
    '      float rh = 0.30 + 0.85 * vnoise(vec2(cx * 9.0, ut * 2.1 + fl * 5.0));',
    '      float hgt = amp * rh;',
    '      float bars = barX * smoothstep(hgt, hgt - 0.0035, abs(dy));',
    '      float line = smoothstep(0.0016, 0.0, abs(dy)) * along * 0.30;',
    '      float w = bars * (0.70 + 0.50 * env) + line;',
    '      lanes += w;',
    '      laneCol += lc * w;',
    '    }',
    '    /* 待办：一条条落定 */',
    '    float pillT = 12.0;',
    '    float pp = fract(ut / pillT);',
    '    float pBody = 0.0;',
    '    float pEdge = 0.0;',
    '    float pBadge = 0.0;',
    '    float pText = 0.0;',
    '    float pFlash = 0.0;',
    '    float pStrike = 0.0;',
    '    float pGone = 0.0;',
    '    float pRipple = 0.0;',
    '    float pShadow = 0.0;',
    '    float pGlow = 0.0;',
    '    for (int k = 0; k < 3; k++) {',
    '      float fk = float(k);',
    '      float yk = 0.735 - fk * 0.108;',    /* 整列往上挪：第三条不能被右下的通知卡挡住 */
    '      float tOn = 0.05 + fk * 0.16;',               /* 依次落定 */
    '      float land = smoothstep(tOn, tOn + 0.12, pp);',
    '      land = land * land * (3.0 - 2.0 * land);',
    '      float tOff = fk > 1.5 ? 0.86 : 0.91;',        /* 作废那条先走 */
    '      float vis = land * (1.0 - smoothstep(tOff, tOff + 0.07, pp));',
    '      float xc = pillX - (1.0 - land) * 0.42 * xk;',/* 从声音那头滑进来 */
    '      vec2 bx = slotBox(wp, xc, yk, phw, phh);',
    '      pBody += bx.x * vis;',
    '      pEdge += bx.y * vis;',
    '      float bd = localDist(wp - vec2(xc - phw + 0.031 * xk, yk + 0.0125), vec2(0.0135 * xk, 0.0135 * xk), 4.0);',
    '      pBadge += (1.0 - smoothstep(-0.0030, 0.0020, bd)) * vis;',   /* 左边的编号章 */
    '      float tx = (wp.x - xc) / phw;',
    '      pText += smoothstep(0.0026, 0.0, abs(wp.y - yk - 0.0125))',  /* 块里那行字 */
    '             * smoothstep(-0.60, -0.46, tx) * smoothstep(0.82, 0.68, tx) * vis;',
    '      /* 补全：第 2 条被补充，亮一下橙（连同新填进去的那格） */',
    '      float up = (fk > 0.5 && fk < 1.5 ? 1.0 : 0.0)',
    '               * smoothstep(0.56, 0.61, pp) * (1.0 - smoothstep(0.68, 0.75, pp));',
    '      pFlash += bx.x * up;',
    '      pFlash += slotBox(wp, xc + phw * 0.14, yk + 0.0125, phw * 0.56, 0.0125).x * up * 1.3;',
    '      pGlow += smoothstep(0.055, 0.004, localDist(wp - vec2(xc, yk), vec2(phw, phh), 4.0)) * up;',   /* 补全时卡片往外透的橙光 */
    '      /* 作废：第 3 条划一道红，整条跟着泛红 */',
    '      float st = (fk > 1.5 ? 1.0 : 0.0) * smoothstep(0.66, 0.73, pp);',
    '      pStrike += smoothstep(0.0032, 0.0, abs(wp.y - yk))',
    '               * smoothstep(phw * 1.04, phw * 0.86, abs(wp.x - xc)) * st;',
    '      pGone += bx.x * st;',
    '      /* 卡片底边往下的落影带：让待办有“落定”的重量 */',
    '      float dyb = (yk - phh) - wp.y;',
    '      pShadow += smoothstep(0.0016, 0.005, dyb) * (1.0 - smoothstep(0.0075, 0.015, dyb))',
    '               * smoothstep(phw * 0.96, phw * 0.70, abs(wp.x - xc)) * vis;',
    '      /* 落定的那一圈涟漪 */',
    '      float rp = clamp((pp - tOn - 0.12) / 0.13, 0.0, 1.0);',
    '      float dq = length(wp - vec2(pillX, yk));',
    '      pRipple += smoothstep(0.006, 0.0, abs(dq - rp * 0.15)) * (1.0 - rp) * step(tOn + 0.12, pp);',
    '    }',
    '    float focus = 0.55 + 0.85 * halo;',
    '    float mSoft = mix(0.36, 1.0, smoothstep(0.90, 1.40, aspect));',  /* 窄画布（手机）上把待办压淡，别糊住文案 */
    '    float lLane = clamp(lanes * focus, 0.0, 1.0) * mix(0.55, 1.0, mSoft);',
    '    vec3 cLane = laneCol / max(length(laneCol), 1e-4);',
    '    float lBody = clamp(pBody * focus, 0.0, 1.0) * mSoft;',
    '    float lEdge = clamp(pEdge * focus, 0.0, 1.0) * mSoft;',
    '    float lBadge = clamp(pBadge * focus, 0.0, 1.0) * mSoft;',
    '    float lText = clamp(pText * focus, 0.0, 1.0) * mSoft;',
    '    float lFlash = clamp(pFlash * focus, 0.0, 1.0) * mSoft;',
    '    float lStrike = clamp(pStrike * focus, 0.0, 1.0) * mSoft;',
    '    float lGone = clamp(pGone * focus, 0.0, 1.0) * mSoft;',
    '    float lRip = clamp(pRipple * focus, 0.0, 1.0) * mSoft;',
    '    float lShadow = clamp(pShadow * focus, 0.0, 1.0) * mSoft;',
    '    float lGlow = clamp(pGlow * focus, 0.0, 1.0) * mSoft;',
    '    density = clamp(lLane * 0.45 + lBody * 0.60 + lEdge * 0.45 + lBadge * 0.55 + lText * 0.35',
    '                    + lFlash * 0.85 + lStrike * 0.70 + lGone * 0.60 + lRip * 0.55 + lShadow * 0.30',
    '                    + lGlow * 0.45, 0.0, 1.0);',
    '    col = mix(col, mix(vec3(1.0), cLane, 0.90), lLane * 0.70);',        /* 两路声音 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.50), lGlow * 0.34);',       /* 补全时往外透的橙光 */
    '    col = mix(col, vec3(0.44, 0.34, 0.22), lShadow * 0.20);',           /* 落影带 */
    '    float lRaw = clamp(lBody / max(mSoft, 1e-3), 0.0, 1.0);',           /* 还原色浓度：手机压淡的是不透明度，不是颜色 */
    '    vec3 bcol = mix(mix(vec3(1.0), u_colA, 0.16), mix(vec3(1.0), u_colA, 0.78), lRaw);',
    '    col = mix(col, bcol, min(lBody * 0.86, 0.92));',                   /* 待办块：滑进来还淡，落定成实橙 */
    '    col = mix(col, u_colA, lEdge * 0.85);',                             /* 块的描边：实橙 */
    '    col = mix(col, vec3(1.0), lBadge * 0.90);',                         /* 编号章：白底 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.06), lText * 0.80);',       /* 块里那行字：白 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.38), lFlash * 0.85);',      /* 补全：整条亮一下 */
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.80), lGone * 0.75);',       /* 整条作废：泛红 */
    '    col = mix(col, mix(vec3(1.0), u_colB, 0.95), lStrike * 0.92);',     /* 删除线：红 */
    '    col = mix(col, mix(vec3(1.0), u_colA, 0.75), lRip * 0.72);',        /* 落定涟漪 */
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

  /* scan 模式的字符图集：白字黑底的 8x8 网格（64 个字符），只建一次 */
  var GLYPH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij<>/\\|=+*#$%@&{}[]()';
  function makeGlyphTexture() {
    var cell = 64, side = 512;
    var cv = document.createElement('canvas');
    cv.width = side;
    cv.height = side;
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = '#fff';
    ctx.font = '600 42px Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < GLYPH_CHARS.length && i < 64; i++) {
      ctx.fillText(GLYPH_CHARS.charAt(i), (i % 8) * cell + 32, Math.floor(i / 8) * cell + 34);
    }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
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
  /* 字符图集挂到 0 号纹理单元（只有 scan 模式会采样；建失败就少了字符层，其余画面照常） */
  if (makeGlyphTexture()) gl.uniform1i(gl.getUniformLocation(prog, 'u_glyphs'), 0);

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
  /* listen 的静态帧手挑相位（prefers-reduced-motion）：三条待办都落定、中间那条正亮着，定格也讲得完故事 */
  if (reduceMotion && mode === 9) t = 43.7;
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
