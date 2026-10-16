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
    async load(code, grade, room) { return this.rpc('app_load', { p_code: norm(code), p_grade: grade, p_room: room || 1 }); }
    async save(code, grade, room, data, baseVersion, force) {
      return this.rpc('app_save', { p_code: norm(code), p_grade: grade, p_room: room || 1, p_data: data, p_base_version: baseVersion, p_force: !!force });
    }
    async deleteRoom(code, grade, room) { return this.rpc('app_delete_room', { p_code: norm(code), p_grade: grade, p_room: room }); }
    async setLogo(code, logo) { return this.rpc('app_set_logo', { p_code: norm(code), p_logo: logo || null }); }
  }

  // โหมดทดลอง: เก็บในเบราว์เซอร์นี้เท่านั้น (ใช้ตอนยังไม่ได้ตั้งค่า Supabase)
  // เว็บตัวอย่าง (PP_CONFIG.SAMPLE_DIR): ครั้งแรกโหลดข้อมูลตัวอย่างจาก sample/pN.json แล้วเก็บการแก้ไขไว้ในเบราว์เซอร์
  class DemoBackend {
    constructor(cfg) { this.demo = true; this.cfg = cfg || {}; this.prefix = this.cfg.SAMPLE_DIR ? 'pp_sample_' : 'pp_demo_'; }
    key(grade, room) { return this.prefix + grade + (room > 1 ? '_' + room : ''); }   // ห้อง 1 ใช้คีย์เดิม (รายชั้น)
    ls(fn) { try { return fn(localStorage); } catch (e) { return null; } }
    async login(code) {
      if (norm(code) !== 'DEMO') throw new Error('โหมดทดลองใช้รหัส DEMO');
      const grades = this.cfg.GRADES_READY || [1], rooms = [];
      this.ls((st) => { for (const g of grades) for (let r = 1; r <= 10; r++) if (st.getItem(this.key(g, r)) !== null) rooms.push({ grade: g, room: r }); });
      if (this.cfg.SAMPLE_DIR) for (const g of grades) if (!rooms.some(x => x.grade === g) && !this.ls(st => st.getItem(this.prefix + 'del_' + g))) rooms.push({ grade: g, room: 1 });
      return { ok: true, school_name: this.cfg.DEMO_SCHOOL || 'โรงเรียนตัวอย่าง (โหมดทดลอง)', grades, rooms, logo: this.ls(st => st.getItem(this.prefix + 'logo')) };
    }
    async load(code, grade, room) {
      const raw = this.ls(st => st.getItem(this.key(grade, room || 1)));
      if (raw) return JSON.parse(raw);
      if (this.cfg.SAMPLE_DIR && (room || 1) === 1 && !this.ls(st => st.getItem(this.prefix + 'del_' + grade))) {   // ข้อมูลตัวอย่างมีเฉพาะห้อง 1
        const res = await fetch(this.cfg.SAMPLE_DIR + '/p' + grade + '.json?v=' + (this.cfg.BUILD || ''));
        if (res.ok) return { data: await res.json(), version: 0 };
      }
      return { data: null, version: 0 };
    }
    async save(code, grade, room, data, baseVersion) {
      const v = (baseVersion || 0) + 1;
      this.ls(st => st.setItem(this.key(grade, room || 1), JSON.stringify({ data, version: v })));
      return { ok: true, version: v };
    }
    async deleteRoom(code, grade, room) {
      this.ls(st => { st.removeItem(this.key(grade, room)); if (room === 1) st.setItem(this.prefix + 'del_' + grade, '1'); });
      return { ok: true };
    }
    async setLogo(code, logo) { this.ls(st => logo ? st.setItem(this.prefix + 'logo', logo) : st.removeItem(this.prefix + 'logo')); return { ok: true }; }
    reset() { this.ls(st => Object.keys(st).filter(k => k.startsWith(this.prefix) || k.startsWith('pp_draft_')).forEach(k => st.removeItem(k))); }
  }

  root.PPBackend = {
    create(cfg) {
      if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) return new SupabaseBackend(cfg);
      return new DemoBackend(cfg);
    },
    norm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
