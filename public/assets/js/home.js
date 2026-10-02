/* ============================================================
   首页专属视觉增强（只有 index.html 引用）

   Hero 的 WebGL2 极光背景已抽到全站共享的 hero-gl.js
   （由 index.html 里的 canvas data 属性配置，此处不再管背景）。

   1. 工具卡片：鼠标聚光（写入 --mx / --my，CSS 侧画径向光斑）
   2. 工具卡片：滚动依次浮现（进完即摘类，把过渡还给卡片自身）
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- 1. 卡片鼠标聚光 ---------------- */

  var featured = document.querySelectorAll('.tool-card.featured');
  if (!reduceMotion) {
    featured.forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      });
    });
  }

  /* ---------------- 2. 滚动依次浮现 ---------------- */

  var gridCards = document.querySelectorAll('.tools-grid .tool-card');
  if (!reduceMotion && gridCards.length && 'IntersectionObserver' in window) {
    gridCards.forEach(function (card, i) {
      card.classList.add('reveal');
      card.style.setProperty('--rd', (i * 70) + 'ms');
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target;
        io.unobserve(card);
        card.classList.add('in');

        /* 浮现完成后摘掉类，把过渡还给卡片自身的 hover 效果 */
        var settled = false;
        var settle = function () {
          if (settled) return;
          settled = true;
          card.classList.remove('reveal', 'in');
          card.style.removeProperty('--rd');
        };
        card.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'transform') return;
          card.removeEventListener('transitionend', onEnd);
          settle();
        });
        setTimeout(settle, 1600);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });

    gridCards.forEach(function (card) { io.observe(card); });
  }
})();
