/**
 * Terminal-pane collapse/expand regression scenario: verifies the top-bar
 * toggle hides/reveals the terminal pane and resizes the window width so
 * collapsing does not leave a large blank editor region.
 */

const assert = require('node:assert');

const { runIsolatedE2ETest } = require('../harness');

const WINDOW_RESIZE_TOLERANCE_PIXELS = 10;
const EDITOR_WIDTH_STABILITY_TOLERANCE_PIXELS = 10;
const COLLAPSED_TERMINAL_AREA_MAX_PRIMARY_AXIS_PIXELS = 4;
const NON_DEFAULT_ZOOM_FACTOR = 1.25;
const ZOOM_FACTOR_ASSERTION_TOLERANCE = 0.001;

/**
 * Why: this helper captures renderer-visible workspace geometry so assertions
 * can verify both pane visibility and native window resizing from one snapshot.
 */
const readWorkspaceGeometrySnapshot = async (page) => {
  return page.evaluate(() => {
    const workspaceElement = document.querySelector('.workspace');
    const editorPaneElement = document.querySelector('.workspace-pane--editor');
    const terminalPaneElement = document.querySelector('.terminal-pane');
    const workspaceDividerElement = document.querySelector(
      '.workspace-divider--terminal',
    );
    const terminalToggleButtonElement = document.querySelector(
      '.topbar-terminal-toggle-button',
    );

    const editorPaneWidth =
      editorPaneElement?.getBoundingClientRect().width ?? 0;
    const terminalPaneWidth =
      terminalPaneElement?.getBoundingClientRect().width ?? 0;
    const terminalPaneHeight =
      terminalPaneElement?.getBoundingClientRect().height ?? 0;
    const workspaceDividerWidth =
      workspaceDividerElement?.getBoundingClientRect().width ?? 0;
    const workspaceDividerHeight =
      workspaceDividerElement?.getBoundingClientRect().height ?? 0;
    const workspaceComputedStyle = workspaceElement
      ? window.getComputedStyle(workspaceElement)
      : null;
    const isVerticalStackedLayout =
      workspaceComputedStyle?.display === 'flex' &&
      workspaceComputedStyle?.flexDirection === 'column';
    const terminalPanePrimaryAxisFootprint = isVerticalStackedLayout
      ? terminalPaneHeight + workspaceDividerHeight
      : terminalPaneWidth + workspaceDividerWidth;

    return {
      innerWindowWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
      workspaceSplitColumns: workspaceElement
        ? window.getComputedStyle(workspaceElement).gridTemplateColumns
        : '',
      workspaceDisplay: workspaceComputedStyle?.display ?? '',
      workspaceFlexDirection: workspaceComputedStyle?.flexDirection ?? '',
      isVerticalStackedLayout,
      editorPaneWidth,
      terminalPaneWidth,
      terminalPaneHeight,
      workspaceDividerWidth,
      workspaceDividerHeight,
      terminalPaneAreaWidth: terminalPaneWidth + workspaceDividerWidth,
      terminalPanePrimaryAxisFootprint,
      terminalToggleLabel:
        terminalToggleButtonElement?.getAttribute('aria-label') ?? null,
      terminalTogglePressed:
        terminalToggleButtonElement?.getAttribute('aria-pressed') ?? null,
    };
  });
};

/**
 * Why: terminal-toggle waits can fail under CI timing variance, so failures
 * should report current geometry/aria state to make root causes actionable.
 */
const waitForTerminalToggleLabel = async (page, expectedLabel) => {
  try {
    await page.waitForFunction(
      (expectedTerminalToggleLabel) => {
        const terminalToggleButtonElement = document.querySelector(
          '.topbar-terminal-toggle-button',
        );
        return (
          terminalToggleButtonElement?.getAttribute('aria-label') ===
          expectedTerminalToggleLabel
        );
      },
      expectedLabel,
      { timeout: 10_000 },
    );
  } catch (error) {
    const debugSnapshot = await readWorkspaceGeometrySnapshot(page);
    throw new Error(
      [
        `Timed out waiting for terminal toggle label ${JSON.stringify(expectedLabel)}.`,
        `Snapshot: ${JSON.stringify(debugSnapshot)}.`,
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      ].join(' '),
    );
  }
};

/**
 * Why: near-equality checks keep assertions deterministic when layout values
 * are rounded to integers at the BrowserWindow boundary.
 */
const assertWithinTolerance = ({
  actualValue,
  expectedValue,
  tolerancePixels,
  assertionDescription,
}) => {
  assert.ok(
    Math.abs(actualValue - expectedValue) <= tolerancePixels,
    `${assertionDescription}. Expected ${expectedValue}, got ${actualValue}, tolerance ${tolerancePixels}.`,
  );
};

/**
 * Why: Playwright keyboard events do not trigger browser accelerators (like
 * Cmd+plus), so tests set zoom through Electron main to exercise the same
 * browser-level zoom path deterministically.
 */
const setMainWindowZoomFactor = async (electronApp, zoomFactor) => {
  return electronApp.evaluate(({ BrowserWindow }, requestedZoomFactor) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      throw new Error('Main window not found while setting zoom factor');
    }

    mainWindow.webContents.setZoomFactor(requestedZoomFactor);
    return mainWindow.webContents.getZoomFactor();
  }, zoomFactor);
};

/**
 * Why: this regression ensures terminal toggle behavior stays aligned with the
 * writing-first UX by coupling pane collapse with native window width changes.
 */
const runCollapseExpandAssertionsForCurrentZoomLevel = async (
  page,
  zoomLabel,
) => {
  let initialGeometrySnapshot = await readWorkspaceGeometrySnapshot(page);
  if (initialGeometrySnapshot.terminalToggleLabel === 'Expand terminal pane') {
    await page.getByRole('button', { name: 'Expand terminal pane' }).click();
    await waitForTerminalToggleLabel(page, 'Collapse terminal pane');
    initialGeometrySnapshot = await readWorkspaceGeometrySnapshot(page);
  }
  assert.strictEqual(
    initialGeometrySnapshot.terminalToggleLabel,
    'Collapse terminal pane',
    `[${zoomLabel}] Terminal toggle should start in expanded state. Got ${JSON.stringify(initialGeometrySnapshot.terminalToggleLabel)}.`,
  );
  assert.strictEqual(
    initialGeometrySnapshot.terminalTogglePressed,
    'true',
    `[${zoomLabel}] Terminal toggle should report aria-pressed=true initially. Got ${JSON.stringify(initialGeometrySnapshot.terminalTogglePressed)}.`,
  );
  assert.ok(
    initialGeometrySnapshot.terminalPaneAreaWidth > 100,
    `[${zoomLabel}] Initial terminal area width should be visible. Got ${initialGeometrySnapshot.terminalPaneAreaWidth}.`,
  );

  await page.getByRole('button', { name: 'Collapse terminal pane' }).click();
  await waitForTerminalToggleLabel(page, 'Expand terminal pane');

  const collapsedGeometrySnapshot = await readWorkspaceGeometrySnapshot(page);
  assert.strictEqual(
    collapsedGeometrySnapshot.terminalToggleLabel,
    'Expand terminal pane',
    `[${zoomLabel}] Terminal toggle should switch to collapsed label. Got ${JSON.stringify(collapsedGeometrySnapshot.terminalToggleLabel)}.`,
  );
  assert.strictEqual(
    collapsedGeometrySnapshot.terminalTogglePressed,
    'false',
    `[${zoomLabel}] Terminal toggle should report aria-pressed=false when collapsed. Got ${JSON.stringify(collapsedGeometrySnapshot.terminalTogglePressed)}.`,
  );
  assert.ok(
    collapsedGeometrySnapshot.terminalPanePrimaryAxisFootprint <=
      COLLAPSED_TERMINAL_AREA_MAX_PRIMARY_AXIS_PIXELS,
    `[${zoomLabel}] Collapsed terminal area should stay <= ${COLLAPSED_TERMINAL_AREA_MAX_PRIMARY_AXIS_PIXELS}px on the active layout axis. Got ${collapsedGeometrySnapshot.terminalPanePrimaryAxisFootprint}.`,
  );
  const expectedCollapsedInnerWindowWidth = Math.round(
    initialGeometrySnapshot.innerWindowWidth -
      initialGeometrySnapshot.terminalPaneAreaWidth,
  );
  assertWithinTolerance({
    actualValue: collapsedGeometrySnapshot.innerWindowWidth,
    expectedValue: expectedCollapsedInnerWindowWidth,
    tolerancePixels: WINDOW_RESIZE_TOLERANCE_PIXELS,
    assertionDescription: `[${zoomLabel}] Collapsed window width should shrink by terminal pane area width`,
  });
  if (
    collapsedGeometrySnapshot.isVerticalStackedLayout ===
    initialGeometrySnapshot.isVerticalStackedLayout
  ) {
    assertWithinTolerance({
      actualValue: collapsedGeometrySnapshot.editorPaneWidth,
      expectedValue: initialGeometrySnapshot.editorPaneWidth,
      tolerancePixels: EDITOR_WIDTH_STABILITY_TOLERANCE_PIXELS,
      assertionDescription: `[${zoomLabel}] Editor pane width should stay stable when terminal collapses`,
    });
  } else {
    assert.ok(
      collapsedGeometrySnapshot.editorPaneWidth >=
        initialGeometrySnapshot.editorPaneWidth -
          EDITOR_WIDTH_STABILITY_TOLERANCE_PIXELS,
      [
        `[${zoomLabel}] Editor pane width should not shrink when responsive layout switches during collapse.`,
        `Initial width: ${initialGeometrySnapshot.editorPaneWidth}.`,
        `Collapsed width: ${collapsedGeometrySnapshot.editorPaneWidth}.`,
        `Initial vertical layout: ${initialGeometrySnapshot.isVerticalStackedLayout}.`,
        `Collapsed vertical layout: ${collapsedGeometrySnapshot.isVerticalStackedLayout}.`,
      ].join(' '),
    );
  }

  await page.getByRole('button', { name: 'Expand terminal pane' }).click();
  await waitForTerminalToggleLabel(page, 'Collapse terminal pane');

  const reExpandedGeometrySnapshot = await readWorkspaceGeometrySnapshot(page);
  assert.strictEqual(
    reExpandedGeometrySnapshot.terminalTogglePressed,
    'true',
    `[${zoomLabel}] Terminal toggle should return to aria-pressed=true when expanded. Got ${JSON.stringify(reExpandedGeometrySnapshot.terminalTogglePressed)}.`,
  );
  assert.ok(
    reExpandedGeometrySnapshot.terminalPaneAreaWidth > 100,
    `[${zoomLabel}] Terminal area should be visible after re-expand. Got ${reExpandedGeometrySnapshot.terminalPaneAreaWidth}.`,
  );
  assertWithinTolerance({
    actualValue: reExpandedGeometrySnapshot.innerWindowWidth,
    expectedValue: initialGeometrySnapshot.innerWindowWidth,
    tolerancePixels: WINDOW_RESIZE_TOLERANCE_PIXELS,
    assertionDescription: `[${zoomLabel}] Re-expanded window width should return to initial width`,
  });
  assertWithinTolerance({
    actualValue: reExpandedGeometrySnapshot.editorPaneWidth,
    expectedValue: initialGeometrySnapshot.editorPaneWidth,
    tolerancePixels: EDITOR_WIDTH_STABILITY_TOLERANCE_PIXELS,
    assertionDescription: `[${zoomLabel}] Editor pane width should return after terminal re-expand`,
  });
};

/**
 * Why: this regression now runs at default and non-default zoom levels to
 * prevent CSS-to-window pixel conversion drift from regressing collapse sizing.
 */
const runTerminalPaneCollapseExpandScenario = async () => {
  await runIsolatedE2ETest({
    testName: 'E2E terminal-pane collapse/expand regression',
    testBody: async ({ page, electronApp }) => {
      await page.waitForSelector('.terminal-pane', { timeout: 10_000 });
      await page.waitForSelector('.topbar-terminal-toggle-button', {
        timeout: 10_000,
      });

      await runCollapseExpandAssertionsForCurrentZoomLevel(page, 'zoom-1.0');

      const appliedZoomFactor = await setMainWindowZoomFactor(
        electronApp,
        NON_DEFAULT_ZOOM_FACTOR,
      );
      assertWithinTolerance({
        actualValue: appliedZoomFactor,
        expectedValue: NON_DEFAULT_ZOOM_FACTOR,
        tolerancePixels: ZOOM_FACTOR_ASSERTION_TOLERANCE,
        assertionDescription:
          'Main window zoom factor should apply before zoomed collapse/expand assertions',
      });

      await page.waitForTimeout(500);
      await runCollapseExpandAssertionsForCurrentZoomLevel(
        page,
        `zoom-${NON_DEFAULT_ZOOM_FACTOR}`,
      );
    },
  });
};

module.exports = { runTerminalPaneCollapseExpandScenario };
