'use strict';
// ---- 角色描邊(反轉殼,畫質中 / 高才建立,設計_介面與畫風改版 §3-4)----
// 每個身體網格底下掛一個子殼:頂點沿「依位置合併後的平均法線」外推 OL_T、只畫背面、純深色;殼不投影、不參與射線。
// 殼是網格的子物件 → 職業外型 / 武器切換的 visible 自動跟著;外推量寫在殼幾何裡(角色本地單位),不隨鏡頭距離變。
// 只有 olReg() 登記過的 Mage(本機與遠端玩家)會有殼;封面烘焙、分身模型不登記,不受影響。
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
  if (g.index) o.setIndex(g.index.clone());
  OL_GEO.set(key, o); return o;
}
// 畫質切換(scenes.js applyQuality)呼叫:所有已登記的角色即時建立 / 移除外殼
function setOutlineAll(on) { on = !!on; if (on === OL_ON) return; OL_ON = on; OL_SET.forEach(m => m._olApply(on)); }
// 占位法師(程式生成)。之後換成 GLB 模型時,只要保留這些介面:
//   root / yaw / weapon / setWeapon() / update(dt, anim) / tipWorld(out) / glow
class Mage {
  constructor(scene) {
    const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .75, metalness: .05 }, o || {}));
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.root.add(this.body); scene.add(this.root);
    this.yaw = 0; this.walkPh = 0; this.weapon = 'staff'; this.glow = 0; this.swap = 1; this.flip = 0;
    this.spinY = 0; this.shieldUp = 0; this.opq = 1;   // 旋風斬轉身 / 衝鋒盾舉盾 / 潛行透明度(classes.js classTick 每幀寫入)
    const robe = M(0x3a3f9c), robe2 = M(0x2a2e78), gold = M(0xe0b04a, { metalness: .6, roughness: .35 });
    this.robeM = robe; this.robe2M = robe2;   // 職業袍色用
    const skin = M(0xf1c9a5), hair = M(0xe9ecff), boot = M(0x5a3a22), dark = new THREE.MeshBasicMaterial({ color: 0x151525 });
    const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (parent || this.body).add(m); return m; };
    const robeLow = add(new THREE.CylinderGeometry(.27, .52, .95, 24), robe, 0, .7, 0);
    const hemRing = add(new THREE.TorusGeometry(.515, .03, 8, 32), gold, 0, .24, 0); hemRing.rotation.x = Math.PI / 2;
    const robeUp = add(new THREE.CylinderGeometry(.24, .29, .42, 20), robe, 0, 1.33, 0);
    const collar = add(new THREE.TorusGeometry(.28, .035, 8, 24), gold, 0, 1.14, 0); collar.rotation.x = Math.PI / 2;
    const shoulders = add(new THREE.SphereGeometry(.3, 16, 12), robe2, 0, 1.5, -.02); shoulders.scale.set(1.1, .45, .85);
    this.head = new THREE.Group(); this.head.position.set(0, 1.72, 0); this.body.add(this.head);
    const mageHead = new THREE.Group(); this.head.add(mageHead);
    add(new THREE.SphereGeometry(.24, 24, 18), skin, 0, 0, 0, this.head);
    add(new THREE.SphereGeometry(.255, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, .02, -.03, mageHead);
    add(new THREE.SphereGeometry(.2, 16, 12), hair, 0, -.12, -.15, mageHead).scale.set(.95, 1.2, .6);
    add(new THREE.SphereGeometry(.035, 8, 8), dark, .085, -.01, .215, this.head);
    add(new THREE.SphereGeometry(.035, 8, 8), dark, -.085, -.01, .215, this.head);
    add(new THREE.CylinderGeometry(.46, .46, .035, 28), robe2, 0, .2, 0, mageHead);
    add(new THREE.TorusGeometry(.285, .02, 6, 24), gold, 0, .24, 0, mageHead).rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.28, .62, 24), robe2, 0, .52, 0, mageHead).rotation.x = -.15;
    add(new THREE.ConeGeometry(.12, .3, 16), robe2, 0, .88, -.1, mageHead).rotation.x = -.55;
    this.feet = [-1, 1].map(s => { const f = add(new THREE.SphereGeometry(.12, 12, 10), boot, s * .15, .1, .05); f.scale.set(1, .7, 1.5); return f; });
    // 手臂:side=+1 為角色左手(x+),-1 為右手
    this.arms = [1, -1].map(side => {
      const sh = new THREE.Group(); sh.position.set(side * .33, 1.45, 0); this.body.add(sh);
      add(new THREE.SphereGeometry(.1, 12, 10), robe, 0, 0, 0, sh);
      add(new THREE.CylinderGeometry(.09, .1, .33, 12), robe, 0, -.165, 0, sh);
      const el = new THREE.Group(); el.position.y = -.33; sh.add(el);
      add(new THREE.SphereGeometry(.095, 10, 8), robe, 0, 0, 0, el);
      add(new THREE.CylinderGeometry(.1, .15, .32, 14), robe2, 0, -.16, 0, el);
      add(new THREE.SphereGeometry(.07, 12, 10), skin, 0, -.36, 0, el);
      const hand = new THREE.Object3D(); hand.position.y = -.36; el.add(hand);
      return { sh, el, hand, side };
    });
    this.armL = this.arms[0]; this.armR = this.arms[1];
    // 法杖
    this.staff = new THREE.Group(); this.body.add(this.staff);
    const wood = M(0x6b4423);
    add(new THREE.CylinderGeometry(.03, .04, 2.1, 10), wood, 0, .35, 0, this.staff);
    add(new THREE.TorusGeometry(.13, .025, 8, 20), gold, 0, 1.42, 0, this.staff);
    this.gemMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a10, emissiveIntensity: .6, roughness: .2 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.1), this.gemMat); gem.position.y = 1.45; this.staff.add(gem);
    this.staffGlow = glowSprite(0xff8a2a, .6, 0); this.staffGlow.position.y = 1.45; this.staff.add(this.staffGlow);
    this.tipAnchor = new THREE.Object3D(); this.tipAnchor.position.y = 1.5; this.staff.add(this.tipAnchor);
    // 魔法書(書頁朝 +z)
    this.book = new THREE.Group(); this.body.add(this.book);
    const cover = M(0x7a2331), pages = M(0xf3e8c8, { roughness: .9 });
    this.halves = [1, -1].map(sg => {
      const h = new THREE.Group(); this.book.add(h);
      const c = new THREE.Mesh(new THREE.BoxGeometry(.3, .42, .02), cover); c.position.set(sg * .15, 0, -.015); c.castShadow = true; h.add(c);
      const p = new THREE.Mesh(new THREE.BoxGeometry(.28, .4, .025), pages); p.position.set(sg * .15, 0, .005); h.add(p);
      return h;
    });
    this.flipPage = new THREE.Mesh(new THREE.BoxGeometry(.28, .4, .004), pages); this.flipPage.position.set(.14, 0, .02);
    this.flipGrp = new THREE.Group(); this.flipGrp.add(this.flipPage); this.book.add(this.flipGrp);
    this.bookGlow = glowSprite(0xff8a2a, .9, 0); this.bookGlow.position.set(0, .1, .2); this.book.add(this.bookGlow);
    this.orbAnchor = new THREE.Object3D(); this.orbAnchor.position.set(0, .42, .32); this.book.add(this.orbAnchor);
    // 職業武器掛件(程式模型;動作為佔位,D2~D4 細化)
    const steel = M(0xc8d0dc, { metalness: .7, roughness: .3 }), shieldM = M(0x8a2a2a), str = M(0xe8e0c8);
    this.bow = new THREE.Group(); this.body.add(this.bow);
    add(new THREE.TorusGeometry(.55, .025, 6, 24, Math.PI * 1.1), wood, 0, 0, 0, this.bow).rotation.set(0, Math.PI / 2, Math.PI * .45);
    add(new THREE.BoxGeometry(.008, 1.08, .008), str, 0, 0, -.086, this.bow);
    add(new THREE.CylinderGeometry(.012, .012, .75, 6), wood, 0, 0, .29, this.bow).rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.035, .12, 6), steel, 0, 0, .72, this.bow).rotation.x = Math.PI / 2;
    this.bowTip = new THREE.Object3D(); this.bowTip.position.set(0, 0, .8); this.bow.add(this.bowTip);
    this.sword = new THREE.Group(); this.body.add(this.sword);
    add(new THREE.BoxGeometry(.06, .85, .018), steel, 0, .42, 0, this.sword);
    add(new THREE.BoxGeometry(.26, .04, .05), gold, 0, .02, 0, this.sword);
    add(new THREE.CylinderGeometry(.025, .025, .18, 8), wood, 0, -.09, 0, this.sword);
    this.swordTip = new THREE.Object3D(); this.swordTip.position.y = .86; this.sword.add(this.swordTip);
    this.shield = new THREE.Group(); this.body.add(this.shield);
    add(new THREE.CylinderGeometry(.42, .42, .06, 24), shieldM, 0, 0, 0, this.shield).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(.42, .03, 6, 24), gold, 0, 0, .03, this.shield);
    add(new THREE.SphereGeometry(.1, 10, 8), gold, 0, 0, .05, this.shield);
    this.daggers = [0, 1].map(() => {
      const g = new THREE.Group(); this.body.add(g);
      add(new THREE.BoxGeometry(.03, .32, .012), steel, 0, .16, 0, g);
      add(new THREE.BoxGeometry(.035, .08, .035), wood, 0, -.04, 0, g);
      return g;
    });
    this.dagTip = new THREE.Object3D(); this.dagTip.position.y = .32; this.daggers[1].add(this.dagTip);
    // 職業外型(每職業一組 Group,只建一次;切換只改 visible 與軀幹寬度,見 setClassLook)
    const grp = parent => { const g = new THREE.Group(); (parent || this.body).add(g); return g; };
    const leather = M(0x6b4a2a), pants = M(0x2e2620), black = M(0x17141d), cloth = M(0x1a1620), red = M(0xc0281e), plate = M(0x9aa3b2, { metalness: .6, roughness: .4 }), tail = M(0x3d1f6e);
    this.robeLow = robeLow; this.hemRing = hemRing;
    this.torso = [robeLow, hemRing, robeUp, collar, shoulders];
    this.torso.forEach(m => { m.userData.bx = m.scale.x; m.userData.bz = m.scale.z; });
    // 弓箭手:綠兜帽、短束腰袍、深色褲、背後箭袋、皮護腕
    const archerH = grp(this.head), archerB = grp(), archerArm = this.arms.map(a => grp(a.el));
    add(new THREE.SphereGeometry(.275, 20, 12, 0, Math.PI * 2, 0, Math.PI * .42), robe, 0, .01, 0, archerH);
    add(new THREE.SphereGeometry(.29, 18, 12, Math.PI * .8, Math.PI * 1.4, Math.PI * .3, Math.PI * .45), robe2, 0, -.02, 0, archerH);
    const quiver = new THREE.Group(); quiver.position.set(.14, 1.12, -.25); quiver.rotation.z = -.3; archerB.add(quiver);
    add(new THREE.CylinderGeometry(.075, .085, .55, 12), leather, 0, 0, 0, quiver);
    const fletch = new THREE.ConeGeometry(.024, .12, 4);
    [-.04, 0, .05].forEach(x => add(fletch, str, x, .33, 0, quiver));
    add(new THREE.CylinderGeometry(.27, .36, .5, 20), robe, 0, .9, 0, archerB);
    add(new THREE.TorusGeometry(.31, .03, 8, 24), leather, 0, 1.0, 0, archerB).rotation.x = Math.PI / 2;
    [-.13, .13].forEach(x => add(new THREE.CylinderGeometry(.085, .075, .55, 12), pants, x, .42, 0, archerB));
    archerArm.forEach(g => add(new THREE.CylinderGeometry(.142, .142, .12, 12), leather, 0, -.2, 0, g));
    // 劍士:鐵盔、面甲縫隙、紅羽飾、肩甲、銀灰胸甲、紅披風
    const swH = grp(this.head), swB = grp(), swS = this.arms.map(a => grp(a.sh));
    add(new THREE.SphereGeometry(.28, 20, 12, 0, Math.PI * 2, 0, Math.PI * .5), steel, 0, .02, 0, swH);
    add(new THREE.TorusGeometry(.28, .02, 6, 24), steel, 0, .02, 0, swH).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(.24, .014, .03), dark, 0, .035, .272, swH);
    add(new THREE.ConeGeometry(.045, .3, 6), red, 0, .33, -.08, swH).rotation.x = -.35;
    swS.forEach(g => add(new THREE.SphereGeometry(.15, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), steel, 0, .02, 0, g));
    add(new THREE.CylinderGeometry(.33, .35, .42, 18, 1, true), plate, 0, 1.2, 0, swB);
    add(new THREE.BoxGeometry(.42, .7, .03), robe, 0, 1.12, -.36, swB);
    // 刺客:深紫兜帽、黑面罩(露眼)、短外套、長圍巾、腰後雙刀
    const asH = grp(this.head), asB = grp();
    add(new THREE.SphereGeometry(.275, 20, 12, 0, Math.PI * 2, 0, Math.PI * .45), robe2, 0, .01, 0, asH);
    add(new THREE.SphereGeometry(.29, 18, 12, Math.PI * .8, Math.PI * 1.4, Math.PI * .3, Math.PI * .45), robe2, 0, -.02, 0, asH);
    add(new THREE.SphereGeometry(.252, 16, 8, 0, Math.PI * 2, Math.PI * .58, Math.PI * .26), cloth, 0, 0, 0, asH);
    add(new THREE.TorusGeometry(.25, .045, 8, 20), tail, 0, 1.45, 0, asB).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(.1, .7, .03), tail, 0, 1.1, -.36, asB);
    add(new THREE.CylinderGeometry(.25, .28, .5, 16), robe, 0, .9, 0, asB);
    [-.12, .12].forEach(x => add(new THREE.CylinderGeometry(.07, .065, .55, 10), black, x, .42, 0, asB));
    [-1, 1].forEach(s => {
      add(new THREE.BoxGeometry(.04, .3, .012), steel, s * .11, .98, -.29, asB).rotation.x = -.15;
      add(new THREE.BoxGeometry(.05, .08, .045), wood, s * .11, 1.17, -.29, asB);
    });
    this.looks = { mage: [mageHead], archer: [archerH, archerB, ...archerArm], swordsman: [swH, swB, ...swS], assassin: [asH, asB] };
    this.setWeapon('staff', true);
    this.setClassLook('mage');
  }
  setWeapon(w, instant) {
    this.weapon = w; if (!instant) this.swap = 0; this.staff.visible = w === 'staff'; this.book.visible = w === 'book';
    this.bow.visible = w === 'bow'; this.sword.visible = w === 'swordShield'; this.shield.visible = w === 'swordShield';
    this.daggers.forEach(g => { g.visible = w === 'daggers'; });
  }
  // 職業外型:切換各職業 Group 的可見性;軀幹寬度(弓箭手較輕、劍士較壯、刺客較瘦),只改 x/z 不動 y(腳與碰撞基準不變)
  setClassLook(cls) {
    const look = this.looks[cls] ? cls : 'mage';
    for (const c in this.looks) this.looks[c].forEach(g => { g.visible = c === look; });
    const k = { mage: 1, archer: .92, swordsman: 1.12, assassin: .85 }[look]; this.torsoK = k;
    this.torso.forEach(m => { m.scale.x = m.userData.bx * k; m.scale.z = m.userData.bz * k; });
    this.robeLow.visible = this.hemRing.visible = look === 'mage' || look === 'swordsman';
  }
  // 描邊:登記 / 取消登記(取消時一併移除外殼,remote.js destroy 在 dispose 前呼叫,避免釋放共用的殼幾何)
  olReg() { OL_SET.add(this); if (OL_ON) this._olApply(true); }
  olUnreg() { OL_SET.delete(this); this._olApply(false); }
  _olApply(on) {
    if (on === !!this._olShells) return;
    if (!on) { this._olShells.forEach(sh => { sh.parent.remove(sh); }); this._olShells = null; this._olMat.dispose(); this._olMat = null; return; }
    const mat = this._olMat = new THREE.MeshBasicMaterial({ color: 0x0b0f24, side: THREE.BackSide }), list = [];
    mat.visible = this._opA === undefined || this._opA >= .999;
    this.body.traverse(o => { if (o.isMesh && o.geometry.attributes.normal && !o.material.isMeshBasicMaterial) list.push(o); });
    this._olShells = list.map(o => {
      const sh = new THREE.Mesh(outlineGeo(o.geometry), mat); sh.castShadow = sh.receiveShadow = false; sh.matrixAutoUpdate = false; sh.raycast = () => { };
      sh.userData.ol = true; o.add(sh); return sh;
    });
  }
  setRobeColor(hex) { this.robeM.color.setHex(hex); this.robe2M.color.setHex(hex).multiplyScalar(.75); }
  tipWorld(out) { const A = { staff: this.tipAnchor, book: this.orbAnchor, bow: this.bowTip, swordShield: this.swordTip, daggers: this.dagTip }[this.weapon] || this.orbAnchor; A.getWorldPosition(out); return out; }
  setElementColor(hex) { this.gemMat.color.setHex(hex); this.gemMat.emissive.setHex(hex); this.staffGlow.material.color.setHex(hex); this.bookGlow.material.color.setHex(hex); }

  // 潛行半透明(a:1 = 正常):只改身體的一般混合材質,加亮光暈不動
  setOpacity(a) {
    this._opA = a; if (this._olMat) this._olMat.visible = a >= .999;   // 描邊殼:半透明 / 潛行 / 閃爍時整個隱藏(不洩漏輪廓)
    this.body.traverse(o => {
      const m = o.material; if (!m || m.blending === THREE.AdditiveBlending || o.userData.ol) return;
      const u = m.userData; if (u.o0 === undefined) { u.o0 = m.opacity; u.t0 = m.transparent; u.d0 = m.depthWrite; }
      m.transparent = a < 1 || u.t0; m.opacity = u.o0 * a; m.depthWrite = a >= 1 ? u.d0 : false; o.castShadow = a >= 1;
    });
  }

  // 打坐 / 倒地姿勢(sit、dn 為 0~1,resources.js 每幀給值)。打坐:身體下沉 .55、上身挺直並呼吸、盤腿、袍子攤開、雙手放膝;倒地:往後躺
  // 身體整體下沉,腳與袍子的 y 補回(腳底約 .06 m、袍底約 .02 m);武器座標為「站立座標 + .55」
  sitPose(sit, dn, t) {
    const b = this.body, k = this.torsoK || 1;
    b.rotation.x = lerp(lerp(b.rotation.x, 0, sit), -1.45, dn);
    b.position.y += lerp(0, -.55, sit) + Math.sin(t * 1.2) * .015 * sit;
    this.feet.forEach((f, i) => {
      f.position.x = lerp(i ? .15 : -.15, i ? .16 : -.16, sit);
      f.position.z = lerp(f.position.z, .22, sit);
      f.position.y = lerp(f.position.y, .61, sit);
      f.rotation.y = lerp(f.rotation.y, i ? -1.1 : 1.1, sit);
    });
    [this.robeLow, this.hemRing].forEach(m => { const w = lerp(1, 1.25, sit); m.scale.x = m.userData.bx * k * w; m.scale.z = m.userData.bz * k * w; });
    this.robeLow.scale.y = lerp(1, .55, sit); this.robeLow.position.y = lerp(.7, .83, sit); this.hemRing.position.y = lerp(.24, .57, sit);
    [[this.armL, 1], [this.armR, -1]].forEach(([a, sg]) => {
      a.sh.rotation.x = lerp(lerp(a.sh.rotation.x, -.55, sit), -.3, dn);
      a.sh.rotation.z = lerp(lerp(a.sh.rotation.z, -sg * .28, sit), sg * 1.2, dn);
      a.el.rotation.x = lerp(lerp(a.el.rotation.x, -1.25, sit), 0, dn);
    });
    this.head.rotation.x = lerp(this.head.rotation.x, .12, sit);
  }
  // 打坐時武器擺放:以本幀的手位置為起點,lerp 到坐姿位置(sit = 0 時不改)
  sitWeapon(sit, t) {
    const P = (o, x, y, z) => o.position.set(lerp(o.position.x, x, sit), lerp(o.position.y, y, sit), lerp(o.position.z, z, sit));
    const w = this.weapon;
    if (w === 'staff') { P(this.staff, .42, .5, .2); this.staff.rotation.x = lerp(this.staff.rotation.x, 0, sit); this.staff.rotation.z = lerp(this.staff.rotation.z, -.08, sit); }
    else if (w === 'book') { P(this.book, 0, 1.5 + Math.sin(t * 1.5) * .03, .35); this.book.rotation.z = lerp(this.book.rotation.z, 0, sit); }
    else if (w === 'bow') { P(this.bow, 0, 1.1, .3); this.bow.rotation.z = lerp(this.bow.rotation.z, Math.PI / 2, sit); }
    else if (w === 'swordShield') { P(this.sword, 0, .45, .55); this.sword.rotation.x = lerp(this.sword.rotation.x, 0, sit); P(this.shield, -.45, .65, .1); this.shield.rotation.z = lerp(this.shield.rotation.z, .3, sit); }
    else [[this.daggers[0], -.18, 1.15, .25, .6], [this.daggers[1], .18, 1.15, .25, -.6]].forEach(([g, x, y, z, rz]) => { P(g, x, y, z); g.rotation.set(lerp(g.rotation.x, -1.2, sit), 0, lerp(g.rotation.z, rz, sit)); });
  }
  // anim: {move, cast(0..1), kick(0..1), charge(0..1), t}
  update(dt, s) {
    this.root.rotation.y = this.yaw;
    const moving = s.move > .05;
    if (moving) this.walkPh += dt * (4 + s.move * 4);
    const sw = Math.sin(this.walkPh) * Math.min(s.move, 1.4) * (1 - s.cast);
    this.feet[0].position.z = .05 + sw * .26; this.feet[1].position.z = .05 - sw * .26;
    this.feet[0].position.y = .1 + Math.max(0, Math.cos(this.walkPh)) * .08 * Math.min(1, s.move);
    this.feet[1].position.y = .1 + Math.max(0, -Math.cos(this.walkPh)) * .08 * Math.min(1, s.move);
    this.body.position.y = Math.abs(Math.sin(this.walkPh)) * .06 * Math.min(1, s.move) + Math.sin(s.t * 2) * .012 + s.hover;
    this.body.rotation.set(.1 * Math.min(1, s.move) - .07 * s.cast + .16 * s.kick, this.spinY, 0);
    this.head.rotation.x = -.18 * s.cast + (s.cast > .5 ? Math.sin(s.t * 3) * .02 : 0);
    const c = s.cast, k = s.kick, L = this.armL, R = this.armR;
    const pose = (a, sx, sz, ex) => { a.sh.rotation.set(sx, 0, sz); a.el.rotation.set(ex, 0, 0); };
    if (this.weapon === 'staff') {
      pose(R, lerp(-.12, -1.3, c) - .25 * k, lerp(-.08, .1, c), lerp(-.35, -.18, c));
      pose(L, lerp(-sw * .8, -1.0, c), lerp(-.06, -.4, c), lerp(-.1, -.8, c));
    } else if (this.weapon === 'book') {
      pose(L, lerp(-.35, -1.2, c) - .2 * k, lerp(-.06, -.45, c), lerp(-1.0, -.5, c));
      pose(R, lerp(sw * .8, -1.2, c) - .2 * k, lerp(.06, .45, c), lerp(-.1, -.5, c));
    } else if (this.weapon === 'bow') {
      pose(L, -1.45, -.12, -.1); pose(R, -1.45, lerp(.1, .42, c), lerp(-.4, -1.5, c));
    } else if (this.weapon === 'swordShield') {
      pose(R, lerp(-.12, -2.1, c) - .2 * k, lerp(-.08, -.25, c), lerp(-.35, -.2, c)); pose(L, lerp(-.5, -1.35, this.shieldUp), -.25, lerp(-.6, -1.2, this.shieldUp));
    } else {
      pose(L, -1.1, lerp(-.1, -.5, c), -1.2); pose(R, -1.1, lerp(.1, .5, c), -1.2);
    }
    const rp = s.roll >= 0 ? s.roll : (s.flip >= 0 ? s.flip : -1);
    const phi = s.roll >= 0 ? s.rollPhi : 0;          // phi=0 → 繞本地 x 軸 = 前空翻
    if (rp >= 0) {  // 側翻滾 / 前空翻:繞身體中心翻一圈、收手
      pose(L, -2, .2, -1.4); pose(R, -2, -.2, -1.4);
      const ax = new V3(Math.cos(phi), 0, -Math.sin(phi));
      this.body.quaternion.setFromAxisAngle(ax, Math.PI * 2 * rp);
      const c = new V3(0, .9, 0);
      this.body.position.copy(c).sub(c.clone().applyQuaternion(this.body.quaternion));
      this.body.position.y += .25 * Math.sin(Math.PI * rp);
    }
    const sit = s.sit || 0, dn = s.down || 0, hasPose = sit > 0 || dn > 0 || !!this._sitWas;   // 打坐 / 倒地姿勢;都為 0 且先前也沒有時不動既有動畫
    this._sitWas = sit > 0 || dn > 0;
    if (hasPose) this.sitPose(sit, dn, s.t);
    this.root.updateMatrixWorld(true);
    const v = new V3(), v2 = new V3();
    const hp = (h, o) => { h.getWorldPosition(o); this.body.worldToLocal(o); return o; };
    this.swap = Math.min(1, this.swap + dt * 4);
    const pop = easeOut(this.swap);
    if (this.weapon === 'staff') {
      hp(R.hand, v); this.staff.position.copy(v);
      this.staff.rotation.set(lerp(.08, 1.05, c) + .3 * k, 0, 0); this.staff.scale.setScalar(pop);
    } else if (this.weapon === 'book') {
      hp(L.hand, v); hp(R.hand, v2);
      const rest = v.clone().add(new V3(-.05, .12, .1)), mid = v.clone().add(v2).multiplyScalar(.5).add(new V3(0, .12, .12));
      this.book.position.lerpVectors(rest, mid, c);
      this.book.rotation.set(lerp(0, -.3, c), lerp(0, 0, c), lerp(-.25, 0, c)); this.book.scale.setScalar(pop);
      const th = lerp(lerp(1.5, .4, c), .4, sit); this.halves[0].rotation.y = -th; this.halves[1].rotation.y = th;
      if (c > .6) { this.flip = (this.flip + dt * (.8 + s.charge * 2.2)) % 1; } else this.flip = 0;
      const f = this.flip < .5 ? this.flip * 2 : 0;
      this.flipGrp.rotation.y = lerp(-th + .05, th - .05, f); this.flipGrp.visible = c > .6;
    } else {
      hp(L.hand, v); hp(R.hand, v2);
      if (this.weapon === 'bow') { this.bow.position.copy(v); this.bow.rotation.set(0, 0, 0); }
      else if (this.weapon === 'swordShield') { this.sword.position.copy(v2); this.sword.rotation.set(lerp(-.2, -.9, c), 0, 0); this.shield.position.copy(v).add(new V3(0, .02, .14)); this.shield.rotation.set(0, 0, 0); }
      else { this.daggers[0].position.copy(v); this.daggers[1].position.copy(v2); this.daggers[0].rotation.set(lerp(0, -.6, c), 0, lerp(0, .5, c)); this.daggers[1].rotation.set(lerp(0, -.6, c), 0, lerp(0, -.5, c)); }
    }
    if (hasPose) this.sitWeapon(sit, s.t);
    const g = this.glow;
    this.gemMat.emissiveIntensity = .6 + g * 3; this.staffGlow.material.opacity = g * .9; this.staffGlow.scale.setScalar(.5 + g * 1.4);
    this.bookGlow.material.opacity = g * .9; this.bookGlow.scale.setScalar(.6 + g * 1.5);
  }
}
