'use strict';
// 風系招式(階段 0 暫代版):風刃術先以 castShot 單片直線(擊退保留);風壁術自 spells.js 搬入(階段 1-B 改寫為颶風牆);
// 風刃切割暫呼叫龍捲風。SHAPE_FN_NAME.wind.sky = 'castWindCut'。

// 風刃術(暫代):單片直線、月牙尾跡;B 模式份數固定 1(三片新月於階段 1-B 完成)
function castWindBolt(P, orb) {
  const E = EL.wind, moon = new THREE.Mesh(MOON_GEO, new THREE.MeshBasicMaterial({ color: E.hex, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(moon);
  castShot(Object.assign({}, P, { copies: 1 }), orb, {
    speed: BOLT_SPEED * ELMOD.wind.speedMul,
    trail(a, b, o, Ev) { moon.position.copy(b); moon.lookAt(b.x + (b.x - a.x) * 9, b.y, b.z + (b.z - a.z) * 9); moon.rotateZ(.5); TRAIL.wind(a, b, o, Ev); },
    impact(end, Q) {
      explode(end, Q.r, Q.power, { dmg: 0, el: 'wind', gy: Q.target.y, fxK: Q.fxK, flatY: .3, smokeA: .25 });
      burstRing(end, EL_BURST.wind.ring, Q.r); burstRing(end, EL_BURST.wind.ring, Q.r * 1.4);
      areaEl(end, Q.r, 60, 'wind', Q);
    },
    done() { scene.remove(moon); moon.material.dispose(); }
  });
}
// 風壁術:螺旋上升的風牆,每跳擊退(2.5 → 1.25 m 的牆外推出)— 自 spells.js 原樣搬入(份數與 emitK 已接上)
function castWindWall(P, orb) {
  const E = EL.wind;
  castBolt(P, orb, {
    speed: 36, arc: 0, endY: .5, dmin: .2, dmax: .6, trail: TRAIL.wind,
    impact: (end, Q) => spawnZone(Q, {
      hex: E.hex, indHex: E.hex, alpha: .3, lightHex: E.hex, lightInt: 2.5, tickInt: .3,
      emit(s, ramp, c) {
        s.acc += c.dt * 20 * ramp * FXQ() * c.emitK;
        while (s.acc >= 1) {
          s.acc -= 1;
          const lx = rnd(-c.thick / 2, c.thick / 2), x = s.x - c.az * lx, z = s.z + c.ax * lx, sway = Math.sin(c.age * 6 + s.o) * 1.2;
          fire.emit(x, s.gy + rnd(0, .4), z, c.ax * sway, rnd(2.5, 4.5), c.az * sway, rnd(.6, .9), rnd(.2, .35), E.c0, E.c1, .9, .5, -.2, .8);
          if (Math.random() < .3) fire.emit(x, s.gy + rnd(.3, 2.5), z, rnd(-.5, .5), rnd(0, .6), rnd(-.5, .5), rnd(.8, 1.2), rnd(.08, .14), LEAF0, LEAF1, .8, .5, -.4, .8);
        }
      },
      onTick: c => zoneTick(c, 5, 'wind', { knock: 2.5 * c.P.fxK })
    })
  });
}
// 風刃切割(暫代):呼叫龍捲風;階段 1-B 改為超寬新月衝擊波
function castWindCut(P, orb) { castTornado(P, orb); }
