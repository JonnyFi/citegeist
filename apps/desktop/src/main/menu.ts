import { app, Menu, type MenuItemConstructorOptions } from "electron";
import { mt } from "../shared/text.js";

export interface MenuActions {
  openLibrary(): void;
  createLibrary(): void;
  navigate(path: string): void;
  about(): void;
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
              { label: mt("menu.about"), click: () => actions.about() },
              { type: "separator" },
              {
                label: mt("menu.settings"),
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
      label: mt("menu.file"),
      submenu: [
        {
          label: mt("menu.openLibrary"),
          accelerator: "CmdOrCtrl+O",
          click: () => actions.openLibrary(),
        },
        {
          label: mt("menu.newLibrary"),
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => actions.createLibrary(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: mt("menu.view"),
      submenu: [
        {
          label: mt("menu.library"),
          accelerator: "CmdOrCtrl+1",
          click: () => actions.navigate("/"),
        },
        {
          label: mt("menu.inbox"),
          accelerator: "CmdOrCtrl+2",
          click: () => actions.navigate("/inbox"),
        },
        {
          label: mt("menu.projects"),
          accelerator: "CmdOrCtrl+3",
          click: () => actions.navigate("/projects"),
        },
        {
          label: mt("menu.search"),
          accelerator: "CmdOrCtrl+F",
          click: () => actions.navigate("/search"),
        },
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
