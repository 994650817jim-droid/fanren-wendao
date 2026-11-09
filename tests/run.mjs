/**
 * 测试入口：单进程跑完所有测试。
 * 不用 `node --test tests/`，因为那种模式会为每个文件 fork 子进程，
 * 在某些受限环境（如带文件沙箱的 Windows）会因 spawn EPERM 直接失败。
 */
import './cultivation.test.js';
import './breakthrough.test.js';
import './breakthrough-forecast.test.js';
import './save.test.js';
import './integrity.test.js';
import './events.test.js';
import './combat.test.js';
import './timeline.test.js';
import './boss.test.js';
import './boss-save.test.js';
import './inventory.test.js';
import './story.test.js';
import './balance.test.js';








