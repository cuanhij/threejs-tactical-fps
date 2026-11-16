// The DOM HUD: health and armour bars, ammo, money, timer, team score, kill feed,
// bomb status, a crosshair that opens with spread, a hit marker, a damage
// direction indicator, the buy menu, round banners and the start/pause/end
// overlays. It never touches the simulation; game.js pushes numbers in and reads
// the buy and play callbacks out. Every setter skips the DOM when nothing changed.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armourFill = $('armour-fill');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreEmber = $('score-ember');
  const scoreAshen = $('score-ashen');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageDir = $('damage-dir');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const vignette = $('vignette');
  const flashOverlay = $('flash-overlay');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(health, armour) {
      setText(healthNum, 'health', String(Math.ceil(health)));
      const h = Math.max(0, Math.min(100, health));
      const a = Math.max(0, Math.min(100, armour));
      if (last.healthFill !== h) {
        last.healthFill = h;
        healthFill.style.width = `${h}%`;
      }
      if (last.armourFill !== a) {
        last.armourFill = a;
        armourFill.style.width = `${a}%`;
      }
      healthFill.classList.toggle('low', h <= 30);
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', name);
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerValue.classList.toggle('urgent', s <= 10);
    },
    setScore(ember, ashen) {
      setText(scoreEmber, 'se', String(ember));
      setText(scoreAshen, 'sa', String(ashen));
    },
    setBomb(text, kind) {
      setText(bombStatus, 'bomb', text);
      if (last.bombKind !== kind) {
        last.bombKind = kind;
        bombStatus.className = kind ? `bomb-${kind}` : '';
      }
    },
    setSpread(gapPx) {
      const gap = Math.round(gapPx);
      if (last.gap === gap) return;
      last.gap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleDeg) {
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      damageDir.classList.add('on');
      setTimeout(() => damageDir.classList.remove('on'), 600);
    },
    damageVignette() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 220);
    },
    flash(strength) {
      flashOverlay.style.opacity = String(strength);
      setTimeout(() => {
        flashOverlay.style.opacity = '0';
      }, 60);
    },
    killfeed(killer, victim, head, killerTeam) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const k = document.createElement('b');
      k.textContent = killer;
      k.className = killerTeam === 'ember' ? 'ember' : 'ashen';
      const v = document.createElement('b');
      v.textContent = victim;
      v.className = killerTeam === 'ember' ? 'ashen' : 'ember';
      line.append(k, document.createTextNode(head ? ' ⌖ ' : '  ✕  '), v);
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    banner(main, sub, ms = 2600) {
      bannerTitle.textContent = main;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuy(items, money) {
      buyMenu.hidden = false;
      buyMoney.textContent = `$${money}`;
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.key = item.key;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
        row.disabled = item.owned || money < item.price;
        buyItems.appendChild(row);
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    onBuy(handler) {
      buyItems.addEventListener('click', (event) => {
        const row = event.target.closest('.buy-row');
        if (row && !row.disabled) handler(row.dataset.key);
      });
    },
    setPlant(label, fraction) {
      if (fraction == null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    showOverlay(mode, titleText, copyText, actionText) {
      title.textContent = titleText;
      copy.textContent = copyText;
      play.textContent = actionText;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
