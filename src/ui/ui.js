/**
 * 界面层：只负责渲染与事件绑定，所有规则都在 core/ 里。
 * 布局：手机单栏 + 底部导航；平板两栏；桌面三栏（左属性 / 中场景与操作 / 右日志）。
 */
import { getRng, reseed } from '../core/rng.js';
import {
  addLog,
  ageYears,
  createCharacter,
  expPercent,
  isAtPeak,
  isDead,
  lifespanYears,
  maxHp,
  realmName,
  rollBackground,
  sanitize,
  timeLabel,
} from '../core/gameState.js';
import { CULTIVATE_MONTHS } from '../core/cultivation.js';
import { ACTIONS, resolveAction } from '../core/actions.js';
import { COMBAT_ACTIONS, shouldTeachThunderDefense } from '../core/combat.js';
import { pickEnemy } from '../data/enemies.js';
import { buildTurnTimeline } from '../core/turnTimeline.js';
import { SPEED_OPTIONS, loadPrefs, markThunderHintShown, setAnimationSpeed, shouldShowThunderHint } from '../core/prefs.js';
import { canBreakthrough, breakthroughChance, breakthroughForecast } from '../core/breakthrough.js';
import * as Save from '../core/saveManager.js';
import { getRealm, isFinalRealm } from '../data/realms.js';
import { getRoot, getTalent } from '../data/backgrounds.js';
import { getEventById } from '../data/events.js';

let character = null;
let view = 'welcome';
let pending = null;
let blobUrlToRevoke = null;

const app = { el: null };
const NAV = [['洞府', 'home'], ['属性', 'stats'], ['日志', 'log'], ['设置', 'settings']];

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'g', 'defs', 'linearGradient', 'stop', 'ellipse']);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 极简 DOM 构造器（自动识别 SVG 标签，否则 <svg> 里的图形不会渲染） */
function h(tag, attrs = {}, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function toast(message, bad = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = h('div', { class: bad ? 'toast bad' : 'toast', text: message });
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

/** 操作反馈：数值浮动 */
function floatText(text, kind = 'gain') {
  const layer = h('div', { class: 'float-layer' }, h('div', { class: `float-text ${kind}`, text }));
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1100);
}

/** 操作反馈：全屏闪光（只用于突破、胜负等里程碑） */
function flash(kind = 'gold') {
  const el = h('div', { class: `flash ${kind}` });
  document.body.append(el);
  setTimeout(() => el.remove(), 900);
}

/** 局部脉冲：只在发生变化的元素上做一次高亮，不做全屏效果 */
function pulseElement(target) {
  if (!target) return;
  target.classList.remove('value-pulse');
  void target.offsetWidth;
  target.classList.add('value-pulse');
  setTimeout(() => target.classList.remove('value-pulse'), 520);
}

/** 修为收益：脉冲修为进度条 */
function pulseExp() {
  const bar = document.querySelector('.bar.exp');
  pulseElement(bar);
  pulseElement(bar && bar.closest('.card'));
}

/** 灵石收益：脉冲灵石数值 */
function pulseStones() {
  const candidates = Array.from(document.querySelectorAll('.stat-value, .v'));
  const target = candidates.find((el) => /^\d+$/.test(el.textContent.trim()));
  pulseElement(target || document.querySelector('.col-side'));
}

/* ------------------------------ 奇遇弹窗 ------------------------------ */
let activeEvent = null;
let activeCombat = null;

function openEventModal(event) {
  // P0-1：始终只保留一个弹窗
  const stale = document.querySelector('.event-overlay');
  if (stale) stale.remove();
  activeEvent = event;
  const close = () => {
    const existing = document.querySelector('.event-overlay');
    if (existing) existing.remove();
    activeEvent = null;
  };

  const overlay = h(
    'div',
    { class: 'event-overlay' },
    h(
      'div',
      { class: 'card event-card stack' },
      h('p', { class: 'event-title', text: event.title }),
      h('p', { class: 'event-desc', text: event.desc }),
      h(
        'div',
        { class: 'choices' },
        event.choices.map((choice) =>
          h('button', {
            class: 'btn ghost',
            text: choice.text,
            onclick: (e) => {
              e.stopPropagation();
              chooseEvent(event, choice.id);
            },
          })
        )
      )
    )
  );
  // P1-4：奇遇是必须解决的状态，点遮罩不能关闭，只能做选择
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      toast('请先做出选择，奇遇才能了结');
    }
  });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}

function chooseEvent(event, choiceId) {
  const buttons = document.querySelectorAll('.event-overlay .choices button');
  for (const btn of buttons) btn.disabled = true;
  const overlay = document.querySelector('.event-overlay');
  const result = resolveAction(character, ACTIONS.CHOOSE, getRng(), { eventId: event.id, choiceId });
  if (overlay) overlay.remove();
  activeEvent = null;
  if (!result.ok) return toast(result.error, true);
  character = result.character;

  autosave();
  render();

  const deltas = result.detail.deltas || {};
  if (deltas.exp) floatText(`修为 ${deltas.exp > 0 ? '+' : ''}${deltas.exp}`, deltas.exp > 0 ? 'gain' : 'loss');
  if (deltas.stones) floatText(`灵石 ${deltas.stones > 0 ? '+' : ''}${deltas.stones}`, deltas.stones > 0 ? 'gain' : 'loss');
  if (deltas.hp && deltas.hp < 0) flash('red');
  if (deltas.exp > 0) pulseExp();
  if (deltas.stones > 0) pulseStones();
  toast(result.detail.outcome.text);
}

function autosave() {
  if (!character) return false;
  const result = Save.saveToStorage(character);
  if (!result.ok) toast(result.error, true);
  return Boolean(result.ok);
}

export function mount(rootEl) {
  app.el = rootEl;
  render();
}

function render() {
  if (!app.el) return;
  if (blobUrlToRevoke) {
    URL.revokeObjectURL(blobUrlToRevoke);
    blobUrlToRevoke = null;
  }
  clear(app.el);
  const page = {
    welcome: renderWelcome,
    create: renderCreate,
    home: renderHome,
    explore: renderExplore,
    stats: renderStats,
    log: renderLog,
    settings: renderSettings,
    dead: renderDead,
    ending: renderEnding,
  }[view]();
  app.el.append(page);

  if (character && character.pendingEvent && !document.querySelector('.event-overlay')) {
    const pending = getEventById(character.pendingEvent.eventId);
    if (pending) openEventModal(pending);
  }
  if (character && character.combat && character.combat.status === 'active' && !document.querySelector('.combat-overlay')) {
    openCombatModal();
  }

  if (NAV.some(([, target]) => target === view)) {
    app.el.append(
      h(
        'nav',
        { class: 'tabbar' },
        NAV.map(([label, target]) =>
          h('button', {
            text: label,
            'aria-current': view === target ? 'true' : 'false',
            onclick: () => {
              view = target;
              render();
            },
          })
        )
      )
    );
  }
}

/* ------------------------------------------------------------------ 公共片段 */
function headerBar(right) {
  return h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      {},
      h('div', { class: 'name', text: character ? character.name : '凡人问道' }),
      h('div', { text: character ? `${realmName(character)} · ${getRoot(character.rootId).name} · ${getTalent(character.talentId).name}` : '青云修仙录' })
    ),
    right,
    h(
      'nav',
      { class: 'nav-desktop' },
      NAV.map(([label, target]) =>
        h('button', {
          text: label,
          'aria-current': view === target ? 'true' : 'false',
          onclick: () => {
            view = target;
            render();
          },
        })
      )
    )
  );
}

/** 场景：用 SVG 画的水墨山水，随境界换层 */
function renderScene() {
  const tier = character ? (character.realmId >= 13 ? 2 : character.realmId >= 10 ? 1 : 0) : 0;
  const captions = ['青云山 · 简陋洞府', '青云山 · 灵气道场', '金丹祭坛 · 雷云神兽'];
  const sources = ['/scene-dongfu.jpg', '/scene-dongfu.jpg', '/scene-boss.jpg'];
  return h(
    'div',
    { class: `scene scene-tier-${tier}` },
    h('img', {
      class: 'scene-img',
      src: sources[tier],
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    }),
    h('div', { class: 'mist' }),
    h('div', { class: 'caption', text: captions[tier] })
  );
}
function statBox(key, value) {
  return h('div', { class: 'stat' }, h('div', { class: 'k', text: key }), h('div', { class: 'v', text: value }));
}

function monthLabel(month) {
  const year = Math.floor(month / 12);
  const season = ['春', '夏', '秋', '冬'][Math.floor((month % 12) / 3)] || '春';
  return `第 ${year} 年 · ${season}`;
}

/* ------------------------------ 战斗弹窗 ------------------------------ */
/** 战斗弹窗的 DOM 引用：整场战斗只挂载一次，之后只做局部更新 */
const combatUI = {
  overlay: null,
  enemyBar: null,
  enemyNum: null,
  myBar: null,
  myNum: null,
  skillBtn: null,
  itemBtn: null,
  actionBtns: [],
  logBox: null,
  stage: null,
  playerBox: null,
  enemyBox: null,
  timers: [],
  busy: false,
};

function clearCombatTimers() {
  for (const timer of combatUI.timers) clearTimeout(timer);
  combatUI.timers = [];
}

function schedule(fn, ms) {
  combatUI.timers.push(setTimeout(fn, ms));
}

/** 只更新冷却、按钮状态与日志；气血条默认由动画阶段负责，避免「数字先跳、动画后到」 */
function updateCombatUI({ syncBars = true } = {}) {
  const combat = character && character.combat;
  if (!combat || !combatUI.overlay) return;

  if (syncBars) {
    if (combatUI.enemyBar) combatUI.enemyBar.style.width = Math.max(0, (combat.enemyHp / combat.enemyMaxHp) * 100) + '%';
    if (combatUI.enemyNum) combatUI.enemyNum.textContent = `${combat.enemyHp} / ${combat.enemyMaxHp}`;
    if (combatUI.myBar) combatUI.myBar.style.width = Math.max(0, (character.hp / maxHp(character)) * 100) + '%';
    if (combatUI.myNum) combatUI.myNum.textContent = `${character.hp} / ${maxHp(character)}`;
  }

  if (combatUI.skillBtn) {
    const cooling = combat.cooldown > 0;
    combatUI.skillBtn.textContent = cooling ? `催动技能（冷却 ${combat.cooldown}）` : '催动技能（威力 ×1.9）';
    combatUI.skillBtn.disabled = cooling || combatUI.busy;
  }
  for (const btn of combatUI.actionBtns) btn.disabled = combatUI.busy;

  if (combatUI.telegraphBar) {
    const threatening = combat.isBoss && combat.telegraph;
    const residual = Boolean(combat.isBoss && combat.residualThunder > 0);
    combatUI.telegraphBar.textContent = threatening
      ? '雷云已聚：下一击是雷霆，按「运功防御」可大幅减伤'
      : residual
        ? '余雷未散：本回合仍可运化，否则会继续受伤'
        : combat.isBoss
          ? '镇坛古灵 · 第 ' + (combat.phase || 1) + ' 阶段'
          : '';
    combatUI.telegraphBar.classList.toggle('active', Boolean(threatening || residual));
  }

  const stock = character.inventory && Number.isFinite(character.inventory.healingPill) ? character.inventory.healingPill : 0;
  const usedThisBattle = (character.combat && character.combat.pillsUsed) || 0;
  const capped = usedThisBattle >= 2;
  if (combatUI.stonesNum) combatUI.stonesNum.textContent = String(character.stones);
  if (combatUI.pillNum) combatUI.pillNum.textContent = '×' + stock;
  if (combatUI.itemBtn) {
    const affordable = stock > 0 && !capped;
    combatUI.itemBtn.disabled = combatUI.busy || !affordable;
    if (capped) combatUI.itemBtn.textContent = '此战已服 2 枚，不可再服';
    else if (stock <= 0) combatUI.itemBtn.textContent = '疗伤丹不足（洞府丹房可购）';
    else combatUI.itemBtn.textContent = '服用疗伤丹（库存 ×' + stock + '，回血 30%）';
  }

  if (combatUI.logBox) {
    const lines = (combat.log || []).slice(-4);
    combatUI.logBox.textContent = '';
    for (const line of lines) combatUI.logBox.append(h('div', { class: 'combat-log-line', text: line }));
    combatUI.logBox.scrollTop = combatUI.logBox.scrollHeight;
  }
}

/* ---------------- 战斗动作动画（纯展示，不改数值） ---------------- */
function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function replayClass(el, cls, duration) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  schedule(() => el.classList.remove(cls), duration);
}

function fighterBox(side) {
  return side === 'player' ? combatUI.playerBox : combatUI.enemyBox;
}

function animateAttack(side) {
  replayClass(fighterBox(side), 'lunge-' + side, 460);
}

function animateHurt(side) {
  replayClass(fighterBox(side), 'hurt', 480);
  replayClass(fighterBox(side), 'knockback-' + side, 420);
}

function stagePoint(side, ratioY) {
  const target = fighterBox(side);
  if (!target || !combatUI.stage) return null;
  const stageRect = combatUI.stage.getBoundingClientRect();
  const boxRect = target.getBoundingClientRect();
  return {
    left: boxRect.left - stageRect.left + boxRect.width / 2,
    top: boxRect.top - stageRect.top + boxRect.height * ratioY,
  };
}

function showDamageNumber(side, amount, variant) {
  if (!combatUI.stage || !amount) return;
  const point = stagePoint(side, 0.22);
  if (!point) return;
  const text = variant === 'heal' ? '+ ' + amount : '- ' + amount;
  const el = h('div', { class: 'damage-number ' + variant, text });
  el.style.left = point.left + 'px';
  el.style.top = point.top + 'px';
  combatUI.stage.append(el);
  schedule(() => el.remove(), 950);
}

function showSlash(side, isSkill) {
  if (combatUI.stage) {
    const point = stagePoint(side, 0.42);
    if (point) {
      const el = h('div', { class: 'slash-effect' + (isSkill ? ' skill' : '') });
      el.style.left = point.left + 'px';
      el.style.top = point.top + 'px';
      combatUI.stage.append(el);
      schedule(() => el.remove(), 430);
    }
  }
}

function syncBar(side) {
  const combat = character.combat;
  if (side === 'enemy') {
    if (combatUI.enemyBar && combat) combatUI.enemyBar.style.width = Math.max(0, (combat.enemyHp / combat.enemyMaxHp) * 100) + '%';
    if (combatUI.enemyNum && combat) combatUI.enemyNum.textContent = `${combat.enemyHp} / ${combat.enemyMaxHp}`;
  } else {
    if (combatUI.myBar) combatUI.myBar.style.width = Math.max(0, (character.hp / maxHp(character)) * 100) + '%';
    if (combatUI.myNum) combatUI.myNum.textContent = `${character.hp} / ${maxHp(character)}`;
  }
}

/** 执行一个展示阶段：只动 DOM，绝不改角色数值 */
function applyTimelineStep(step) {
  switch (step.kind) {
    case 'windup':
      replayClass(combatUI.playerBox, 'windup', 120);
      break;
    case 'playerLunge':
      animateAttack('player');
      break;
    case 'enemyHurt':
      animateHurt('enemy');
      showSlash('enemy', Boolean(step.isSkill));
      break;
    case 'applyEnemyBar':
      syncBar('enemy');
      break;
    case 'showEnemyDamage':
      showDamageNumber('enemy', step.value, step.isSkill ? 'skill' : 'hit');
      break;
    case 'enemyCounter':
      animateAttack('enemy');
      break;
    case 'playerHurt':
      animateHurt('player');
      showSlash('player', false);
      break;
    case 'applyMyBar':
      syncBar('player');
      break;
    case 'showMyDamage':
      showDamageNumber('player', step.value, 'hit');
      break;
    case 'healNumber':
      showDamageNumber('player', step.value, 'heal');
      break;
    case 'release':
      combatUI.busy = false;
      updateCombatUI();
      break;
    default:
      break;
  }
}
function closeCombatModal() {
  clearCombatTimers();
  if (combatUI.overlay) combatUI.overlay.remove();
  combatUI.overlay = null;
  combatUI.enemyBar = null;
  combatUI.enemyNum = null;
  combatUI.myBar = null;
  combatUI.myNum = null;
  combatUI.skillBtn = null;
  combatUI.telegraphBar = null;
  combatUI.itemBtn = null;
  combatUI.stonesNum = null;
  combatUI.pillNum = null;
  combatUI.actionBtns = [];
  combatUI.logBox = null;
  combatUI.stage = null;
  combatUI.playerBox = null;
  combatUI.enemyBox = null;
  combatUI.busy = false;
}

/** 战斗开始时挂载一次；战斗中若已存在则只更新 */
function openCombatModal() {
  const combat = character && character.combat;
  if (!combat || combat.status !== 'active') {
    closeCombatModal();
    return;
  }
  if (combatUI.overlay && document.body.contains(combatUI.overlay)) {
    updateCombatUI();
    return;
  }

  const enemyBar = h('i', { style: 'width:0%' });
  const enemyNum = h('span', { class: 'combat-num' });
  const myBar = h('i', { style: 'width:0%' });
  const myNum = h('span', { class: 'combat-num' });
  const skillBtn = h('button', { class: 'btn ghost', onclick: () => combatAct(COMBAT_ACTIONS.SKILL) });
  const attackBtn = h('button', { class: 'btn', text: '普通攻击', onclick: () => combatAct(COMBAT_ACTIONS.ATTACK) });
  const itemBtn = h('button', { class: 'btn ghost', text: '服下丹药（8 灵石，回血 30%）', onclick: () => combatAct(COMBAT_ACTIONS.ITEM) });
  const defendBtn = h('button', { class: 'btn ghost', text: '运功防御（减伤）', onclick: () => combatAct(COMBAT_ACTIONS.DEFEND) });
  const fleeBtn = h('button', { class: 'btn ghost', text: '抽身退走', onclick: () => combatAct(COMBAT_ACTIONS.FLEE) });
  const telegraphBar = h('p', { class: 'telegraph-bar', text: '' });
  const logBox = h('div', { class: 'combat-log' });

  const playerBox = h(
    'div',
    { class: 'fighter player' },
    h('img', { class: 'fighter-img', src: '/portrait-cultivator.jpg', alt: character.name }),
    h('span', { class: 'fighter-label', text: character.name })
  );
  const enemyBox = h(
    'div',
    { class: 'fighter enemy', 'data-enemy': combat.enemyId },
    h('img', { class: 'fighter-img', src: combat.enemySprite || '/enemy-wolf.png', alt: combat.enemyName }),
    h('span', { class: 'fighter-label', text: combat.enemyName })
  );
  const stage = h('div', { class: 'combat-stage' }, playerBox, h('div', { class: 'stage-vs', text: '斗' }), enemyBox);

  const overlay = h(
    'div',
    { class: 'event-overlay combat-overlay' },
    h('div', { class: 'combat-bg', style: "background-image:url('/scene-battle.jpg')" }),
    h(
      'div',
      { class: 'card event-card stack combat-card' },
      h('p', { class: 'event-title', text: combat.enemyName }),
      h('p', { class: 'event-desc', text: combat.enemyDesc }),
      stage,
      h('div', { class: 'combat-row' }, h('span', { class: 'combat-label', text: '妖兽' }), h('div', { class: 'bar hp' }, enemyBar), enemyNum),
      h('div', { class: 'combat-row' }, h('span', { class: 'combat-label', text: '你' }), h('div', { class: 'bar hp' }, myBar), myNum),
      h(
        'div',
        { class: 'combat-resources' },
        h('span', { class: 'res-item' }, h('img', { class: 'res-icon', src: '/icon-stone.png', alt: '' }), h('span', { class: 'res-label', text: '灵石' }), h('span', { class: 'res-value', 'data-role': 'stones' })),
        h('span', { class: 'res-item' }, h('img', { class: 'res-icon', src: '/icon-pill.png', alt: '' }), h('span', { class: 'res-label', text: '丹药' }), h('span', { class: 'res-value', 'data-role': 'pills' }))
      ),
      telegraphBar,
      h('div', { class: 'choices' }, attackBtn, skillBtn, itemBtn, defendBtn, fleeBtn),
      logBox,
      h('p', { class: 'desc', text: '战败不会身死：气血保留一点，损失两成灵石，退回洞府。' })
    )
  );

  combatUI.overlay = overlay;
  combatUI.enemyBar = enemyBar;
  combatUI.enemyNum = enemyNum;
  combatUI.myBar = myBar;
  combatUI.myNum = myNum;
  combatUI.skillBtn = skillBtn;
  combatUI.telegraphBar = telegraphBar;
  combatUI.stonesNum = overlay.querySelector('[data-role="stones"]');
  combatUI.pillNum = overlay.querySelector('[data-role="pills"]');
  combatUI.itemBtn = itemBtn;
  combatUI.actionBtns = [attackBtn, itemBtn, defendBtn, fleeBtn];
  combatUI.logBox = logBox;
  combatUI.stage = stage;
  combatUI.playerBox = playerBox;
  combatUI.enemyBox = enemyBox;
  combatUI.timers = [];
  combatUI.busy = false;

  document.body.append(overlay);
  updateCombatUI();
  requestAnimationFrame(() => overlay.classList.add('show'));
}

function combatAct(action) {
  if (combatUI.busy) return;
  if (!character || !character.combat || character.combat.status !== 'active') return;

  const before = { enemyHp: character.combat.enemyHp, myHp: character.hp };
  combatUI.busy = true;
  updateCombatUI({ syncBars: false });

  let result;
  try {
    result = resolveAction(character, ACTIONS.COMBAT_TURN, getRng(), { action });
  } catch (error) {
    clearCombatTimers();
    combatUI.busy = false;
    updateCombatUI();
    toast('战斗结算出错，已恢复操作', true);
    return;
  }

  if (!result.ok) {
    combatUI.busy = false;
    updateCombatUI();
    toast(result.error || '无法行动', true);
    return;
  }

  // 结算只发生这一次；之后一律只做展示
  character = result.character;
  autosave();
  const detail = result.detail;

  if (detail.finished) {
    playFinishAnimation(detail, before);
    return;
  }

  const combat = character.combat;
  const enemyDamage = Math.max(0, before.enemyHp - (combat ? combat.enemyHp : 0));
  const myDamage = Math.max(0, before.myHp - character.hp);
  const healed = Math.max(0, character.hp - before.myHp);

  const timeline = buildTurnTimeline({
    action,
    enemyDamage,
    myDamage,
    healed,
    isSkill: action === COMBAT_ACTIONS.SKILL,
    speed: loadPrefs().animationSpeed,
  });

  try {
    for (const step of timeline.steps) schedule(() => applyTimelineStep(step), step.at);
  } catch (error) {
    clearCombatTimers();
    combatUI.busy = false;
    updateCombatUI();
    toast('战斗动画出错，已恢复操作', true);
  }
}

/** 战斗真正结束时的收尾：先播完收尾动画，再关闭弹窗并给反馈 */
function playFinishAnimation(detail, before) {
  const outcome = detail.result;
  const combat = detail.combat || {};
  const killed = Math.max(0, before.enemyHp - (combat.enemyHp || 0));

  try {
    animateAttack('player');
    if (outcome === 'victory') {
      showSlash('enemy', true);
      schedule(() => {
        animateHurt('enemy');
        showDamageNumber('enemy', Math.max(killed, 1), 'skill');
        if (combatUI.enemyBox) combatUI.enemyBox.classList.add('dying');
      }, 160);
      schedule(() => {
        closeCombatModal();
        render();
        flash('gold');
        floatText('胜利', 'gain');
        toast('妖兽伏诛，你收剑而立');
      }, 820);
    } else if (outcome === 'defeat') {
      schedule(() => {
        animateHurt('player');
        showDamageNumber('player', Math.max(1, before.myHp - character.hp), 'hit');
        if (combatUI.playerBox) combatUI.playerBox.classList.add('down');
      }, 140);
      schedule(() => {
        const combatState = detail.combat || {};
        const shouldTeachThunder = shouldTeachThunderDefense(combatState);
        closeCombatModal();
        render();
        flash('red');
        floatText('战败', 'loss');
        toast('你败下阵来，退回洞府', true);
        if (shouldTeachThunder && shouldShowThunderHint()) openThunderHint();
      }, 820);
    } else {
      schedule(() => {
        closeCombatModal();
        render();
        toast('你退出了战斗');
      }, 420);
    }
  } catch (error) {
    closeCombatModal();
    render();
    toast('战斗已结束', true);
  }
}
/** 洞府丹房购买（走 resolveAction，原子结算） */
function buyPillFromShop(count) {
  const result = resolveAction(character, ACTIONS.BUY_PILL, getRng(), { count });
  if (!result.ok) return toast(result.error || '购买失败', true);
  character = result.character;
  autosave();
  render();
  toast('购入 ' + count + ' 枚疗伤丹');
}

/** 首次因雷霆战败的一次性策略提示（记录在本地偏好，不进存档） */
function openThunderHint() {
  const existing = document.querySelector('.event-overlay');
  if (existing) return;
  const overlay = h(
    'div',
    { class: 'event-overlay' },
    h(
      'div',
      { class: 'card event-card stack' },
      h('p', { class: 'event-title', text: '试炼感悟 · 雷霆虽烈，亦有破法' }),
      h('p', { class: 'event-desc', text: '你败退洞府，耳边仿佛仍有雷鸣回响。回想祭坛上的一战，你渐渐察觉：天雷落下之前，必有雷云凝聚。' }),
      h('p', { class: 'desc', text: '若能提前运功护体，便可挡下大半雷霆之威。纵使一时失察，余雷尚未散尽，亦可运功化解。' }),
      h('p', { class: 'desc', text: '下次挑战时，留意雷云预警。及时防御，方能于雷劫之中寻得一线生机。' }),
      h('button', {
        class: 'btn primary',
        text: '记下了',
        onclick: () => {
          markThunderHintShown();
          overlay.remove();
        },
      })
    )
  );
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}
/* ------------------------------------------------------------------ 结局 */
function renderEnding() {
  const months = character.months;
  const years = (months / 12).toFixed(1);
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'hero' },
      h('h1', { text: '问道有成' }),
      h('div', { class: 'sub', text: '金 丹 之 上' }),
      h('p', { class: 'flavor', text: '雷云散尽，祭坛归于寂静。\n你踏过长阶，身后是三百年的枯坐与跋涉。' })
    ),
    renderScene(),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '最终试炼 · 已通关' }),
      h('p', { class: 'desc', text: `道友「${character.name}」于金丹祭坛击退镇坛古灵，历时 ${years} 年。` }),
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: '境界' }), h('span', { class: 'stat-value', text: getRealm(character.realmId).name })),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: '道龄' }), h('span', { class: 'stat-value', text: years + ' 年' })),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: '灵石' }), h('span', { class: 'stat-value', text: String(character.stones) }))
      ),
      h('button', {
        class: 'btn primary',
        text: '再入轮回（重新开始）',
        onclick: () => {
          if (!window.confirm('重新开始会清空当前角色，确定吗？')) return;
          Save.clearSave();
          character = null;
          pending = rollBackground(getRng());
          view = 'create';
          render();
        },
      }),
      h('button', { class: 'btn ghost', text: '回到洞府', onclick: () => { view = 'home'; render(); } })
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '这一路' }),
      ...character.log.slice(-8).reverse().map((entry) => h('p', { class: 'log-line', text: timeLabel(entry.month) + '　' + entry.text }))
    )
  );
}
/* ------------------------------------------------------------------ 欢迎页 */
function renderWelcome() {
  const hasSave = Save.hasSave();
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'hero' },
      h('h1', { text: '凡人问道' }),
      h('div', { class: 'sub', text: '青 云 修 仙 录' }),
      h('p', { class: 'flavor', text: '仙途无涯，凡骨亦可问天。\n一念苦修，一线机缘，一步登天。' })
    ),
    renderScene(),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '踏入仙途' }),
      h('button', {
        class: 'btn primary',
        text: '开始问道',
        onclick: () => {
          if (Save.hasSave() && !window.confirm('已有存档。开始新游戏不会立刻覆盖，但新角色踏入仙途后会替换旧进度。\n\n建议先到「设置 → 导出存档」备份。继续？')) return;
          pending = rollBackground(getRng());
          view = 'create';
          render();
        },
      }),
      hasSave &&
        h('button', {
          class: 'btn ghost',
          text: '继续前缘',
          onclick: () => {
            const result = Save.loadFromStorage();
            if (!result.ok) return toast(result.error, true);
            character = result.character;
            view = 'home';
            render();
          },
        }),
      h('p', {
        class: 'desc center',
        text: '进度自动保存在本机浏览器。清理浏览器数据会丢失存档，请用「设置 → 导出存档」备份。',
      })
    ),
    h('p', { class: 'center muted', style: 'font-size:12px', text: 'v1.0 RC3.4 · 试玩候选' })
  );
}

/* ------------------------------------------------------------------ 创建角色 */
function renderCreate() {
  if (!pending) pending = rollBackground(getRng());
  const root = pending.root;
  const talent = pending.talent;

  const nameInput = h('input', {
    type: 'text',
    maxlength: '12',
    placeholder: '输入道号（可留空）',
    value: character && character.name ? character.name : '',
  });

  const awaken = h(
    'div',
    { class: 'awaken' },
    h('div', { class: `aura aura-root-${root.id}` }),
    h(
      'div',
      { class: 'awaken-inner' },
      h('img', { class: 'awaken-portrait', src: '/portrait-cultivator.jpg', alt: '', loading: 'lazy' }),
      h(
        'div',
        { class: 'awaken-info' },
        h(
          'div',
          { class: 'sigil' },
          h(
            'svg',
            { viewBox: '0 0 120 120', 'aria-hidden': 'true' },
            h('circle', { cx: '60', cy: '60', r: '52', fill: 'none', stroke: 'rgba(217,180,90,0.35)', 'stroke-width': '1' }),
            h('circle', { cx: '60', cy: '60', r: '40', fill: 'none', stroke: 'rgba(217,180,90,0.22)', 'stroke-width': '1', 'stroke-dasharray': '4 6' }),
            h('path', { d: 'M60,26 L88,78 L32,78 Z', fill: 'none', stroke: 'rgba(240,213,138,0.55)', 'stroke-width': '1.2' }),
            h('path', { d: 'M60,94 L32,42 L88,42 Z', fill: 'none', stroke: 'rgba(140,200,190,0.35)', 'stroke-width': '1' }),
            h('circle', { cx: '60', cy: '60', r: '4', fill: 'rgba(240,213,138,0.9)' })
          )
        ),
        h('div', { class: 'root-name', text: root.name }),
        h('div', { class: 'talent-name', text: talent.name }),
        h('p', { class: 'desc center', text: root.desc })
      )
    )
  );
  const statsCard = h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'section-title', text: '资质' }),
    h(
      'div',
      { class: 'stats' },
      statBox('修炼速度', `×${(root.mult * talent.cultMult).toFixed(2)}`),
      statBox('突破加成', `+${Math.round(talent.breakthroughBonus * 100)}%`),
      statBox('初始气血', String(Math.round(100 * talent.hpMult)))
    ),
    h('p', { class: 'desc', text: talent.desc })
  );

  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: '缘起 · 创建角色' })),
    awaken,
    statsCard,
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '道号' }),
      h('div', { class: 'field' }, nameInput),
      h('button', {
        class: 'btn ghost',
        text: '重新掷骰',
        onclick: () => {
          pending = rollBackground(getRng());
          render();
          const el = app.el.querySelector('.awaken');
          if (el) {
            el.classList.add('rolling');
            setTimeout(() => el.classList.remove('rolling'), 520);
          }
        },
      }),
      h('button', {
        class: 'btn primary',
        text: '踏入仙途',
        onclick: () => {
          if (Save.hasSave() && !window.confirm('确定用新角色覆盖旧存档吗？此操作不可撤销。')) return;
          character = createCharacter({ name: nameInput.value, rootId: pending.root.id, talentId: pending.talent.id });
          pending = null;
          view = 'home';
          autosave();
          render();
          floatText('灵根已觉醒', 'gain');
          toast('你踏上了修仙之路');
        },
      }),
      h('button', {
        class: 'btn ghost small',
        text: '返回',
        onclick: () => {
          view = 'welcome';
          render();
        },
      })
    )
  );
}

/* ------------------------------------------------------------------ 洞府主页 */
function renderHome() {
  if (!character) return renderWelcome();
  const realm = getRealm(character.realmId);
  const check = canBreakthrough(character);
  const expPct = expPercent(character) * 100;
  const hpPct = (character.hp / maxHp(character)) * 100;
  const alive = !isDead(character);
  const expFull = isAtPeak(character) || character.exp >= (realm.expToNext || 0);

  const runAction = (action, describe, feedback) => {
    const result = resolveAction(character, action, getRng());
    if (!result.ok) return toast(result.error, true);
    character = result.character;
    autosave();
    const died = result.detail && result.detail.died;
    render();
    if (died) {
      view = 'dead';
      render();
      return;
    }
    if (feedback) feedback(result.detail);
    else toast(describe(result.detail));
  };

  const actionCard = h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'section-title', text: '洞府' }),
    h('button', {
      class: 'btn primary',
      text: expFull ? '修为已满 · 需先突破' : `闭关修炼（${CULTIVATE_MONTHS} 个月）`,
      disabled: !alive || expFull,
      onclick: () =>
        runAction(ACTIONS.CULTIVATE, null, (d) => {
          floatText(`修为 +${d.gained}`, 'gain');
          pulseExp();
          if (d.capped) toast('修为已满，去突破吧');
        }),
    }),
    h('button', {
      class: 'btn ghost',
      text: `凝灵吐纳（${CULTIVATE_MONTHS} 个月）`,
      disabled: !alive,
      onclick: () =>
        runAction(ACTIONS.CONDENSE, null, (d) => {
          floatText(`灵石 +${d.stones}`, 'gain');
          pulseStones();
        }),
    }),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '洞府丹房' }),
      h('p', { class: 'desc', text: '疗伤丹可存于背包，战斗中服用回血 30%（每场最多 2 枚）。8 灵石一枚。' }),
      h(
        'div',
        { class: 'shop-row' },
        h('span', { class: 'shop-stock', text: '库存 ×' + ((character.inventory && character.inventory.healingPill) || 0) }),
        h('button', {
          class: 'btn ghost',
          text: '购入 1 枚（8 灵石）',
          onclick: () => buyPillFromShop(1),
        }),
        h('button', {
          class: 'btn ghost',
          text: '购入 5 枚（40 灵石）',
          onclick: () => buyPillFromShop(5),
        })
      )
    ),    character && character.realmId >= 13 && !character.victory
      ? h('button', {
          class: 'btn primary',
          text: '挑战最终试炼：雷霆麒麟',
          onclick: () => {
            const result = resolveAction(character, ACTIONS.COMBAT_START, getRng(), { enemyId: 'thunder-qilin' });
            if (!result.ok) return toast(result.error || '无法挑战', true);
            character = result.character;
            autosave();
            render();
            openCombatModal();
          },
        })
      : null,
    character && character.victory
      ? h('button', { class: 'btn primary', text: '回望金丹祭坛（已通关）', onclick: () => { view = 'ending'; render(); } })
      : null,
    h('button', {
      class: 'btn ghost',
      text: '外出历练（3 个月）',
      disabled: !alive,
      onclick: () => {
        view = 'explore';
        render();      },
    }),
    h('button', {
      class: check.ok ? 'btn primary' : 'btn',
      text: isFinalRealm(character.realmId) ? '已是金丹初期' : `突破境界 · ${Math.round(check.chance * 100)}%`,
      disabled: !check.ok,
      onclick: () => {
        // 突破前把概率、保底进度和失败代价说清楚，避免「明明概率很高怎么还失败」的困惑
        const forecast = breakthroughForecast(character);
        if (forecast.chance < 1) {
          const lines = [
            `突破成功率：${forecast.shownPct}%（失败概率 ${100 - forecast.shownPct}%）`,
            forecast.pityCount > 0
              ? `已连续失败 ${forecast.pityCount} 次，下次成功率 ${forecast.nextChancePct}%；再失败 ${forecast.attemptsToGuarantee} 次必定成功`
              : `连续失败 5 次必定成功`,
            '',
            `失败代价：修为 -${Math.round(forecast.lossExpRatio * 100)}%、气血 -${Math.round(forecast.lossHpRatio * 100)}%、耗时 ${forecast.monthsLost} 个月（不会身死、不会掉境界）`,
            '',
            '确定尝试突破吗？',
          ];
          if (!window.confirm(lines.join('\n'))) return;
        }
        const result = resolveAction(character, ACTIONS.BREAKTHROUGH, getRng());
        if (!result.ok) return toast(result.error, true);
        character = result.character;
        autosave();
        const detail = result.detail;
        render();
        if (detail.success) {
          flash('gold');
          floatText(`突破成功 · ${detail.nextRealm}`, 'gain');
        } else {
          flash('red');
          floatText(`突破失败 · 修为 -${detail.lostExp}`, 'loss');
          toast('气机反噬，调息再试', true);
        }
      },
    }),
    !check.ok && h('p', { class: 'desc', text: check.reasons.join('；') }),
    !isFinalRealm(character.realmId) &&
      h('p', {
        class: 'desc breakthrough-forecast',
        text: (() => {
          const f = breakthroughForecast(character);
          if (f.chance >= 1) return '成功率 100%，必定成功';
          const pityText =
            f.pityCount > 0
              ? `已连续失败 ${f.pityCount} 次（下次 ${f.nextChancePct}%），再失败 ${f.attemptsToGuarantee} 次必定成功`
              : '连续失败 5 次必定成功';
          return `失败概率 ${100 - f.shownPct}%：修为 -25%、气血 -20%、耗时半年（不身死、不掉境界）。${pityText}`;
        })(),
      }),
    h('p', {
      class: 'desc',
      text: '闭关只涨修为，凝灵只涨灵石。突破失败会累计保底：每失败一次下次成功率 +5%，连续失败 5 次后下一次必定成功。',
    })
  );

  const sideCard = h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'section-title', text: '道体' }),
    h(
      'div',
      { class: 'stats' },
      statBox('灵石', String(character.stones)),
      statBox('寿元', `${Math.floor(ageYears(character))} / ${lifespanYears(character)} 岁`),
      statBox('气血', `${character.hp} / ${maxHp(character)}`),
      statBox('攻击', String(10 + character.realmId * 4)),
      statBox('防御', String(5 + character.realmId * 3)),
      statBox('灵力', String(20 + character.realmId * 6))
    )
  );

  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: timeLabel(character) })),
    h(
      'div',
      { class: 'layout' },
      h('section', { class: 'col-main' }, renderScene(), actionCard),
      h('aside', { class: 'col-side' }, sideCard, renderProgressCard(realm, expPct, hpPct)),
      h('aside', { class: 'col-log' }, renderLogCard(40, true))
    )
  );
}

/* ------------------------------------------------------------------ 外出历练场景 */
function renderExplore() {
  if (!character) return renderWelcome();
  const alive = !isDead(character);
  const risk = character.hp / maxHp(character);
  const riskText = risk > 0.7 ? '安稳' : risk > 0.4 ? '有险' : '凶险';
  const riskTier = risk > 0.7 ? 0 : risk > 0.4 ? 1 : 2;

  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: timeLabel(character) })),
    h(
      'div',
      { class: 'layout' },
      h(
        'section',
        { class: 'col-main' },
        h(
          'div',
          { class: `scene scene-explore scene-tier-${riskTier}` },
          h('img', { class: 'scene-img', src: '/scene-forest.jpg', alt: '', loading: 'lazy' }),
          h('div', { class: 'mist' }),
          h('div', { class: 'caption', text: '青云山 · 后山小径' }),
          h('div', { class: 'badge', text: `风险 · ${riskText}` })
        ),
        h(
          'div',
          { class: 'card stack' },
          h('p', { class: 'section-title', text: '历练' }),
          h('p', { class: 'desc', text: '此地野径通幽，灵气驳杂。你可能遇见洞府、高人、灵兽，也可能遇上劫修。每次历练耗时三个月，途中必得些散碎灵石。' }),
          h('button', {
            class: 'btn primary',
            text: '踏入山道（3 个月）',
            disabled: !alive,
            onclick: () => {
              const result = resolveAction(character, ACTIONS.EXPLORE, getRng());
              if (!result.ok) return toast(result.error, true);
              character = result.character;
              autosave();
              const detail = result.detail;
              render();
              floatText(`灵石 +${detail.stones}`, 'gain');
              if (detail.event) openEventModal(detail.event);
              else toast('此行平安，未见异象');
            },
          }),
          h('button', {
            class: 'btn ghost',
            text: '深入险地（遇妖兽）',
            disabled: !alive,
            onclick: () => {
              const enemy = pickEnemy(character, getRng());
              if (!enemy) return toast('此地暂无妖兽', true);
              const result = resolveAction(character, ACTIONS.COMBAT_START, getRng(), { enemyId: enemy.id });
              if (!result.ok) return toast(result.error || '无法开战', true);
              character = result.character;
              autosave();
              openCombatModal();
            },
          }),
          h('button', {
            class: 'btn ghost',
            text: '返回洞府',
            onclick: () => {
              view = 'home';
              render();
            },
          }),
          h('p', { class: 'desc', text: '历练不会致死：气血最低保留一点，重伤后请回洞府调息。' })
        )
      ),
      h(
        'aside',
        { class: 'col-side' },
        h(
          'div',
          { class: 'card stack' },
          h('p', { class: 'section-title', text: '行囊' }),
          h(
            'div',
            { class: 'stats' },
            statBox('灵石', String(character.stones)),
            statBox('气血', `${character.hp} / ${maxHp(character)}`),
            statBox('境界', realmName(character)),
            statBox('寿元', `${Math.floor(ageYears(character))} / ${lifespanYears(character)} 岁`)
          )
        ),
        h(
          'div',
          { class: 'card stack' },
          h('p', { class: 'section-title', text: '见闻' }),
          h('img', { class: 'bestiary', src: '/bestiary.jpg', alt: '妖兽图鉴', loading: 'lazy' }),
          h('p', { class: 'desc', text: '青云山脉绵延三百里。往北是宗门辖地，往南是乱葬岗，据说夜里有人听见剑鸣。' })
        )
      ),
      h('aside', { class: 'col-log' }, renderLogCard(40, true))
    )
  );
}
function renderProgressCard(realm, expPct, hpPct) {
  return h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'section-title', text: '修为' }),
    h('div', { class: 'bar exp' }, h('i', { style: `width:${expPct}%` })),
    h(
      'div',
      { class: 'row between' },
      h('span', { class: 'muted', text: realm.expToNext === null ? '已至金丹初期' : `${character.exp} / ${realm.expToNext}` }),
      h('span', { class: 'gold', text: `${expPct.toFixed(1)}%` })
    ),
    h('p', { class: 'section-title', text: '气血' }),
    h('div', { class: 'bar hp' }, h('i', { style: `width:${hpPct}%` })),
    h('div', { class: 'row between' }, h('span', { class: 'muted', text: `${character.hp} / ${maxHp(character)}` }))
  );
}

function renderLogCard(limit, scrollable = false) {
  if (!character) return null;
  const entries = character.log.slice(-limit).reverse();
  return h(
    'div',
    { class: 'card stack' },
    h('p', { class: 'section-title', text: '修仙日志' }),
    entries.length === 0
      ? h('p', { class: 'desc', text: '尚无记录。' })
      : h(
          'div',
          { class: scrollable ? 'log-list' : 'stack' },
          entries.map((entry) =>
            h('div', { class: `log-item ${entry.kind || ''}` }, h('span', { class: 't', text: monthLabel(entry.month) }), entry.text)
          )
        )
  );
}

/* ------------------------------------------------------------------ 属性页 */
function renderStats() {
  if (!character) return renderWelcome();
  const root = getRoot(character.rootId);
  const talent = getTalent(character.talentId);
  const check = canBreakthrough(character);
  const rows = [
    ['道号', character.name],
    ['境界', realmName(character)],
    ['灵根', `${root.name}（修炼 ×${root.mult}）`],
    ['天赋', `${talent.name}（修炼 ×${talent.cultMult}，突破 +${Math.round(talent.breakthroughBonus * 100)}%）`],
    ['修为', getRealm(character.realmId).expToNext === null ? '已至金丹初期' : `${character.exp} / ${getRealm(character.realmId).expToNext}`],
    ['气血', `${character.hp} / ${maxHp(character)}`],
    ['灵石', String(character.stones)],
    ['寿元', `${Math.floor(ageYears(character))} / ${lifespanYears(character)} 岁`],
    ['下一步突破', isFinalRealm(character.realmId) ? '已是终点' : `${getRealm(character.realmId + 1).name} · 成功率 ${Math.round(breakthroughChance(character) * 100)}%`],
  ];
  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: timeLabel(character) })),
    h(
      'div',
      { class: 'card stack' },
      rows.map(([k, v]) => h('div', { class: 'row between' }, h('span', { class: 'muted', text: k }), h('span', { text: v })))
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '突破条件' }),
      check.ok ? h('p', { class: 'desc', text: '条件已满足，可回洞府突破。' }) : h('p', { class: 'desc', text: check.reasons.join('；') })
    )
  );
}

/* ------------------------------------------------------------------ 日志页 */
function renderLog() {
  if (!character) return renderWelcome();
  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: `${character.log.length} 条` })),
    renderLogCard(60, true)
  );
}

/* ------------------------------------------------------------------ 设置页 */
function renderSettings() {
  const exportArea = h('textarea', { readonly: true, placeholder: '点击「导出」生成存档 JSON' });
  const diagnosticArea = h('textarea', { readonly: true, placeholder: '点击上方按钮生成诊断信息' });
  const importArea = h('textarea', { placeholder: '把存档 JSON 粘贴到这里，然后点「导入」' });

  return h(
    'div',
    { class: 'page' },
    headerBar(h('span', { class: 'chip', text: '存档与重置' })),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '保存' }),
      h('button', {
        class: 'btn ghost',
        text: '手动保存',
        onclick: () => {
          if (!character) return toast('还没有角色', true);
          const r = Save.saveToStorage(character);
          toast(r.ok ? '已保存' : r.error, !r.ok);
        },
      }),
      h('button', {
        class: 'btn ghost',
        text: '导出存档 JSON',
        onclick: () => {
          if (!character) return toast('还没有角色', true);
          exportArea.value = Save.exportToJson(character);
          const blob = new Blob([exportArea.value], { type: 'application/json' });
          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
          blobUrlToRevoke = URL.createObjectURL(blob);
          const a = h('a', { href: blobUrlToRevoke, download: `凡人问道-${character.name}-${Date.now()}.json` });
          document.body.append(a);
          a.click();
          a.remove();
          toast('已导出，请妥善保管');
        },
      }),
      exportArea
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '导入' }),
      importArea,
      h('button', {
        class: 'btn ghost',
        text: '导入存档',
        onclick: () => {
          const result = Save.parseSaveText(importArea.value);
          if (!result.ok) return toast(result.error, true);
          character = result.character;
          const saved = autosave();
          view = 'home';
          render();
          toast(saved ? '存档已导入' : '已导入，但写入本地存档失败（刷新会丢失）', !saved);
        },
      }),
      h('p', { class: 'desc', text: '导入前会校验版本与字段，非法存档会被拒绝，不会影响当前进度。' })
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '战斗动画速度' }),
      h('p', { class: 'desc', text: '只影响动画展示节奏，不改变伤害、冷却、随机结果与奖励。' }),
      h(
        'div',
        { class: 'segmented' },
        SPEED_OPTIONS.map((speed) =>
          h('button', {
            class: 'seg-btn' + (loadPrefs().animationSpeed === speed ? ' active' : ''),
            text: { fast: '快速 0.55s', full: '完整 1.1s', reduced: '简化 0.12s' }[speed],
            onclick: () => {
              setAnimationSpeed(speed);
              render();
              const label = { fast: '快速', full: '完整', reduced: '简化' }[speed];
              toast('动画速度已改为「' + label + '」');
            },
          })
        )
      ),
      h('p', { class: 'section-title', text: '环境诊断' }),
      h('p', { class: 'desc', text: '如果画面出现白边、错位或缩放异常，点下面按钮生成诊断信息，复制发给开发者。' }),
      h('button', {
        class: 'btn ghost',
        text: '生成诊断信息',
        onclick: () => {
          const appRect = document.querySelector('.app');
          const info = {
            innerWidth: window.innerWidth,
            outerWidth: window.outerWidth,
            dpr: window.devicePixelRatio,
            docWidth: document.documentElement.clientWidth,
            bodyWidth: Math.round(document.body.getBoundingClientRect().width),
            appRect: appRect ? appRect.getBoundingClientRect().toJSON() : null,
            viewport: window.visualViewport ? Math.round(window.visualViewport.width) : null,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            htmlBg: getComputedStyle(document.documentElement).backgroundColor,
            zoom: (window.outerWidth / window.innerWidth).toFixed(3),
            ua: navigator.userAgent.slice(0, 80),
          };
          const text = JSON.stringify(info, null, 2);
          diagnosticArea.value = text;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => toast('诊断信息已复制到剪贴板'),
              () => toast('已生成，请手动复制下方文本')
            );
          } else {
            toast('已生成，请手动复制下方文本');
          }
        },
      }),
      diagnosticArea
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'section-title', text: '危险操作' }),
      h('button', {
        class: 'btn danger',
        text: '重置游戏',
        onclick: () => {
          if (!window.confirm('确定要重置游戏吗？当前进度会被删除。')) return;
          if (!window.confirm('再次确认：这一步不可撤销。')) return;
          Save.clearSave();
          character = null;
          view = 'welcome';
          render();
          toast('已重置');
        },
      }),
      h('p', { class: 'mono-help', text: `存档版本 v${Save.SAVE_VERSION} · 存储键 ${Save.SAVE_KEY}` })
    )
  );
}

/* ------------------------------------------------------------------ 寿元耗尽 */
function renderDead() {
  const name = character ? character.name : '无名散修';
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'hero' },
      h('h1', { text: '道消' }),
      h('div', { class: 'sub', text: '寿 元 已 尽' }),
      h('p', { class: 'flavor', text: `你以${character ? realmName(character) : '凡人'}之身坐化于洞府之中。\n仙路未尽，来世再问。` })
    ),
    h(
      'div',
      { class: 'card stack' },
      h('p', { class: 'desc', text: `道号：${name}　终境：${character ? realmName(character) : '未知'}` }),
      h('button', {
        class: 'btn primary',
        text: '重开一世',
        onclick: () => {
          Save.clearSave();
          character = null;
          pending = null;
          view = 'welcome';
          render();
        },
      })
    )
  );
}

export function getView() {
  return view;
}

export function setView(next) {
  view = next;
}

export function getCharacter() {
  return character;
}

export function setCharacter(next) {
  character = next;
}

export { render, autosave, sanitize, addLog, reseed };













































