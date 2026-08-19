const MAX_PROGRAMS = 64;
const MAX_STORIES = 100;
const MAX_CAMPAIGNS = 40;

function text(value, fallback = '', max = 220, allowBlank = true) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return normalized || (allowBlank ? '' : fallback);
}

function httpsUrl(value, fallback = '') {
  const candidate = text(value, fallback, 1000, true);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function color(value, fallback) {
  const candidate = text(value, fallback, 9, false).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : fallback;
}

function int(value, fallback, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function isoDate(value, fallback = '') {
  const candidate = text(value, fallback, 80, true);
  if (!candidate) return '';
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function normalizeConfig(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El contenido publicado debe ser un objeto JSON.');
  }

  const oldRadio = previous.radio ?? {};
  const oldStation = previous.station ?? {};
  const oldHome = previous.home ?? {};
  const oldSafe = previous.safeListening ?? {};
  const oldStoriesHero = previous.storiesHero ?? {};
  const oldVisibility = previous.visibility ?? {};

  const radio = input.radio ?? {};
  const station = input.station ?? {};
  const home = input.home ?? {};
  const safe = input.safeListening ?? {};
  const storiesHero = input.storiesHero ?? {};
  const visibility = input.visibility ?? {};

  const programsInput = Array.isArray(input.programs) ? input.programs : (previous.programs ?? []);
  const storiesInput = Array.isArray(input.stories) ? input.stories : (previous.stories ?? []);
  const campaignsInput = Array.isArray(input.campaigns) ? input.campaigns : (previous.campaigns ?? []);

  const streamUrl = httpsUrl(radio.streamUrl, oldRadio.streamUrl ?? '');
  if (!streamUrl) throw new Error('radio.streamUrl debe ser una URL HTTPS válida.');

  const stationName = text(station.name, oldStation.name ?? 'Radio Periquín', 80, false);
  const currentProgram = text(home.currentProgram, oldHome.currentProgram ?? 'El Club de Periquín', 120, false);
  const host = text(home.host, oldHome.host ?? 'Con Periquín y sus amigos', 100, false);
  if (!stationName || !currentProgram || !host) {
    throw new Error('station.name, home.currentProgram y home.host son obligatorios.');
  }

  const programs = programsInput.slice(0, MAX_PROGRAMS).map((item, index) => ({
    id: text(item?.id, `program-${index + 1}`, 64, false).replace(/[^a-zA-Z0-9_-]/g, '-'),
    startMinutes: int(item?.startMinutes, 0, 0, 1439),
    time: text(item?.time, '', 40, true),
    title: text(item?.title, `Programa ${index + 1}`, 120, false),
    subtitle: text(item?.subtitle, '', 140, true),
    icon: ['music', 'child', 'mic', 'story', 'radio'].includes(item?.icon) ? item.icon : 'radio',
    accent: color(item?.accent, '#0A858C')
  })).sort((a, b) => a.startMinutes - b.startMinutes);

  const stories = storiesInput.slice(0, MAX_STORIES).map((item, index) => ({
    id: text(item?.id, `story-${index + 1}`, 64, false).replace(/[^a-zA-Z0-9_-]/g, '-'),
    title: text(item?.title, `Cuento ${index + 1}`, 120, false),
    theme: text(item?.theme, '', 140, true),
    duration: text(item?.duration, '', 40, true),
    accent: color(item?.accent, '#7568BE'),
    imageUrl: httpsUrl(item?.imageUrl, ''),
    status: ['coming_soon', 'available'].includes(item?.status) ? item.status : 'coming_soon'
  }));

  const campaigns = campaignsInput.slice(0, MAX_CAMPAIGNS).map((item, index) => {
    const startAt = isoDate(item?.startAt, '');
    const endAt = isoDate(item?.endAt, '');
    return {
      id: text(item?.id, `campaign-${index + 1}`, 64, false).replace(/[^a-zA-Z0-9_-]/g, '-'),
      enabled: bool(item?.enabled, true),
      title: text(item?.title, `Campaña ${index + 1}`, 120, false),
      message: text(item?.message, '', 260, true),
      imageUrl: httpsUrl(item?.imageUrl, ''),
      imageAlt: text(item?.imageAlt, '', 140, true),
      accent: color(item?.accent, '#FF7A00'),
      startAt,
      endAt,
      priority: int(item?.priority, 0, 0, 100)
    };
  }).filter(item => !item.startAt || !item.endAt || Date.parse(item.endAt) > Date.parse(item.startAt));

  return {
    schemaVersion: 2,
    contentVersion: Number(previous.contentVersion ?? 0),
    updatedAt: previous.updatedAt ?? new Date().toISOString(),
    radio: {
      streamUrl,
      serverType: text(radio.serverType, oldRadio.serverType ?? 'SHOUTCAST_V2', 40, false)
    },
    station: {
      name: stationName,
      tagline: text(station.tagline, oldStation.tagline ?? 'La radio de los niños', 100, true)
    },
    home: {
      currentProgram,
      host,
      fallbackNowPlaying: text(home.fallbackNowPlaying, oldHome.fallbackNowPlaying ?? 'Música, juegos y mucha imaginación', 160, true),
      nextProgram: text(home.nextProgram, oldHome.nextProgram ?? '', 120, true),
      nextTime: text(home.nextTime, oldHome.nextTime ?? '', 40, true),
      announcement: text(home.announcement, oldHome.announcement ?? '', 260, true),
      heroImageUrl: httpsUrl(home.heroImageUrl, ''),
      heroImageAlt: text(home.heroImageAlt, oldHome.heroImageAlt ?? 'Periquín con audífonos', 140, true)
    },
    safeListening: {
      title: text(safe.title, oldSafe.title ?? 'Un espacio cuidado', 100, false),
      message: text(safe.message, oldSafe.message ?? 'Contenido familiar y controles sencillos.', 220, true)
    },
    storiesHero: {
      eyebrow: text(storiesHero.eyebrow, oldStoriesHero.eyebrow ?? 'LA HORA MÁGICA', 80, true),
      title: text(storiesHero.title, oldStoriesHero.title ?? 'Historias que abrazan', 120, false),
      subtitle: text(storiesHero.subtitle, oldStoriesHero.subtitle ?? 'Muy pronto podrás escucharlas cuando quieras.', 180, true)
    },
    visibility: {
      announcement: bool(visibility.announcement, bool(oldVisibility.announcement, true)),
      shortcuts: bool(visibility.shortcuts, bool(oldVisibility.shortcuts, true)),
      todaySchedule: bool(visibility.todaySchedule, bool(oldVisibility.todaySchedule, true)),
      safeListening: bool(visibility.safeListening, bool(oldVisibility.safeListening, true)),
      programsTab: bool(visibility.programsTab, bool(oldVisibility.programsTab, true)),
      storiesTab: bool(visibility.storiesTab, bool(oldVisibility.storiesTab, true)),
      campaigns: bool(visibility.campaigns, bool(oldVisibility.campaigns, true))
    },
    campaigns,
    programs,
    stories
  };
}
