'use strict';
// 召喚框架(任務 S-1)尚未實作。階段 0 只提供暫代的 castSummon 與空的 updateSummons,讓第 4 格的選取、冷卻與 HUD 可以運作。
function castSummon(P, orb) { dissolveOrb(orb, EL[P.el]); banner('召喚(未實作)', '#ccc'); }
function updateSummons(dt) { }
