// Inline line icons (stroke = currentColor). Kept minimal and geometric to
// match the telemetry aesthetic — no filled emoji.
const wrap = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

export const icons = {
  bedwars: wrap('<path d="M3 7v10"/><path d="M3 12h15a3 3 0 0 1 3 3v2"/><path d="M21 17H3"/><path d="M6 12V9a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3"/>'),
  practice: wrap('<path d="M14.5 3.5 20 9l-8.5 8.5"/><path d="m3 21 4-4"/><path d="M9.5 3.5 4 9l8.5 8.5"/><path d="m21 21-4-4"/>'),
  ffa: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  // Two islands, blocks placed across the gap — the mode is a bridging race.
  fastbuilder: wrap('<path d="M2 13h5v8H2z"/><path d="M17 13h5v8h-5z"/><path d="M8 13h3.5v3.5H8z"/><path d="M12.5 13H16v3.5h-3.5z"/>'),
  clutches: wrap('<path d="M4 10a8 8 0 0 1 16 0"/><path d="M4 10c0 3 3.5 4 4 6M20 10c0 3-3.5 4-4 6"/><path d="M12 10c0 3-1 4-1 6M12 10c0 3 1 4 1 6"/><path d="M9 21h6"/>'),
  search: wrap('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>'),
  trophy: wrap('<path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3"/><path d="M9 15h6M10 19h4M12 15v4"/>'),
  bolt: wrap('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>'),
  clock: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: wrap('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17 20a5.5 5.5 0 0 0-2.5-4.6"/>'),
  arrow: wrap('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  sword: wrap('<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/>'),
  shield: wrap('<path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/>'),
  flame: wrap('<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.2.5-2.3 1.3-3.2C9 10 10 8 12 3Z"/>'),
};
