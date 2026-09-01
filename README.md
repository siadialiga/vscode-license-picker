# VSCode Visual License Picker Extension

A simple visual license picker for VS Code. Browse popular open-source licenses, compare their permissions and limitations, and add one to your project in seconds.

## Features

- Opening a `LICENSE` file uses a visual custom editor instead of plain text.
- GitHub-inspired 3-column license picker.
- License metadata and full text are loaded from the [GitHub Licenses API](https://docs.github.com/en/rest/licenses/licenses).
- Shows permissions, conditions, limitations, and the full license text.
- Fills `[year]` and `[fullname]` placeholders before writing.
- Changes are written through VS Code's text document API, so save/undo behave normally.
- `License Picker: Create LICENSE File` creates a new `LICENSE` in the workspace root.
- `Open as Text` lets you switch back to VS Code's normal text editor at any time.

## Run locally

1. Open this folder in VS Code.
2. Press `F5` to start an Extension Development Host.
3. Create/open a file named `LICENSE`.

## Package

```bash
npm run package
```

## Notes

- An internet connection is required the first time licenses are loaded.
- Results are cached locally for 24 hours so the picker still works offline after the first successful load.
