// HUD, squad panel, hints, and messages (aria-live). Reads game state only.

import { DT, ROUT_BELOW } from '../core/config.ts';
import type { GameEvent, GameState, Squad } from '../core/types.ts';
import { buildingName, dirName, getLang, t, traitName, unitName, unitRole, type Key } from './i18n.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const HINT_COUNT = 5;

export class Hud {
  private readonly wave = $('wave');
  private readonly phase = $('phase');
  private readonly callWave = $<HTMLButtonElement>('call-wave');
  private readonly panel = $('panel');
  private readonly title = $('panel-title');
  private readonly pstate = $('panel-state');
  private readonly morale = $('panel-morale');
  private readonly moraleText = $('panel-morale-text');
  private readonly list = $('panel-warriors');
  private readonly shield = $<HTMLButtonElement>('shield');
  private readonly horn = $<HTMLButtonElement>('horn');
  private readonly hint = $('hint');
  private readonly toastEl = $('toast');
  private readonly live = $('live');
  private toastTimer = 0;
  private hintIdx = 0;
  private hintTimer = 0;
  private lastPanelKey = '';

  showHints(): void {
    this.hintIdx = 0;
    this.hintTimer = 0;
    this.hint.hidden = false;
    this.hint.textContent = t('hint.0');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastTimer = 3.2;
  }

  announce(text: string): void {
    this.live.textContent = text;
  }

  onEvents(s: GameState, ev: GameEvent[]): void {
    for (const e of ev) {
      if (e.t === 'boatSpawned') this.say(t('msg.boat', { dir: dirName(e.dir) }));
      else if (e.t === 'waveStarted') this.hint.hidden = true;
      else if (e.t === 'waveCleared') this.say(t('msg.waveCleared', { n: e.wave + 1 }));
      else if (e.t === 'routed' && e.side === 'player') this.say(t('msg.routed', { unit: this.nameOf(s, e.squadId) }));
      else if (e.t === 'rallied') this.say(t('msg.rallied', { unit: this.nameOf(s, e.squadId) }));
      else if (e.t === 'buildingDestroyed') this.say(t('msg.buildingFell', { name: buildingName(s.buildings[e.building].key) }));
      else if (e.t === 'routed' && e.side === 'enemy') this.say(t('msg.enemyFlee'));
    }
  }

  private say(text: string): void {
    this.toast(text);
    this.announce(text);
  }

  private nameOf(s: GameState, id: number): string {
    const q = s.squads.find((x) => x.id === id);
    return q ? unitName(q.type) : '';
  }

  update(s: GameState, selected: Squad | undefined, realDt: number): void {
    this.wave.textContent = t('hud.wave', { n: Math.min(s.waveIndex + 1, s.waves.length), total: s.waves.length });
    let phase = '';
    if (s.phase === 'prep') phase = t('phase.prep', { s: Math.max(0, Math.ceil((s.phaseEnd - s.tick) * DT)) });
    else phase = t(`phase.${s.phase}` as Key);
    this.phase.textContent = phase;
    this.callWave.hidden = s.phase !== 'prep';

    const hornCd = Math.max(0, Math.ceil((s.hornReady - s.tick) * DT));
    this.horn.disabled = hornCd > 0;
    this.horn.textContent = hornCd > 0 ? t('hud.hornCd', { s: hornCd }) : t('hud.horn');

    if (this.toastTimer > 0) {
      this.toastTimer -= realDt;
      if (this.toastTimer <= 0) this.toastEl.hidden = true;
    }
    if (!this.hint.hidden) {
      if (s.phase === 'prep' && s.waveIndex === 0) {
        this.hintTimer += realDt;
        if (this.hintTimer > 7 && this.hintIdx < HINT_COUNT - 1) {
          this.hintTimer = 0;
          this.hintIdx++;
        }
      }
      // re-set every frame only when the text differs (language switch or next hint)
      const text = t(`hint.${this.hintIdx}` as Key);
      if (this.hint.textContent !== text) this.hint.textContent = text;
    }
    this.updatePanel(s, selected);
  }

  private updatePanel(s: GameState, sq: Squad | undefined): void {
    if (!sq || sq.side !== 'player' || sq.mode === 'dead') {
      this.panel.hidden = true;
      this.lastPanelKey = '';
      return;
    }
    this.panel.hidden = false;
    this.panel.dataset.type = sq.type;
    const m = Math.round(sq.morale);
    const shieldCd = Math.max(0, Math.ceil((sq.shieldReady - s.tick) * DT));
    const shieldOn = sq.shieldUntil > s.tick;
    const hp = sq.warriors.map((w) => Math.ceil(w.hp)).join(',');
    const key = `${getLang()}|${sq.id}|${m}|${sq.mode}|${hp}|${shieldCd}|${shieldOn}|${sq.order.kind}|${sq.targetId}`;
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;

    this.title.textContent = unitName(sq.type);
    let state = unitRole(sq.type);
    if (sq.mode === 'routing') state = t('panel.routing');
    else if (sq.targetId >= 0) state = sq.contact ? t('panel.fighting') : t('panel.shooting');
    else if (sq.order.kind === 'move') state = t('panel.marching');
    this.pstate.textContent = state;
    this.morale.setAttribute('aria-valuenow', String(m));
    (this.morale.firstElementChild as HTMLElement).style.width = `${m}%`;
    this.morale.classList.toggle('low', m < ROUT_BELOW + 15);
    this.moraleText.textContent = t(m >= 60 ? 'panel.moraleSteady' : m >= 35 ? 'panel.moraleUneasy' : 'panel.moraleWavering', { n: m });

    const items = sq.warriors.map((w) => {
      const li = document.createElement('li');
      if (!w.alive) li.className = 'fallen';
      const name = document.createElement('span');
      name.textContent = w.name;
      const trait = document.createElement('span');
      trait.className = 'trait';
      trait.textContent = traitName(w.trait);
      const hpEl = document.createElement('span');
      hpEl.textContent = w.alive ? `${Math.ceil(w.hp)}/${w.maxHp}` : t('panel.departed');
      li.append(name, trait, hpEl);
      return li;
    });
    this.list.replaceChildren(...items);

    this.shield.hidden = sq.type !== 'guard';
    this.shield.disabled = shieldCd > 0 || sq.mode !== 'ready';
    this.shield.textContent = shieldOn ? t('panel.shieldUp') : shieldCd > 0 ? t('panel.shieldCd', { s: shieldCd }) : t('panel.shield');
  }
}
