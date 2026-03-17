/**
 * E2E scenario suite registry: separates CI-safe scenarios from local-only
 * scenarios that depend on developer tooling such as Claude Code.
 */

const { runHappyPathScenario } = require('./scenarios/happy-path.scenario');
const {
  runInlineCommentBoundaryWhitespaceScenario,
} = require('./scenarios/inline-comment-boundary-whitespace.scenario');
const {
  runInlineCommentTypingScrollStabilityScenario,
} = require('./scenarios/inline-comment-typing-scroll-stability.scenario');
const {
  runInlineCommentDeleteScrollStabilityScenario,
} = require('./scenarios/inline-comment-delete-scroll-stability.scenario');
const {
  runInlineCommentActiveFocusSyncScenario,
} = require('./scenarios/inline-comment-active-focus-sync.scenario');
const {
  runTerminalPaneCollapseExpandScenario,
} = require('./scenarios/terminal-pane-collapse-expand.scenario');
const {
  runRepositoryFileExplorerPaneScenario,
} = require('./scenarios/repository-file-explorer-pane.scenario');
const {
  runRepositoryFileExplorerNonGitScenario,
} = require('./scenarios/repository-file-explorer-non-git.scenario');
const {
  runClaudeSafeShiftEnterRegressionScenario,
} = require('./scenarios/claude-safe-shift-enter-regression.scenario');

const ciScenarioDefinitions = [
  runHappyPathScenario,
  runInlineCommentBoundaryWhitespaceScenario,
  runInlineCommentTypingScrollStabilityScenario,
  runInlineCommentDeleteScrollStabilityScenario,
  runInlineCommentActiveFocusSyncScenario,
  runTerminalPaneCollapseExpandScenario,
  runRepositoryFileExplorerPaneScenario,
  runRepositoryFileExplorerNonGitScenario,
];

const developerLocalScenarioDefinitions = [
  ...ciScenarioDefinitions,
  runClaudeSafeShiftEnterRegressionScenario,
];

module.exports = {
  ciScenarioDefinitions,
  developerLocalScenarioDefinitions,
};
