/**
 * 奇遇事件库（阶段二第一批 10 条，最终目标 30 条）。
 *
 * 每条事件：
 *  - id       唯一标识
 *  - title    标题
 *  - desc     故事描述
 *  - minRealm 触发的最低境界 id
 *  - weight   触发权重
 *  - choices  2–3 个选择，每个选择 outcomes 里按权重抽结果
 *
 * 结果里的 effects 是声明式数据，由 core/explore.js 统一结算：
 *  - { type: 'exp', ratio }      按当前境界上限的比例增减修为
 *  - { type: 'stones', value }   灵石增减
 *  - { type: 'hp', ratio }       气血按上限比例增减（保底 1）
 *  - { type: 'months', value }   额外消耗的月数
 */
export const EVENTS = [
  {
    id: 'ancient-cave',
    title: '神秘洞府',
    desc: '青云山深处，藤蔓后露出半扇石门。门内传来苍老而平稳的呼吸声，石缝里渗出淡淡灵光。',
    minRealm: 1,
    weight: 10,
    choices: [
      {
        id: 'enter',
        text: '推门而入',
        outcomes: [
          { weight: 70, text: '洞中坐着一具枯坐的遗蜕，身前留有一卷残破功法。你记下只言片语，修为大涨。', effects: [{ type: 'exp', ratio: 0.35 }] },
          { weight: 30, text: '阵纹骤然亮起，你被弹出门外，气血翻涌。', effects: [{ type: 'hp', ratio: -0.25 }] },
        ],
      },
      {
        id: 'kneel',
        text: '门前跪下叩首',
        outcomes: [
          { weight: 60, text: '门内传来一声轻笑：「知进退，可教。」一枚灵石落入你掌心。', effects: [{ type: 'stones', value: 12 }] },
          { weight: 40, text: '洞府无声，你在门外枯等半日，一无所获。', effects: [{ type: 'months', value: 3 }] },
        ],
      },
      {
        id: 'leave',
        text: '谨慎离开',
        outcomes: [{ weight: 100, text: '你退了三步，回头再看，藤蔓已合拢如初。', effects: [] }],
      },
    ],
  },
  {
    id: 'immortal-passing',
    title: '遇见高人',
    desc: '一位背着旧剑的散修与你擦肩而过，忽然停步：「小友骨相尚可，可愿听我一言？」',
    minRealm: 1,
    weight: 9,
    choices: [
      {
        id: 'listen',
        text: '执礼求教',
        outcomes: [
          { weight: 80, text: '他随手点出你修行中的一处岔路，你如醍醐灌顶。', effects: [{ type: 'exp', ratio: 0.3 }] },
          { weight: 20, text: '他说的全是听不懂的疯话，你只当听了个故事。', effects: [{ type: 'months', value: 1 }] },
        ],
      },
      {
        id: 'pay',
        text: '奉上灵石求指点',
        outcomes: [
          { weight: 100, text: '他收下灵石，留下三句口诀，飘然而去。', effects: [{ type: 'stones', value: -8 }, { type: 'exp', ratio: 0.5 }] },
        ],
      },
    ],
  },
  {
    id: 'beast-attack',
    title: '灵兽袭击',
    desc: '一只毛色赤红的山猫从岩壁跃下，拦在路中央，喉间发出低沉的威胁声。',
    minRealm: 2,
    weight: 10,
    choices: [
      {
        id: 'fight',
        text: '拔剑相向',
        outcomes: [
          { weight: 65, text: '你险胜一着，山猫负伤逃走，留下几块散碎灵石。', effects: [{ type: 'stones', value: 10 }, { type: 'hp', ratio: -0.2 }] },
          { weight: 35, text: '山猫速度远胜于你，你被扑倒在地，仓皇逃开。', effects: [{ type: 'hp', ratio: -0.45 }] },
        ],
      },
      {
        id: 'feed',
        text: '丢出灵石引开它',
        outcomes: [{ weight: 100, text: '山猫叼走灵石，钻进草丛不见了。', effects: [{ type: 'stones', value: -6 }] }],
      },
      {
        id: 'retreat',
        text: '缓缓后退',
        outcomes: [{ weight: 100, text: '你退了半里，山猫没有追来。', effects: [{ type: 'months', value: 1 }] }],
      },
    ],
  },
  {
    id: 'herb-gather',
    title: '灵草采集',
    desc: '崖畔生着一丛叶片如玉的灵草，根须半露，灵气自土中一丝丝往上涌。',
    minRealm: 1,
    weight: 9,
    choices: [
      {
        id: 'dig',
        text: '连根挖出',
        outcomes: [
          { weight: 70, text: '灵草完整出土，你小心收好，换了不少灵石。', effects: [{ type: 'stones', value: 14 }] },
          { weight: 30, text: '草根缠着一条土蛇，被咬了一口，灵草也枯了。', effects: [{ type: 'hp', ratio: -0.2 }] },
        ],
      },
      {
        id: 'leave',
        text: '只摘叶片',
        outcomes: [{ weight: 100, text: '你只取两片叶子，留根再长，心中安定。', effects: [{ type: 'stones', value: 5 }, { type: 'exp', ratio: 0.1 }] }],
      },
    ],
  },
  {
    id: 'rogue-cultivator',
    title: '遭遇劫修',
    desc: '一名披着黑斗篷的修士拦住去路：「留下灵石，可饶你一命。」',
    minRealm: 3,
    weight: 9,
    choices: [
      {
        id: 'resist',
        text: '拼死一搏',
        outcomes: [
          { weight: 45, text: '对方没料到你敢动手，被你击退，反而丢下自己的储物袋。', effects: [{ type: 'stones', value: 20 }, { type: 'hp', ratio: -0.3 }] },
          { weight: 55, text: '你被一掌拍在胸口，灵石被抢走大半。', effects: [{ type: 'stones', value: -15 }, { type: 'hp', ratio: -0.35 }] },
        ],
      },
      {
        id: 'handover',
        text: '交出灵石',
        outcomes: [{ weight: 100, text: '劫修数了数灵石，冷笑一声放你离开。', effects: [{ type: 'stones', value: -10 }] }],
      },
      {
        id: 'run',
        text: '转身就跑',
        outcomes: [
          { weight: 60, text: '你仗着熟悉山道甩开了他。', effects: [{ type: 'months', value: 1 }] },
          { weight: 40, text: '他从背后追上，抓走了一小袋灵石。', effects: [{ type: 'stones', value: -8 }, { type: 'hp', ratio: -0.15 }] },
        ],
      },
    ],
  },
  {
    id: 'sect-invite',
    title: '宗门邀请',
    desc: '两名青衣弟子递来一枚玉牌：「青云宗招收外门弟子，你有灵根，可来一试。」',
    minRealm: 2,
    weight: 7,
    choices: [
      {
        id: 'accept',
        text: '接过玉牌',
        outcomes: [{ weight: 100, text: '宗门赐下入门灵石与一份功法残页，修行有了着落。', effects: [{ type: 'stones', value: 16 }, { type: 'exp', ratio: 0.2 }] }],
      },
      {
        id: 'decline',
        text: '婉拒，独自修行',
        outcomes: [{ weight: 100, text: '你更信自己的路。清静修行数月，心境澄明。', effects: [{ type: 'exp', ratio: 0.15 }, { type: 'months', value: 3 }] }],
      },
    ],
  },
  {
    id: 'ancient-talisman',
    title: '捡到法宝',
    desc: '溪水冲下一块黑石，石面刻满看不懂的符篆，握在手里竟微微发烫。',
    minRealm: 4,
    weight: 8,
    choices: [
      {
        id: 'refine',
        text: '就地以气血温养',
        outcomes: [
          { weight: 70, text: '符篆亮起，黑石化为一枚护身符，你的气血上限有所增长。', effects: [{ type: 'exp', ratio: 0.2, }, { type: 'hp', ratio: 0.3 }] },
          { weight: 30, text: '符篆反噬，你被震得耳鸣目眩。', effects: [{ type: 'hp', ratio: -0.3 }] },
        ],
      },
      {
        id: 'sell',
        text: '拿去坊市卖掉',
        outcomes: [{ weight: 100, text: '坊市掌柜眼睛一亮，给了你一个好价钱。', effects: [{ type: 'stones', value: 18 }] }],
      },
    ],
  },
  {
    id: 'hidden-realm',
    title: '危险秘境',
    desc: '山雾散开一线，露出一道悬在半空的裂缝。裂缝后隐约有古树与钟声。',
    minRealm: 5,
    weight: 8,
    choices: [
      {
        id: 'enter',
        text: '踏入裂缝',
        outcomes: [
          { weight: 55, text: '秘境里灵气浓郁如雨，你打坐三日，修为暴涨。', effects: [{ type: 'exp', ratio: 0.5 }, { type: 'months', value: 3 }] },
          { weight: 45, text: '秘境法则排斥外来者，你被撕扯出一道伤口，仓皇退出。', effects: [{ type: 'hp', ratio: -0.5 }, { type: 'months', value: 3 }] },
        ],
      },
      {
        id: 'observe',
        text: '在裂缝外记录方位',
        outcomes: [{ weight: 100, text: '你把地形画在纸上，自觉见识更长。', effects: [{ type: 'exp', ratio: 0.1 }] }],
      },
    ],
  },
  {
    id: 'trader',
    title: '修士交易',
    desc: '一位游方修士摆开摊位，摊上有丹药、旧书和几块成色不错的灵石。',
    minRealm: 2,
    weight: 9,
    choices: [
      {
        id: 'buy-pill',
        text: '买一枚养气丹（10 灵石）',
        outcomes: [{ weight: 100, text: '丹香入腹，气血与修为都有所回升。', effects: [{ type: 'stones', value: -10 }, { type: 'exp', ratio: 0.25 }, { type: 'hp', ratio: 0.4 }] }],
      },
      {
        id: 'buy-book',
        text: '买下那本旧书（14 灵石）',
        outcomes: [{ weight: 100, text: '书里是半篇行气法门，虽残但有用。', effects: [{ type: 'stones', value: -14 }, { type: 'exp', ratio: 0.35 }] }],
      },
      {
        id: 'pass',
        text: '只看不买',
        outcomes: [{ weight: 100, text: '你与摊主聊了半日，倒也听来些坊市见闻。', effects: [{ type: 'months', value: 1 }] }],
      },
    ],
  },
  {
    id: 'discover-manual',
    title: '发现功法',
    desc: '破庙的佛像掌心夹着一页薄如蝉翼的绢帛，上面写着「吐纳三十六式」。',
    minRealm: 0,
    weight: 9,
    choices: [
      {
        id: 'study',
        text: '当场研读',
        outcomes: [
          { weight: 75, text: '你照着吐纳一炷香，灵气入体如泉，修为大进。', effects: [{ type: 'exp', ratio: 0.4 }] },
          { weight: 25, text: '法门与你灵根不合，强练之下气血逆行。', effects: [{ type: 'hp', ratio: -0.2 }] },
        ],
      },
      {
        id: 'copy',
        text: '抄录后放回原处',
        outcomes: [{ weight: 100, text: '你抄了一份带走，心中踏实。', effects: [{ type: 'exp', ratio: 0.2 }, { type: 'months', value: 1 }] }],
      },
    ],
  },
];

export const EXPORE_MONTHS = 3;

/** 按权重抽一条奇遇（只返回满足境界条件的） */
export function pickEvent(character, rng) {
  const story = character.story || { flags: {}, seenEvents: [], completedEvents: [] };
  const completed = new Set(story.completedEvents || []);
  const seen = story.seenEvents || [];
  const recent = seen.slice(-2);

  const pool = EVENTS.filter((event) => {
    if (character.realmId < event.minRealm) return false;
    // 一次性剧情：完成后不再触发
    if (event.repeatable === false && completed.has(event.id)) return false;
    // 剧情前置条件（需要哪些 flag 已为真）
    if (Array.isArray(event.requiresFlags)) {
      for (const flag of event.requiresFlags) {
        if (!story.flags || !story.flags[flag]) return false;
      }
    }
    // 剧情排斥条件（哪些 flag 出现后不再触发）
    if (Array.isArray(event.blockedByFlags)) {
      for (const flag of event.blockedByFlags) {
        if (story.flags && story.flags[flag]) return false;
      }
    }
    return true;
  });
  if (pool.length === 0) return null;
  // 近期重复惩罚：刚遇到过的两个事件权重降到 25%，避免连续撞同一条
  const weightOf = (event) => {
    let weight = event.weight || 1;
    if (recent.includes(event.id)) weight *= 0.25;
    if (Array.isArray(event.requiresFlags) && event.requiresFlags.length) weight *= 2.6;
    return weight;
  };
  const total = pool.reduce((sum, event) => sum + weightOf(event), 0);
  let roll = rng.float() * total;
  for (const event of pool) {
    roll -= weightOf(event);
    if (roll <= 0) return event;
  }
  return pool[pool.length - 1];
}

export function getEventById(id) {
  return EVENTS.find((event) => event.id === id) || null;
}



/* ================= v0.16 新增 20 条奇遇（ChatGPT 四组方案） ================= */
const NEW_EVENTS = [
  /* ---------- 炼气期 6 条：建立资源与选择策略 ---------- */
  {
    id: 'herb-valley',
    title: '药谷采露',
    desc: '山谷里整片灵草挂着夜露，采与不采都有代价。',
    minRealm: 1,
    weight: 8,
    choices: [
      { id: 'gather', text: '尽数采下，带回去换灵石', outcomes: [
        { weight: 7, text: '你把灵草捆成几束，卖与山下药铺，得灵石若干。', effects: [{ type: 'stones', value: 12 }] },
        { weight: 3, text: '守谷的灵蜂被你惊动，你带伤奔逃。', effects: [{ type: 'stones', value: 4 }, { type: 'hp', ratio: -0.18 }] },
      ] },
      { id: 'taste', text: '当场嚼服一株，试试药力', outcomes: [
        { weight: 6, text: '药力温和，伤势好了些。', effects: [{ type: 'hp', ratio: 0.2 }] },
        { weight: 4, text: '药性太烈，你被冲得气血翻涌。', effects: [{ type: 'hp', ratio: -0.1 }, { type: 'exp', ratio: 0.15 }] },
      ] },
    ],
  },
  {
    id: 'village-plague',
    title: '山村疫病',
    desc: '山下小村染了疫气，村民跪求仙长出手。',
    minRealm: 1,
    weight: 7,
    choices: [
      { id: 'help', text: '耗三日以灵力净化水源', outcomes: [
        { weight: 8, text: '村民为你立了长生牌位，凑了些灵石相谢。', effects: [{ type: 'stones', value: 8 }, { type: 'months', value: 3 }] },
        { weight: 2, text: '疫气比你预想的顽固，灵力耗损不小。', effects: [{ type: 'hp', ratio: -0.2 }, { type: 'months', value: 3 }] },
      ] },
      { id: 'leave', text: '凡人生死有数，转身离去', outcomes: [
        { weight: 10, text: '你没有回头。山风里隐约传来哭声。', effects: [] },
      ] },
    ],
  },
  {
    id: 'spirit-mine',
    title: '废弃灵矿',
    desc: '矿洞塌了一半，仍有细碎灵光从石缝里透出来。',
    minRealm: 2,
    weight: 7,
    choices: [
      { id: 'dig', text: '探进矿洞深处刨挖', outcomes: [
        { weight: 6, text: '你刨出几块残矿，换了不少灵石。', effects: [{ type: 'stones', value: 20 }] },
        { weight: 4, text: '矿洞二次塌陷，你狼狈逃出。', effects: [{ type: 'hp', ratio: -0.22 }, { type: 'stones', value: 5 }] },
      ] },
      { id: 'seal', text: '以灵力封住矿口，免伤后来人', outcomes: [
        { weight: 10, text: '你封了矿口，心中道意澄明。', effects: [{ type: 'exp', ratio: 0.2 }, { type: 'months', value: 1 }] },
      ] },
    ],
  },
  {
    id: 'fallen-cultivator',
    title: '路遇散修',
    desc: '一名散修倒在路边，胸口有剑伤，储物袋还挂在腰间。',
    minRealm: 2,
    weight: 7,
    choices: [
      { id: 'save', text: '渡一缕灵力救他', outcomes: [
        { weight: 7, text: '他醒来后留下半袋灵石与一句话："青云山别有洞天。"', effects: [{ type: 'stones', value: 14 }, { type: 'exp', ratio: 0.15 }] },
        { weight: 3, text: '他伤势太重，只来得及道一声谢。', effects: [{ type: 'exp', ratio: 0.1 }, { type: 'hp', ratio: -0.1 }] },
      ] },
      { id: 'take', text: '取走储物袋，不闻不问', outcomes: [
        { weight: 8, text: '袋中有灵石，也有你不想细看的东西。', effects: [{ type: 'stones', value: 26 }, { type: 'exp', ratio: -0.05 }] },
        { weight: 2, text: '袋里是空的，只有一枚生锈的令牌。', effects: [] },
      ] },
    ],
  },
  {
    id: 'night-rain-dojo',
    title: '雨夜破观',
    desc: '荒废的道观里还供着香火，雨敲在残瓦上像有人念经。',
    minRealm: 3,
    weight: 6,
    repeatable: false,
    choices: [
      { id: 'pray', text: '在像前静坐一夜', outcomes: [
        { weight: 10, text: '你梦见有人以剑指点你的呼吸，醒来时修为进了一截。', effects: [{ type: 'exp', ratio: 0.3 }, { type: 'months', value: 1 }], flags: { dojoDream: true } },
      ] },
      { id: 'search', text: '翻找供桌下的暗格', outcomes: [
        { weight: 6, text: '暗格里是几枚旧年丹药，药性竟还完好。', effects: [{ type: 'item', id: 'healingPill', count: 1 }] },
        { weight: 4, text: '暗格是空的，只有一枚铜钱。', effects: [{ type: 'stones', value: 2 }] },
      ] },
    ],
  },
  {
    id: 'market-haggle',
    title: '坊市讨价',
    desc: '坊市的老修士眯着眼，把一枚疗伤丹推到你面前。',
    minRealm: 3,
    weight: 6,
    choices: [
      { id: 'buy', text: '按价买下一枚（12 灵石）', outcomes: [
        { weight: 10, text: '你付了灵石，收下丹药。', effects: [{ type: 'stones', value: -12 }, { type: 'item', id: 'healingPill', count: 1 }] },
      ] },
      { id: 'barter', text: '用炼器的小玩意换', outcomes: [
        { weight: 5, text: '老修士喜欢你的手艺，多送了一枚。', effects: [{ type: 'item', id: 'healingPill', count: 1 }] },
        { weight: 5, text: '他摇头，不肯换。', effects: [] },
      ] },
    ],
  },

  /* ---------- 筑基期 6 条：丹药、特殊资源和风险 ---------- */
  {
    id: 'demon-drill',
    title: '魔修试炼',
    desc: '一名魔修拦住去路，说要看看你的道心有多硬。',
    minRealm: 10,
    weight: 7,
    choices: [
      { id: 'fight', text: '拔剑迎战', outcomes: [
        { weight: 6, text: '你以剑气破了魔功，他冷笑退走，留下一瓶丹药。', effects: [{ type: 'hp', ratio: -0.25 }, { type: 'stones', value: 30 }, { type: 'item', id: 'healingPill', count: 1 }] },
        { weight: 4, text: '你被魔气侵体，勉强脱身。', effects: [{ type: 'hp', ratio: -0.3 }, { type: 'exp', ratio: 0.12 }] },
      ] },
      { id: 'ignore', text: '不与魔修纠缠', outcomes: [
        { weight: 10, text: '你绕道而行，他也没有追。', effects: [] },
      ] },
    ],
  },
  {
    id: 'beast-nest',
    title: '妖兽巢穴',
    desc: '崖洞里有幼兽的叫声，母兽的尸骨还横在洞口。',
    minRealm: 10,
    weight: 7,
    choices: [
      { id: 'loot', text: '取走洞中的妖丹', outcomes: [
        { weight: 7, text: '妖丹仍有灵性，你小心翼翼收好。', effects: [{ type: 'stones', value: 26 }, { type: 'exp', ratio: 0.18 }] },
        { weight: 3, text: '洞中另有虫潮，你仓皇退出。', effects: [{ type: 'hp', ratio: -0.25 }] },
      ] },
      { id: 'raise', text: '把幼兽带回洞府养着', outcomes: [
        { weight: 10, text: '幼兽认你为主，日后或有大用。', effects: [{ type: 'months', value: 2 }, { type: 'exp', ratio: 0.1 }], flags: { beastCompanion: true } },
      ] },
    ],
  },
  {
    id: 'sect-trial',
    title: '宗门试剑会',
    desc: '青云宗三年一次的试剑会，胜者可得丹药与灵石。',
    minRealm: 11,
    weight: 6,
    repeatable: false,
    choices: [
      { id: 'join', text: '登台试剑', outcomes: [
        { weight: 5, text: '你连赢三场，宗门赏下丹药与灵石。', effects: [{ type: 'stones', value: 40 }, { type: 'item', id: 'healingPill', count: 2 }], flags: { sectTrialWon: true } },
        { weight: 5, text: '你在第二场败下阵来，但收获不小。', effects: [{ type: 'stones', value: 10 }, { type: 'exp', ratio: 0.2 }] },
      ] },
      { id: 'watch', text: '只在台下观战', outcomes: [
        { weight: 10, text: '你旁观了十几场斗剑，心境反而稳了。', effects: [{ type: 'exp', ratio: 0.25 }] },
      ] },
    ],
  },
  {
    id: 'poison-marsh',
    title: '瘴泽采药',
    desc: '毒瘴深处有一株成熟的灵药，靠近就头晕目眩。',
    minRealm: 11,
    weight: 6,
    choices: [
      { id: 'risk', text: '屏息深入', outcomes: [
        { weight: 5, text: '你采到了灵药，也采到了几枚疗伤丹的材料。', effects: [{ type: 'item', id: 'healingPill', count: 1 }, { type: 'exp', ratio: 0.2 }] },
        { weight: 5, text: '瘴气入体，你退了回来。', effects: [{ type: 'hp', ratio: -0.28 }] },
      ] },
      { id: 'retreat', text: '不值得冒险', outcomes: [
        { weight: 10, text: '你退出了瘴泽，改走大路。', effects: [] },
      ] },
    ],
  },
  {
    id: 'ancient-talisman-two',
    title: '古符残片',
    desc: '河道里冲出一片古符，上面的纹路你只认得三分之一。',
    minRealm: 12,
    weight: 6,
    repeatable: false,
    choices: [
      { id: 'study', text: '带回洞府仔细参研', outcomes: [
        { weight: 6, text: '你参透了一道符纹，修为大进。', effects: [{ type: 'exp', ratio: 0.35 }], flags: { talismanStudied: true } },
        { weight: 4, text: '符纹反噬，你头痛欲裂。', effects: [{ type: 'hp', ratio: -0.15 }, { type: 'exp', ratio: 0.1 }] },
      ] },
      { id: 'sell', text: '卖给坊市的符师', outcomes: [
        { weight: 10, text: '符师给的价钱公道。', effects: [{ type: 'stones', value: 35 }] },
      ] },
    ],
  },
  {
    id: 'old-friend',
    title: '故人相邀',
    desc: '多年前同路求道的旧友寻到你，说发现了一处秘境入口。',
    minRealm: 12,
    weight: 5,
    choices: [
      { id: 'go', text: '与他同去', outcomes: [
        { weight: 7, text: '秘境中你们各有所得。', effects: [{ type: 'stones', value: 30 }, { type: 'item', id: 'healingPill', count: 1 }, { type: 'months', value: 3 }] },
        { weight: 3, text: '秘境凶险，你们狼狈退回。', effects: [{ type: 'hp', ratio: -0.3 }, { type: 'months', value: 3 }] },
      ] },
      { id: 'decline', text: '婉拒，继续闭关', outcomes: [
        { weight: 10, text: '你留在洞府，把时间都花在了修为上。', effects: [{ type: 'exp', ratio: 0.28 }, { type: 'months', value: 3 }] },
      ] },
    ],
  },

  /* ---------- 金丹期 4 条：最终试炼前的世界叙事 ---------- */
  {
    id: 'thunder-omen',
    title: '雷云初现',
    desc: '连续七夜，祭坛方向雷云不散，山民心怀恐惧。',
    minRealm: 13,
    weight: 8,
    repeatable: false,
    choices: [
      { id: 'observe', text: '独自登坛观察雷云', outcomes: [
        { weight: 10, text: '你看清了雷云落点与节奏——这对之后的对决至关重要。', effects: [{ type: 'exp', ratio: 0.25 }], flags: { knowsThunderPattern: true } },
      ] },
      { id: 'warn', text: '先疏散山下村民', outcomes: [
        { weight: 10, text: '村民得以安然撤离，你心中无憾。', effects: [{ type: 'months', value: 2 }] },
      ] },
    ],
  },
  {
    id: 'altar-pilgrim',
    title: '祭坛香客',
    desc: '一名老香客在祭坛前跪了三天，他说自己的孙子死在这里。',
    minRealm: 13,
    weight: 6,
    choices: [
      { id: 'listen', text: '听他讲完那段旧事', outcomes: [
        { weight: 10, text: '你记住了古灵的脾性——它先蓄势，后落雷。', effects: [{ type: 'exp', ratio: 0.2 }], flags: { knowsThunderPattern: true } },
      ] },
      { id: 'give', text: '给他一些灵石', outcomes: [
        { weight: 10, text: '他把一枚旧年护身符塞给你。', effects: [{ type: 'stones', value: -10 }, { type: 'item', id: 'healingPill', count: 2 }] },
      ] },
    ],
  },
  {
    id: 'golden-furnace',
    title: '金炉余烬',
    desc: '祭坛下埋着一座古丹炉，炉中余火未熄。',
    minRealm: 13,
    weight: 6,
    repeatable: false,
    choices: [
      { id: 'refine', text: '以余火炼制丹药', outcomes: [
        { weight: 8, text: '你炼出两枚疗伤丹，品质极佳。', effects: [{ type: 'item', id: 'healingPill', count: 2 }] },
        { weight: 2, text: '火候失控，你被灼伤了手臂。', effects: [{ type: 'hp', ratio: -0.2 }] },
      ] },
      { id: 'absorb', text: '吸纳炉中残存的丹气', outcomes: [
        { weight: 10, text: '丹气入体，修为暴涨。', effects: [{ type: 'exp', ratio: 0.4 }] },
      ] },
    ],
  },
  {
    id: 'rival-golden',
    title: '同门问剑',
    desc: '一位同样修到金丹的同门拦住你，要在大战前分个高下。',
    minRealm: 13,
    weight: 5,
    repeatable: false,
    choices: [
      { id: 'duel', text: '接剑', outcomes: [
        { weight: 6, text: '你赢了半招，他留下疗伤丹离去。', effects: [{ type: 'hp', ratio: -0.2 }, { type: 'item', id: 'healingPill', count: 1 }, { type: 'exp', ratio: 0.2 }] },
        { weight: 4, text: '你输了，却想通了一处剑理。', effects: [{ type: 'hp', ratio: -0.15 }, { type: 'exp', ratio: 0.3 }] },
      ] },
      { id: 'talk', text: '与他对饮，不谈输赢', outcomes: [
        { weight: 10, text: '你们喝到天亮，各自往祭坛去。', effects: [{ type: 'exp', ratio: 0.15 }, { type: 'months', value: 1 }] },
      ] },
    ],
  },

  /* ---------- 连续型 4 条：早期选择影响后续 ---------- */
  {
    id: 'chain-stele',
    title: '破庙残碑',
    desc: '庙里半块残碑刻着陌生的字，末尾似乎还有下文。',
    minRealm: 1,
    weight: 6,
    repeatable: false,
    choices: [
      { id: 'read', text: '拓下碑文，回去慢慢认', outcomes: [
        { weight: 10, text: '你把碑文收好。有些字，像是在指路。', effects: [{ type: 'exp', ratio: 0.12 }], flags: { steleRead: true } },
      ] },
      { id: 'ignore', text: '不过半块破石头', outcomes: [{ weight: 10, text: '你没有停留。', effects: [] }] },
    ],
  },
  {
    id: 'chain-cave',
    title: '碑后洞天',
    desc: '照着碑文所指，你在崖壁间找到一处极窄的石缝。',
    minRealm: 6,
    weight: 6,
    repeatable: false,
    requiresFlags: ['steleRead'],
    choices: [
      { id: 'enter', text: '侧身挤进去', outcomes: [
        { weight: 8, text: '石缝尽头是一间小洞天，石台上摆着两枚丹药。', effects: [{ type: 'item', id: 'healingPill', count: 2 }, { type: 'exp', ratio: 0.2 }], flags: { caveFound: true } },
        { weight: 2, text: '石缝塌了半边，你只带回一块碎石。', effects: [{ type: 'hp', ratio: -0.15 }] },
      ] },
      { id: 'mark', text: '记下位置，日后再来', outcomes: [
        { weight: 10, text: '你在崖上刻了个记号。', effects: [{ type: 'months', value: 1 }], flags: { caveFound: true } },
      ] },
    ],
  },
  {
    id: 'chain-furnace',
    title: '洞天遗火',
    desc: '你带着碑文再次入洞，石台后竟还有一间丹房。',
    minRealm: 10,
    weight: 5,
    repeatable: false,
    requiresFlags: ['caveFound'],
    choices: [
      { id: 'use', text: '以遗火炼一炉丹', outcomes: [
        { weight: 8, text: '三枚疗伤丹出炉，你收起余火。', effects: [{ type: 'item', id: 'healingPill', count: 3 }, { type: 'months', value: 2 }], flags: { furnaceLit: true } },
        { weight: 2, text: '火势太急，你保住了一枚丹药。', effects: [{ type: 'item', id: 'healingPill', count: 1 }, { type: 'hp', ratio: -0.1 }] },
      ] },
      { id: 'seal', text: '封了丹房，留给后人', outcomes: [
        { weight: 10, text: '你封好丹房。道心愈发稳固。', effects: [{ type: 'exp', ratio: 0.3 }], flags: { furnaceLit: false } },
      ] },
    ],
  },
  {
    id: 'chain-lastword',
    title: '碑文末章',
    desc: '碑文最后一页指向祭坛，写着「雷落三息，气机自成」。',
    minRealm: 12,
    weight: 5,
    repeatable: false,
    requiresFlags: ['caveFound'],
    choices: [
      { id: 'understand', text: '静心参悟这句话', outcomes: [
        { weight: 10, text: '你终于明白：雷霆落下的三息里，护体最有效。', effects: [{ type: 'exp', ratio: 0.35 }], flags: { knowsThunderPattern: true } },
      ] },
      { id: 'burn', text: '烧掉碑文，不留后患', outcomes: [
        { weight: 10, text: '火光里，你像是放下了什么。', effects: [{ type: 'item', id: 'healingPill', count: 1 }] },
      ] },
    ],
  },
];

EVENTS.push(...NEW_EVENTS);


