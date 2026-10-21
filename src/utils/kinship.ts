// 家谱称谓推导与关系路径查找
// 设计依据《推导算法》：数据层只存 生父母/养父母/继父母/配偶/子女，其余称谓全部由路径推导。

import { compareSiblings, sortSiblings, type SiblingOrderMap, type SeniorityMap } from './siblingOrder';

// ==================== 路径步进类型 ====================

/**
 * 路径中的一步（从"我"的视角出发）：
 * F 父 / M 母 / AF 养父 / AM 养母 / SF 继父 / SM 继母
 * H 丈夫 / W 妻子
 * S 儿子 / D 女儿 / AS 养子 / AD 养女 / SS 继子 / SD 继女
 */
export type KinStep =
  | 'F' | 'M' | 'AF' | 'AM' | 'SF' | 'SM'
  | 'H' | 'W'
  | 'S' | 'D' | 'AS' | 'AD' | 'SS' | 'SD';

const DOWN_STEPS = new Set<KinStep>(['S', 'D', 'AS', 'AD', 'SS', 'SD']);

interface AdjEdge {
  to: string;
  step: KinStep;
  /** 路径选择惩罚：0=生血亲，1=母系优先级稍低，2=姻亲，3=养/继 */
  penalty: number;
}

// ==================== 有向图构建（5.1） ====================

function collectAdoptiveFathers(r: any): string[] {
  if (Array.isArray(r.adoptiveFathers) && r.adoptiveFathers.length > 0) return r.adoptiveFathers;
  if (r.adoptiveFather) return [r.adoptiveFather];
  return [];
}

function collectAdoptiveMothers(r: any): string[] {
  if (Array.isArray(r.adoptiveMothers) && r.adoptiveMothers.length > 0) return r.adoptiveMothers;
  if (r.adoptiveMother) return [r.adoptiveMother];
  return [];
}

function buildAdjacency(persons: Record<string, any>): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  const add = (from: string, to: string, step: KinStep, penalty: number) => {
    if (!from || !to || from === to || !persons[from] || !persons[to]) return;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, step, penalty });
  };

  for (const p of Object.values(persons) as any[]) {
    const r = p?.relations;
    if (!r) continue;

    const childStep: KinStep = p.gender === 'male' ? 'S' : 'D';

    // 生父母（父系优先：M 边 penalty=1，F 边 penalty=0，用于同长路径优先选父系）
    if (r.father && persons[r.father]) {
      add(p.id, r.father, 'F', 0);
      add(r.father, p.id, childStep, 0);
    }
    if (r.mother && persons[r.mother]) {
      add(p.id, r.mother, 'M', 1);
      add(r.mother, p.id, childStep, 0);
    }

    // 养父母 / 继父母（penalty=3，生父母路径优先）
    collectAdoptiveFathers(r).forEach((afId) => {
      add(p.id, afId, 'AF', 3);
      add(afId, p.id, childStep, 3);
    });
    collectAdoptiveMothers(r).forEach((amId) => {
      add(p.id, amId, 'AM', 3);
      add(amId, p.id, childStep, 3);
    });
    if (r.stepFather && persons[r.stepFather]) {
      add(p.id, r.stepFather, 'SF', 3);
      add(r.stepFather, p.id, childStep, 3);
    }
    if (r.stepMother && persons[r.stepMother]) {
      add(p.id, r.stepMother, 'SM', 3);
      add(r.stepMother, p.id, childStep, 3);
    }

    // 配偶（姻亲 penalty=2，血亲路径优先；同性配偶同样按 丈夫/妻子 走）
    (r.spouses || []).forEach((s: any) => {
      if (!s?.id || !persons[s.id]) return;
      add(p.id, s.id, p.gender === 'female' ? 'H' : 'W', 2);
      // 反向边兜底（正常数据由对方记录补齐，这里保证双向可达）
      const spouse = persons[s.id];
      add(s.id, p.id, spouse.gender === 'female' ? 'H' : 'W', 2);
    });

    // 子女（按 child.type 映射）
    (r.children || []).forEach((c: any) => {
      const child = persons[c?.id];
      if (!child) return;
      let step: KinStep;
      let penalty = 0;
      if (c.type === 'adopted') {
        step = child.gender === 'male' ? 'AS' : 'AD';
        penalty = 3;
      } else if (c.type === 'step') {
        step = child.gender === 'male' ? 'SS' : 'SD';
        penalty = 3;
      } else {
        step = child.gender === 'male' ? 'S' : 'D';
      }
      add(p.id, child.id, step, penalty);
      // 反向：子女视角的父母边
      const parentStep: KinStep =
        c.type === 'adopted'
          ? p.gender === 'male' ? 'AF' : 'AM'
          : c.type === 'step'
            ? p.gender === 'male' ? 'SF' : 'SM'
            : p.gender === 'male' ? 'F' : 'M';
      add(child.id, p.id, parentStep, penalty);
    });
  }

  return adj;
}

// ==================== 路径搜索（5.2） ====================

export interface KinshipPath {
  /** 路径节点 id 序列：ids[0] = 主视角，ids[last] = 目标 */
  ids: string[];
  /** 每一步的步进类型，steps.length = ids.length - 1 */
  steps: KinStep[];
}

/**
 * 从主视角出发搜索到目标人的主路径。
 * 同长路径按优先级选择：生父母 > 养/继；父系 > 母系；血亲 > 姻亲；越短越优先。
 */
export function findKinshipPath(
  targetId: string,
  perspectiveId: string | undefined,
  persons: Record<string, any>,
  maxDepth = 8
): KinshipPath | null {
  if (!perspectiveId || !targetId || perspectiveId === targetId) return null;
  if (!persons[perspectiveId] || !persons[targetId]) return null;

  const adj = buildAdjacency(persons);
  const bestCost = new Map<string, number>();

  interface SearchNode {
    id: string;
    cost: number;
    depth: number;
    ids: string[];
    steps: KinStep[];
  }

  const heap: SearchNode[] = [{ id: perspectiveId, cost: 0, depth: 0, ids: [perspectiveId], steps: [] }];
  bestCost.set(perspectiveId, 0);

  let guard = 0;
  while (heap.length && guard++ < 50000) {
    heap.sort((a, b) => a.cost - b.cost);
    const cur = heap.shift()!;
    if (cur.id === targetId) {
      return { ids: cur.ids, steps: cur.steps };
    }
    if (cur.depth >= maxDepth) continue;

    for (const e of adj.get(cur.id) || []) {
      const cost = cur.cost + 10 + e.penalty;
      if ((bestCost.get(e.to) ?? Infinity) <= cost) continue;
      if (cur.ids.includes(e.to)) continue; // 路径内防环
      bestCost.set(e.to, cost);
      heap.push({
        id: e.to,
        cost,
        depth: cur.depth + 1,
        ids: [...cur.ids, e.to],
        steps: [...cur.steps, e.step],
      });
    }
  }
  return null;
}

// ==================== 年龄比较（5.5） ====================

/**
 * a 是否比 b 年长。
 * 优先使用家谱里手动指定的同辈顺序（用于"不知道生日但知道排行"的场景），
 * 没有手动顺序时按出生日期，出生日期未知的视为更年幼。
 */
function olderThan(a: any, b: any, order?: SiblingOrderMap, seniority?: SeniorityMap): boolean {
  return compareSiblings(a, b, order, seniority) < 0;
}

// ==================== 称谓地域习惯（南北方 + 小地区细分） ====================

/** 大方向：north=北方，south=南方 */
export type TitleRegion = 'north' | 'south';

/**
 * 具体称谓方案 = 大方向 + 小地区。
 * 直接存在 meta.titleStyle 上；历史数据里的 'north' / 'south' 仍是最基础的两档，天然兼容。
 */
export type TitleDialect =
  | 'north' | 'dongbei' | 'jin' | 'xibei'
  | 'south' | 'yue' | 'ke' | 'min' | 'wu' | 'xiang';

/** 兼容旧命名（外部还在用 TitleStyle 这个类型名） */
export type TitleStyle = TitleDialect;

export interface TitleDialectInfo {
  name: string;
  desc: string;
  /** 展示用的叫法样例：[关系, 叫法] */
  examples: Array<[string, string]>;
}

/**
 * 书面称谓 → 口语词条。
 * 替换时按"词条长度从长到短"依次进行：先命中「外曾祖父」，再命中「祖父」，
 * 因此 外祖父→姥爷 之后不会再被 祖父→爷爷 二次污染。
 * 未列出的称谓（父亲/母亲/儿子/女儿/丈夫/妻子 等）各地差别很小，保持书面写法。
 */
type WordPair = [string, string];

/** 北方通用 */
const WORDS_NORTH: WordPair[] = [
  ['外高祖父', '老太姥爷'], ['外高祖母', '老太姥姥'],
  ['外曾祖父', '太姥爷'], ['外曾祖母', '太姥姥'],
  ['外祖父', '姥爷'], ['外祖母', '姥姥'],
  ['曾祖父', '太爷爷'], ['曾祖母', '太奶奶'],
  ['高祖父', '老太爷爷'], ['高祖母', '老太奶奶'],
  ['祖父', '爷爷'], ['祖母', '奶奶'],
  ['伯父', '伯伯'], ['叔父', '叔叔'],
  ['婶母', '婶婶'], ['姑母', '姑妈'],
  ['舅父', '舅舅'], ['舅母', '舅妈'], ['姨母', '姨妈'],
  ['弟媳', '弟妹'], ['儿媳', '儿媳妇'],
  ['堂兄', '堂哥'], ['表兄', '表哥'],
];

/** 南方通用 */
const WORDS_SOUTH: WordPair[] = [
  ['外高祖父', '太外公'], ['外高祖母', '太外婆'],
  ['外曾祖父', '太外公'], ['外曾祖母', '太外婆'],
  ['外祖父', '外公'], ['外祖母', '外婆'],
  ['曾祖父', '太爷爷'], ['曾祖母', '太奶奶'],
  ['高祖父', '老太爷爷'], ['高祖母', '老太奶奶'],
  ['祖父', '爷爷'], ['祖母', '奶奶'],
  ['伯父', '伯伯'], ['叔父', '叔叔'],
  ['婶母', '婶婶'], ['姑母', '姑妈'],
  ['姑父', '姑丈'], ['姨父', '姨丈'],
  ['舅父', '舅舅'], ['舅母', '舅妈'], ['姨母', '姨妈'],
  ['儿媳', '儿媳妇'],
  ['堂兄', '堂哥'], ['表兄', '表哥'],
];

/** 在基础上覆盖若干词条（后写的优先） */
function extendWords(base: WordPair[], extra: WordPair[]): WordPair[] {
  const box = new Map<string, string>(base);
  for (const [from, to] of extra) box.set(from, to);
  // 长词优先，避免「祖父」抢在「外曾祖父」前面命中
  return Array.from(box.entries()).sort((a, b) => b[0].length - a[0].length);
}

/** 各地叫法差异（只在已确认有区别的词条上覆盖） */
const WORD_OVERRIDES: Record<TitleDialect, WordPair[]> = {
  north: WORDS_NORTH,
  south: WORDS_SOUTH,
  // 东北：连襟叫"一担挑"，姑母叫"姑姑"
  dongbei: extendWords(WORDS_NORTH, [
    ['连襟', '一担挑'],
    ['姑母', '姑姑'],
  ]),
  // 晋语（山西及周边）：伯父叫"大爷"，妯娌叫"先后"
  jin: extendWords(WORDS_NORTH, [
    ['伯父', '大爷'],
    ['妯娌', '先后'],
  ]),
  // 西北（陕甘宁青）：连襟叫"挑担"，妯娌叫"先后"
  xibei: extendWords(WORDS_NORTH, [
    ['连襟', '挑担'],
    ['妯娌', '先后'],
  ]),
  // 粤语（广府）
  yue: extendWords(WORDS_SOUTH, [
    ['伯祖父', '伯公'], ['叔祖父', '叔公'], ['姑祖母', '姑婆'],
    ['伯祖母', '伯婆'], ['叔祖母', '叔婆'],
    ['舅外祖父', '舅公'], ['姨外祖母', '姨婆'], ['姑外祖母', '姑婆'],
    ['曾祖父', '太公'], ['曾祖母', '太婆'],
    ['高祖父', '老太公'], ['高祖母', '老太婆'],
    ['祖父', '阿公'], ['祖母', '阿嫲'],
    ['伯父', '阿伯'], ['叔父', '阿叔'],
    ['伯母', '伯娘'], ['婶母', '阿婶'],
    ['姑母', '姑姐'], ['舅母', '妗母'], ['姨母', '阿姨'],
    ['哥哥', '阿哥'], ['姐姐', '家姐'], ['弟弟', '细佬'], ['妹妹', '细妹'],
    ['嫂子', '阿嫂'],
    ['儿媳', '新妇'], ['弟媳', '弟妇'],
    ['侄子', '侄仔'], ['外甥', '甥仔'], ['外甥女', '甥女'],
    ['孙子', '孙仔'],
    ['公公', '家公'], ['婆婆', '家婆'], ['岳父', '外父'], ['岳母', '外母'],
    ['大伯子', '大伯'], ['小叔子', '叔仔'],
    ['大姑子', '姑奶'], ['小姑子', '姑仔'],
    ['大舅子', '大舅'], ['小舅子', '舅仔'],
    ['大姨子', '大姨'], ['小姨子', '姨仔'],
  ]),
  // 客家
  ke: extendWords(WORDS_SOUTH, [
    ['伯祖父', '伯公'], ['叔祖父', '叔公'], ['姑祖母', '姑婆'],
    ['伯祖母', '伯婆'], ['叔祖母', '叔婆'],
    ['舅外祖父', '舅公'], ['姨外祖母', '姨婆'], ['姑外祖母', '姑婆'],
    ['曾祖父', '太公'], ['曾祖母', '太婆'],
    ['祖父', '阿公'], ['祖母', '阿婆'],
    ['伯父', '阿伯'], ['叔父', '阿叔'],
    ['伯母', '伯娘'], ['婶母', '阿婶'],
    ['姑母', '阿姑'], ['舅母', '妗婆'], ['姨母', '阿姨'],
    ['儿媳', '新妇'],
    ['侄子', '侄仔'], ['外甥', '甥仔'], ['外甥女', '甥女'],
    ['公公', '家公'], ['婆婆', '家婆'],
  ]),
  // 闽语（闽南 / 潮汕 / 台湾）
  min: extendWords(WORDS_SOUTH, [
    ['伯祖父', '伯公'], ['叔祖父', '叔公'], ['姑祖母', '姑婆'],
    ['伯祖母', '伯婆'], ['叔祖母', '叔婆'],
    ['舅外祖父', '舅公'], ['姨外祖母', '姨婆'], ['姑外祖母', '姑婆'],
    ['曾祖父', '太公'], ['曾祖母', '太嫲'],
    ['祖父', '阿公'], ['祖母', '阿嫲'],
    ['伯父', '阿伯'], ['叔父', '阿叔'],
    ['伯母', '阿姆'], ['婶母', '阿婶'],
    ['姑母', '阿姑'], ['舅父', '阿舅'], ['舅母', '妗婆'],
    ['姨母', '阿姨'],
    ['儿媳', '新妇'],
    ['侄子', '侄仔'], ['外甥', '甥仔'], ['外甥女', '甥女'],
  ]),
  // 吴语（江浙沪）
  wu: extendWords(WORDS_SOUTH, [
    ['孙女', '孙囡'], ['外孙女', '外孙囡'], ['侄女', '侄囡'],
    ['儿媳', '新妇'],
    ['连襟', '挑担'],
  ]),
  // 湘语（湖南）
  xiang: extendWords(WORDS_SOUTH, [
    ['祖母', '娭毑'],
    ['伯祖母', '伯婆'], ['叔祖母', '叔婆'], ['姑祖母', '姑婆'],
  ]),
};

/** 各大方向下的可选项与展示文案 */
export const TITLE_REGIONS: Array<{
  id: TitleRegion;
  name: string;
  desc: string;
  /** 切到大方向时默认选中的细分方案 */
  fallback: TitleDialect;
  dialects: TitleDialect[];
}> = [
  {
    id: 'north',
    name: '北方',
    desc: '姥爷 / 姥姥、姑父 / 姨父 一路的叫法',
    fallback: 'north',
    dialects: ['north', 'dongbei', 'jin', 'xibei'],
  },
  {
    id: 'south',
    name: '南方',
    desc: '外公 / 外婆、姑丈 / 姨丈 一路的叫法',
    fallback: 'south',
    dialects: ['south', 'yue', 'ke', 'min', 'wu', 'xiang'],
  },
];

/** 每个具体方案的名称 / 说明 / 示例（新建家谱、设置页展示用） */
export const TITLE_STYLE_SAMPLES: Record<TitleDialect, TitleDialectInfo> = {
  north: {
    name: '通用北方',
    desc: '华北、东北一带的通行叫法',
    examples: [
      ['祖父', '爷爷'], ['祖母', '奶奶'],
      ['外祖父', '姥爷'], ['外祖母', '姥姥'],
      ['伯父', '伯伯'], ['伯母', '伯母'],
    ],
  },
  dongbei: {
    name: '东北',
    desc: '在通用北方之上：姑母叫"姑姑"、连襟叫"一担挑"',
    examples: [
      ['外祖父', '姥爷'], ['外祖母', '姥姥'],
      ['姑母', '姑姑'], ['婶母', '婶婶'], ['连襟', '一担挑'],
    ],
  },
  jin: {
    name: '晋语（山西一带）',
    desc: '在通用北方之上：伯父叫"大爷"、妯娌叫"先后"',
    examples: [
      ['祖父', '爷爷'], ['伯父', '大爷'],
      ['叔父', '叔叔'], ['妯娌', '先后'],
    ],
  },
  xibei: {
    name: '西北（陕甘宁青）',
    desc: '在通用北方之上：连襟叫"挑担"、妯娌叫"先后"',
    examples: [
      ['外祖父', '姥爷'], ['舅母', '舅妈'],
      ['连襟', '挑担'], ['妯娌', '先后'],
    ],
  },
  south: {
    name: '通用南方',
    desc: '江南、华中一带的通行叫法',
    examples: [
      ['祖父', '爷爷'], ['祖母', '奶奶'],
      ['外祖父', '外公'], ['外祖母', '外婆'],
      ['姑父', '姑丈'], ['姨父', '姨丈'],
    ],
  },
  yue: {
    name: '粤语（广府）',
    desc: '祖父叫"阿公"、祖母叫"阿嫲"、儿媳叫"新妇"、公公叫"家公"',
    examples: [
      ['祖父', '阿公'], ['祖母', '阿嫲'],
      ['伯父', '阿伯'], ['舅母', '妗母'],
      ['儿媳', '新妇'], ['公公', '家公'],
    ],
  },
  ke: {
    name: '客家',
    desc: '祖父叫"阿公"、祖母叫"阿婆"、舅母叫"妗婆"、儿媳叫"新妇"',
    examples: [
      ['祖父', '阿公'], ['祖母', '阿婆'],
      ['伯母', '伯娘'], ['舅母', '妗婆'],
      ['儿媳', '新妇'], ['婆婆', '家婆'],
    ],
  },
  min: {
    name: '闽语（闽南 / 潮汕）',
    desc: '祖母叫"阿嫲"、舅父叫"阿舅"、舅母叫"妗婆"、儿媳叫"新妇"',
    examples: [
      ['祖父', '阿公'], ['祖母', '阿嫲'],
      ['舅父', '阿舅'], ['舅母', '妗婆'],
      ['儿媳', '新妇'], ['伯母', '阿姆'],
    ],
  },
  wu: {
    name: '吴语（江浙沪）',
    desc: '儿媳叫"新妇"、孙女叫"孙囡"、连襟叫"挑担"',
    examples: [
      ['外祖父', '外公'], ['外祖母', '外婆'],
      ['儿媳', '新妇'], ['孙女', '孙囡'],
      ['侄女', '侄囡'], ['连襟', '挑担'],
    ],
  },
  xiang: {
    name: '湘语（湖南）',
    desc: '在通用南方之上：祖母叫"娭毑"',
    examples: [
      ['祖母', '娭毑'], ['祖父', '爷爷'],
      ['外祖母', '外婆'], ['姑父', '姑丈'],
    ],
  },
};

/** 方案 → 所属大方向 */
export function dialectRegion(dialect: TitleDialect): TitleRegion {
  return dialect === 'north' || dialect === 'dongbei' || dialect === 'jin' || dialect === 'xibei'
    ? 'north'
    : 'south';
}

/** 按地域习惯替换称谓用词（未传或未收录时原样返回） */
export function localizeTitle(title: string, dialect?: TitleDialect): string {
  if (!title || !dialect) return title;
  const pairs = WORD_OVERRIDES[dialect];
  if (!pairs) return title;
  let out = title;
  for (const [from, to] of pairs) {
    if (from === to) continue;
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

const CHINESE_RANK = ['大', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function collectParentKeys(r: any): string[] {
  if (!r) return [];
  return [
    r.father,
    r.mother,
    ...collectAdoptiveFathers(r),
    ...collectAdoptiveMothers(r),
    r.stepFather,
    r.stepMother,
  ].filter(Boolean);
}

/** 共享父母的兄弟姐妹排行称呼 */
function siblingTitle(
  targetId: string,
  selfId: string,
  persons: Record<string, any>,
  order?: SiblingOrderMap,
  seniority?: SeniorityMap
): string {
  const me = persons[selfId];
  const target = persons[targetId];
  if (!me || !target) return '';

  const parentKeys = collectParentKeys(me.relations);
  const sibs = Object.values(persons).filter((p: any) => {
    if (p.id === selfId || p.id === targetId) return true;
    if (!p?.relations) return false;
    const pKeys = collectParentKeys(p.relations);
    return pKeys.some((k) => parentKeys.includes(k));
  });

  const unique = Array.from(new Map(sibs.map((p: any) => [p.id, p])).values()) as any[];
  // 排行顺序 = 树上从左到右的顺序（手动排序优先，其次出生日期）
  const sorted = sortSiblings(unique, order, seniority);

  const male = target.gender === 'male';
  if (unique.length <= 1) return male ? '独子' : '独女';

  const selfIdx = sorted.findIndex((p) => p.id === selfId);
  const targetIdx = sorted.findIndex((p) => p.id === targetId);
  if (selfIdx === -1 || targetIdx === -1) return male ? '兄弟' : '姐妹';

  const older = targetIdx < selfIdx;
  if (unique.length === 2) {
    return older ? (male ? '哥哥' : '姐姐') : (male ? '弟弟' : '妹妹');
  }
  const rank = targetIdx < CHINESE_RANK.length ? CHINESE_RANK[targetIdx] : `${targetIdx + 1}`;
  return older ? `${rank}${male ? '哥' : '姐'}` : `${rank}${male ? '弟' : '妹'}`;
}

// ==================== 路径 → 称谓（5.3 / 5.6 / 5.7 + 六、速查表） ====================

/** 纯向下路径：儿子/女儿 → 孙子 → 曾孙 → 玄孙 → 来孙…（含外/养/继前缀） */
function descendantTitle(steps: KinStep[]): string {
  if (steps.length === 0) return '';
  const first = steps[0];
  if (steps.length === 1) {
    switch (first) {
      case 'S': return '儿子';
      case 'D': return '女儿';
      case 'AS': return '养子';
      case 'AD': return '养女';
      case 'SS': return '继子';
      case 'SD': return '继女';
    }
  }

  const last = steps[steps.length - 1];
  const femaleLast = last === 'D' || last === 'AD' || last === 'SD';
  const maternal = first === 'D' || first === 'AD' || first === 'SD';
  const adoptPrefix =
    first === 'AS' || first === 'AD' ? '养' : first === 'SS' || first === 'SD' ? '继' : '';

  const level = steps.length;
  // 女系后代一律加"外"：外孙 / 外曾孙 / 外玄孙（此时不再用"孙子"）
  if (maternal) {
    const base = DESCENDANT_GEN[level] || `${level}世孙`;
    return '外' + base + (femaleLast ? '女' : '');
  }

  let base = level === 2
    ? femaleLast ? '孙女' : '孙子'
    : (DESCENDANT_GEN[level] || `${level}世孙`) + (femaleLast ? '女' : '');
  if (adoptPrefix) base = adoptPrefix + base;
  return base;
}

/** 第 n 代后代：子 → 孙 → 曾孙 → 玄孙 → 来孙 → 晜孙 → 仍孙 → 云孙 → 耳孙 */
const DESCENDANT_GEN = ['', '子', '孙', '曾孙', '玄孙', '来孙', '晜孙', '仍孙', '云孙', '耳孙'];

/** 旁系（侄/甥）后代用：子/女、孙/孙女、曾孙/曾孙女… */
function collateralDescendant(level: number, female: boolean): string {
  if (level === 1) return female ? '女' : '子';
  const base = DESCENDANT_GEN[level] || `${level}世孙`;
  return female ? base + '女' : base;
}

/** 父 → 祖父 → 曾祖父 → 高祖父 → 天/烈/太/远/鼻祖 */
const ANCESTOR_GEN = ['祖父', '曾祖父', '高祖父', '天祖父', '烈祖父', '太祖父', '远祖父', '鼻祖父'];


/** 纯向上路径：父亲 → 祖父 → 曾祖父 → 高祖父 → 天/烈/太/远/鼻祖 */
function ancestorTitle(steps: KinStep[], ids: string[], persons: Record<string, any>): string {
  const k = steps.length;
  const first = steps[0];

  if (k === 1) {
    const map: Record<string, string> = {
      F: '父亲', M: '母亲', AF: '养父', AM: '养母', SF: '继父', SM: '继母',
    };
    return map[first] || '长辈';
  }

  const lastPerson = persons[ids[k]];
  const female = lastPerson?.gender === 'female';

  let prefix = '';
  if (first === 'M') prefix = '外';
  else if (first === 'AF' || first === 'AM') prefix = '养';
  else if (first === 'SF' || first === 'SM') prefix = '继';

  const baseByK: Record<number, string> = { 2: '祖父', 3: '曾祖父', 4: '高祖父' };
  const tier = ['天', '烈', '太', '远', '鼻'];
  let base: string;
  if (baseByK[k]) base = baseByK[k];
  else if (k >= 5 && k <= 9) base = tier[k - 5] + '祖父';
  else base = `${k + 1}世祖`;

  if (female) base = base.replace(/祖父$/, '祖母');
  return prefix + base;
}

/**
 * 向上 + 向下的旁系路径：兄弟姐妹 / 伯叔姑舅姨 / 堂表兄弟姐妺 / 侄甥等
 *
 * 统一按三个维度命名，避免"某个 K/L 组合没覆盖到就退化成祖辈亲戚"：
 *   1) 分支度数 g = min(K, L)：1=亲（无前缀）、2=堂/表、3=再从、≥4=族
 *   2) 代差 d = L - K：0=同辈、正=晚辈、负=长辈
 *   3) 参照人：目标同辈、靠"我"这一侧的人
 *        - 晚辈（d>0）：ids[2K]（与我同辈的堂/表兄弟姊妹）→ 决定侄 / 甥
 *        - 长辈（d<0）：ids[K-L]（目标这一辈、我这房的人）→ 决定伯/叔/姑/舅/姨
 */
function collateralTitle(
  steps: KinStep[],
  ids: string[],
  persons: Record<string, any>,
  selfId: string,
  order?: SiblingOrderMap,
  seniority?: SeniorityMap
): string {
  const upCount = steps.findIndex((s) => DOWN_STEPS.has(s));
  const ups = steps.slice(0, upCount);
  const downs = steps.slice(upCount);
  const K = ups.length;
  const L = downs.length;
  const target = persons[ids[ids.length - 1]];
  if (!target) return '';
  const female = target.gender === 'female';
  const firstUp = ups[0];
  const adoptPrefix =
    firstUp === 'AF' || firstUp === 'AM' ? '养' : firstUp === 'SF' || firstUp === 'SM' ? '继' : '';

  // 兄弟姐妹（含排行称呼）
  if (K === 1 && L === 1) {
    return siblingTitle(ids[ids.length - 1], selfId, persons, order, seniority);
  }

  const d = L - K;
  const g = Math.min(K, L);

  // 分支人（共同祖先的子女，即伯/叔/姑/舅/姨这一辈）性别，用于判断堂 / 表
  const branchPerson = persons[ids[K + 1]];
  const branchMale = branchPerson?.gender === 'male';

  let branchPrefix = '';
  if (g >= 2) {
    // 长辈方向要以"目标同辈的参照人"为起点算堂表（例：堂姐的孩子叫我，我相对她母亲是堂兄弟）
    const leadUp = d < 0 ? ups[-d] : ups[0];
    const paternal = leadUp === 'F' || leadUp === 'AF' || leadUp === 'SF';
    const tong = paternal && branchMale;
    if (g === 2) branchPrefix = tong ? '堂' : '表';
    else if (g === 3) branchPrefix = tong ? '再从' : '再从表';
    else branchPrefix = tong ? '族' : '族表';
  }

  // ---------- 同辈：堂/表兄弟姊妹 ----------
  if (d === 0) {
    const older = olderThan(target, persons[selfId], order, seniority);
    const suffix = female ? (older ? '姐' : '妹') : older ? '兄' : '弟';
    return adoptPrefix + branchPrefix + suffix;
  }

  // ---------- 长辈：伯/叔/姑/舅/姨 → 祖父 / 曾祖 … ----------
  if (d < 0) {
    const level = -d; // 1=父辈, 2=祖父辈, 3=曾祖辈…
    const peer = persons[ids[K - L]]; // 目标这一辈、与我最接近的人
    const peerMale = peer?.gender === 'male';

    let core: string;
    if (peerMale) {
      core = female ? '姑' : olderThan(target, peer, order, seniority) ? '伯' : '叔';
    } else {
      core = female ? '姨' : '舅';
    }

    if (level === 1) {
      // 堂伯/堂姑这类已带分支前缀的不再加"父/母"（与文档速查表一致）
      return adoptPrefix + branchPrefix + core + (g >= 2 ? '' : female ? '母' : '父');
    }

    const genName = ANCESTOR_GEN[level - 2] || `${level}世祖`;
    // 母系（"我"这一步先到母亲）在祖辈称谓里插"外"：伯外祖父 / 舅外祖父
    const outer = firstUp === 'M' || firstUp === 'AM' || firstUp === 'SM' ? '外' : '';
    const genderName = female ? genName.replace(/祖父$/, '祖母') : genName;
    return adoptPrefix + branchPrefix + core + outer + genderName;
  }

  // ---------- 晚辈：侄 / 甥 系列 ----------
  // 与我同辈的堂/表兄弟姊妹：男 → 其后代称"侄"；女 → 称"甥"
  const connector = persons[ids[2 * K]];
  const throughMale = connector ? connector.gender === 'male' : branchMale;
  const line = throughMale ? '侄' : '外甥';
  let genName = collateralDescendant(d, female);
  // 亲侄叫"侄子/侄女"，堂/表只叫"堂侄/表侄"；甥不加"子"
  if (d === 1 && (branchPrefix || !throughMale)) genName = female ? '女' : '';
  if (!genName && d !== 1) return '晚辈亲戚';
  // 隔着女儿这一层下来的孙辈加"外"（如伯外祖父称我"外侄孙"）
  const outer =
    d >= 2 && !branchPrefix && throughMale && downs.some((s) => s === 'D' || s === 'AD' || s === 'SD')
      ? '外'
      : '';
  return adoptPrefix + outer + branchPrefix + line + genName;
}

/** 配偶视角递归：婚姻点之后的整段路径"随配偶叫"（5.7） */
function inLawFromSpouse(
  steps: KinStep[],
  ids: string[],
  persons: Record<string, any>,
  selfId: string,
  order?: SiblingOrderMap,
  seniority?: SeniorityMap
): string {
  const me = persons[selfId];
  const spouseId = ids[1];
  const femaleSelf = me?.gender === 'female';
  const rest = steps.slice(1);
  const restIds = ids.slice(1);

  // 直接配偶
  if (rest.length === 0) {
    const rel = (me?.relations?.spouses || []).find((s: any) => s.id === spouseId);
    const pfx = rel?.type === 'divorced' ? '前' : rel?.type === 'deceased' ? '亡' : '';
    return pfx + (femaleSelf ? '丈夫' : '妻子');
  }

  const target = persons[ids[ids.length - 1]];
  const r0 = rest[0];

  // 配偶的父母：公婆 / 岳父母
  if (rest.length === 1) {
    if (r0 === 'F') return femaleSelf ? '公公' : '岳父';
    if (r0 === 'M') return femaleSelf ? '婆婆' : '岳母';
    if (DOWN_STEPS.has(r0)) return target?.gender === 'female' ? '继女' : '继子';
  }

  // 配偶的兄弟姐妹：大伯子/小叔子/大姑子/小姑子 或 大舅子/小舅子/大姨子/小姨子
  if (rest.length === 2 && (r0 === 'F' || r0 === 'M')) {
    const spouse = persons[spouseId];
    const older = olderThan(target, spouse, order, seniority);
    if (target?.gender === 'male') {
      return femaleSelf ? (older ? '大伯子' : '小叔子') : older ? '大舅子' : '小舅子';
    }
    return femaleSelf ? (older ? '大姑子' : '小姑子') : older ? '大姨子' : '小姨子';
  }

  // 妯娌 / 连襟
  if (rest.length === 3 && (r0 === 'F' || r0 === 'M')) {
    if (femaleSelf && (rest[1] === 'S' || rest[1] === 'AS') && rest[2] === 'W') return '妯娌';
    if (!femaleSelf && (rest[1] === 'D' || rest[1] === 'AD') && rest[2] === 'H') return '连襟';
  }

  // 其余姻亲：套用配偶对该人的称呼（随配偶叫）
  const spouseTitle = kinshipTitle(rest, restIds, persons, spouseId, order, seniority);
  return spouseTitle || '亲戚';
}

/** 血亲称谓 → 其配偶称谓：伯父→伯母、姑母→姑父、哥哥→嫂子…… */
function spouseifyTitle(t: string): string {
  const map: Record<string, string> = {
    '伯父': '伯母',
    '叔父': '婶母',
    '姑母': '姑父',
    '舅父': '舅母',
    '姨母': '姨父',
  };
  if (map[t]) return map[t];
  // 哥哥 → 嫂子（siblingTitle 输出的是"哥哥/二哥"，不是"兄"）
  if (t.endsWith('哥哥')) return '嫂子';
  if (t.endsWith('哥')) return t.slice(0, -1) + '嫂';
  if (t.endsWith('兄')) return t.slice(0, -1) + '嫂';
  if (t.endsWith('弟')) return t.slice(0, -1) + '弟媳';
  if (t.endsWith('姐')) return t.slice(0, -1) + '姐夫';
  if (t.endsWith('妹')) return t.slice(0, -1) + '妹夫';
  // 侄 / 甥 / 女：侄媳、甥媳、侄女婿、堂外甥女婿
  if (t.endsWith('侄')) return t + '媳';
  if (t.endsWith('甥')) return t + '媳';
  if (t.endsWith('子') && t.length >= 2) return t.slice(0, -1) + '媳';
  if (t.endsWith('女')) return t + '婿';
  if (t.endsWith('祖父')) return t.slice(0, -2) + '祖母';
  if (t.endsWith('祖母')) return t.slice(0, -2) + '祖父';
  if (t.endsWith('父') && t.length >= 3) return t.slice(0, -1) + '母';
  if (t.endsWith('母') && t.length >= 3) return t.slice(0, -1) + '父';
  return t + '的配偶';
}

/**
 * 路径 → 称谓主入口
 * steps: 从"我"到目标的步进序列；ids: 对应节点 id（ids[0] = 我）
 */
export function kinshipTitle(
  steps: KinStep[],
  ids: string[],
  persons: Record<string, any>,
  selfId: string,
  order?: SiblingOrderMap,
  seniority?: SeniorityMap
): string {
  if (!steps.length) return '';

  const mwIdx = steps.findIndex((s) => s === 'H' || s === 'W');

  // 婚姻点在路径开头：配偶及其亲属
  if (mwIdx === 0) {
    return inLawFromSpouse(steps, ids, persons, selfId, order, seniority);
  }

  // 婚姻点在路径末尾：血亲的配偶（伯母/姑父/嫂子/儿媳/孙婿……）
  if (mwIdx === steps.length - 1) {
    const prev = steps[mwIdx - 1];
    const baseSteps = steps.slice(0, mwIdx);
    const baseIds = ids.slice(0, mwIdx + 1);

    if (DOWN_STEPS.has(prev)) {
      const allDown = baseSteps.every((s) => DOWN_STEPS.has(s));
      if (allDown) {
        // 子孙的配偶：儿媳/女婿/孙媳/孙女婿……
        if (baseSteps.length === 1) return steps[mwIdx] === 'W' ? '儿媳' : '女婿';
        const base = descendantTitle(baseSteps);
        if (base.endsWith('女')) return base + '婿';
        return base + '媳';
      }
      // 兄弟姐妹的配偶：哥哥→嫂子、姐姐→姐夫……
      const base = kinshipTitle(baseSteps, baseIds, persons, selfId, order, seniority);
      return base ? spouseifyTitle(base) : '亲戚';
    }

    // 长辈/平辈血亲的配偶：伯父→伯母、姑母→姑父……
    const base = kinshipTitle(baseSteps, baseIds, persons, selfId, order, seniority);
    return base ? spouseifyTitle(base) : '亲戚';
  }

  // 婚姻点在路径中段（少见），兜底
  if (mwIdx > 0) return '亲戚';

  const upCount = steps.findIndex((s) => DOWN_STEPS.has(s));

  // 纯向上：直系祖先
  if (upCount === -1) {
    return ancestorTitle(steps, ids, persons);
  }

  const ups = steps.slice(0, upCount);
  const downs = steps.slice(upCount);

  // 纯向下：直系后代
  if (ups.length === 0) {
    if (downs.every((s) => DOWN_STEPS.has(s))) return descendantTitle(downs);
    return '亲戚';
  }

  // 向上 + 向下：旁系
  return collateralTitle(steps, ids, persons, selfId, order, seniority);
}

// ==================== 对外主入口 ====================

/**
 * 计算目标人相对于主视角的称谓。
 * 与旧版签名保持一致，内部改为 BFS 路径推导 + 查表。
 * order 为家谱中手动指定的同辈顺序（meta.siblingOrder），不传则纯按出生日期判断长幼；
 * seniority 为手动长幼标记（meta.siblingSeniority），优先级高于 order。
 */
export function getRelationshipText(
  targetId: string,
  perspectiveId: string | undefined,
  persons: Record<string, any>,
  order?: SiblingOrderMap,
  seniority?: SeniorityMap,
  titleStyle?: TitleDialect
): string {
  if (!perspectiveId || !persons) return '';
  if (targetId === perspectiveId) return '主视角';

  const target = persons[targetId];
  if (!target) return '';

  // 虚拟占位父母：跳过称呼计算，直接按结构称呼
  if (target.givenName === '（父亲）') return '父亲';
  if (target.givenName === '（母亲）') return '母亲';

  const path = findKinshipPath(targetId, perspectiveId, persons);
  if (!path) return '家族成员';

  const title = kinshipTitle(path.steps, path.ids, persons, perspectiveId, order, seniority);
  // 未设置时按北方习惯（与历史版本用词最接近：姑父/姨父/弟媳）
  return localizeTitle(title || '家族成员', titleStyle || 'north');
}

// ==================== 关系路径 → 连线高亮辅助 ====================

/**
 * 把路径中相邻两人映射到家谱树上实际绘制的连线 id。
 * 夫妻边直接匹配；父母边因"共用一条线"可能只绘有生父→子女的边，
 * 此时回退到该子女任意父母的连线。
 */
export function findPathEdgeIds(
  ids: string[],
  edges: { id: string; source: string; target: string }[],
  persons: Record<string, any>
): string[] {
  const result: string[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const u = ids[i];
    const v = ids[i + 1];
    let found = edges.find(
      (e) => (e.source === u && e.target === v) || (e.source === v && e.target === u)
    );
    if (!found) {
      const child =
        persons[u]?.relations && (persons[u].relations.father === v || persons[u].relations.mother === v)
          ? u
          : persons[v]?.relations && (persons[v].relations.father === u || persons[v].relations.mother === u)
            ? v
            : null;
      if (child) {
        const parentIds = [persons[child]?.relations?.father, persons[child]?.relations?.mother].filter(Boolean);
        found = edges.find((e) => parentIds.includes(e.source) && e.target === child);
      }
    }
    if (found) result.push(found.id);
  }
  return result;
}
