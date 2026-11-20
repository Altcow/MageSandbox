'use strict';
// ---- 人偶姿勢與動作資料(設計_武器技能系統與火柴人角色 §1-4 / §1-5)----
// 姿勢 = { 骨名: [rx, ry, rz] } + hip:[x,y,z] 位移,只寫有變的骨;骨用短名(對應 Mixamo:Chest = Spine2、Thigh = UpLeg、Shin = Leg)。
// 旋轉順序 XYZ(先 z 再 y 最後 x);角色朝 +z、左手在 +x:
//   手臂 / 腿靜止姿勢為 T 字(手臂沿 ±x),所以手臂自然下垂 = rz ∓1.42;rx 負值 = 向前抬;前臂 ry:左手負值、右手正值 = 肘彎向前;
//   小腿 rx 正值 = 膝彎(腳往後);脊椎 / 頭 rx 正值 = 前傾 / 低頭。手臂請用 arm(side, 前抬, 外展, 肘彎, 扭轉) 免得記符號。
// 片段 = 關鍵姿勢序列 [[t, 姿勢, 緩動], ...];緩動只用 6 種(linear / inQuad / outQuad / inOutQuad / outExpo / outBack)。
const POSE_BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LArm', 'LFore', 'LHand', 'RArm', 'RFore', 'RHand', 'LThigh', 'LShin', 'LFoot', 'RThigh', 'RShin', 'RFoot'];
const POSE_N = POSE_BONES.length, POSE_LEN = POSE_N * 3 + 5;   // 最後 5 個 = Hips 位移(3)+ tilt(身體繞腳底 x 軸,+ 前撲 / − 後仰,弧度)+ lift(body 視覺離地,公尺)
const POSE_TILT = POSE_N * 3 + 3, POSE_LIFT = POSE_N * 3 + 4;
const POSE_IX = {}; POSE_BONES.forEach((n, i) => { POSE_IX[n] = i; });
const ARM0 = 1.42;
const EASE = {
  linear: t => t, inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t), inOutQuad: t => t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t),
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t), outBack: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
};
// 手臂:前抬 fwd(弧度,負向後)、外展 abd(0 = 貼身)、肘彎 bend(向前)、扭轉 tw
function arm(side, fwd, abd, bend, tw) {
  fwd = fwd || 0; abd = abd || 0; bend = bend || 0; tw = tw || 0;
  return side === 'L' ? { LArm: [-fwd, tw, -(ARM0 - abd)], LFore: [0, -bend, 0] } : { RArm: [-fwd, -tw, ARM0 - abd], RFore: [0, bend, 0] };
}
// 腿:前抬 fwd、外展 abd、膝彎 knee
function leg(side, fwd, abd, knee) {
  fwd = fwd || 0; abd = abd || 0; knee = knee || 0;
  return side === 'L' ? { LThigh: [-fwd, 0, abd], LShin: [knee, 0, 0] } : { RThigh: [-fwd, 0, -abd], RShin: [knee, 0, 0] };
}
const PZ = (...o) => Object.assign({}, ...o);   // 合併稀疏姿勢
const _NEUTRAL = new Float32Array(POSE_LEN);
function _fill(arr, sp) {
  for (const k in sp) { if (k === 'hip') { arr[POSE_N * 3] = sp.hip[0]; arr[POSE_N * 3 + 1] = sp.hip[1]; arr[POSE_N * 3 + 2] = sp.hip[2]; continue; } if (k === 'tilt') { arr[POSE_TILT] = sp.tilt; continue; } if (k === 'lift') { arr[POSE_LIFT] = sp.lift; continue; } const i = POSE_IX[k]; if (i === undefined) { console.warn('[poses] 未知骨', k); continue; } arr[i * 3] = sp[k][0]; arr[i * 3 + 1] = sp[k][1]; arr[i * 3 + 2] = sp[k][2]; }
  return arr;
}
_fill(_NEUTRAL, PZ(arm('L', 0, 0, .22), arm('R', 0, 0, .22), { LThigh: [0, 0, .03], RThigh: [0, 0, -.03] }));
const mkPose = sp => _fill(_NEUTRAL.slice(), sp || {});
// 遮罩:每骨權重(第 17 個 = Hips 位移 → 屬於下半身)
const MASK = { full: new Float32Array(POSE_N).fill(1), upper: new Float32Array(POSE_N), lower: new Float32Array(POSE_N) };
['Spine', 'Chest', 'Neck', 'Head', 'LArm', 'LFore', 'LHand', 'RArm', 'RFore', 'RHand'].forEach(n => { MASK.upper[POSE_IX[n]] = 1; });
['Hips', 'LThigh', 'LShin', 'LFoot', 'RThigh', 'RShin', 'RFoot'].forEach(n => { MASK.lower[POSE_IX[n]] = 1; });
// out = lerp(out, p, w * mask)
function poseMix(out, p, w, mask) {
  if (w <= 0) return out;
  for (let i = 0; i < POSE_N; i++) { const m = (mask ? mask[i] : 1) * w; if (m <= 0) continue; const j = i * 3; out[j] += (p[j] - out[j]) * m; out[j + 1] += (p[j + 1] - out[j + 1]) * m; out[j + 2] += (p[j + 2] - out[j + 2]) * m; }
  const m = (mask ? mask[0] : 1) * w, h = POSE_N * 3;
  if (m > 0) { for (let j = 0; j < 5; j++) out[h + j] += (p[h + j] - out[h + j]) * m; }
  return out;
}

/* ---------- 姿勢庫 ---------- */
const POSES = {
  sit: mkPose(PZ({ hip: [0, -.8, 0], Spine: [-.05, 0, 0], Head: [.1, 0, 0] }, arm('L', .9, .3, .4), arm('R', .9, .3, .4),
    { LThigh: [-1.45, 0, .55], LShin: [2.4, 0, 0], RThigh: [-1.45, 0, -.55], RShin: [2.4, 0, 0] })),
  down: mkPose(PZ({ Head: [-.2, .3, 0], Spine: [-.1, 0, 0] }, arm('L', -.3, 1.0, .1), arm('R', -.2, 1.1, .1), { LThigh: [0, 0, .25], RThigh: [0, 0, -.2], LShin: [.1, 0, 0], RShin: [.25, 0, 0] })),
  tuck: mkPose(PZ({ Spine: [.5, 0, 0], Head: [.4, 0, 0], hip: [0, -.1, 0] }, arm('L', 1.3, .1, 1.7), arm('R', 1.3, .1, 1.7), leg('L', 1.5, .1, 1.9), leg('R', 1.5, -.1, 1.9))),
  jump: mkPose(PZ({ Spine: [.05, 0, 0] }, arm('L', .5, .5, .5), arm('R', .5, .5, .5), leg('L', .35, .06, .9), leg('R', -.1, .06, .5))),
  fall: mkPose(PZ({ Spine: [-.05, 0, 0] }, arm('L', .2, .9, .3), arm('R', .2, .9, .3), leg('L', .2, .2, .4), leg('R', -.15, .2, .25))),
  land: mkPose(PZ({ hip: [0, -.3, 0], Spine: [.35, 0, 0], Head: [-.15, 0, 0] }, arm('L', .5, .35, .6), arm('R', .5, .35, .6), leg('L', 1.0, .15, 1.8), leg('R', 1.0, -.15, 1.8))),
  idle: mkPose(PZ(arm('L', 0, .02, .22), arm('R', 0, .02, .22)))
};

/* ---------- 武器持握:ready(持武器待機)/ prep(集氣、瞄準預備)/ burst(放開瞬間爆發)/ free(移動時可擺動的自由手) ---------- */
const WPOSE = {
  staff: {   // 短法杖:右手持杖,杖頭朝前上;集氣 = 右手舉杖過肩
    ready: mkPose(PZ(arm('R', .75, .15, 1.15), arm('L', .25, .25, .5), { Spine: [.05, -.15, 0], Head: [-.05, .1, 0] })),
    prep: mkPose(PZ(arm('R', 2.1, .1, 1.5), arm('L', .9, .55, .5), { Spine: [-.06, -.3, 0], Chest: [-.08, 0, 0], Head: [-.2, .15, 0] })),
    burst: mkPose(PZ(arm('R', 1.35, .08, .35), arm('L', -.4, .6, .3), { Spine: [.28, .15, 0], Chest: [.1, 0, 0], Head: [.1, 0, 0] })), free: ['L']
  },
  book: {
    ready: mkPose(PZ(arm('L', .6, .15, 1.2), arm('R', .3, .15, .4), { Spine: [.05, 0, 0] })),
    prep: mkPose(PZ(arm('L', 1.2, .3, .9), arm('R', 1.2, .3, .9), { Spine: [-.05, 0, 0], Head: [-.1, 0, 0] })),
    burst: mkPose(PZ(arm('L', 1.4, .2, .3), arm('R', 1.4, .2, .3), { Spine: [.25, 0, 0] })), free: []
  },
  bow: {     // 長弓:左手持弓側立前伸,右手拉弦到下巴
    ready: mkPose(PZ(arm('L', 1.35, .12, .1), arm('R', .5, .2, 1.0), { Spine: [0, .55, 0], Chest: [0, .15, 0], Head: [0, -.5, 0] })),
    prep: mkPose(PZ(arm('L', 1.5, .1, .05), arm('R', 1.1, .65, 2.35), { Spine: [-.04, .6, 0], Chest: [0, .2, 0], Head: [0, -.6, 0] })),
    burst: mkPose(PZ(arm('L', 1.5, .1, .05), arm('R', 1.0, 1.0, .5), { Spine: [.04, .55, 0], Chest: [0, .1, 0], Head: [0, -.55, 0] })), free: []
  },
  sword: {   // 長劍:右手持劍,劍尖斜上;預備 = 舉劍過肩,爆發 = 劈下
    ready: mkPose(PZ(arm('R', .8, .2, 1.1), arm('L', .3, .35, .5), { Spine: [.04, -.25, 0], Head: [0, .2, 0] })),
    prep: mkPose(PZ(arm('R', 2.3, .45, 1.6), arm('L', .4, .6, .6), { Spine: [-.1, -.35, 0], Chest: [-.1, -.2, 0], Head: [-.05, .3, 0] })),
    burst: mkPose(PZ(arm('R', 1.1, .0, .25), arm('L', -.2, .5, .3), { Spine: [.35, .35, 0], Chest: [.1, .2, 0], Head: [.1, -.2, 0] })), free: ['L']
  },
  swordShield: {
    ready: mkPose(PZ(arm('R', .8, .2, 1.1), arm('L', .55, .3, 1.3), { Spine: [.04, -.2, 0], Head: [0, .15, 0] })),
    prep: mkPose(PZ(arm('R', 2.2, .4, 1.5), arm('L', .8, .3, 1.35), { Spine: [-.1, -.3, 0], Chest: [-.08, -.15, 0] })),
    burst: mkPose(PZ(arm('R', 1.1, .0, .25), arm('L', .9, .3, 1.3), { Spine: [.32, .3, 0], Chest: [.1, .2, 0] })), free: []
  },
  dual: {    // 雙劍(設計_雙劍 §6):右劍前上、左劍稍低;集氣 = 雙手交叉胸前、劍尖朝後;爆發 = 向外揮開
    ready: mkPose(PZ(arm('R', .8, .25, 1.0), arm('L', .55, .35, .9), { Spine: [.08, -.1, 0] })),
    prep: mkPose(PZ(arm('R', 1.2, -.2, 1.9, .3), arm('L', 1.2, -.2, 1.9, .3), { Spine: [.25, 0, 0], Chest: [.1, 0, 0] })),
    burst: mkPose(PZ(arm('R', 1.3, .9, .2), arm('L', 1.3, .9, .2), { Spine: [.3, 0, 0] })), free: []
  },
  daggers: {
    ready: mkPose(PZ(arm('R', .7, .35, 1.4), arm('L', .7, .35, 1.4), { Spine: [.15, 0, 0], Head: [-.05, 0, 0] })),
    prep: mkPose(PZ(arm('R', .5, .9, 1.5), arm('L', .5, .9, 1.5), { Spine: [.3, 0, 0], hip: [0, -.12, 0] })),
    burst: mkPose(PZ(arm('R', 1.3, .2, .3), arm('L', .9, .6, .3), { Spine: [.3, .3, 0], Chest: [.1, .2, 0] })), free: []
  }
};
// 換武動作的「手上武器那隻手」:收到肩後的預備姿勢(右手持握的武器 = R,左手持握的弓 / 書 = L)
const SWAP_HAND = { staff: 'R', sword: 'R', swordShield: 'R', daggers: 'R', book: 'L', bow: 'L', dual: 'B' };
const SWAP_BACK = { B: mkPose(PZ(arm('R', 2.65, .55, 1.95), arm('L', 2.65, .55, 1.95), { Spine: [-.1, 0, 0], Head: [-.08, 0, 0] })), R: mkPose(PZ(arm('R', 2.65, .55, 1.95), { Spine: [-.1, -.25, 0], Chest: [-.05, -.15, 0], Head: [-.08, 0, 0] })), L: mkPose(PZ(arm('L', 2.65, .55, 1.95), { Spine: [-.1, .25, 0], Chest: [-.05, .15, 0], Head: [-.08, 0, 0] })) };

/* ---------- 片段 ---------- */
// mask:full / upper / lower;loop:循環;weapon:建議手持(P 面板播放時自動換上)
const ACT = {};
const CLIP_GROUPS = [];
function defClip(group, name, dur, mask, keys, opt) { ACT[name] = Object.assign({ name, dur, mask, keys, group }, opt || {}); let g = CLIP_GROUPS.find(x => x.name === group); if (!g) CLIP_GROUPS.push(g = { name: group, list: [] }); g.list.push(name); }

/* 通用 */
defClip('通用', 'idle', 2, 'full', [[0, {}], [1, { Chest: [.02, 0, 0], Head: [-.02, 0, 0] }, 'inOutQuad'], [2, {}, 'inOutQuad']], { loop: true });
defClip('通用', 'roll', .45, 'full', [[0, {}], [.45, {}]], { special: 'roll' });   // 翻滾:play('roll', {ang}) 依方向前 / 側 / 後滾(實作在 Doll.update)
defClip('通用', 'jump', .5, 'full', [[0, PZ({ hip: [0, -.25, 0], Spine: [.3, 0, 0] }, leg('L', .8, .1, 1.5), leg('R', .8, -.1, 1.5))], [.25, POSES.jump, 'outQuad'], [.5, POSES.jump]]);
defClip('通用', 'doubleJump', .5, 'full', [[0, PZ({ Spine: [.1, 0, 0] }, arm('L', .2, .3, .4), arm('R', .2, .3, .4), leg('L', 1.2, .1, 1.8), leg('R', 1.2, -.1, 1.8))], [.2, PZ({ Spine: [-.1, 0, 0] }, arm('L', 1.6, .8, .2), arm('R', 1.6, .8, .2), leg('L', .1, .1, .5), leg('R', -.2, .1, .4)), 'outBack'], [.5, PZ(arm('L', .6, .6, .3), arm('R', .6, .6, .3), leg('L', .3, .1, .8), leg('R', -.1, .1, .5)), 'outQuad']]);
defClip('通用', 'fall', 1, 'full', [[0, PZ({ Spine: [-.05, 0, 0] }, arm('L', .2, .9, .3), arm('R', .2, .9, .3), leg('L', .2, .2, .4), leg('R', -.15, .2, .25))], [.5, PZ({ Spine: [-.1, 0, 0] }, arm('L', .5, 1.1, .2), arm('R', .5, 1.1, .2), leg('L', .1, .25, .5), leg('R', -.2, .25, .3)), 'inOutQuad'], [1, PZ({ Spine: [-.05, 0, 0] }, arm('L', .2, .9, .3), arm('R', .2, .9, .3), leg('L', .2, .2, .4), leg('R', -.15, .2, .25)), 'inOutQuad']], { loop: true });
defClip('通用', 'land', .35, 'full', [[0, PZ({ hip: [0, -.3, 0], Spine: [.35, 0, 0], Head: [-.15, 0, 0] }, arm('L', .5, .35, .6), arm('R', .5, .35, .6), leg('L', 1.0, .15, 1.8), leg('R', 1.0, -.15, 1.8))], [.35, {}, 'outQuad']]);
const _dodge = (dx, dz, tag) => {   // dx:向左為正(+x)、dz:向前為正
  const lean = { Spine: [dz * .55 + (dz < 0 ? -.1 : 0), dx * 0, -dx * .45], Chest: [dz * .15, 0, -dx * .2], Head: [-dz * .2, 0, dx * .25], hip: [dx * .12, -.32, dz * .2] };
  const stride = PZ(leg(dx >= 0 ? 'L' : 'R', dz * .8 + (dx ? .2 : 0), dx ? .5 : .1, 1.0), leg(dx >= 0 ? 'R' : 'L', -dz * .4, dx ? -.2 : .1, 1.3));
  const cover = PZ(arm('L', .8, .2, 1.5), arm('R', .8, .2, 1.5));
  defClip('通用', tag, .45, 'full', [[0, PZ({ hip: [0, -.1, 0], Spine: [dz * .1, 0, 0] })], [.3, PZ(lean, stride, cover), 'outExpo'], [.75, PZ(lean, stride, cover), 'linear'], [1, {}, 'inOutQuad']].map(k => [k[0] * .45, k[1], k[2]]));
};
_dodge(1, 0, 'dodgeLeft'); _dodge(-1, 0, 'dodgeRight'); _dodge(0, -1, 'dodgeBack'); _dodge(0, 1, 'dodgeFwd');
defClip('通用', 'hitSmall', .3, 'full', [[0, {}], [.07, PZ({ Spine: [-.22, .1, 0], Chest: [-.1, 0, 0], Head: [-.3, .2, 0], hip: [0, -.04, -.06] }, arm('L', .2, .5, .3), arm('R', .1, .5, .3)), 'outExpo'], [.3, {}, 'inOutQuad']]);
defClip('通用', 'hitBig', .6, 'full', [[0, {}], [.1, PZ({ Spine: [-.5, .2, 0], Chest: [-.25, 0, 0], Head: [-.5, .3, 0], hip: [0, -.1, -.2] }, arm('L', -.3, 1.0, .1), arm('R', -.2, 1.0, .1), leg('L', -.3, .1, .4), leg('R', .2, .1, .6)), 'outExpo'], [.3, PZ({ Spine: [-.4, .2, 0], Chest: [-.2, 0, 0], Head: [-.4, .3, 0], hip: [0, -.12, -.15] }, arm('L', -.1, .8, .2), arm('R', 0, .8, .2), leg('L', -.2, .1, .5), leg('R', .2, .1, .6)), 'linear'], [.6, {}, 'inOutQuad']]);
defClip('通用', 'hitFly', 1, 'full', [[0, {}], [.15, PZ({ Spine: [-.45, 0, 0], Head: [-.5, 0, 0], hip: [0, 0, -.1] }, arm('L', -.5, 1.2, .1), arm('R', -.5, 1.2, .1), leg('L', .5, .2, .8), leg('R', .1, .2, .5)), 'outExpo'], [.6, PZ({ Spine: [-.3, 0, 0], Head: [-.3, 0, 0] }, arm('L', -.6, 1.3, .1), arm('R', -.6, 1.3, .1), leg('L', .3, .3, .5), leg('R', .0, .3, .3)), 'inOutQuad'], [1, POSES.land, 'inQuad']]);
defClip('通用', 'knockDown', .5, 'full', [[0, {}], [.5, POSES.down, 'outQuad']], { bodyTilt: 1 });
defClip('通用', 'getUp', .9, 'full', [[0, POSES.down], [.35, PZ({ hip: [0, -.55, .1], Spine: [.6, 0, 0], Head: [.2, 0, 0] }, arm('L', .8, .5, .5), arm('R', .8, .5, .5), leg('L', 1.3, .2, 2.0), leg('R', .7, -.2, 1.2)), 'outQuad'], [.9, {}, 'inOutQuad']], { bodyTilt: -1 });
defClip('通用', 'sit', 1, 'full', [[0, {}], [1, POSES.sit, 'outQuad']]);
defClip('通用', 'die', 1, 'full', [[0, {}], [.3, PZ({ Spine: [-.3, .2, 0], Head: [-.4, .3, 0], hip: [0, -.2, -.1] }, arm('L', -.2, .9, .2), arm('R', -.1, .9, .2), leg('L', -.2, .1, .8), leg('R', .1, .1, 1.0)), 'outExpo'], [1, POSES.down, 'outQuad']], { bodyTilt: 1 });
defClip('通用', 'revive', 1, 'full', [[0, POSES.down], [.5, PZ({ hip: [0, -.55, .1], Spine: [.6, 0, 0] }, arm('L', .8, .5, .5), arm('R', .8, .5, .5), leg('L', 1.3, .2, 2.0), leg('R', .7, -.2, 1.2)), 'outQuad'], [1, {}, 'inOutQuad']], { bodyTilt: -1 });
defClip('通用', 'stun', 1, 'upper', [[0, PZ({ Head: [.3, .25, 0], Spine: [.1, .1, .1] })], [.5, PZ({ Head: [.35, -.25, 0], Spine: [.1, -.1, -.1] }), 'inOutQuad'], [1, PZ({ Head: [.3, .25, 0], Spine: [.1, .1, .1] }), 'inOutQuad']], { loop: true });
defClip('通用', 'frozen', .5, 'full', [[0, PZ({ Spine: [-.1, .1, 0], Head: [-.2, .2, 0] }, arm('L', .5, .6, .6), arm('R', .3, .6, .5), leg('L', .3, .2, .3), leg('R', -.1, .2, .2))], [.5, PZ({ Spine: [-.1, .1, 0], Head: [-.2, .2, 0] }, arm('L', .5, .6, .6), arm('R', .3, .6, .5), leg('L', .3, .2, .3), leg('R', -.1, .2, .2))]]);
defClip('通用', 'swapWeapon', .35, 'upper', [[0, {}]], { special: 'swap' });   // 實際姿勢依「手上武器那隻手」算(Doll._swapPose)
defClip('通用', 'kick', .45, 'full', [[0, {}], [.15, PZ({ Spine: [-.15, -.3, 0], hip: [0, -.05, -.05] }, leg('R', -.4, 0, .9), arm('L', .6, .4, 1.0), arm('R', .6, .4, 1.0)), 'outQuad'], [.25, PZ({ Spine: [-.2, -.35, 0] }, leg('R', 1.35, .1, .15), arm('L', .6, .5, 1.0), arm('R', .3, .3, .8)), 'outExpo'], [.45, {}, 'inOutQuad']]);

/* 受擊反應(設計_劍技光效與受擊反應 §4-8;tilt = 身體前撲 + / 後仰 −、lift = body 視覺離地 m,只動外觀)。holdDown:停在最後一格直到倒地結束;after:收尾接的片段 */
const _poseT = (p, t, l) => { const c = p.slice(); c[POSE_TILT] = t; c[POSE_LIFT] = l || 0; return c; };
const POSE_DOWN_FACE = mkPose(PZ({ Head: [-.4, .6, 0], tilt: 1.45 }, arm('L', .9, .9, 1.2), arm('R', .9, .9, 1.2), leg('L', 0, .1, .1), leg('R', 0, .1, .1)));
const POSE_DOWN_T = _poseT(POSES.down, -1.45, 0);
defClip('受擊', 'hitSmallRear', .3, 'full', [[0, {}], [.07, PZ({ Spine: [.35, 0, 0], Chest: [.12, 0, 0], Head: [.25, 0, 0], hip: [0, -.04, .06] }, arm('L', -.3, .4, .3), arm('R', -.3, .4, .3)), 'outExpo'], [.3, {}, 'inOutQuad']]);
defClip('受擊', 'hitBigRear', .6, 'full', [[0, {}], [.1, PZ({ Spine: [.55, 0, 0], Chest: [.2, 0, 0], Head: [.35, 0, 0], hip: [0, -.1, .18] }, arm('L', -.5, .9, .1), arm('R', -.5, .9, .1), leg('L', .35, .1, .6), leg('R', -.25, .1, .3)), 'outExpo'], [.3, PZ({ Spine: [.45, 0, 0], Chest: [.18, 0, 0], Head: [.3, 0, 0], hip: [0, -.1, .15] }, arm('L', -.3, .8, .1), arm('R', -.3, .8, .1), leg('L', .3, .1, .5), leg('R', -.2, .1, .3)), 'linear'], [.6, {}, 'inOutQuad']]);
defClip('受擊', 'hitSlide', .5, 'lower', [[0, {}], [.08, PZ({ hip: [0, -.15, 0] }, leg('L', .3, .12, .7), leg('R', -.35, .12, .6)), 'outExpo'], [.4, PZ({ hip: [0, -.15, 0] }, leg('L', .3, .12, .7), leg('R', -.35, .12, .6)), 'linear'], [.5, {}, 'inOutQuad']]);
defClip('受擊', 'stagger', .55, 'full', [[0, {}], [.12, PZ({ Spine: [-.5, .2, 0], Chest: [-.25, 0, 0], Head: [-.5, .3, 0], hip: [0, -.1, -.2] }, arm('L', -.3, 1.0, .1), arm('R', -.2, 1.0, .1), leg('L', -.3, .1, .4), leg('R', .2, .1, .6)), 'outExpo'], [.25, PZ({ Head: [.3, .2, 0], Spine: [.1, .1, 0] }, leg('L', -.35, .15, .6), arm('L', .4, 1.0, .3), arm('R', -.4, 1.0, .3)), 'outQuad'], [.4, PZ({ Head: [.3, -.2, 0], Spine: [.1, -.1, 0] }, leg('R', -.3, .15, .6), arm('L', -.4, 1.0, .3), arm('R', .4, 1.0, .3)), 'inOutQuad'], [.55, PZ({ Head: [.3, .25, 0], Spine: [.1, .1, .1], hip: [.04, -.06, 0] }, leg('L', 0, 0, .25), leg('R', 0, 0, .25), arm('L', .1, .15, .3), arm('R', .1, .15, .3)), 'inOutQuad']]);
defClip('受擊', 'stunSway', 1.2, 'full', [[0, PZ({ Head: [.3, .25, 0], Spine: [.1, .1, .1], hip: [.04, -.06, 0] }, leg('L', 0, 0, .25), leg('R', 0, 0, .25), arm('L', .1, .15, .3), arm('R', .1, .15, .3))], [.6, PZ({ Head: [.35, -.25, 0], Spine: [.1, -.1, -.1], hip: [-.04, -.06, 0] }, leg('L', 0, 0, .35), leg('R', 0, 0, .2), arm('L', .1, .15, .3), arm('R', .1, .15, .3)), 'inOutQuad'], [1.2, PZ({ Head: [.3, .25, 0], Spine: [.1, .1, .1], hip: [.04, -.06, 0] }, leg('L', 0, 0, .25), leg('R', 0, 0, .25), arm('L', .1, .15, .3), arm('R', .1, .15, .3)), 'inOutQuad']], { loop: true });
// 擊退仰飛:被打得上身後折 → 空中後仰滑行 → 背著地(落地瞬間對準位移 74%)→ 接倒地(holdDown)→ 起身
const _flyHands = (f, ab) => PZ(arm('L', f, ab, .1), arm('R', f, ab, .1));
defClip('受擊', 'flyBack', .62, 'full', [[0, {}], [.12, PZ({ Spine: [-.6, 0, 0], Chest: [-.25, 0, 0], Head: [-.55, 0, 0], tilt: -.35, lift: .15 }, _flyHands(-.6, 1.2), leg('L', .5, .2, .8), leg('R', .2, .2, .4)), 'outExpo'],
  [.27, PZ({ Spine: [-.4, 0, 0], Head: [-.35, 0, 0], tilt: -.7, lift: .3 }, _flyHands(-.5, 1.35), leg('L', .6, .25, 1.0), leg('R', .3, .25, .6)), 'inOutQuad'],
  [.42, PZ({ Spine: [-.4, 0, 0], Head: [-.35, 0, 0], tilt: -.85, lift: .1 }, _flyHands(-.5, 1.35), leg('L', .6, .25, 1.0), leg('R', .3, .25, .6)), 'inOutQuad'],
  [.5, PZ({ tilt: -1.2, lift: .05 }, _flyHands(-.2, 1.1), leg('L', .9, .2, .3)), 'outQuad'], [.62, POSE_DOWN_T, 'outQuad']], { holdDown: true, after: 'getUpFast' });
defClip('受擊', 'flyFwd', .62, 'full', [[0, {}], [.12, PZ({ Spine: [.5, 0, 0], Head: [-.2, 0, 0], tilt: .35, lift: .15 }, _flyHands(1.2, .5), leg('L', -.4, .1, .6), leg('R', -.4, .1, .6)), 'outExpo'],
  [.27, PZ({ Spine: [.5, 0, 0], Head: [-.2, 0, 0], tilt: .7, lift: .3 }, _flyHands(1.3, .5), leg('L', -.4, .1, .6), leg('R', -.4, .1, .6)), 'inOutQuad'],
  [.45, PZ({ Spine: [.4, 0, 0], Head: [-.3, 0, 0], tilt: 1.1, lift: .1 }, _flyHands(1.2, .6), leg('L', -.3, .1, .5), leg('R', -.3, .1, .5)), 'inOutQuad'], [.62, POSE_DOWN_FACE, 'outQuad']], { holdDown: true, after: 'getUpFace' });
defClip('受擊', 'knockDownFace', .45, 'full', [[0, {}], [.15, PZ({ Spine: [.4, 0, 0], tilt: .4 }, _flyHands(1.0, .5)), 'outQuad'], [.45, POSE_DOWN_FACE, 'outQuad']], { holdDown: true, after: 'getUpFace' });
defClip('受擊', 'getUpFast', .5, 'full', [[0, POSE_DOWN_T], [.2, PZ({ hip: [0, -.6, .1], Spine: [.7, 0, 0], tilt: -.2 }, leg('L', 1.3, .2, 1.9), leg('R', .7, -.2, 1.2), arm('L', .8, .5, .5), arm('R', .8, .5, .5)), 'outQuad'], [.5, {}, 'inOutQuad']], { dnSup: true });
defClip('受擊', 'getUpFace', .55, 'full', [[0, POSE_DOWN_FACE], [.2, PZ({ tilt: .9, Spine: [.3, 0, 0] }, arm('L', 1.4, .3, .2), arm('R', 1.4, .3, .2)), 'outQuad'], [.35, PZ({ hip: [0, -.5, 0], tilt: 0 }, leg('L', 1.0, .1, 1.6), leg('R', .2, .1, 1.9)), 'inOutQuad'], [.55, {}, 'inOutQuad']], { dnSup: true });

/* 長劍(swordShield / sword 通用:以 R 手持劍) */
defClip('長劍', 'sword.slash1', .5, 'upper', [[0, WPOSE.sword.ready], [.18, PZ(arm('R', 2.2, .7, 1.5), { Spine: [-.05, -.45, 0], Chest: [0, -.25, 0] }), 'outQuad'], [.26, PZ(arm('R', 1.2, -.1, .3), { Spine: [.3, .45, 0], Chest: [.1, .3, 0], Head: [.1, -.3, 0] }, arm('L', -.3, .5, .3)), 'outExpo'], [.5, WPOSE.sword.ready, 'inOutQuad']], { weapon: 'sword' });
defClip('長劍', 'sword.slash2', .5, 'upper', [[0, WPOSE.sword.ready], [.18, PZ(arm('R', 1.0, 1.1, .7), { Spine: [0, .5, 0], Chest: [0, .3, 0] }, arm('L', .2, .3, .5)), 'outQuad'], [.26, PZ(arm('R', 1.2, 1.3, .2), { Spine: [.1, -.6, 0], Chest: [0, -.4, 0], Head: [0, .4, 0] }), 'outExpo'], [.5, WPOSE.sword.ready, 'inOutQuad']], { weapon: 'sword' });
defClip('長劍', 'sword.slash3', .6, 'upper', [[0, WPOSE.sword.ready], [.22, PZ(arm('R', 2.5, .9, 1.9), { Spine: [-.2, -.5, 0], Chest: [-.1, -.3, 0] }), 'outQuad'], [.3, PZ(arm('R', 1.3, .0, .15), { Spine: [.5, .45, 0], Chest: [.2, .3, 0], hip: [0, -.12, .1] }, arm('L', -.4, .6, .3)), 'outExpo'], [.6, WPOSE.sword.ready, 'inOutQuad']], { weapon: 'sword' });
defClip('長劍', 'sword.charge', .8, 'upper', [[0, WPOSE.sword.ready], [.5, WPOSE.sword.prep, 'outQuad'], [.8, WPOSE.sword.prep, 'linear']], { weapon: 'sword' });
defClip('長劍', 'sword.whirl', .5, 'upper', [[0, PZ(arm('R', 1.5, 1.35, .3), arm('L', 1.5, 1.35, .3), { Spine: [.1, 0, 0] })], [.5, PZ(arm('R', 1.5, 1.35, .3), arm('L', 1.5, 1.35, .3), { Spine: [.1, 0, 0] })]], { weapon: 'sword', loop: true });
defClip('長劍', 'sword.whirlRun', .5, 'upper', [[0, PZ(arm('R', 1.1, 1.45, .2), arm('L', .3, .3, .5), { Spine: [.25, -.2, 0] })], [.5, PZ(arm('R', 1.1, 1.45, .2), arm('L', .3, .3, .5), { Spine: [.25, -.2, 0] })]], { weapon: 'sword', loop: true });
defClip('長劍', 'sword.leap', 1.0, 'full', [[0, WPOSE.sword.ready], [.3, PZ({ hip: [0, -.4, 0], Spine: [.3, 0, 0] }, leg('L', 1.2, .1, 2.0), leg('R', 1.0, -.1, 2.0), arm('R', 2.0, .5, 1.5), arm('L', .6, .6, .6)), 'outQuad'], [.55, PZ({ Spine: [-.15, 0, 0] }, arm('R', 2.8, .3, .2), arm('L', 2.4, .5, .3), leg('L', .3, .1, .6), leg('R', -.2, .1, .4)), 'outExpo'], [.75, PZ({ Spine: [.5, 0, 0], hip: [0, -.2, .1] }, arm('R', 1.0, .0, .1), arm('L', 1.0, .1, .1), leg('L', .8, .1, 1.2), leg('R', .6, -.1, 1.2)), 'outExpo'], [1, {}, 'inOutQuad']], { weapon: 'sword' });
defClip('長劍', 'sword.parry', .5, 'upper', [[0, WPOSE.sword.ready], [.1, PZ(arm('R', 1.3, .4, 1.9), { Spine: [-.1, -.3, 0], Chest: [0, -.2, 0] }, arm('L', .4, .4, .7)), 'outExpo'], [.3, PZ(arm('R', 1.3, .4, 1.9), { Spine: [-.1, -.3, 0], Chest: [0, -.2, 0] }, arm('L', .4, .4, .7)), 'linear'], [.5, WPOSE.sword.ready, 'inOutQuad']], { weapon: 'sword' });
/* 長弓 */
defClip('長弓', 'bow.shoot', .7, 'upper', [[0, WPOSE.bow.ready], [.25, WPOSE.bow.prep, 'outQuad'], [.35, WPOSE.bow.prep, 'linear'], [.4, WPOSE.bow.burst, 'outExpo'], [.7, WPOSE.bow.ready, 'inOutQuad']], { weapon: 'bow' });
defClip('長弓', 'bow.bigShot', 1.1, 'upper', [[0, WPOSE.bow.ready], [.6, PZ(WPOSE.bow.prep, arm('R', 1.1, .85, 2.5), { Spine: [-.25, .6, 0], Head: [-.1, -.6, 0] }), 'outQuad'], [.8, PZ(WPOSE.bow.prep, arm('R', 1.1, .85, 2.5), { Spine: [-.25, .6, 0], Head: [-.1, -.6, 0] }), 'linear'], [.85, PZ(WPOSE.bow.burst, { Spine: [.1, .55, 0] }), 'outExpo'], [1.1, WPOSE.bow.ready, 'inOutQuad']], { weapon: 'bow' });
defClip('長弓', 'bow.rain', .9, 'upper', [[0, WPOSE.bow.ready], [.4, PZ(arm('L', 2.1, .2, .05), arm('R', 1.9, .75, 2.4), { Spine: [-.45, .3, 0], Chest: [-.2, 0, 0], Head: [-.4, -.3, 0] }), 'outQuad'], [.5, PZ(arm('L', 2.1, .2, .05), arm('R', 1.7, 1.0, .5), { Spine: [-.4, .3, 0], Head: [-.4, -.3, 0] }), 'outExpo'], [.9, WPOSE.bow.ready, 'inOutQuad']], { weapon: 'bow' });
defClip('長弓', 'bow.backShot', .8, 'full', [[0, WPOSE.bow.ready], [.2, PZ(WPOSE.bow.prep, { hip: [0, -.1, 0] }, leg('L', .4, .1, .8), leg('R', -.3, .1, .5)), 'outQuad'], [.4, PZ(WPOSE.bow.burst, { Spine: [-.3, .5, 0], hip: [0, .05, -.2] }, leg('L', -.2, .1, .3), leg('R', -.3, .1, .3)), 'outExpo'], [.8, {}, 'inOutQuad']], { weapon: 'bow' });
/* 短法杖 */
defClip('短法杖', 'staff.tap', .4, 'upper', [[0, WPOSE.staff.ready], [.1, PZ(arm('R', .5, .2, 1.4), { Spine: [-.05, -.2, 0] }), 'outQuad'], [.16, PZ(arm('R', 1.35, .1, .3), { Spine: [.2, .1, 0] }), 'outExpo'], [.4, WPOSE.staff.ready, 'inOutQuad']], { weapon: 'staff' });
defClip('短法杖', 'staff.bolt', .55, 'upper', [[0, WPOSE.staff.ready], [.2, WPOSE.staff.prep, 'outQuad'], [.26, WPOSE.staff.burst, 'outExpo'], [.55, WPOSE.staff.ready, 'inOutQuad']], { weapon: 'staff' });
defClip('短法杖', 'staff.wall', .6, 'upper', [[0, WPOSE.staff.ready], [.2, PZ(arm('R', 1.3, 1.1, .6), { Spine: [0, .55, 0], Chest: [0, .3, 0] }, arm('L', .4, .6, .4)), 'outQuad'], [.3, PZ(arm('R', 1.3, .0, .6), { Spine: [.1, -.6, 0], Chest: [0, -.35, 0] }, arm('L', .2, .8, .4)), 'outExpo'], [.6, WPOSE.staff.ready, 'inOutQuad']], { weapon: 'staff' });
defClip('短法杖', 'staff.sky', .7, 'upper', [[0, WPOSE.staff.ready], [.3, PZ(arm('R', 3.0, .2, .3), arm('L', 1.2, .5, .4), { Spine: [-.3, 0, 0], Chest: [-.15, 0, 0], Head: [-.4, 0, 0] }), 'outQuad'], [.45, PZ(arm('R', 3.0, .2, .3), arm('L', 1.2, .5, .4), { Spine: [-.3, 0, 0], Head: [-.4, 0, 0] }, { Spine: [-.35, 0, 0] }), 'linear'], [.7, WPOSE.staff.ready, 'inOutQuad']], { weapon: 'staff' });
defClip('短法杖', 'staff.summon', .8, 'upper', [[0, WPOSE.staff.ready], [.3, PZ(arm('R', 2.8, .3, .4), arm('L', .9, .6, .4), { Spine: [-.25, 0, 0], Head: [-.3, 0, 0] }), 'outQuad'], [.45, PZ(arm('R', .9, .1, .9), { Spine: [.4, 0, 0], Chest: [.1, 0, 0], hip: [0, -.18, 0], Head: [.15, 0, 0] }, arm('L', .8, .6, .5), leg('L', .5, .1, 1.0), leg('R', .3, -.1, 1.0)), 'outExpo'], [.8, {}, 'inOutQuad']], { weapon: 'staff' });
defClip('短法杖', 'staff.buff', 1.0, 'upper', [[0, WPOSE.staff.ready], [.4, PZ(arm('R', 3.1, .15, .1), arm('L', 2.9, .3, .1), { Spine: [-.2, 0, 0], Head: [-.35, 0, 0] }), 'outQuad'], [.75, PZ(arm('R', 3.1, .15, .1), arm('L', 2.9, .3, .1), { Spine: [-.2, 0, 0], Head: [-.35, 0, 0] }), 'linear'], [1, WPOSE.staff.ready, 'inOutQuad']], { weapon: 'staff' });
/* 雙劍(設計_雙劍 §6):hand = 該片段主要出手的那隻手('L' / 'R' / 'B' 雙手),決定 tipWorld 與光軌起點 */
const _dR = (a, b, c, d) => arm('R', a, b, c, d), _dL = (a, b, c, d) => arm('L', a, b, c, d);
defClip('雙劍', 'dual.n1', .28, 'upper', [[0, WPOSE.dual.ready], [.07, PZ(_dR(2.3, .6, 1.5), { Spine: [-.05, -.35, 0] }), 'outQuad'], [.11, PZ(_dR(1.1, -.1, .3), { Spine: [.3, .35, 0], Chest: [.1, .2, 0] }, _dL(.3, .5, .6)), 'outExpo'], [.28, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'R' });
defClip('雙劍', 'dual.n2', .28, 'upper', [[0, WPOSE.dual.ready], [.07, PZ(_dL(2.3, .6, 1.5), { Spine: [-.05, .35, 0] }), 'outQuad'], [.11, PZ(_dL(1.1, -.1, .3), { Spine: [.3, -.35, 0], Chest: [.1, -.2, 0] }, _dR(.3, .5, .6)), 'outExpo'], [.28, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'L' });
defClip('雙劍', 'dual.n3', .3, 'upper', [[0, WPOSE.dual.ready], [.08, PZ(_dR(1.3, 1.2, .6), { Spine: [0, .5, 0] }), 'outQuad'], [.12, PZ(_dR(1.3, -.2, .4), { Spine: [.1, -.6, 0], Chest: [0, -.3, 0] }), 'outExpo'], [.3, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'R' });
defClip('雙劍', 'dual.n4', .3, 'upper', [[0, WPOSE.dual.ready], [.08, PZ(_dL(.2, .5, .4), { Spine: [.3, -.2, 0] }), 'outQuad'], [.13, PZ(_dL(2.6, .3, .2), { Spine: [-.2, .3, 0], Head: [-.15, 0, 0] }), 'outExpo'], [.3, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'L' });
defClip('雙劍', 'dual.n5', .44, 'upper', [[0, WPOSE.dual.ready], [.1, PZ(_dR(2.5, .9, 1.8), _dL(2.5, .9, 1.8), { Spine: [-.2, 0, 0], hip: [0, -.05, 0] }), 'outQuad'], [.2, PZ(_dR(1.0, -.3, .2), _dL(1.0, -.3, .2), { Spine: [.45, 0, 0], hip: [0, -.15, .15] }, leg('L', .6, .1, .9), leg('R', -.3, .1, .5)), 'outExpo'], [.3, PZ(_dR(1.0, -.3, .2), _dL(1.0, -.3, .2), { Spine: [.45, 0, 0], hip: [0, -.15, .15] }, leg('L', .6, .1, .9), leg('R', -.3, .1, .5)), 'linear'], [.44, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'B' });
defClip('雙劍', 'dual.charge', .6, 'upper', [[0, WPOSE.dual.prep], [.3, PZ(_dR(1.2, -.2, 1.9, .3), _dL(1.2, -.2, 1.9, .3), { Spine: [.28, 0, 0], Chest: [.1, 0, 0] }), 'inOutQuad'], [.6, WPOSE.dual.prep, 'inOutQuad']], { weapon: 'dual', hand: 'B', loop: true });
defClip('雙劍', 'dual.dash', .4, 'full', [[0, WPOSE.dual.prep], [.06, PZ({ Spine: [.55, 0, 0] }, _dR(-.6, .5, .2), _dL(-.6, .5, .2), leg('L', .9, .1, .5), leg('R', -.6, .1, .3)), 'outExpo'], [.4, PZ({ Spine: [.55, 0, 0] }, _dR(-.6, .5, .2), _dL(-.6, .5, .2), leg('L', .9, .1, .5), leg('R', -.6, .1, .3)), 'linear']], { weapon: 'dual', hand: 'B', hold: true });
defClip('雙劍', 'dual.flurry', .24, 'upper', [[0, PZ(_dR(1.5, .4, .3), _dL(.9, .7, 1.2), { Spine: [.2, -.25, 0] })], [.06, PZ(_dR(1.2, -.2, .2), _dL(.9, .7, 1.2), { Spine: [.2, -.25, 0] }), 'outExpo'], [.12, PZ(_dL(1.5, .4, .3), _dR(.9, .7, 1.2), { Spine: [.2, .25, 0] }), 'inOutQuad'], [.18, PZ(_dL(1.2, -.2, .2), _dR(.9, .7, 1.2), { Spine: [.2, .25, 0] }), 'outExpo'], [.24, PZ(_dR(1.5, .4, .3), _dL(.9, .7, 1.2), { Spine: [.2, -.25, 0] }), 'inOutQuad']], { weapon: 'dual', hand: 'B', loop: true });
defClip('雙劍', 'dual.flurryEnd', .35, 'full', [[0, WPOSE.dual.ready], [.08, PZ(_dR(2.5, .9, 1.8), _dL(2.5, .9, 1.8), { Spine: [-.2, 0, 0] }), 'outQuad'], [.16, PZ(_dR(1.0, -.3, .2), _dL(1.0, -.3, .2), { Spine: [.45, 0, 0], hip: [0, -.15, .15] }), 'outExpo'], [.35, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'B' });
defClip('雙劍', 'dual.cross', .45, 'upper', [[0, WPOSE.dual.ready], [.15, PZ(_dR(1.4, -.6, 1.8), _dL(1.4, -.6, 1.8), { Spine: [.15, 0, 0] }), 'outQuad'], [.2, PZ(_dR(1.3, 1.3, .2), _dL(1.3, 1.3, .2), { Spine: [-.1, 0, 0] }), 'outExpo'], [.45, WPOSE.dual.ready, 'inOutQuad']], { weapon: 'dual', hand: 'B' });
/* 自動備援(沒有專屬動作的招式,依 kind / aim 套通用姿勢;§1-4) */
defClip('通用備援', 'gen.throw', .5, 'upper', [[0, {}], [.18, PZ(arm('R', 2.4, .4, 1.5), { Spine: [-.2, -.35, 0] }, arm('L', .8, .5, .4)), 'outQuad'], [.26, PZ(arm('R', 1.3, .1, .1), { Spine: [.3, .3, 0] }, arm('L', -.3, .5, .3)), 'outExpo'], [.5, {}, 'inOutQuad']]);
defClip('通用備援', 'gen.slash', .5, 'upper', [[0, {}], [.18, PZ(arm('R', 2.3, .6, 1.5), { Spine: [-.1, -.4, 0] }), 'outQuad'], [.26, PZ(arm('R', 1.1, -.1, .3), { Spine: [.3, .4, 0] }), 'outExpo'], [.5, {}, 'inOutQuad']]);
defClip('通用備援', 'gen.overhead', .6, 'upper', [[0, {}], [.3, PZ(arm('R', 3.0, .2, .3), arm('L', 2.8, .3, .3), { Spine: [-.3, 0, 0], Head: [-.4, 0, 0] }), 'outQuad'], [.6, {}, 'inOutQuad']]);
defClip('通用備援', 'gen.thrust', .45, 'upper', [[0, {}], [.15, PZ(arm('R', .6, .3, 1.8), { Spine: [-.05, -.4, 0] }), 'outQuad'], [.22, PZ(arm('R', 1.5, .05, .05), { Spine: [.25, .35, 0] }), 'outExpo'], [.45, {}, 'inOutQuad']]);
defClip('通用備援', 'gen.sweep', .55, 'upper', [[0, {}], [.2, PZ(arm('R', 1.4, 1.1, .5), { Spine: [0, .5, 0] }), 'outQuad'], [.3, PZ(arm('R', 1.4, .0, .5), { Spine: [.1, -.55, 0] }), 'outExpo'], [.55, {}, 'inOutQuad']]);
defClip('通用備援', 'gen.self', .6, 'upper', [[0, {}], [.3, PZ(arm('R', .9, .5, 1.5), arm('L', .9, .5, 1.5), { Spine: [.1, 0, 0] }), 'outQuad'], [.6, {}, 'inOutQuad']]);
// 動作 id(快照 a 欄位的 aId,6 位元 0~63;設計_劍技光效與受擊反應 §4-6;0 = 無)。24~55 = 招式片段(普攻光軌遠端靠這段觸發)
const ACT_NAMES = [null, 'hitSmall', 'hitSmallRear', 'hitBig', 'hitBigRear', 'hitBig+hitSlide', 'hitBigRear+hitSlide', 'stagger', 'flyBack', 'flyFwd', 'knockDown', 'knockDownFace', 'downTwitch', 'rollUp', 'getUp', null, 'swapWeapon', 'die', 'revive'];
while (ACT_NAMES.length < 24) ACT_NAMES.push(null);
['sword.slash1', 'sword.slash2', 'sword.slash3', 'dual.n1', 'dual.n2', 'dual.n3', 'dual.n4', 'dual.n5', 'dual.dash', 'dual.flurry', 'dual.cross', 'sword.charge', 'bow.shoot'].forEach(n => ACT_NAMES.push(n));
const ACT_ID = {}; ACT_NAMES.forEach((n, i) => { if (n) ACT_ID[n] = i; });
const KIND_ACT = { bolt: 'gen.throw', wall: 'gen.sweep', sky: 'gen.overhead', line: 'gen.thrust', front: 'gen.slash', self: 'gen.self' };

// 跳躍方向傾斜:ang = 相對面向的方向(0 前、π/2 右、π 後、-π/2 左);k = 0..1;前跳 = 現況(不加),後跳後仰、側跳往側邊傾且該側腿外展
function dirLean(out, ang, k) {
  const dx = -Math.sin(ang), back = Math.max(0, -Math.cos(ang)), I = n => POSE_IX[n] * 3, h = I('Hips'), sp = I('Spine'), lt = I('LThigh'), rt = I('RThigh'), ls = I('LShin'), rs = I('RShin');
  out[h] -= back * .3 * k; out[h + 2] -= dx * .22 * k; out[sp] -= back * .2 * k; out[sp + 2] -= dx * .15 * k;
  out[lt + 2] += Math.max(0, dx) * .45 * k; out[rt + 2] -= Math.max(0, -dx) * .45 * k;
  out[lt] -= back * .25 * k; out[rt] -= back * .25 * k; out[ls] += Math.abs(dx) * .3 * k; out[rs] += Math.abs(dx) * .3 * k;
}
// 編譯片段(第一次使用時把稀疏姿勢展開成完整陣列)
function clipCompile(c) {
  if (c._k) return c;
  c._k = c.keys.map(k => ({ t: k[0], p: k[1] instanceof Float32Array ? k[1] : mkPose(k[1]), e: EASE[k[2]] || EASE.inOutQuad }));
  return c;
}
// 取樣:tt(秒)→ out(完整姿勢);回傳 false = 已超過片段長度(非循環)
function clipSample(c, tt, out) {
  clipCompile(c); const K = c._k;
  if (c.loop) tt = tt % c.dur;
  if (tt <= K[0].t) { out.set(K[0].p); return true; }
  for (let i = 1; i < K.length; i++) {
    if (tt <= K[i].t) { const a = K[i - 1], b = K[i], u = (tt - a.t) / Math.max(1e-4, b.t - a.t), e = b.e(u); for (let j = 0; j < POSE_LEN; j++) out[j] = a.p[j] + (b.p[j] - a.p[j]) * e; return true; }
  }
  out.set(K[K.length - 1].p); return tt <= c.dur;
}
