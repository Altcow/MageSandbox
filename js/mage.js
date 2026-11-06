'use strict';
// 占位法師(程式生成)。之後換成 GLB 模型時,只要保留這些介面:
//   root / yaw / weapon / setWeapon() / update(dt, anim) / tipWorld(out) / glow
class Mage {
  constructor(scene) {
    const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: .75, metalness: .05 }, o || {}));
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.root.add(this.body); scene.add(this.root);
    this.yaw = 0; this.walkPh = 0; this.weapon = 'staff'; this.glow = 0; this.swap = 1; this.flip = 0;
    const robe = M(0x3a3f9c), robe2 = M(0x2a2e78), gold = M(0xe0b04a, { metalness: .6, roughness: .35 });
    this.robeM = robe; this.robe2M = robe2;   // 職業袍色用
    const skin = M(0xf1c9a5), hair = M(0xe9ecff), boot = M(0x5a3a22), dark = new THREE.MeshBasicMaterial({ color: 0x151525 });
    const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (parent || this.body).add(m); return m; };
    add(new THREE.CylinderGeometry(.27, .52, .95, 24), robe, 0, .7, 0);
    add(new THREE.TorusGeometry(.515, .03, 8, 32), gold, 0, .24, 0).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(.24, .29, .42, 20), robe, 0, 1.33, 0);
    add(new THREE.TorusGeometry(.28, .035, 8, 24), gold, 0, 1.14, 0).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(.3, 16, 12), robe2, 0, 1.5, -.02).scale.set(1.1, .45, .85);
    this.head = new THREE.Group(); this.head.position.set(0, 1.72, 0); this.body.add(this.head);
    add(new THREE.SphereGeometry(.24, 24, 18), skin, 0, 0, 0, this.head);
    add(new THREE.SphereGeometry(.255, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, .02, -.03, this.head);
    add(new THREE.SphereGeometry(.2, 16, 12), hair, 0, -.12, -.15, this.head).scale.set(.95, 1.2, .6);
    add(new THREE.SphereGeometry(.035, 8, 8), dark, .085, -.01, .215, this.head);
    add(new THREE.SphereGeometry(.035, 8, 8), dark, -.085, -.01, .215, this.head);
    add(new THREE.CylinderGeometry(.46, .46, .035, 28), robe2, 0, .2, 0, this.head);
    add(new THREE.TorusGeometry(.285, .02, 6, 24), gold, 0, .24, 0, this.head).rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.28, .62, 24), robe2, 0, .52, 0, this.head).rotation.x = -.15;
    add(new THREE.ConeGeometry(.12, .3, 16), robe2, 0, .88, -.1, this.head).rotation.x = -.55;
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
    this.setWeapon('staff', true);
  }
  setWeapon(w, instant) {
    this.weapon = w; if (!instant) this.swap = 0; this.staff.visible = w === 'staff'; this.book.visible = w === 'book';
    this.bow.visible = w === 'bow'; this.sword.visible = w === 'swordShield'; this.shield.visible = w === 'swordShield';
    this.daggers.forEach(g => { g.visible = w === 'daggers'; });
  }
  setRobeColor(hex) { this.robeM.color.setHex(hex); this.robe2M.color.setHex(hex).multiplyScalar(.75); }
  tipWorld(out) { const A = { staff: this.tipAnchor, book: this.orbAnchor, bow: this.bowTip, swordShield: this.swordTip, daggers: this.dagTip }[this.weapon] || this.orbAnchor; A.getWorldPosition(out); return out; }
  setElementColor(hex) { this.gemMat.color.setHex(hex); this.gemMat.emissive.setHex(hex); this.staffGlow.material.color.setHex(hex); this.bookGlow.material.color.setHex(hex); }

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
    this.body.rotation.set(.1 * Math.min(1, s.move) - .07 * s.cast + .16 * s.kick, 0, 0);
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
      pose(R, lerp(-.12, -2.1, c) - .2 * k, lerp(-.08, -.25, c), lerp(-.35, -.2, c)); pose(L, -.5, -.25, -.6);
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
      const th = lerp(1.5, .4, c); this.halves[0].rotation.y = -th; this.halves[1].rotation.y = th;
      if (c > .6) { this.flip = (this.flip + dt * (.8 + s.charge * 2.2)) % 1; } else this.flip = 0;
      const f = this.flip < .5 ? this.flip * 2 : 0;
      this.flipGrp.rotation.y = lerp(-th + .05, th - .05, f); this.flipGrp.visible = c > .6;
    } else {
      hp(L.hand, v); hp(R.hand, v2);
      if (this.weapon === 'bow') { this.bow.position.copy(v); this.bow.rotation.set(0, 0, 0); }
      else if (this.weapon === 'swordShield') { this.sword.position.copy(v2); this.sword.rotation.set(lerp(-.2, -.9, c), 0, 0); this.shield.position.copy(v).add(new V3(0, .02, .14)); this.shield.rotation.set(0, 0, 0); }
      else { this.daggers[0].position.copy(v); this.daggers[1].position.copy(v2); this.daggers[0].rotation.set(lerp(0, -.6, c), 0, lerp(0, .5, c)); this.daggers[1].rotation.set(lerp(0, -.6, c), 0, lerp(0, -.5, c)); }
    }
    const g = this.glow;
    this.gemMat.emissiveIntensity = .6 + g * 3; this.staffGlow.material.opacity = g * .9; this.staffGlow.scale.setScalar(.5 + g * 1.4);
    this.bookGlow.material.opacity = g * .9; this.bookGlow.scale.setScalar(.6 + g * 1.5);
  }
}
