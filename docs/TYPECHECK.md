# 类型检查现状（npm run typecheck）

- 工具：TypeScript ，checkJs + noEmit，**不迁移 TypeScript**
- 范围：src/core/** 与 src/data/**（src/ui 暂未纳入，ui 单独约有 28 个类型错误）
- 最新一次运行：**10 个类型错误**
- 完整输出见仓库根目录 	ypecheck-report.txt

## 分类与处理原则（按 ChatGPT v1.0 RC3 决定）
1. **真正的返回值类型不匹配** → 优先修（本轮已修 combat.js 的 CombatResult 联合类型，13 → ）
2. **JSDoc 定义不准确** → 调整注释使其与实现一致（不改变逻辑）
3. **需要改动核心玩法的** → 先记录，不擅自改
4. **不使用 @ts-ignore 掩盖，不关闭检查**

## 当前剩余错误（10 项）

- `src/core/cultivation.js(73,42): error TS2353: Object literal may only specify known properties, and 'stones' does not exist in type '{ ok: boolean; reason?: string; gained: number; months: number; capped: boolean; omen: string; died: boolean; }'.`
- `src/core/rng.js(21,5): error TS2339: Property 'seed' does not exist on type '() => number'.`
- `src/core/rng.js(22,5): error TS2339: Property 'float' does not exist on type '() => number'.`
- `src/core/rng.js(23,5): error TS2339: Property 'range' does not exist on type '() => number'.`
- `src/core/rng.js(24,5): error TS2339: Property 'int' does not exist on type '() => number'.`
- `src/core/rng.js(25,5): error TS2339: Property 'chance' does not exist on type '() => number'.`
- `src/core/rng.js(26,5): error TS2339: Property 'pick' does not exist on type '() => number'.`
- `src/core/saveManager.js(249,25): error TS2339: Property 'character' does not exist on type 'object'.`
- `src/core/turnTimeline.js(48,3): error TS2339: Property 'action' does not exist on type '{ enemyDamage?: number; healed?: number; isSkill?: boolean; myDamage?: number; reduced?: boolean; speed?: string; }'.`
- `src/data/events.js(653,13): error TS2345: Argument of type '{ id: string; title: string; desc: string; minRealm: number; weight: number; repeatable: boolean; choices: ({ id: string; text: string; outcomes: { weight: number; text: string; effects: ({ value?: undefined; type: string; ratio: number; } | { ...; })[]; flags: { ...; }; }[]; } | { ...; })[]; requiresFlags?: undefin...' is not assignable to parameter of type '{ id: string; title: string; desc: string; minRealm: number; weight: number; choices: { id: string; text: string; outcomes: { weight: number; text: string; effects: ({ type: string; value: number; ratio?: undefined; } | { value?: undefined; type: string; ratio: number; })[]; }[]; }[]; }'.`


## 下一轮计划
- 逐模块补齐 JSDoc（rng 的函数属性类型、cultivation 返回字段、turnTimeline 的 action 参数、events 的数组元素类型、saveManager 的联合类型收窄）
- 清零后才把 
pm run typecheck 纳入正式发布必过项；当前只作为诊断工具