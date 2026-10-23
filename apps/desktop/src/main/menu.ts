import { app, Menu, type MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  openLibrary(): void;
  createLibrary(): void;
  navigate(path: string): void;
}

/** Native menu bar. View entries navigate the renderer; File entries open the native pickers. */
export function buildMenu(actions: MenuActions): Menu {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => actions.navigate("/settings"),
              },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Library...",
          accelerator: "CmdOrCtrl+O",
          click: () => actions.openLibrary(),
        },
        {
          label: "New Library...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => actions.createLibrary(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Library", accelerator: "CmdOrCtrl+1", click: () => actions.navigate("/") },
        { label: "Inbox", accelerator: "CmdOrCtrl+2", click: () => actions.navigate("/inbox") },
        {
          label: "Projects",
          accelerator: "CmdOrCtrl+3",
          click: () => actions.navigate("/projects"),
        },
        { label: "Search", accelerator: "CmdOrCtrl+F", click: () => actions.navigate("/search") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
