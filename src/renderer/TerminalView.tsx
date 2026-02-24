//
// This view remains as a standalone wrapper so terminal work can still be
// tested in isolation while reusing the embeddable terminal pane component.
//

import { useEffect, useState } from 'react';

import type { TerminalBootstrapResponse } from '../shared-types';
import { getTerminalApi } from './terminal-api';
import { TerminalPane } from './TerminalPane';

// The standalone wrapper owns bootstrap loading because main still decides the
// default terminal file context during isolated terminal prototype runs.
export const TerminalView = () => {
  const [bootstrapContext, setBootstrapContext] =
    useState<TerminalBootstrapResponse | null>(null);
  const [bootstrapErrorText, setBootstrapErrorText] = useState<string | null>(
    null,
  );

  // Bootstrap context is async because the main process resolves the canonical
  // file path/cwd and fallback behavior for terminal prototype startup.
  useEffect(() => {
    let isDisposed = false;

    const loadBootstrapContext = async () => {
      try {
        const nextBootstrapContext =
          await getTerminalApi().getBootstrapContext();
        if (isDisposed) {
          return;
        }

        setBootstrapContext(nextBootstrapContext);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setBootstrapErrorText(
          error instanceof Error ? error.message : 'Unknown bootstrap error',
        );
      }
    };

    void loadBootstrapContext();

    return () => {
      isDisposed = true;
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-title">kale terminal view</div>
        <div className="file-path">
          {bootstrapContext
            ? `${bootstrapContext.targetFilePath} (${bootstrapContext.source})`
            : bootstrapErrorText
              ? `Bootstrap failed: ${bootstrapErrorText}`
              : 'Loading terminal context...'}
        </div>
        <div className="save-status">
          {bootstrapContext
            ? 'Ready'
            : bootstrapErrorText
              ? 'Error'
              : 'Loading...'}
        </div>
      </header>
      <main className="workspace">
        <TerminalPane
          title="Terminal (Prototype)"
          targetFilePath={bootstrapContext?.targetFilePath ?? null}
          targetWorkingDirectory={bootstrapContext?.cwd ?? null}
          contextSourceLabel={bootstrapContext?.source ?? null}
          showPrototypeNotice={true}
          showMetadataPanel={true}
        />
      </main>
    </>
  );
};
