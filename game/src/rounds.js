// Rounds and money. One state machine: buy -> fight -> over -> buy ... First to
// 8 round wins takes the match. Money comes from kills, round wins and plants,
// and is spent in the buy menu between rounds. Nothing here touches the DOM:
// game.js reads the state and hud.js draws it.
import { WEAPONS, GRENADES } from './weapons.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const WIN_ROUNDS = 8;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

export const ECONOMY = {
  kill: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plant: 300,
  start: 800,
};

export function createRounds() {
  const state = {
    phase: 'buy', // buy | fight | over
    phaseLeft: BUY_TIME,
    round: 1,
    scoreEmber: 0,
    scoreAshen: 0,
    bombPlanted: false,
    bombLeft: 0,
    bombSite: null,
    matchOver: false,
    matchWinner: null,
    lastWinner: null,
  };

  function buyItems(owned, grenades) {
    const items = [];
    for (const [key, def] of Object.entries(WEAPONS)) {
      items.push({
        key,
        name: def.name,
        desc: `DMG ${def.damage} · ${def.mag} rounds`,
        price: def.price,
        owned: owned.includes(key),
      });
    }
    for (const [key, def] of Object.entries(GRENADES)) {
      items.push({
        key: `grenade-${key}`,
        name: def.name,
        desc: key === 'frag' ? 'Blast damage in a radius' : key === 'smoke' ? 'Blocks sight for 12 s' : 'Blinds anyone looking',
        price: def.price,
        owned: false,
      });
    }
    items.push({
      key: 'armour',
      name: 'Plate Armour',
      desc: 'Absorbs half of every hit',
      price: 650,
      owned: false,
    });
    void grenades;
    return items;
  }

  return {
    state,
    startBuy() {
      state.phase = 'buy';
      state.phaseLeft = BUY_TIME;
      state.bombPlanted = false;
      state.bombLeft = 0;
      state.bombSite = null;
    },
    startFight() {
      state.phase = 'fight';
      state.phaseLeft = ROUND_TIME;
    },
    plant(site) {
      state.bombPlanted = true;
      state.bombLeft = BOMB_TIME;
      state.bombSite = site;
    },
    // Returns the winner ('ember' | 'ashen') or null. Ends the round on a win.
    endRound(winner, reason) {
      if (state.phase === 'over') return null;
      state.phase = 'over';
      state.phaseLeft = 4;
      state.lastWinner = winner;
      if (winner === 'ember') state.scoreEmber += 1;
      else state.scoreAshen += 1;
      if (state.scoreEmber >= WIN_ROUNDS || state.scoreAshen >= WIN_ROUNDS) {
        state.matchOver = true;
        state.matchWinner = state.scoreEmber >= WIN_ROUNDS ? 'ember' : 'ashen';
      }
      return { winner, reason };
    },
    nextRound() {
      state.round += 1;
      state.bombPlanted = false;
      state.bombLeft = 0;
      state.bombSite = null;
      state.phase = 'buy';
      state.phaseLeft = BUY_TIME;
    },
    buyItems,
  };
}
