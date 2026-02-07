/**
 * Запуск проверок XP из командной строки:
 * npx tsx src/domain/xp/runXpTestsRunner.ts
 */

import { runXpTests } from "./calculateXp.test";

runXpTests();
console.log("All XP tests passed.");
process.exit(0);
