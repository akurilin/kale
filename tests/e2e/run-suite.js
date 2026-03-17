/**
 * Generic E2E suite runner: keeps CI and developer-local entrypoints focused on
 * suite membership while preserving one sequential execution policy.
 */

/**
 * Why: sequential execution avoids cross-test interference between isolated
 * Electron sessions while preserving deterministic logs for debugging failures.
 */
const runScenarioSuite = async ({ suiteName, scenarioDefinitions }) => {
  for (const runScenario of scenarioDefinitions) {
    await runScenario();
  }

  console.log(`\n${suiteName} passed!`);
};

module.exports = {
  runScenarioSuite,
};
