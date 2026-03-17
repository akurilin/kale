/**
 * Developer-local E2E suite entrypoint: runs the CI-safe scenarios plus
 * developer-machine-only regressions that depend on local Claude access.
 */

const { developerLocalScenarioDefinitions } = require('./scenario-suites');
const { runScenarioSuite } = require('./run-suite');

runScenarioSuite({
  suiteName: 'Developer-local E2E suite',
  scenarioDefinitions: developerLocalScenarioDefinitions,
}).catch((error) => {
  console.error('\nDeveloper-local E2E suite FAILED:', error.message || error);
  process.exit(1);
});
