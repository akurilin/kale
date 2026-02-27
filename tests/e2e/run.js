/**
 * E2E suite entrypoint: runs all defined scenarios sequentially so CI and local
 * workflows use one command while scenario files stay focused and modular.
 */

const { runHappyPathScenario } = require('./scenarios/happy-path.scenario');
const {
  runInlineCommentBoundaryWhitespaceScenario,
} = require('./scenarios/inline-comment-boundary-whitespace.scenario');

/**
 * Why: sequential execution avoids cross-test interference between isolated
 * Electron sessions while preserving deterministic logs for debugging failures.
 */
const runAllE2ETests = async () => {
  await runHappyPathScenario();
  await runInlineCommentBoundaryWhitespaceScenario();
  console.log('\nAll E2E tests passed!');
};

runAllE2ETests().catch((error) => {
  console.error('\nE2E test suite FAILED:', error.message || error);
  process.exit(1);
});
