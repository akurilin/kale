/**
 * CI-safe E2E suite entrypoint: runs only the scenarios that do not require
 * local Claude access or other developer-machine-only dependencies.
 */

const { ciScenarioDefinitions } = require('./scenario-suites');
const { runScenarioSuite } = require('./run-suite');

runScenarioSuite({
  suiteName: 'CI-safe E2E suite',
  scenarioDefinitions: ciScenarioDefinitions,
}).catch((error) => {
  console.error('\nE2E test suite FAILED:', error.message || error);
  process.exit(1);
});
