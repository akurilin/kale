# Project Notes

This is an Electron project using Electron Forge. The goal of this app is to be a modern tool for editing
prose combining the power of coding agents and an IDE with the beautful aesthetics of a writing tool.

# Workflow

- !IMPORTANT: do not commit unless explitictly told to by the user

## Coding style

- Use a self-explanatory naming style that makes it easy to understand what a function does based on the name alone. It's better to make it longer and clearer than to try to be brief and obscure.
- Comment every function with a header comment focusing on the why
- Add comments to sections that may be not obvious to future readers, focus on WHY something is implemented and implemented that particular way
- Preserve comments when copying code around and refactoring
- Keep comments updated as you're changing the logic, make sure they still reflect what's happening in the logic

## Facts

- Use the `date` command to check what date it is before looking up things on the web
  including a year. The current year might not be what you think it is, `date` is the source of truth.

## Documentation Policy

- `README.md` is the source of truth about this project.
- The agent must read `README.md` at the beginning of each session.
- The agent must keep `README.md` updated with the latest changes to the repository.

## GitHub Tooling

- The agent can use the `gh` tool to interact with GitHub in general.

## Testing

- Never use Playwright or Playwright MCP
- Do not use Playwright to test the app, instead use the `scripts/capture_npm_start_window.sh` script
  to take a screenshot and verify your changes visually. Kill the app process after you're done verifying
- After finishing a batch of changes, run `npm run format` and `npm run lint` before wrapping up
