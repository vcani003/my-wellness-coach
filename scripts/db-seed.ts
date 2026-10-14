/**
 * `npm run db:seed -- <single|household> [--after-shopping]`
 * Resets that test kitchen (local only) and loads the scenario (0021).
 */
import { openScriptDb } from "./local-db";
import { SCENARIOS, seedScenario, type ScenarioName } from "./scenarios";

const [name, ...flags] = process.argv.slice(2);
if (!SCENARIOS.includes(name as ScenarioName)) {
  console.error(`Usage: npm run db:seed -- <${SCENARIOS.join("|")}> [--after-shopping]`);
  process.exit(1);
}

const { db, close, dataDir } = await openScriptDb();
try {
  const { kitchenId, userIds } = await seedScenario(db, name as ScenarioName, {
    afterShopping: flags.includes("--after-shopping"),
  });
  console.log(`Seeded "${name}" in ${dataDir}: kitchen ${kitchenId}, members ${userIds.join(", ")}`);
} finally {
  await close();
}
