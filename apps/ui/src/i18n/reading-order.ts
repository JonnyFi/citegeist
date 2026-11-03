/** Strings for the ordered reading list of a project. Spread into `de.ts` and `en.ts`. */
export const readingOrderDe = {
  "reading.progress.one": "{read} von {n} gelesen",
  "reading.progress.other": "{read} von {n} gelesen",
  "reading.next": "Als Nächstes lesen",
  "reading.nextTitle": "Öffnet „{title}“",
  "reading.allRead": "Alles gelesen",
  "reading.position": "Position",
  "reading.handle":
    "{title} verschieben: ziehen oder mit den Pfeiltasten nach oben oder unten bewegen",
  "reading.moveUp": "Nach oben",
  "reading.moveDown": "Nach unten",
  "reading.moved": "{title} steht jetzt an Position {position} von {total}.",
  "reading.failed": "Die Leseliste ließ sich nicht ändern: {message}",
  "reading.addNote": "Notiz hinzufügen",
  "reading.editNote": "Notiz ändern",
  "reading.noteLabel": "Notiz zu {title}",
  "reading.notePlaceholder": "Warum an dieser Stelle?",
} as const;

export const readingOrderEn: Record<keyof typeof readingOrderDe, string> = {
  "reading.progress.one": "{read} of {n} read",
  "reading.progress.other": "{read} of {n} read",
  "reading.next": "Read next",
  "reading.nextTitle": "Opens “{title}”",
  "reading.allRead": "All read",
  "reading.position": "Position",
  "reading.handle": "Move {title}: drag, or press the arrow keys to move it up or down",
  "reading.moveUp": "Move up",
  "reading.moveDown": "Move down",
  "reading.moved": "{title} is now at position {position} of {total}.",
  "reading.failed": "The reading list could not be changed: {message}",
  "reading.addNote": "Add note",
  "reading.editNote": "Edit note",
  "reading.noteLabel": "Note on {title}",
  "reading.notePlaceholder": "Why here?",
};
