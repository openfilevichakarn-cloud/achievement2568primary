/* backend.js — เชื่อม Supabase ผ่าน RPC (ไม่ต้องใช้ SDK) + โหมดทดลองในเครื่อง
 * ตารางใน Supabase ปิดด้วย RLS ทั้งหมด เข้าถึงได้ผ่านฟังก์ชัน app_login / app_load / app_save เท่านั้น
 * โดยใช้ "รหัสสิทธิ์โรงเรียน" เป็นกุญแจ (เก็บเป็น hash ฝั่งเซิร์ฟเวอร์) */
(function (root) {
  'use strict';

  const norm = (code) => String(code || '').replace(/[\s-]/g, '').toUpperCase();

  class SupabaseBackend {
    constructor(cfg) { this.url = cfg.SUPABASE_URL.replace(/\/$/, ''); this.key = cfg.SUPABASE_ANON_KEY; this.demo = false; }
    async rpc(fn, body) {
      let res;
      try {
        res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: this.key, Authorization: 'Bearer ' + this.key },
          body: JSON.stringify(body),
        });
      } catch (e) { const err = new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้'); err.offline = true; throw err; }
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
      if (!res.ok) {
        const msg = (json && (json.message || json.hint)) || ('คำขอล้มเหลว (' + res.status + ')');
        const err = new Error(msg); err.status = res.status; throw err;
      }
      if (json && json.ok === false) { const err = new Error(json.error || 'ไม่สำเร็จ'); err.denied = true; throw err; }
      return json;
    }
    async login(code) { return this.rpc('app_login', { p_code: norm(code) }); }
    async load(code, grade) { return this.rpc('app_load', { p_code: norm(code), p_grade: grade }); }
    async save(code, grade, data, baseVersion, force) {
      return this.rpc('app_save', { p_code: norm(code), p_grade: grade, p_data: data, p_base_version: baseVersion, p_force: !!force });
    }
  }

  // โหมดทดลอง: เก็บในเบราว์เซอร์นี้เท่านั้น (ใช้ตอนยังไม่ได้ตั้งค่า Supabase)
  class DemoBackend {
    constructor() { this.demo = true; }
    async login(code) {
      if (norm(code) !== 'DEMO') throw new Error('โหมดทดลองใช้รหัส DEMO');
      return { ok: true, school_name: 'โรงเรียนตัวอย่าง (โหมดทดลอง)', grades: [1] };
    }
    async load(code, grade) {
      let raw = null; try { raw = localStorage.getItem('pp_demo_' + grade); } catch (e) { /* ignore */ }
      if (!raw) return { data: null, version: 0 };
      return JSON.parse(raw);
    }
    async save(code, grade, data, baseVersion) {
      const v = (baseVersion || 0) + 1;
      try { localStorage.setItem('pp_demo_' + grade, JSON.stringify({ data, version: v })); } catch (e) { /* ignore */ }
      return { ok: true, version: v };
    }
  }

  root.PPBackend = {
    create(cfg) {
      if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) return new SupabaseBackend(cfg);
      return new DemoBackend();
    },
    norm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
