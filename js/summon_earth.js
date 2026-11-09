'use strict';
// 石頭人傀儡(設計_魔法調整.md 第 14 節 S-2、S-4「石頭人」列、S-4b 砸地外觀)。覆寫 SUMMON_KINDS.earth 整筆。
//   · 沒有普攻(不定義 attack);砸地的土牆、減速、傷害由 summons_core.js 的 smSlam 負責,本檔不重複。
//   · build:身體 1 mesh + 左右臂、左右腿各 1 mesh(肩 / 髖為 pivot)= 5 mesh;眼睛光暈 1 sprite。零件用 mergeParts 合併,幾何與材質共用。
//   · animate:走路擺動;砸地前 0.8 s 雙臂高舉(由 slamT 推算);砸下瞬間由 slamT 跳升偵測,之後 0.15 s 砸下、0.5 s 收回。
//   · onDeath:四肢脫落落地後 1 s 移除,並拋出碎石與塵土;身體由框架 fade 下沉。
// 依賴:summons_core.js(SUMMON_KINDS、mergeParts)、fx.js(EL、glowSprite、rnd、lerp、damp、easeOut、V3)、spells.js(fq、debris、addFx)。

(function () {

const SE_ROCK = 0x5a4a40, SE_LIGHT = 0x6e5e50, SE_DARK = 0x3a2e28, SE_CRACK = 0xa8803e, SE_EYE = 0xffb040;
let SE_C = null;   // 共用幾何 / 材質:第一次 build 時建立(userData.shared = true,框架消散時不 dispose)

function seCache() {
  if (SE_C) return SE_C;
  const made = [];   // mergeParts 的輸入幾何不會被釋放,這裡建完即 dispose
  const box = (w, h, d, pos, color, rot) => { const geo = new THREE.BoxGeometry(w, h, d); made.push(geo); return { geo, pos, rot, color }; };
  const bodyParts = [
    box(1.2, .5, .85, [0, 1.25, 0], SE_ROCK),
    box(1.45, 1.2, 1.0, [0, 2.0, 0], SE_ROCK),
    box(1.7, .55, 1.15, [0, 2.8, .02], SE_LIGHT),
    box(.8, .8, .85, [0, 3.4, 0], SE_ROCK),
    box(1.0, .12, .2, [0, 3.6, .45], SE_DARK),
    box(.2, .14, .08, [-.2, 3.42, .44], SE_EYE),
    box(.2, .14, .08, [.2, 3.42, .44], SE_EYE),
    box(.08, .9, .04, [-.35, 2.1, .53], SE_CRACK),
    box(.06, .6, .04, [.42, 1.9, .53], SE_CRACK, [0, 0, .3]),
    box(.05, .7, .04, [.1, 2.8, .6], SE_CRACK, [0, 0, -.25])
  ];
  const armParts = [
    box(.5, 1.0, .5, [0, -.5, 0], SE_ROCK),
    box(.55, .95, .55, [0, -1.45, 0], SE_LIGHT),
    box(.7, .6, .7, [0, -2.2, 0], SE_ROCK)
  ];
  const legParts = [
    box(.6, 1.05, .7, [0, -.525, 0], SE_ROCK),
    box(.7, .25, .95, [0, -1.17, .1], SE_LIGHT)
  ];
  const C = {
    body: mergeParts(bodyParts), arm: mergeParts(armParts), leg: mergeParts(legParts),
    mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8 })
  };
  made.forEach(g => g.dispose());
  C.body.userData.shared = true; C.arm.userData.shared = true; C.leg.userData.shared = true; C.mat.userData.shared = true;
  SE_C = C;
  return C;
}

// 肢體 pivot:pivot 位於肩 / 髖,網格往下掛;回傳 pivot(Group),網格為 pivot.children[0]
function seLimb(C, geo, x, y) {
  const pv = new THREE.Group(); pv.position.set(x, y, 0);
  const m = new THREE.Mesh(geo, C.mat); m.castShadow = true; pv.add(m);
  return pv;
}

function seBuild(P, scale) {
  const C = seCache(), g = new THREE.Group();
  const body = new THREE.Mesh(C.body, C.mat); body.castShadow = true; g.add(body);
  const armL = seLimb(C, C.arm, -1.0, 2.75), armR = seLimb(C, C.arm, 1.0, 2.75);
  const legL = seLimb(C, C.leg, -.38, 1.3), legR = seLimb(C, C.leg, .38, 1.3);
  g.add(armL, armR, legL, legR);
  const eyes = glowSprite(0xff8a20, 1.3, .9); eyes.position.set(0, 3.42, .5); g.add(eyes);
  g.scale.setScalar(scale);
  g.userData.se = { armL, armR, legL, legR, eyes, ph: rnd(0, 6), amp: 0, imp: 9, prevS: 0 };
  return g;
}

function seAnimate(u, dt) {
  const p = u.body && u.body.userData.se;
  if (!p) return;
  // 砸下:smSlam 會把 slamT 重設為 interval(跳升 > 2 s),以此偵測砸下瞬間
  if (u.slamT > p.prevS + 2) p.imp = 0;
  p.prevS = u.slamT; p.imp += dt;
  const moving = u.state === 'seek';
  p.amp = damp(p.amp, moving ? 1 : 0, 6, dt);
  if (moving) p.ph += dt * u.def.speed * 1.6;
  const sw = Math.sin(p.ph) * p.amp;
  // 砸前 0.8 s 高舉(slamT 由 .8 倒數到 0 時 rk 由 0 升到 1)
  const rk = u.state === 'attack' && u.slamT > 0 && u.slamT <= .8 ? 1 - u.slamT / .8 : 0;
  let arm = null, lean = 0;
  if (p.imp < .15) { const k = easeOut(p.imp / .15); arm = lerp(-2.6, -.4, k); lean = lerp(-.2, .35, k); }   // 砸下 0.15 s
  else if (p.imp < .65) { const k = (p.imp - .15) / .5; arm = lerp(-.4, 0, k); lean = lerp(.35, 0, k); }       // 收回 0.5 s
  else if (rk > 0) { arm = -2.6 * easeOut(rk); lean = -.2 * rk; }                                               // 高舉
  p.armL.rotation.x = arm == null ? -sw * .3 : arm;
  p.armR.rotation.x = arm == null ? sw * .3 : arm;
  p.legL.rotation.x = sw * .45; p.legR.rotation.x = -sw * .45;
  u.body.rotation.x = lean;
  u.body.position.y = Math.abs(sw) * .08;
  p.eyes.material.opacity = .75 + .15 * Math.sin(u.age * 3) + (rk > 0 || p.imp < .65 ? .1 : 0);
}

function seDeath(u) {
  const p = u.body && u.body.userData.se;
  if (!p) return;
  const L = [];
  for (const k of ['armL', 'armR', 'legL', 'legR']) {
    const m = p[k].children[0];
    scene.attach(m);   // 保留世界變換改掛到場景,框架 dispose 時不會誤刪(幾何共用)
    L.push({ m, v: new V3(rnd(-1.5, 1.5), rnd(2, 3.5), rnd(-1.5, 1.5)), w: new V3(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5)) });
  }
  debris(new V3(u.x, u.y + 1, u.z), 8, u.E.hex, .45);
  for (let i = 0; i < fq(14); i++) smoke.emit(u.x + rnd(-.6, .6), u.y + rnd(.2, 1.5), u.z + rnd(-.6, .6), rnd(-1, 1), rnd(.3, 1), rnd(-1, 1), rnd(.9, 1.4), rnd(1.2, 1.8), u.E.s0, u.E.s1, .5, 2, -.1, .6);
  let t = 0;
  addFx(dt => {
    t += dt;
    for (const o of L) {
      o.v.y -= 9.8 * dt; o.m.position.addScaledVector(o.v, dt);
      o.m.rotation.x += o.w.x * dt; o.m.rotation.y += o.w.y * dt; o.m.rotation.z += o.w.z * dt;
    }
    if (t < 1) return true;
    for (const o of L) scene.remove(o.m);
    return false;
  });
}

SUMMON_KINDS.earth = { build: seBuild, animate: seAnimate, onDeath: seDeath };

})();
