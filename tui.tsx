import { Plugin, usePlugin } from "@opencode/plugin/tui"
import {
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
  type Component,
} from "solid-js"
import { readFile, readdir, stat } from "node:fs/promises"
import * as path from "node:path"

// --- ignore rules -----------------------------------------------------------

const IGNORED_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", "out",
  "target", ".next", ".turbo", ".cache", "coverage", "vendor",
  "__pycache__", ".venv", "venv", ".idea", ".vscode", ".gradle",
  ".terraform", "Pods",
])

const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])

const IGNORED_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".svgz", ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".jar", ".war",
  ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".wasm", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".pyc", ".class", ".o", ".a", ".obj", ".db", ".sqlite", ".sqlite3",
])

const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_PREVIEW_LINES = 200

interface Entry {
  name: string
  path: string
  isDir: boolean
  children?: Entry[]
}

async function listDir(dir: string): Promise<Entry[]> {
  const names = await readdir(dir)
  const out: Entry[] = []
  for (const name of names) {
    if (name.startsWith(".")) continue
    const p = path.join(dir, name)
    let st
    try {
      st = await stat(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue
      out.push({ name, path: p, isDir: true })
    } else if (st.isFile()) {
      if (IGNORED_FILES.has(name) || IGNORED_EXTS.has(path.extname(name))) continue
      out.push({ name, path: p, isDir: false })
    }
  }
  return out.sort(
    (a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name),
  )
}

// --- rendering --------------------------------------------------------------

const Rows: Component<{
  entries: Entry[]
  depth: number
  expanded: Set<string>
  current: string
  onDir: (entry: Entry) => void
  onFile: (entry: Entry) => void
  onContext: (entry: Entry) => void
}> = (props) => (
  <For each={props.entries}>
    {(entry) => (
      <box flexDirection="column">
        <box
          paddingLeft={props.depth * 2}
          onMouseDown={(event: { button?: number } | undefined) => {
            if (event?.button === 2) return
            if (entry.isDir) props.onDir(entry)
            else props.onFile(entry)
          }}
          onMouseUp={(event: { button?: number } | undefined) => {
            if (event?.button === 2) props.onContext(entry)
          }}
        >
          <text>
            {entry.isDir ? (props.expanded.has(entry.path) ? "▾ " : "▸ ") : "· "}
            {entry.isDir ? entry.name + "/" : entry.name}
            {entry.path === props.current ? "  ● session" : ""}
          </text>
        </box>
        <Show when={entry.isDir && props.expanded.has(entry.path)}>
          <Rows
            entries={entry.children ?? []}
            depth={props.depth + 1}
            expanded={props.expanded}
            current={props.current}
            onDir={props.onDir}
            onFile={props.onFile}
            onContext={props.onContext}
          />
        </Show>
      </box>
    )}
  </For>
)

// --- preview ----------------------------------------------------------------

const Preview: Component<{ filePath: string; onClose: () => void }> = (props) => {
  const [content] = createResource(
    () => props.filePath,
    async (filePath) => {
      try {
        const buffer = await readFile(filePath)
        if (buffer.byteLength > MAX_PREVIEW_BYTES) {
          return "… file is too large to preview"
        }
        const all = buffer.toString("utf8").split("\n")
        return (
          all
            .slice(0, MAX_PREVIEW_LINES)
            .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
            .join("\n") +
          (all.length > MAX_PREVIEW_LINES
            ? `\n… (${all.length - MAX_PREVIEW_LINES} more lines)`
            : "")
        )
      } catch (err) {
        return `… could not read file: ${err}`
      }
    },
  )

  return (
    <box flexDirection="column" marginTop={1} paddingTop={1} border={["top"]}>
      <box flexDirection="row" paddingBottom={1}>
        <text>{path.basename(props.filePath)}</text>
        <box marginLeft={2} onMouseDown={props.onClose}>
          <text>[close]</text>
        </box>
      </box>
      <text>{content.loading ? "loading…" : (content() ?? "")}</text>
    </box>
  )
}

// --- sidebar component ------------------------------------------------------

const Tree: Component<{ sessionID?: string }> = (props) => {
  const context = usePlugin()
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [preview, setPreview] = createSignal<string | null>(null)
  const [version, setVersion] = createSignal(0)

  const session = () =>
    props.sessionID ? context.data.session.get(props.sessionID) : undefined

  // Tree navigation override (set by "⬆ .."). Reset when the session changes.
  const [navRoot, setNavRoot] = createSignal<string | undefined>(undefined)
  createEffect(() => {
    props.sessionID
    setNavRoot(undefined)
  })

  // Session's own working directory; fall back to plugin location, then cwd.
  const root = () =>
    navRoot() ??
    session()?.location?.directory ??
    context.location?.directory ??
    process.cwd()

  const goUp = () => {
    const parent = path.dirname(root())
    if (parent !== root()) setNavRoot(parent)
  }

  // Pull session data once so `session()` is populated.
  if (props.sessionID) {
    void context.data.session.sync(props.sessionID).catch(() => {})
  }

  // Load the root listing. Expansion starts empty for each root.
  const [rootListing] = createResource(
    () => `${root()}#${version()}`,
    async (key) => {
      const dir = key.slice(0, key.indexOf("#"))
      const fresh = await listDir(dir)
      setExpanded(new Set<string>())
      setEntries(fresh)
      return fresh
    },
  )

  // Re-root tree and refresh when the session's directory changes (e.g. after a move).
  createEffect(() => {
    root()
    setVersion((v) => v + 1)
  })

  // Refresh on server events that can change the file layout.
  const stops = [
    context.data.on("session.execution.succeeded", () => setVersion((v) => v + 1)),
  ]
  context.onCleanup?.(() => stops.forEach((stop) => stop()))

  const updateChildren = (target: string, kids: Entry[]) => {
    const walk = (list: Entry[]): Entry[] =>
      list.map((e) => {
        if (e.path === target) return { ...e, children: kids }
        return e.children ? { ...e, children: walk(e.children) } : e
      })
    setEntries((current) => walk(current))
  }

  const openDir = async (entry: Entry) => {
    const set = new Set(expanded())
    if (set.has(entry.path)) {
      set.delete(entry.path)
    } else {
      set.add(entry.path)
      updateChildren(entry.path, await listDir(entry.path).catch(() => []))
    }
    setExpanded(set)
  }

  // Right-click → "Set session working directory here".
  const moveTo = async (entry: Entry) => {
    if (!props.sessionID) {
      context.ui.toast.show({
        title: "File tree",
        message: "No active session to move",
        variant: "error",
      })
      return
    }
    const confirmed = await context.ui.dialog.confirm({
      title: "Set session path",
      message: `Move this session's working directory to\n${entry.path}?`,
      label: { confirm: "Move", cancel: "Cancel" },
    })
    if (!confirmed) return
    try {
      await (context.client.session as {
        move(input: { sessionID: string; directory: string }): Promise<unknown>
      }).move({ sessionID: props.sessionID!, directory: entry.path })
      await context.data.session.sync(props.sessionID!)
      context.ui.toast.show({
        title: "File tree",
        message: `Session moved to ${context.ui.format.path(entry.path)}`,
        variant: "success",
      })
    } catch (err) {
      context.ui.toast.show({
        title: "File tree",
        message: `Move failed: ${err}`,
        variant: "error",
      })
    }
  }

  const contextMenu = async (entry: Entry) => {
    const choice = await context.ui.dialog.select({
      title: entry.name,
      options: [
        {
          title: "Set session working directory here",
          description: context.ui.format.path(entry.path),
          value: "move",
        },
      ],
    })
    if (choice === "move") await moveTo(entry)
  }

  // Keyboard path to move the session without the mouse.
  // Acts on the most recently selected directory (fallback: session root).
  const [lastDir, setLastDir] = createSignal<string | undefined>(undefined)
  const trackDir = (entry: Entry) => {
    if (entry.isDir) setLastDir(entry.path)
    openDir(entry)
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "file-tree.refresh",
        title: "File tree: refresh",
        palette: true,
        slash: { name: "tree-refresh" },
        run: () => setVersion((v) => v + 1),
      },
      {
        id: "file-tree.move-here",
        title: "File tree: set session directory to selected folder",
        palette: true,
        slash: { name: "tree-move-here" },
        run: async () => {
          const target = lastDir()
          if (!target) {
            context.ui.toast.show({
              title: "File tree",
              message: "Select a folder in the tree first",
              variant: "error",
            })
            return
          }
          await moveTo({ name: path.basename(target), path: target, isDir: true })
        },
      },
    ],
  }))

  return (
    <box flexDirection="column">
      <box flexDirection="row" paddingBottom={1}>
        <box onMouseDown={goUp}>
          <text>⬆ up</text>
        </box>
        <box marginLeft={2}>
          <text>{context.ui.format.path(root())}</text>
        </box>
      </box>
      <Show when={rootListing.error}>
        <box paddingBottom={1}>
          <text>cannot read {root()}</text>
          <text>{String(rootListing.error)}</text>
        </box>
      </Show>
      <For each={entries()} fallback={<text>(empty folder)</text>}>
        {(entry) => (
          <Rows
            entries={[entry]}
            depth={0}
            expanded={expanded()}
            current={root()}
            onDir={trackDir}
            onFile={(file) => setPreview(file.path)}
            onContext={contextMenu}
          />
        )}
      </For>
      <Show when={preview()}>
        <Preview filePath={preview()!} onClose={() => setPreview(null)} />
      </Show>
    </box>
  )
}

// --- plugin -----------------------------------------------------------------

export default Plugin.define({
  id: "file-tree.sidebar",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (slot) => <Tree sessionID={slot?.sessionID} />,
    })
  },
})
