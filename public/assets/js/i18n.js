/* 中英双语切换：扫描页面上的 data-i18n-zh / data-i18n-en 属性并替换内容。
   默认中文；用户选择后通过 localStorage 记住。 */
(function () {
  'use strict';

  var KEY = 'site-lang';

  function store(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* 隐私模式等场景下忽略 */ }
  }

  function load() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply(lang) {
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');

    document.querySelectorAll('[data-i18n-zh]').forEach(function (el) {
      var value = el.getAttribute(lang === 'en' ? 'data-i18n-en' : 'data-i18n-zh');
      if (value !== null) el.innerHTML = value;
    });

    document.querySelectorAll('.lang-switch [data-lang]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    store(lang);
  }

  function init() {
    apply(load() || 'zh');
    document.querySelectorAll('.lang-switch [data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apply(btn.getAttribute('data-lang'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
