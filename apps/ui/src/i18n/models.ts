/**
 * Strings of the model panel in the settings (default backend, per-task routing, fallback order)
 * and the note of a job that moved to another backend. They are spread into the catalogs in
 * `de.ts` and `en.ts`.
 */
export const modelsDe = {
  "settings.routing.none":
    "Kein Backend ist bereit. Melde dich bei einem Backend an oder hinterlege einen API-Schlüssel.",
  "settings.routing.unavailable": "{name} (nicht verfügbar)",
  "settings.routing.perTask": "Pro Aufgabe",
  "settings.fallback.title": "Ausweichziele",
  "settings.fallback.desc":
    "Erreicht das Backend sein Limit, ist es überlastet oder abgemeldet, übernimmt die erste aktive Zeile. Ein Backend, das ausgefallen ist, pausiert, bis es wieder bereit ist.",
  "settings.fallback.list": "Reihenfolge der Ausweichziele",
  "settings.fallback.none": "Es gibt kein weiteres Backend, das einspringen kann.",
  "settings.fallback.up": "{name} nach oben",
  "settings.fallback.down": "{name} nach unten",
  "backend.paused": "Pausiert bis {time}",
  "backend.paused.limit": "Limit erreicht",
  "backend.paused.overloaded": "Überlastet",
  "backend.paused.auth": "Nicht angemeldet",
  "job.fallback.limit": "weiter mit {to}, {from}-Limit erreicht",
  "job.fallback.overloaded": "weiter mit {to}, {from} überlastet",
  "job.fallback.auth": "weiter mit {to}, {from} nicht angemeldet",
};

export const modelsEn: Record<keyof typeof modelsDe, string> = {
  "settings.routing.none": "No backend is ready. Log in to a backend or store an API key.",
  "settings.routing.unavailable": "{name} (unavailable)",
  "settings.routing.perTask": "Per task",
  "settings.fallback.title": "Fallback order",
  "settings.fallback.desc":
    "When the backend reaches its limit, is overloaded or logged out, the first active row takes over. A backend that failed rests until it is ready again.",
  "settings.fallback.list": "Order of fallback backends",
  "settings.fallback.none": "No other backend can step in.",
  "settings.fallback.up": "Move {name} up",
  "settings.fallback.down": "Move {name} down",
  "backend.paused": "Paused until {time}",
  "backend.paused.limit": "Limit reached",
  "backend.paused.overloaded": "Overloaded",
  "backend.paused.auth": "Logged out",
  "job.fallback.limit": "continuing with {to}, {from} limit reached",
  "job.fallback.overloaded": "continuing with {to}, {from} overloaded",
  "job.fallback.auth": "continuing with {to}, {from} logged out",
};
