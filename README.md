# opencode-file-tree-v2

A sidebar file tree for [OpenCode](https://opencode.ai) **V2** (TUI). It shows the working directory of the current session and lets you navigate it and move the session.

This is a V2 CLI plugin built on `@opencode/plugin/tui`. For OpenCode V1, use the original `opencode-file-tree` instead.

## Features

- Tree of the session's working directory, in the sidebar
- `⬆ up` button to go up one level (changes the tree view, not the session)
- Click folders to expand and collapse; click files to preview the first 200 lines
- Right-click a folder → **Set session working directory here** to move the session
- `/tree-move-here` moves the session to the last folder you clicked (keyboard-friendly)
- `/tree-refresh` reloads the tree
- Hides dotfiles, `node_modules`, `.git`, build output, and binary files

## Install

Clone the plugin somewhere permanent:

```sh
git clone https://github.com/zemadeiran/opencode-file-tree-v2 ~/.config/opencode/plugins/file-tree
```

Then add its path to the `plugins` array in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["/Users/you/.config/opencode/plugins/file-tree"]
}
```

Use the absolute path to your clone. Restart OpenCode, open a session, and the tree appears in the sidebar.

> **Note:** `opencode plugin add github:zemadeiran/opencode-file-tree-v2` does not work yet. The TUI plugin fails to load when installed from Git ([anomalyco/opencode#33884](https://github.com/anomalyco/opencode/issues/33884)). Use the path setup above until that is fixed.

Mouse support requires mouse capture in `~/.config/opencode/cli.json`:

```json
{
  "mouse": true
}
```

## Notes

- Right-click handling depends on your terminal reporting the right mouse button. If right-click does nothing, use `/tree-move-here` instead.
- Expanded folders are not saved across restarts yet.
- This plugin is not affiliated with OpenCode. Review the source before installing.
