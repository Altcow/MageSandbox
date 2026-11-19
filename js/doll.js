'use strict';
// ---- 3D 灰色人偶(設計_武器技能系統與火柴人角色 §1,取代 mage.js 的占位法師)----
// 程式生成一個蒙皮網格(膠囊 / 球合併、頂點色、每頂點 100% 綁一根骨),17 根骨,骨名照 Mixamo(mixamorig:Hips / Spine / Spine2 / Neck / Head / LeftArm …)。
// 對外介面完全沿用 Mage:root / yaw / weapon / setWeapon() / update(dt, anim) / tipWorld(out) / glow / shieldUp / spinY / opq / setOpacity /
//   setRobeColor(座位色飾件) / setClassLook(空實作) / setElementColor(杖頭色) / olReg / olUnreg;`const Mage = Doll` 讓 new Mage 呼叫處不用改。
// 新增:setLoadout(a, b, held)、swapHeld()(0.35 s 收 / 拔)、play(動作名)、stop()、hideWeapons(bool);動作資料在 poses.js。
// 載入順序:fx.js → poses.js → doll.js → world.js …
// ---- 角色描邊(反轉殼,畫質中 / 高才建立,設計_介面與畫風改版 §3-4)----
// 蒙皮人偶只有 1 個身體網格 → 外殼也只有 1 個(同骨架、頂點沿平均法線外推 OL_T);武器網格各掛一個殼。
// 只有 olReg() 登記過的人偶(本機與遠端玩家)會有殼;封面烘焙、分身模型不登記,不受影響。
const OL_GEO = new Map(), OL_SET = new Set(), OL_T = .02; let OL_ON = false;
function outlineGeo(g) {
  const key = g.parameters ? g.type + JSON.stringify(g.parameters) : g.uuid;
  let o = OL_GEO.get(key); if (o) return o;
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count, acc = new Map(), ks = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = ks[i] = Math.round(pos.getX(i) * 1e3) + ',' + Math.round(pos.getY(i) * 1e3) + ',' + Math.round(pos.getZ(i) * 1e3);
    let a = acc.get(k); if (!a) acc.set(k, a = [0, 0, 0]);
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = acc.get(ks[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = pos.getX(i) + a[0] / l * OL_T; out[i * 3 + 1] = pos.getY(i) + a[1] / l * OL_T; out[i * 3 + 2] = pos.getZ(i) + a[2] / l * OL_T;
  }
  o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.BufferAttribute(out, 3));
  if (g.attributes.skinIndex) { o.setAttribute('skinIndex', g.attributes.skinIndex); o.setAttribute('skinWeight', g.attributes.skinWeight); }
  if (g.index) o.setIndex(g.index.clone());
  OL_GEO.set(key, o); return o;
}
// 畫質切換(scenes.js applyQuality)呼叫:所有已登記的角色即時建立 / 移除外殼
function setOutlineAll(on) { on = !!on; if (on === OL_ON) return; OL_ON = on; OL_SET.forEach(m => m._olApply(on)); }

/* ---------- 骨架與網格(全人偶共用一份靜態資料) ---------- */
// 順序 = poses.js 的 POSE_BONES;[Mixamo 名, 父骨索引, 相對父骨位移]
const DOLL_BONES = [
  ['Hips', -1, [0, .95, 0]], ['Spine', 0, [0, .12, 0]], ['Spine2', 1, [0, .22, 0]], ['Neck', 2, [0, .20, 0]], ['Head', 3, [0, .08, 0]],
  ['LeftArm', 2, [.22, .14, 0]], ['LeftForeArm', 5, [.30, 0, 0]], ['LeftHand', 6, [.28, 0, 0]],
  ['RightArm', 2, [-.22, .14, 0]], ['RightForeArm', 8, [-.30, 0, 0]], ['RightHand', 9, [-.28, 0, 0]],
  ['LeftUpLeg', 0, [.1, -.05, 0]], ['LeftLeg', 11, [0, -.43, 0]], ['LeftFoot', 12, [0, -.43, 0]],
  ['RightUpLeg', 0, [-.1, -.05, 0]], ['RightLeg', 14, [0, -.43, 0]], ['RightFoot', 15, [0, -.43, 0]],
  ['Cape0', 2, [0, .17, -.17]], ['Cape1', 17, [0, -.32, 0]], ['Cape2', 18, [0, -.32, 0]], ['Cape3', 19, [0, -.32, 0]]   // 披風 4 段跟隨骨(索引 17~20,不在 POSE_BONES 內,由 _cape() 驅動)
];
const CAPE_B0 = 17;
// 座位色(1~12):名牌 / 編號 / 飾件 / 披風共用,remote.js 的 NAME_COLORS 同色
const SEAT_HEX = ['#ffd27a', '#8fd0ff', '#ff8a8a', '#b8f08a', '#ffa8e0', '#a8fff0', '#d0a8ff', '#ffe08a', '#8affb0', '#ff9a5a', '#9ab0ff', '#e0e0e0'];
function seatHex(seat) { return SEAT_HEX[(((seat | 0) || 1) - 1 + 120) % SEAT_HEX.length]; }
function mySeatHex() { return parseInt(seatHex(typeof Net !== 'undefined' && Net.me).slice(1), 16); }
const DOLL_BODY = 0xc9ccd2, DOLL_DARK = 0x23262e, DOLL_ACC = 0xffffff;
let DOLL_SH = null;
function dollCapGeo(r, len, seg, cap) {   // 沿 Y 軸、置中的膠囊(圓柱段長 len,兩端半球)
  const pts = [];
  for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + i / cap * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0, Math.cos(a) * r), -len / 2 + Math.sin(a) * r)); }
  for (let i = 0; i <= cap; i++) { const a = i / cap * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0, Math.cos(a) * r), len / 2 + Math.sin(a) * r)); }
  return new THREE.LatheGeometry(pts, seg);
}
function dollShared() {
  if (DOLL_SH) return DOLL_SH;
  const P = [], N = [], C = [], SI = [], SW = [], IX = [], acc = []; let nv = 0;
  const col = new THREE.Color(), YU = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3();
  const push = (geo, mat, bone, hex, isAcc) => {
    geo.applyMatrix4(mat); const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index, n = pos.count, st = nv; col.setHex(hex);
    for (let i = 0; i < n; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); C.push(col.r, col.g, col.b); SI.push(bone, 0, 0, 0); SW.push(1, 0, 0, 0); }
    for (let i = 0; i < idx.count; i++) IX.push(idx.getX(i) + nv);
    nv += n; if (isAcc) acc.push([st, nv]); geo.dispose();
  };
  const cap = (a, b, r, bone, hex, sx, sz, isAcc) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    Q.setFromUnitVectors(YU, d.normalize()); M4.compose(A.add(B).multiplyScalar(.5), Q, S1.set(sx || 1, 1, sz || 1));
    push(dollCapGeo(r, len, 8, 2), M4, bone, hex, isAcc);
  };
  const ball = (p, r, bone, hex, sx, sy, sz, isAcc) => { M4.compose(new THREE.Vector3(...p), Q.identity(), S1.set(sx || 1, sy || 1, sz || 1)); push(new THREE.SphereGeometry(r, 10, 7), M4, bone, hex, isAcc); };
  const ring = (y, r, h, bone, hex, sx, sz) => { M4.compose(new THREE.Vector3(0, y, 0), Q.identity(), S1.set(sx || 1, 1, sz || 1)); push(new THREE.CylinderGeometry(r, r, h, 16, 1, true), M4, bone, hex, true); };
  // 軀幹與頭(骨索引 = DOLL_BONES 順序)
  ball([0, .97, 0], .13, 0, DOLL_BODY, 1.25, 1, .9);
  ring(1.02, .14, .05, 0, DOLL_ACC, 1.2, .95);                          // 腰帶(座位色)
  cap([0, 1.05, 0], [0, 1.16, 0], .125, 1, DOLL_BODY, 1.2, .85);
  cap([0, 1.30, 0], [0, 1.40, 0], .15, 2, DOLL_BODY, 1.3, .85);
  cap([0, 1.50, 0], [0, 1.55, 0], .055, 3, DOLL_BODY);
  ball([0, 1.71, 0], .2, 4, DOLL_BODY);
  ring(1.75, .205, .06, 4, DOLL_ACC);                                    // 頭帶(座位色)
  ball([0, 1.71, .185], .07, 4, DOLL_DARK, 1.5, .9, .45);                // 面罩(看得出面向)
  for (const [sg, b0] of [[1, 5], [-1, 8]]) {   // 手臂:b0 = 上臂骨
    ball([sg * .22, 1.43, 0], .08, b0, DOLL_BODY);
    cap([sg * .27, 1.43, 0], [sg * .47, 1.43, 0], .052, b0, DOLL_BODY);
    ball([sg * .52, 1.43, 0], .05, b0 + 1, DOLL_BODY);
    cap([sg * .55, 1.43, 0], [sg * .75, 1.43, 0], .046, b0 + 1, DOLL_BODY);
    ball([sg * .85, 1.43, 0], .062, b0 + 2, DOLL_ACC, 1, 1, 1, true);   // 手套(座位色)
  }
  for (const [sg, b0] of [[1, 11], [-1, 14]]) {   // 腿:b0 = 大腿骨
    ball([sg * .1, .9, 0], .08, b0, DOLL_BODY);
    cap([sg * .1, .88, 0], [sg * .1, .52, 0], .075, b0, DOLL_BODY);
    ball([sg * .1, .47, 0], .065, b0 + 1, DOLL_BODY);
    cap([sg * .1, .43, 0], [sg * .1, .10, 0], .058, b0 + 1, DOLL_BODY);
    cap([sg * .1, .05, -.02], [sg * .1, .05, .1], .05, b0 + 2, 0x8a8f99, 1, 1);
  }
  // 披風(座位色,每人都有、與職業無關):兩片背靠背薄片(單面材質即可,不用 DoubleSide),5 列 x 5 行;列 r 綁 Cape(r-1) 骨,末列綁 Cape3
  {
    const R = [1.46, 1.14, .82, .50, .20], HW = [.30, .36, .42, .47, .52], COLS = 5, st = nv;
    for (let sheet = 0; sheet < 2; sheet++) {
      const base = nv, nz = sheet ? 1 : -1;
      for (let r = 0; r < 5; r++) for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1) * 2 - 1;
        P.push(u * HW[r], R[r], -.17 + .07 * u * u + (sheet ? .012 : 0)); N.push(0, 0, nz); C.push(1, 1, 1);
        SI.push(Math.max(0, r - 1) + CAPE_B0, 0, 0, 0); SW.push(1, 0, 0, 0);
      }
      nv += 5 * COLS;
      for (let r = 0; r < 4; r++) for (let c = 0; c < COLS - 1; c++) {
        const a = base + r * COLS + c, b = a + 1, cc = a + COLS, d = cc + 1;
        if (sheet) IX.push(a, cc, b, b, cc, d); else IX.push(a, b, cc, b, d, cc);
      }
    }
    acc.push([st, nv]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  geo.setIndex(IX.length > 65535 ? new THREE.Uint32BufferAttribute(IX, 1) : new THREE.Uint16BufferAttribute(IX, 1));
  return DOLL_SH = { geo, color: new Float32Array(C), acc, tris: IX.length / 3 };
}

/* ---------- 武器掛點(held = 手上、stow = 收在身上);位置 / 旋轉為該骨本地座標,可用 DOLL_MOUNT 即時調整 ---------- */
// 骨名用 poses.js 短名。手骨本地 x 軸沿前臂向遠端(左 +x、右 -x)。
const DOLL_MOUNT = {
  staff: { held: ['RHand', [-.06, 0, 0], [1.17, .19, .76]], stow: ['Hips', [-.17, .07, -.05], [-.5, 0, .35]] },
  book: { held: ['LHand', [.1, .05, .06], [-.32, -.34, -1.68]], stow: ['Hips', [.2, .05, .0], [0, 0, 0]] },
  bow: { held: ['LHand', [.05, 0, 0], [1.44, .6, .14]], stow: ['Chest', [0, .0, -.2], [0, 0, .35]] },
  sword: { held: ['RHand', [-.06, 0, 0], [1.11, .3, 1.07]], stow: ['Chest', [.13, -.3, -.2], [0, 0, .8]] },
  shield: { held: ['LFore', [.14, 0, .08], [-.4, .26, -1.25]], stow: ['Chest', [0, 0, -.24], [Math.PI / 2, Math.PI, 0]] },
  dagL: { held: ['LHand', [.04, 0, .02], [1.08, -.08, -1.63]], stow: ['Hips', [.1, .02, -.14], [0, 0, -1.2]] },
  dagR: { held: ['RHand', [-.04, 0, .02], [1.08, .08, 1.63]], stow: ['Hips', [-.1, .02, -.14], [0, 0, 1.2]] }
};
// 武器組成:各武器含哪些零件(零件名對 DOLL_MOUNT)與杖頭 / 弓尖 / 劍尖等發射點
const DOLL_WEAPONS = { staff: ['staff'], book: ['book'], bow: ['bow'], sword: ['sword'], swordShield: ['sword', 'shield'], daggers: ['dagL', 'dagR'] };
const DOLL_TIP = { staff: 'staff', book: 'book', bow: 'bow', sword: 'sword', swordShield: 'sword', daggers: 'dagR' };

class Doll {
  constructor(scene) {
    const sh = dollShared();
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.root.add(this.body); scene.add(this.root);
    this.yaw = 0; this.walkPh = 0; this.weapon = 'staff'; this.glow = 0; this.flip = 0; this.spinY = 0; this.shieldUp = 0; this.opq = 1; this.torsoK = 1; this.cls = 'mage';
    this._opA = undefined; this._olShells = null; this._elHex = 0xff7a1a; this._acc = DOLL_ACC;
    // 幾何:位置 / 法線 / 骨權重共用,顏色每隻自己一份(座位色飾件換色不影響別人)
    const g = new THREE.BufferGeometry();
    ['position', 'normal', 'skinIndex', 'skinWeight'].forEach(k => g.setAttribute(k, sh.geo.attributes[k])); g.setIndex(sh.geo.index);
    this._cArr = sh.color.slice(); this._cAttr = new THREE.BufferAttribute(this._cArr, 3); g.setAttribute('color', this._cAttr);
    // 材質:淺灰、微自發光、頂點色;邊緣光(fresnel)顏色 = 座位色(§2 對策 1、3)
    this._rimU = { value: new THREE.Color(0xffffff) };
    const mat = this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .72, metalness: .04, emissive: DOLL_BODY, emissiveIntensity: .12, skinning: true });   // three r128 蒙皮材質要明確開 skinning
    mat.onBeforeCompile = s => {
      s.uniforms.rimC = this._rimU;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 rimC;')
        .replace('#include <dithering_fragment>', 'float rimK = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  gl_FragColor.rgb += rimC * rimK * .5;\n#include <dithering_fragment>');
    };
    mat.customProgramCacheKey = () => 'dollrim';
    // 骨架
    this.bones = DOLL_BONES.map(([n, , o]) => { const b = new THREE.Bone(); b.name = 'mixamorig:' + n; b.position.set(o[0], o[1], o[2]); return b; });
    DOLL_BONES.forEach(([, p], i) => { if (p >= 0) this.bones[p].add(this.bones[i]); });
    this.mesh = new THREE.SkinnedMesh(g, mat); this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.add(this.bones[0]);
    this.body.add(this.mesh); this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones); this.mesh.bind(this.skeleton, this.mesh.matrixWorld);
    this.head = this.bones[POSE_IX.Head];   // status.js 麻痺抖動、cover_bg 轉頭
    this.B = {}; POSE_BONES.forEach((n, i) => { this.B[n] = this.bones[i]; });
    // 武器(用到才建)
    const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .6, metalness: .1 }, o || {}));
    this.wm = { wood: M(0x6b4423), gold: M(0xe0b04a, { metalness: .6, roughness: .35 }), steel: M(0xc8d0dc, { metalness: .7, roughness: .3 }), shield: M(0x8a2a2a), str: M(0xe8e0c8), cover: M(0x7a2331), pages: M(0xf3e8c8, { roughness: .9 }) };
    this.gemMat = new THREE.MeshStandardMaterial({ color: this._elHex, emissive: this._elHex, emissiveIntensity: .6, roughness: .2 });
    this.parts = {}; this.held = 'staff'; this.stow = null;   // held / stow = 武器鍵(見 DOLL_WEAPONS)
    this._pose = POSES.idle.slice(); this._lo = POSES.idle.slice(); this._up = POSES.idle.slice(); this._cs = POSES.idle.slice();
    this._clip = null; this._swap = null; this._swapT = 1; this._ly = null; this._cp = null; this._vy = 0; this._air = false; this._landT = 0; this._hidden = false; this._tilt = 0;
    this._mountAll();
  }
  /* ---------- 武器 ---------- */
  _part(n) {
    let p = this.parts[n]; if (p) return p;
    const W = this.wm, add = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; par.add(m); return m; };
    const o = new THREE.Group(), tip = new THREE.Object3D(); o.add(tip); p = { o, tip, bone: null };
    if (n === 'staff') {   // 短法杖:長約 .6 m,杖頭獨立發光(顏色隨選中法術屬性)
      add(new THREE.CylinderGeometry(.02, .026, .64, 8), W.wood, 0, .2, 0, o);
      add(new THREE.TorusGeometry(.06, .016, 6, 14), W.gold, 0, .52, 0, o).rotation.x = Math.PI / 2;
      add(new THREE.OctahedronGeometry(.07), this.gemMat, 0, .62, 0, o);
      p.glow = glowSprite(this._elHex, .5, 0); p.glow.position.y = .62; o.add(p.glow); tip.position.y = .65;
    } else if (n === 'book') {
      const bk = new THREE.Group(); o.add(bk); bk.rotation.x = -.3;
      add(new THREE.BoxGeometry(.3, .4, .03), W.cover, 0, .2, -.02, bk); add(new THREE.BoxGeometry(.27, .37, .03), W.pages, 0, .2, .005, bk);
      p.glow = glowSprite(this._elHex, .8, 0); p.glow.position.set(0, .3, .2); o.add(p.glow); tip.position.set(0, .45, .3);
    } else if (n === 'bow') {   // 弓:握把在原點,弓背朝 +z,弦在 -z 側
      const R = .5, arc = Math.PI * .8, geo = new THREE.TorusGeometry(R, .022, 6, 20, arc);
      geo.rotateZ(-arc / 2); geo.rotateY(-Math.PI / 2); geo.translate(0, 0, -R); add(geo, W.wood, 0, 0, 0, o);
      const zE = R * Math.cos(arc / 2) - R, yE = R * Math.sin(arc / 2);
      add(new THREE.BoxGeometry(.008, yE * 2, .008), W.str, 0, 0, zE, o); tip.position.set(0, 0, .5);
    } else if (n === 'sword') {
      add(new THREE.BoxGeometry(.06, .85, .018), W.steel, 0, .5, 0, o); add(new THREE.BoxGeometry(.26, .04, .05), W.gold, 0, .08, 0, o); add(new THREE.CylinderGeometry(.025, .025, .18, 8), W.wood, 0, -.02, 0, o); tip.position.y = .94;
    } else if (n === 'shield') {
      add(new THREE.CylinderGeometry(.34, .34, .05, 20), W.shield, 0, 0, 0, o); add(new THREE.TorusGeometry(.34, .025, 6, 20), W.gold, 0, .026, 0, o).rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(.08, 10, 8), W.gold, 0, .04, 0, o);
      
    } else {   // 匕首
      add(new THREE.BoxGeometry(.03, .32, .012), W.steel, 0, .2, 0, o); add(new THREE.BoxGeometry(.035, .08, .035), W.wood, 0, -.02, 0, o); tip.position.y = .38;
    }
    o.visible = false; this.parts[n] = p;
    if (this._opA !== undefined && this._opA < 1) this.setOpacity(this._opA);
    if (this._olShells) this._olAdd(o);
    return p;
  }
  // 掛上:mode = 'held' | 'stow' | null(收掉不顯示)
  _mountPart(n, mode) {
    const p = this._part(n); if (p.o.parent) p.o.parent.remove(p.o);
    if (!mode) { p.o.visible = false; return; }
    const m = DOLL_MOUNT[n][mode]; this.B[m[0]].add(p.o); p.o.position.set(m[1][0], m[1][1], m[1][2]); p.o.rotation.set(m[2][0], m[2][1], m[2][2]); p.o.scale.setScalar(1); p.o.visible = !this._hidden;
  }
  _mountAll() {
    const keep = {};
    (DOLL_WEAPONS[this.held] || []).forEach(n => { keep[n] = 'held'; });
    if (this.stow) (DOLL_WEAPONS[this.stow] || []).forEach(n => { if (!keep[n]) keep[n] = 'stow'; });
    for (const n in this.parts) if (!keep[n]) this._mountPart(n, null);
    for (const n in keep) this._mountPart(n, keep[n]);
    this.weapon = this.held; this._refreshGlow();
  }
  _refreshGlow() { this._glowParts = ['staff', 'book'].map(n => this.parts[n]).filter(Boolean); }
  // 舊介面:w = 手上武器;被換下的那把收到身上(換武動作 0.35 s)。instant = 直接換、不播動作
  setWeapon(w, instant) {
    if (!DOLL_WEAPONS[w]) w = 'staff';
    if (instant) { if (w !== this.held) { if (this.stow === w) this.stow = this.held; else this.stow = this.stow || (this.held !== w ? this.held : null); } this.held = w; this._swap = null; this._swapT = 1; this._mountAll(); return; }
    if (w === this.held || this._swap) return;
    this._swap = { from: this.held, to: w, t: 0, done: false };
  }
  // 配裝:a 在手上、b 收在身上(階段 2 loadout.js 呼叫);held = 0 / 1 決定誰在手上
  setLoadout(a, b, held) { if (held) { this.held = b; this.stow = a; } else { this.held = a; this.stow = b || null; } this._swap = null; this._mountAll(); }
  swapHeld() { if (this.stow && !this._swap) { this._swap = { from: this.held, to: this.stow, t: 0, done: false }; return true; } return false; }
  hideWeapons(h) { this._hidden = !!h; for (const n in this.parts) { const p = this.parts[n]; if (!h && p.o.parent) p.o.visible = true; else if (h) p.o.visible = false; } }
  _swapStep(dt) {
    const sw = this._swap; sw.t += dt / .35; const u = Math.min(1, sw.t);
    if (!sw.done && u >= .5) { sw.done = true; const old = this.held; this.stow = old; this.held = sw.to; this._mountAll(); (DOLL_WEAPONS[this.held] || []).forEach(n => { this.parts[n].o.scale.setScalar(.01); }); }
    if (sw.done) { const k = EASE.outBack(Math.min(1, (u - .5) * 2)); (DOLL_WEAPONS[this.held] || []).forEach(n => { const p = this.parts[n]; if (p) p.o.scale.setScalar(Math.max(.01, k)); }); }
    if (u >= 1) { (DOLL_WEAPONS[this.held] || []).forEach(n => { this.parts[n].o.scale.setScalar(1); }); this._swap = null; }
    return u;
  }
  /* ---------- 動作 ---------- */
  play(name, opt) {
    const c = ACT[name]; if (!c) return false;
    if (c.special === 'swap') return this.swapHeld();
    if (c.weapon && opt && opt.autoWeapon && !(this.held === c.weapon || (c.weapon === 'sword' && this.held === 'swordShield'))) this.setWeapon(c.weapon, true);
    this._clip = { c, t: opt && opt.t0 || 0, loop: opt && opt.loop != null ? !!opt.loop : !!c.loop, freeze: !!(opt && opt.freeze) }; return true;   // freeze:定格在 t0(調姿勢 / 截圖用)
  }
  stop() { this._clip = null; }
  // 依招式 kind 播通用備援動作
  playKind(kind) { return this.play(KIND_ACT[kind] || 'gen.slash'); }
  /* ---------- 相容介面 ---------- */
  setClassLook(cls) { this.cls = cls; }   // 人偶不分職業外型;職業差異 = 武器 + 座位色
  setRobeColor(hex) {   // 座位色飾件(頭帶 / 腰帶 / 手套)+ 邊緣光
    this._acc = hex; const c = new THREE.Color(hex), a = this._cArr; this._rimU.value.copy(c);
    DOLL_SH.acc.forEach(([s, e]) => { for (let i = s; i < e; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } }); this._cAttr.needsUpdate = true;
  }
  setElementColor(hex) {
    this._elHex = hex; this.gemMat.color.setHex(hex); this.gemMat.emissive.setHex(hex);
    for (const n of ['staff', 'book']) { const p = this.parts[n]; if (p && p.glow) p.glow.material.color.setHex(hex); }
  }
  tipWorld(out) {
    const p = this.parts[DOLL_TIP[this.held]];
    if (p) p.tip.getWorldPosition(out); else this.B.RHand.getWorldPosition(out);
    return out;
  }
  // 描邊:登記 / 取消登記(取消時一併移除外殼,remote.js destroy 在 dispose 前呼叫,避免釋放共用的殼幾何)
  olReg() { OL_SET.add(this); if (OL_ON) this._olApply(true); }
  olUnreg() { OL_SET.delete(this); this._olApply(false); }
  _olMake(o) {
    const sh = o.isSkinnedMesh ? new THREE.SkinnedMesh(outlineGeo(DOLL_SH.geo), this._olMat) : new THREE.Mesh(outlineGeo(o.geometry), this._olMat);
    sh.castShadow = sh.receiveShadow = false; sh.matrixAutoUpdate = false; sh.raycast = () => { }; sh.userData.ol = true; sh.frustumCulled = false;
    o.add(sh); if (o.isSkinnedMesh) sh.bind(o.skeleton, o.bindMatrix); return sh;
  }
  _olAdd(root) { root.traverse(o => { if (o.isMesh && !o.userData.ol && o.geometry.attributes.normal && !o.material.isMeshBasicMaterial) this._olShells.push(this._olMake(o)); }); }
  _olApply(on) {
    if (on === !!this._olShells) return;
    if (!on) { this._olShells.forEach(sh => { sh.parent.remove(sh); }); this._olShells = null; this._olMat.dispose(); this._olMat = null; return; }
    this._olMat = new THREE.MeshBasicMaterial({ color: 0x0b0f24, side: THREE.BackSide, skinning: true }); this._olMat.visible = this._opA === undefined || this._opA >= .999;
    this._olShells = []; this._olAdd(this.body);
  }
  // 潛行半透明(a:1 = 正常):只改身體的一般混合材質,加亮光暈不動
  setOpacity(a) {
    this._opA = a; if (this._olMat) this._olMat.visible = a >= .999;   // 描邊殼:半透明 / 潛行 / 閃爍時整個隱藏(不洩漏輪廓)
    this.body.traverse(o => {
      const m = o.material; if (!m || m.blending === THREE.AdditiveBlending || o.userData.ol) return;
      const u = m.userData; if (u.o0 === undefined) { u.o0 = m.opacity; u.t0 = m.transparent; u.d0 = m.depthWrite; }
      m.transparent = a < 1 || u.t0; m.opacity = u.o0 * a; m.depthWrite = a >= 1 ? u.d0 : false; o.castShadow = a >= 1;
    });
  }
  // 舊程式碼會直接取這些武器物件(skills.js 盾光暈;remote.js LOD)
  get shield() { return this._part('shield').o; }
  get sword() { return this._part('sword').o; }
  get staff() { return this._part('staff').o; }
  get bow() { return this._part('bow').o; }
  get book() { return this._part('book').o; }

  /* ---------- 披風:4 段彈簧跟隨(依 root 位移速度,飄向移動反方向;下落上揚、高速抖動;鏡頭太近時縮掉不擋視線) ---------- */
  _cape(dt, T) {
    const rp = this.root.position, bs = this.bones, c = this._cp || (this._cp = { x: rp.x, y: rp.y, z: rp.z, vf: 0, vl: 0, a: [0, 0, 0, 0], w: [0, 0, 0, 0], l: [0, 0, 0, 0], lw: [0, 0, 0, 0], k: 1 });
    let vx = 0, vy = 0, vz = 0;
    if (dt > 1e-4) { vx = (rp.x - c.x) / dt; vy = (rp.y - c.y) / dt; vz = (rp.z - c.z) / dt; if (Math.hypot(vx, vy, vz) > 30) vx = vy = vz = 0; }   // 傳送 / 瞬移不甩披風
    c.x = rp.x; c.y = rp.y; c.z = rp.z;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), kv = dt > 1e-4 ? Math.min(1, dt * 10) : 0;
    c.vf += (vx * sy + vz * cy - c.vf) * kv; c.vl += (vx * cy - vz * sy - c.vl) * kv;
    const spd = Math.min(1, Math.hypot(c.vf, c.vl) / 6), fall = Math.max(0, -vy) * .05;
    const tp = .1 + Math.max(-.15, Math.min(1.1, c.vf * .1)) + Math.min(.6, fall), tl = -c.vl * .08, st = Math.min(dt, .04);
    if (st > 1e-4) for (let i = 0; i < 4; i++) {
      const k = 90 / (1 + .5 * i), d = 1.1 * Math.sqrt(k), f = (.3 + spd) * .06 * Math.sin(T * 9 + i * 1.3), g = tp * (.4 + .22 * i) + f, h = tl * (.4 + .22 * i);
      c.w[i] += ((g - c.a[i]) * k - c.w[i] * d) * st; c.a[i] += c.w[i] * st;
      c.lw[i] += ((h - c.l[i]) * k - c.lw[i] * d) * st; c.l[i] += c.lw[i] * st;
    }
    for (let i = 0; i < 4; i++) { const b = bs[CAPE_B0 + i]; b.rotation.set(c.a[i] - (i ? c.a[i - 1] : 0), 0, c.l[i] - (i ? c.l[i - 1] : 0)); }
    // 鏡頭距離 < 1.5 m(第一人稱 / 穿模)縮成 0,1.5~3 m 漸出
    let k = 1; if (typeof camera !== 'undefined' && camera) { const p = camera.position, d = Math.hypot(p.x - rp.x, p.y - rp.y - 1.3, p.z - rp.z); k = Math.max(0, Math.min(1, (d - 1.5) / 1.5)); }
    if (k !== c.k) { c.k = k; bs[CAPE_B0].scale.setScalar(Math.max(.001, k)); }
  }
  /* ---------- 每幀 ---------- */
  // s: {move, cast(0..1), kick(0..1), charge(0..1), t, hover, roll, rollPhi, flip, sit, down, air?}
  update(dt, s) {
    this.root.rotation.y = this.yaw;
    const c = s.cast || 0, k = s.kick || 0, mv = s.move || 0, sit = s.sit || 0, dn = s.down || 0, T = s.t || 0, B = this.B, W = WPOSE[this.held] || WPOSE.staff;
    if (mv > .05) this.walkPh += dt * (4 + mv * 4);
    const sp = Math.min(mv, 1.4), a = Math.min(1, sp), run = Math.min(1, Math.max(0, (sp - .75) / .45)), ph = this.walkPh, sn = Math.sin(ph), cs = Math.cos(ph);
    // 空中判斷:本機給 s.air,遠端 / 影分身由高度變化推算(只用位置,不增加網路欄位)
    const y = this.root.position.y; let vy = 0;
    if (this._ly !== null && dt > 1e-4) vy = (y - this._ly) / dt; this._ly = y; this._vy += (vy - this._vy) * Math.min(1, dt * 14);
    const air = s.air !== undefined ? !!s.air : Math.abs(this._vy) > 3.2;
    if (this._air && !air) this._landT = .22; this._air = air; this._landT = Math.max(0, this._landT - dt);
    const rp = s.roll >= 0 ? s.roll : -1, fl = rp < 0 && s.flip >= 0 ? s.flip : -1;
    const lo = this._lo, up = this._up, out = this._pose, S = (n, x, yy, z) => { const i = POSE_IX[n] * 3; lo[i] = x; lo[i + 1] = yy; lo[i + 2] = z; }, H = POSE_N * 3;
    // 下半身:待機 / 走 / 跑 / 空中
    lo.set(POSES.idle);
    const th = (.3 + .38 * run) * a, kn = (.5 + .75 * run) * a;
    S('LThigh', -sn * th, 0, .03); S('RThigh', sn * th, 0, -.03); S('LShin', .08 * a + kn * Math.max(0, cs), 0, 0); S('RShin', .08 * a + kn * Math.max(0, -cs), 0, 0);
    lo[H + 1] = Math.abs(cs) * .035 * a - .02 * a * (1 + run) + Math.sin(T * 2) * .006;
    if (air && rp < 0 && fl < 0) poseMix(lo, this._vy > 0 ? POSES.jump : POSES.fall, 1, MASK.lower);
    else if (this._landT > 0) poseMix(lo, POSES.land, this._landT / .22 * .8, MASK.lower);
    // 上半身:武器持握 ready → prep(集氣 / 瞄準)→ burst(放開)
    up.set(W.ready); if (c > 0) poseMix(up, W.prep, c, MASK.upper); if (k > 0) poseMix(up, W.burst, Math.min(1, k * 1.2), MASK.upper);
    if (this.shieldUp > .01) { poseMix(up, SHIELD_UP, this.shieldUp, MASK.upper); }
    if (this.spinY) poseMix(up, ACT['sword.whirl']._p || (ACT['sword.whirl']._p = mkPose(ACT['sword.whirl'].keys[0][1])), 1, MASK.upper);
    const free = W.free, swing = (1 - c) * a * (.5 + .3 * run);
    if (!air) for (const side of free) { const j = POSE_IX[side + 'Arm'] * 3; up[j] += (side === 'L' ? sn : -sn) * swing; }
    out.set(lo); poseMix(out, up, 1, MASK.upper);
    const i2 = POSE_IX.Spine * 3, i3 = POSE_IX.Chest * 3, i4 = POSE_IX.Head * 3;
    out[i2] += .06 * a + .1 * run; out[i2 + 1] += -sn * .1 * a; out[i3 + 1] += sn * .08 * a; out[i3] += Math.sin(T * 2) * .012;
    if (c > .5 && s.charge > .98) { out[i2] += Math.sin(T * 40) * .015; }   // 集氣滿時顫動
    // 換武:手上武器那隻手收到肩後 → 另一把拔出(0.35 s)
    if (this._swap) {
      const f = this._swap.from, to = this._swap.to, u = this._swapStep(dt), w1 = u < .5 ? EASE.outQuad(u * 2) : 0, w2 = u >= .5 ? EASE.inOutQuad(1 - (u - .5) * 2) : 0;
      poseMix(out, SWAP_BACK[SWAP_HAND[f] || 'R'], w1, MASK.upper); poseMix(out, SWAP_BACK[SWAP_HAND[to] || 'R'], w2, MASK.upper);
    }
    // 片段(P 面板 / 受擊 / 之後的招式動作)
    let tiltK = 0, clipTilt = 0;
    if (this._clip) {
      const cl = this._clip, cp = cl.c; if (!cl.freeze) cl.t += dt;
      const hold = cp.bodyTilt > 0, end = !cl.loop && !hold && cl.t >= cp.dur;
      if (end) this._clip = null; else {
        const tt = hold ? Math.min(cl.t, cp.dur) : cl.t; clipSample(cp, tt, this._cs);
        const wIn = Math.min(1, cl.t / .06), wOut = cl.loop || hold ? 1 : Math.min(1, (cp.dur - cl.t) / .08), w = Math.max(0, Math.min(wIn, wOut));
        poseMix(out, this._cs, w, MASK[cp.mask]); if (cp.bodyTilt) clipTilt = (cp.bodyTilt > 0 ? EASE.outQuad(Math.min(1, cl.t / cp.dur)) : 1 - EASE.inOutQuad(Math.min(1, cl.t / cp.dur))) * w;
      }
    }
    // 翻滾 / 空翻:閃避姿勢(依 roll.phi 分前 / 後 / 左 / 右);空翻 = 縮身 + 身體繞中心轉一圈(沿用 flip 進度)
    if (rp >= 0) {
      const ph2 = s.rollPhi || 0, ap = Math.abs(ph2), nm = ap < Math.PI / 4 ? 'dodgeFwd' : (ap > Math.PI * .75 ? 'dodgeBack' : (ph2 > 0 ? 'dodgeLeft' : 'dodgeRight'));
      clipSample(ACT[nm], rp * ACT[nm].dur, this._cs); poseMix(out, this._cs, 1, MASK.full);
    } else if (fl >= 0) { poseMix(out, POSES.tuck, Math.min(1, Math.sin(Math.PI * Math.min(1, fl)) * 2), MASK.full); }
    if (sit > 0) poseMix(out, POSES.sit, sit, MASK.full);
    tiltK = Math.max(dn, clipTilt); if (dn > 0) poseMix(out, POSES.down, dn, MASK.full);
    // 套到骨頭
    for (let i = 0; i < POSE_N; i++) this.bones[i].rotation.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    this.bones[0].position.set(out[H], .95 + out[H + 1], out[H + 2]);
    // 整個身體:旋風 / 倒地 / 空翻
    const bd = this.body; bd.position.set(0, (s.hover || 0), 0); bd.rotation.set(-1.45 * tiltK, this.spinY, 0); bd.position.y += .14 * tiltK;
    if (fl >= 0) {
      const ax = new V3(1, 0, 0); bd.quaternion.setFromAxisAngle(ax, Math.PI * 2 * fl);
      const c0 = new V3(0, .9, 0); bd.position.copy(c0).sub(c0.clone().applyQuaternion(bd.quaternion)); bd.position.y += .25 * Math.sin(Math.PI * fl);
    }
    this._cape(dt, T);
    // 杖頭 / 書發光(集氣中 glow 隨 auraAmt)
    const g = this.glow; this.gemMat.emissiveIntensity = .6 + g * 3;
    for (const p of this._glowParts) { p.glow.material.opacity = g * .9; p.glow.scale.setScalar(p === this.parts.staff ? .5 + g * 1.4 : .6 + g * 1.5); }
  }
}
const SHIELD_UP = mkPose(PZ(arm('L', 1.35, .3, 1.25)));
const Mage = Doll;   // 相容:舊程式 new Mage(scene)

/* ---------- P 面板:人偶動作預覽(對稻草人 / 自己播放任一動作) ---------- */
function dollBuildPanel(root) {
  const h = document.createElement('h4'); h.textContent = '人偶動作預覽'; root.appendChild(h);
  const mk = (label, el) => { const row = document.createElement('div'); row.className = 'row'; const lab = document.createElement('label'); lab.textContent = label; row.appendChild(lab); row.appendChild(el); root.appendChild(row); return el; };
  const sel = (opts) => { const s = document.createElement('select'); s.style.cssText = 'flex:1;min-width:0'; opts.forEach(o => { const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); }); return s; };
  const WN = [['staff', '短法杖'], ['sword', '長劍'], ['swordShield', '劍盾'], ['bow', '長弓'], ['daggers', '雙匕首'], ['book', '魔法書']];
  const tgt = mk('對象', sel([['dummy', '稻草人(換成人偶)'], ['self', '自己']]));
  const wa = mk('手上武器', sel(WN)), wb = mk('背上武器', sel([['', '(無)']].concat(WN))); wb.value = 'sword';
  const act = document.createElement('select'); act.style.cssText = 'flex:1;min-width:0';
  CLIP_GROUPS.forEach(g => { const og = document.createElement('optgroup'); og.label = g.name; g.list.forEach(n => { const op = document.createElement('option'); op.value = n; op.textContent = n; og.appendChild(op); }); act.appendChild(og); });
  mk('動作', act); act.value = 'sword.slash1';
  const loop = document.createElement('input'); loop.type = 'checkbox'; mk('循環播放', loop);
  const btns = document.createElement('div'); btns.className = 'row'; root.appendChild(btns);
  const B = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.style.marginTop = '2px'; b.onclick = f; btns.appendChild(b); return b; };
  let pv = null, raf = 0, hid = null, t0 = 0;
  const loopFn = now => {
    if (!pv) return; const dt = Math.min(.05, (now - t0) / 1000); t0 = now;
    pv.update(dt, { move: 0, cast: 0, kick: 0, charge: 0, t: now / 1000, hover: 0, roll: -1, flip: -1, sit: 0, down: 0 }); raf = requestAnimationFrame(loopFn);
  };
  const clear = () => { if (pv) { cancelAnimationFrame(raf); scene.remove(pv.root); pv.root.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); }); pv = null; } if (hid) { hid.g.visible = true; hid.bar.visible = false; hid = null; } };
  const who = () => {
    if (tgt.value === 'self') { clear(); return mage; }
    if (!pv) {
      const d = DUMMIES[0]; hid = d; d.g.visible = false; pv = new Mage(scene); pv.setRobeColor(0x5ac8ff);
      pv.root.position.set(d.x, 0, d.z); pv.yaw = Math.atan2(mage.root.position.x - d.x, mage.root.position.z - d.z); t0 = performance.now(); raf = requestAnimationFrame(loopFn);
    }
    pv.root.position.y = typeof terrainH === 'function' ? terrainH(pv.root.position.x, pv.root.position.z) : 0;
    return pv;
  };
  const applyLoadout = () => { const m = who(); m.setLoadout(wa.value, wb.value || null, 0); return m; };
  B('套用配裝', applyLoadout);
  B('換武', () => { const m = who(); if (!m.swapHeld()) { m.setLoadout(wa.value, wb.value || null, 0); m.swapHeld(); } });
  B('播放', () => { const m = who(); const c = ACT[act.value]; if (c && c.weapon && m.held !== c.weapon && !(c.weapon === 'sword' && m.held === 'swordShield')) { wa.value = c.weapon; m.setLoadout(c.weapon, wb.value === c.weapon ? '' : (wb.value || null), 0); } m.play(act.value, { loop: loop.checked }); });
  B('停止', () => { if (pv) pv.stop(); mage.stop(); });
  B('復位', () => { mage.stop(); clear(); });
  const note = document.createElement('div'); note.style.cssText = 'color:#aaa;margin-top:4px'; note.textContent = '播放時會自動換上該動作的武器;只影響外觀,不動遊戲配裝。'; root.appendChild(note);
}
