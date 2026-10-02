/* ============================================================
   Hero 3D 场景（three.js）——ESM，只被 hero-gl.js 动态 import

   页面 canvas 写 data-engine="three" 才会走到这里，普通页面
   完全不会下载 three.js（vendor 里 ~720KB，只服务两个页面）。

   场景：
     cards  —— 大模型掼蛋挑战赛：几片纸牌漂在 hero 上空，缓慢悬浮
     nebula —— 梦游 Wiki：一片慢旋的粉彩星云

   降级契约（与 hero-gl.js 一致）：
     · WebGL 不可用 / 任何异常 → 直接返回，不揭 canvas，CSS 光斑原样保留
     · prefers-reduced-motion → 只渲染一帧静态画面
     · 滚出视口即停渲染；DPR 上限 1.5
     · 首帧渲染成功后才给 hero 加 .gl-3d（canvas 淡入；CSS 光斑与点阵
       继续留在底层/顶层，3D 元素叠在中间）
   ============================================================ */
import * as THREE from '../vendor/three.module.min.js';

export function init(opts) {
  var canvas = opts.canvas;
  var hero = opts.hero;
  var sceneName = opts.scene;
  var speed = opts.speed || 1;
  var reduceMotion = !!opts.reduceMotion;
  var colA = new THREE.Color().fromArray(opts.colors[0]);
  var colB = new THREE.Color().fromArray(opts.colors[1]);
  var colC = new THREE.Color().fromArray(opts.colors[2]);

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power'
    });
  } catch (err) { return; } /* 回退 CSS 背景 */
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 2, 0.1, 60);
  camera.position.set(0, 0, 6);

  /* 相机在 z=6，内容基本贴在 z≈0 一带：视口世界尺寸估算，供布局用 */
  var view = { w: 10, h: 5 };
  function updateView() {
    view.h = 2 * Math.tan((camera.fov / 2) * Math.PI / 180) * camera.position.z;
    view.w = view.h * camera.aspect;
  }

  /* ---------------- Canvas 纹理工具 ---------------- */

  function makeTexture(w, h, draw) {
    var cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 软圆点：星云粒子用 */
  function softDotTex(size) {
    return makeTexture(size, size, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  /* ---------------- 场景一：漂浮的掼蛋纸牌 ---------------- */

  function cardFaceTex(rank, suit, red) {
    return makeTexture(512, 716, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#fffefb');
      g.addColorStop(1, '#f3ead8');
      roundRect(ctx, 7, 7, w - 14, h - 14, 34);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(150,118,66,0.45)';
      ctx.stroke();

      var ink = red ? '#c0392b' : '#333844';
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (suit === '') {
        /* 王：没花色，直接写个字 */
        ctx.font = '700 96px "PingFang SC", "Songti SC", Georgia, serif';
        ctx.fillText(rank, 88, 104);
        ctx.save();
        ctx.translate(w - 88, h - 104);
        ctx.rotate(Math.PI);
        ctx.fillText(rank, 0, 0);
        ctx.restore();
        ctx.font = '700 300px "PingFang SC", "Songti SC", Georgia, serif';
        ctx.fillText(rank, w / 2, h / 2 + 10);
        return;
      }

      ctx.font = '700 92px Georgia, "Songti SC", serif';
      ctx.fillText(rank, 86, 100);
      ctx.font = '300 86px Georgia, serif';
      ctx.fillText(suit, 86, 202);
      ctx.save();
      ctx.translate(w - 86, h - 100);
      ctx.rotate(Math.PI);
      ctx.font = '700 92px Georgia, "Songti SC", serif';
      ctx.fillText(rank, 0, 0);
      ctx.font = '300 86px Georgia, serif';
      ctx.fillText(suit, 0, 102);
      ctx.restore();
      ctx.globalAlpha = 0.92;
      ctx.font = '300 250px Georgia, serif';
      ctx.fillText(suit, w / 2, h / 2 + 24);
      ctx.globalAlpha = 1;
    });
  }

  function cardBackTex() {
    return makeTexture(512, 716, function (ctx, w, h) {
      var rr = 34;
      roundRect(ctx, 7, 7, w - 14, h - 14, rr);
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#cfa04a');
      g.addColorStop(1, '#a8762b');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      roundRect(ctx, 7, 7, w - 14, h - 14, rr);
      ctx.clip();
      /* 斜格纹 */
      ctx.strokeStyle = 'rgba(255,246,224,0.16)';
      ctx.lineWidth = 3;
      for (var d = -h; d < w + h; d += 30) {
        ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(d, h); ctx.lineTo(d + h, 0); ctx.stroke();
      }
      /* 中心菱形徽记 */
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(255,248,232,0.55)';
      ctx.strokeRect(-110, -110, 220, 220);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,248,232,0.35)';
      ctx.strokeRect(-84, -84, 168, 168);
      ctx.restore();
      roundRect(ctx, 7, 7, w - 14, h - 14, rr);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(120,86,30,0.6)';
      ctx.stroke();
    });
  }

  function shadowTex() {
    return makeTexture(256, 256, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(74,54,20,0.42)');
      g.addColorStop(0.55, 'rgba(74,54,20,0.18)');
      g.addColorStop(1, 'rgba(74,54,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  var CARD_W = 0.72;
  var CARD_H = 1.0;
  var NEBULA_RX = -0.48;   /* 星云盘的基准倾角 */
  var NEBULA_RZ = 0.12;

  function buildCards() {
    var group = new THREE.Group();
    var shTex = shadowTex();
    var geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    var shGeo = new THREE.PlaneGeometry(CARD_W * 1.5, CARD_H * 1.3);
    var shMat = new THREE.MeshBasicMaterial({
      map: shTex, transparent: true, depthWrite: false
    });

    /* 卡片都漂在 hero 上半部：右侧深色 mock 上方是留白区
       fx/fy 是相对视口半宽/半高的比例坐标 */
    var defs = [
      { fx: -0.88, fy:  0.86, rz: -0.50, s: 0.72, z: -0.60, ry:  0.16, face: ['A', '♠', false] },
      { fx: -0.48, fy:  0.96, rz: -0.30, s: 0.78, z: -0.30, ry: -0.14, face: ['K', '♥', true] },
      { fx: -0.10, fy:  0.80, rz: -0.10, s: 1.04, z:  0.05, ry:  0.10, face: ['王', '', true] },
      { fx:  0.32, fy:  0.74, rz:  0.12, s: 0.96, z: -0.30, ry: -0.18, face: ['10', '♣', false] },
      { fx:  0.62, fy:  0.80, rz:  0.30, s: 1.06, z:  0.30, ry:  0.14, face: null },
      { fx:  0.88, fy:  0.52, rz:  0.55, s: 0.95, z: -0.15, ry: -0.12, face: ['J', '♦', true] },
      { fx: -0.95, fy: -0.42, rz:  0.42, s: 0.82, z: -0.50, ry:  0.20, face: ['2', '♠', false] }
    ];

    var cards = defs.map(function (d) {
      var card = new THREE.Group();
      var mat = d.face
        ? new THREE.MeshBasicMaterial({
            map: cardFaceTex(d.face[0], d.face[1], d.face[2]),
            transparent: true, depthWrite: false
          })
        : new THREE.MeshBasicMaterial({
            map: cardBackTex(), transparent: true, depthWrite: false
          });
      var mesh = new THREE.Mesh(geo, mat);
      var sh = new THREE.Mesh(shGeo, shMat);
      sh.position.set(0.05, -0.10, -0.02);
      card.add(sh);
      card.add(mesh);
      card.userData = d;
      group.add(card);
      return card;
    });

    function layout() {
      /* 窄视口整体缩一点，保证牌面不出画 */
      var k = Math.max(0.6, Math.min(1, view.w / 11));
      group.scale.setScalar(k);
      cards.forEach(function (card) {
        var d = card.userData;
        card.position.set(
          d.fx * view.w * 0.47,
          d.fy * view.h * 0.44,
          d.z
        );
        card.scale.setScalar(d.s);
        card.rotation.set(0, d.ry, d.rz);
      });
    }

    function animate(t) {
      cards.forEach(function (card, i) {
        var d = card.userData;
        card.position.y = d.fy * view.h * 0.44 + Math.sin(t * 0.5 + i * 1.7) * 0.07;
        card.rotation.z = d.rz + Math.sin(t * 0.4 + i * 1.3) * 0.028;
        card.rotation.y = d.ry + Math.sin(t * 0.3 + i * 0.9) * 0.05;
      });
    }

    return {
      group: group, layout: layout, animate: animate,
      baseRX: 0, baseRZ: 0
    };
  }

  /* ---------------- 场景二：梦游星云 ---------------- */

  function buildNebula() {
    var group = new THREE.Group();
    var COUNT = 2400;

    var pos = new Float32Array(COUNT * 3);
    var col = new Float32Array(COUNT * 3);
    var tmp = new THREE.Color();

    for (var i = 0; i < COUNT; i++) {
      var r = 0.4 + Math.pow(Math.random(), 1.35) * 4.2;   /* 向心分布：核亮边疏 */
      var th = Math.random() * Math.PI * 2 + r * 1.35;     /* 拧出螺旋臂 */
      var x = Math.cos(th) * r;
      var z = Math.sin(th) * r * 0.35;                     /* 压扁成盘 */
      var y = (Math.random() - 0.5) * (1.0 / (0.6 + r * 0.5))
            + Math.sin(th * 2.0) * 0.06;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      tmp.copy(colA).lerp(colB, Math.min(1, Math.max(0, (r - 0.4) / 4.0)));
      if (Math.random() > 0.84) tmp.lerp(colC, 0.8);   /* 零星三色点缀 */
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var dotTex = softDotTex(64);
    var mat = new THREE.PointsMaterial({
      size: 0.082,
      map: dotTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true
    });
    group.add(new THREE.Points(geo, mat));

    /* 少量大光斑做景深：星云里的「大颗星星」 */
    var bPos = new Float32Array(16 * 3);
    var bCol = new Float32Array(16 * 3);
    for (var j = 0; j < 16; j++) {
      var br = 0.6 + Math.random() * 4.0;
      var bth = Math.random() * Math.PI * 2;
      bPos[j * 3] = Math.cos(bth) * br;
      bPos[j * 3 + 1] = (Math.random() - 0.5) * 0.8;
      bPos[j * 3 + 2] = Math.sin(bth) * br * 0.35;
      tmp.copy(j % 2 ? colB : colC).lerp(colA, Math.random() * 0.5);
      bCol[j * 3] = tmp.r;
      bCol[j * 3 + 1] = tmp.g;
      bCol[j * 3 + 2] = tmp.b;
    }
    var bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    group.add(new THREE.Points(bGeo, new THREE.PointsMaterial({
      size: 0.46,
      map: dotTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      sizeAttenuation: true
    })));

    group.rotation.x = NEBULA_RX;   /* 盘面斜过来，像掠过视线的梦 */
    group.rotation.z = NEBULA_RZ;
    group.position.set(-1.1, 0.35, -1.2);   /* 核偏左上：右侧留给深色 mock */

    function layout() {
      var k = Math.max(0.62, Math.min(1.05, view.w / 10.5));
      group.scale.setScalar(k);
    }

    function animate(t) {
      group.rotation.y = t * 0.05;
    }

    return {
      group: group, layout: layout, animate: animate,
      baseRX: NEBULA_RX, baseRZ: NEBULA_RZ
    };
  }

  /* ---------------- 组装 ---------------- */

  var built;
  try {
    built = sceneName === 'nebula' ? buildNebula() : buildCards();
    scene.add(built.group);
  } catch (err) { return; } /* 纹理/几何出错也乖乖回退 */

  /* 指针视差：目标值 + 平滑跟随；无指针时缓慢漂移 */
  var target = { x: 0.5, y: 0.5 };
  var cur = { x: 0.5, y: 0.5 };
  var hasPointer = false;
  hero.addEventListener('pointermove', function (e) {
    var rect = hero.getBoundingClientRect();
    target.x = (e.clientX - rect.left) / Math.max(1, rect.width);
    target.y = (e.clientY - rect.top) / Math.max(1, rect.height);
    hasPointer = true;
  });
  hero.addEventListener('pointerleave', function () { hasPointer = false; });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, canvas.clientWidth);
    var h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateView();
    built.layout();
  }

  var t = 10 + Math.random() * 20;  /* 随机相位：每次打开姿态不同 */
  var last = performance.now();

  function frame(now) {
    var dt = Math.min(Math.max((now - last) / 1000, 0), 0.06);
    last = now;
    t += dt * speed;
    if (!hasPointer && !reduceMotion) {
      target.x = 0.5 + 0.28 * Math.sin(t * 0.10);
      target.y = 0.5 + 0.18 * Math.sin(t * 0.07 + 1.3);
    }
    var k = Math.min(1, dt * 3.0);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    built.group.rotation.x += (built.baseRX + (cur.y - 0.5) * 0.30
      - built.group.rotation.x) * k;
    built.group.rotation.z += (built.baseRZ + (cur.x - 0.5) * 0.22
      - built.group.rotation.z) * k;
    built.animate(t);
    renderer.render(scene, camera);
  }

  try {
    resize();
  } catch (err) { return; }

  if (reduceMotion) {
    /* 静态一帧：构图依旧成立，但完全不动 */
    cur.x = target.x = 0.5;
    cur.y = target.y = 0.5;
    built.group.rotation.x = built.baseRX;
    built.group.rotation.z = built.baseRZ;
    built.animate(t);
    renderer.render(scene, camera);
    hero.classList.add('gl-3d');
    window.addEventListener('resize', resize);
    return;
  }

  frame(last); /* 先画一帧再揭开，避免黑闪 */
  hero.classList.add('gl-3d');
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

  /* 只在 Hero 可见时渲染 */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else stop();
    }).observe(hero);
  }
  start();
}
