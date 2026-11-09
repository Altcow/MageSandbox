'use strict';
// 火系大招(階段 0 暫代):隕石墜擊(階段 1-C)完成前,先呼叫舊的隕石 castMeteor。SHAPE_FN_NAME.fire.sky = 'castCraterMeteor'。
function castCraterMeteor(P, orb) { castMeteor(P, orb); }
