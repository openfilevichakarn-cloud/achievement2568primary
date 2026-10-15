/* theme.js — สลับโหมดมืด/สว่าง (โหลดใน <head> เพื่อไม่ให้จอกระพริบ)
 * ค่าเริ่มต้นตามการตั้งค่าเครื่อง; กดปุ่ม [data-theme-toggle] เพื่อเลือกเอง (จำไว้ในเบราว์เซอร์นี้) */
(function () {
  'use strict';
  const KEY = 'pp_theme', root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const saved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const effective = () => root.dataset.theme || (mq && mq.matches ? 'dark' : 'light');
  function apply(t) {
    if (t === 'dark' || t === 'light') root.dataset.theme = t; else delete root.dataset.theme;
    const eff = effective();
    root.style.colorScheme = eff;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = eff === 'dark' ? '#14171d' : '#1f5eff';
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.textContent = eff === 'dark' ? '☀️' : '🌙';
      const label = eff === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
      b.title = label; b.setAttribute('aria-label', label);
    });
  }
  function toggle() {
    const next = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    apply(next);
  }
  apply(saved());
  if (mq && mq.addEventListener) mq.addEventListener('change', () => apply(saved()));
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (b) { e.preventDefault(); toggle(); } });
  document.addEventListener('DOMContentLoaded', () => apply(saved()));
  window.PPTheme = { toggle, apply, effective };
})();
