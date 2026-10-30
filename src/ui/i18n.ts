// Minimal i18n: English and Polish dictionaries, {placeholder} interpolation, and DOM text binding.
// The simulation core never imports this file; it only knows stable keys (unit types, building keys).

import type { BuildingKey, LaneDir, SquadType, Trait } from '../core/types.ts';

export type Lang = 'en' | 'pl';
export const LANGS: readonly Lang[] = ['en', 'pl'];

const en = {
  'doc.title': 'Wolin: Guardians of the Oder',
  'doc.description':
    'Wolin: Guardians of the Oder - a calm tactics game with active pause. Defend a merchant town at the mouth of the Oder, around the year 970.',
  'canvas.label': 'View of the island of Wolin. Mouse and keyboard controls are described in Settings.',

  'hud.wave': 'Wave {n}/{total}',
  'hud.callWave': 'Call wave',
  'hud.pause': 'Pause',
  'hud.resume': 'Resume',
  'hud.pauseTitle': 'Pause (Space)',
  'hud.speed': 'Speed',
  'hud.horn': 'Horn',
  'hud.hornCd': 'Horn · {s} s',
  'hud.hornTitle': 'Horn signal (G), then click on the map',
  'hud.mute': 'Mute',
  'hud.muteTitle': 'Mute (M)',
  'hud.settings': 'Settings',
  'hud.seed': 'Seed:',
  'hud.pausedBanner': 'Paused - give orders calmly',
  'hud.aimBanner': 'Pick a spot for the horn signal (Esc cancels)',

  'phase.prep': 'Calm · {s} s',
  'phase.wave': 'Landing',
  'phase.won': 'The town stands',
  'phase.lost': 'Defeat',

  'panel.morale': 'Morale',
  'panel.moraleSteady': '{n} · steady',
  'panel.moraleUneasy': '{n} · uneasy',
  'panel.moraleWavering': '{n} · wavering',
  'panel.routing': 'Falling back to town - they ignore orders. The horn can stop them.',
  'panel.fighting': 'In combat.',
  'panel.shooting': 'Shooting.',
  'panel.marching': 'On the move.',
  'panel.departed': 'departed',
  'panel.shield': 'Shield wall (F)',
  'panel.shieldUp': 'Shields raised',
  'panel.shieldCd': 'Shield wall · {s} s',

  'unit.guard': 'Guard',
  'unit.archers': 'Archers',
  'unit.spearmen': 'Spearmen',
  'unit.raiders': 'Raiders',
  'unit.raiderArchers': 'Raider archers',
  'unit.armored': 'Armored',
  'role.guard': 'Sturdy; they hold chokepoints. F: shield wall.',
  'role.archers': 'Shoot while standing; farther and harder from a hill. They need cover.',
  'role.spearmen': 'Best on the beach: they push back those stepping ashore. They pierce armor.',
  'role.raiders': 'Visitors from across the sea.',
  'role.raiderArchers': 'Shoot from the beach. Flank them or shoot them while still in the boat.',
  'role.armored': 'Arrows barely hurt them. Spearmen pierce armor, and their back is less protected.',
  'trait.fast': 'fast',
  'trait.strong': 'strong',
  'trait.careful': 'careful',
  'trait.calm': 'calm',
  'trait.none': '',
  'building.granary': 'Granary',
  'building.workshop': 'Amber workshop',
  'building.lighthouse': 'Lighthouse',
  'dir.S': 'from the south',
  'dir.E': 'from the east',
  'dir.W': 'from the west',
  'dir.N': 'from the north',

  'hint.0': 'Pick a squad with keys 1-3 or by clicking.',
  'hint.1': 'Right button: march. Drag to set the facing.',
  'hint.2': 'Space stops time - you can give orders while paused.',
  'hint.3': 'Archers on the hill by the gate shoot farther. Spearmen welcome visitors best on the beach.',
  'hint.4': 'When ready, call the wave or wait until the fog brings the boats.',

  'msg.boat': 'A boat on the horizon {dir}.',
  'msg.waveCleared': 'Wave {n} repelled. A moment to breathe.',
  'msg.routed': '{unit} are falling back to town.',
  'msg.rallied': '{unit} are ready again.',
  'msg.buildingFell': '{name} has fallen.',
  'msg.enemyFlee': 'The raiders are fleeing to their boats.',
  'toast.needGuard': 'Only the guard can raise a shield wall (key 1).',
  'toast.shieldNotReady': 'Shields are not ready yet.',
  'toast.hornResting': 'The horn is still resting.',
  'toast.waveRetry': 'Wave {n} - once more, calmly.',
  'toast.deaf': 'The squad is not listening - it is falling back.',
  'live.selected': 'Selected: {unit}, morale {n}.',

  'title.heading': 'Wolin: Guardians of the Oder',
  'title.subtitle': 'Around the year 970. Morning at the mouth of the Oder.',
  'title.body':
    'Ships from many shores come to the merchant town on the island - and not everyone means well. You have three squads, a palisade, and a little time before the fog lifts.',
  'title.pauseHint': 'Space stops time. Give orders calmly while paused.',
  'title.difficulty': 'Difficulty',
  'difficulty.easy': 'Easy',
  'difficulty.normal': 'Normal',
  'difficulty.hard': 'Hard',
  'difficulty.brutal': 'Brutal',
  'title.loading': 'Loading…',
  'title.start': 'Start',
  'title.needServer': 'Server required',
  'title.fileWarning':
    'The game cannot run from a file opened straight from disk (file://). Run <kbd>npm run preview</kbd> and open <a href="http://localhost:4173">http://localhost:4173</a>.',

  'settings.title': 'Settings',
  'settings.music': 'Music',
  'settings.sfx': 'Effects',
  'settings.ambient': 'Ambience',
  'settings.motion': 'Reduced motion',
  'settings.text': 'Larger text',
  'settings.language': 'Language',
  'settings.quality': 'Graphics',
  'quality.low': 'Low',
  'quality.medium': 'Medium',
  'quality.high': 'High',
  'quality.reload': 'Changing the graphics quality restarts the page and the current game is lost. Continue?',
  'settings.controls': 'Controls',
  'settings.close': 'Close',
  'ctl.select': '<kbd>1</kbd>-<kbd>3</kbd> or left click: select a squad (press again: focus the camera)',
  'ctl.move': 'Right button: march; drag to set the facing; on an enemy: attack',
  'ctl.keys': '<kbd>Space</kbd> pause, <kbd>Esc</kbd> deselect, <kbd>R</kbd> restart, <kbd>M</kbd> mute',
  'ctl.abilities': '<kbd>F</kbd> shield wall, <kbd>G</kbd> horn, then click',
  'ctl.rotate': 'Drag with the left button: rotate the island 360° (up/down: tilt); <kbd>Q</kbd>/<kbd>E</kbd> also rotate',
  'ctl.camera': '<kbd>WASD</kbd>/arrows: pan the view, wheel: zoom',

  'end.won.title': 'The town stands',
  'end.won.text': 'The fog has lifted and the boats have sailed away. Still standing: {buildings}.',
  'end.lost.title': 'Not this time',
  'end.lost.text': 'You can retry the last wave from its start or begin again from dawn.',
  'end.fallen': '{name} ({unit}) - departed in wave {n}',
  'end.retryWave': 'Retry the wave',
  'end.restart': 'Start over',
  'restart.title': 'Start over?',
  'restart.text': 'The mission begins again at dawn with the same seed.',
  'common.cancel': 'Cancel',
  'error.graphics': 'Could not start graphics (WebGPU/WebGL 2). Try another browser or add ?webgl=1 to the address.',
  'noscript': 'This game requires JavaScript.',
} as const;

export type Key = keyof typeof en;

const pl: Record<Key, string> = {
  'doc.title': 'Wolin: Strażnicy Odry',
  'doc.description':
    'Wolin: Strażnicy Odry - spokojna gra taktyczna z aktywną pauzą. Obroń kupiecki gród u ujścia Odry, około 970 roku.',
  'canvas.label': 'Widok wyspy Wolin. Sterowanie myszą i klawiaturą opisano w ustawieniach.',

  'hud.wave': 'Fala {n}/{total}',
  'hud.callWave': 'Wezwij falę',
  'hud.pause': 'Pauza',
  'hud.resume': 'Wznów',
  'hud.pauseTitle': 'Pauza (Spacja)',
  'hud.speed': 'Tempo',
  'hud.horn': 'Róg',
  'hud.hornCd': 'Róg · {s} s',
  'hud.hornTitle': 'Sygnał rogu (G), potem kliknij na mapie',
  'hud.mute': 'Cisza',
  'hud.muteTitle': 'Cisza (M)',
  'hud.settings': 'Ustawienia',
  'hud.seed': 'Seed:',
  'hud.pausedBanner': 'Pauza - wydawaj rozkazy spokojnie',
  'hud.aimBanner': 'Wskaż miejsce sygnału rogu (Esc anuluje)',

  'phase.prep': 'Spokój · {s} s',
  'phase.wave': 'Desant',
  'phase.won': 'Gród ocalał',
  'phase.lost': 'Porażka',

  'panel.morale': 'Morale',
  'panel.moraleSteady': '{n} · pewni',
  'panel.moraleUneasy': '{n} · niepewni',
  'panel.moraleWavering': '{n} · chwiejni',
  'panel.routing': 'Cofają się do grodu - nie słuchają rozkazów. Róg może ich zatrzymać.',
  'panel.fighting': 'W walce.',
  'panel.shooting': 'Strzelają.',
  'panel.marching': 'W marszu.',
  'panel.departed': 'odszedł',
  'panel.shield': 'Osłona tarczami (F)',
  'panel.shieldUp': 'Tarcze uniesione',
  'panel.shieldCd': 'Osłona tarczami · {s} s',

  'unit.guard': 'Drużyna',
  'unit.archers': 'Łucznicy',
  'unit.spearmen': 'Włócznicy',
  'unit.raiders': 'Najeźdźcy',
  'unit.raiderArchers': 'Łucznicy wroga',
  'unit.armored': 'Pancerni',
  'role.guard': 'Twardzi, zamykają przejścia. F: osłona tarczami.',
  'role.archers': 'Strzelają stojąc; ze wzgórza dalej i mocniej. Potrzebują osłony.',
  'role.spearmen': 'Najlepsi na plaży: spychają wysiadających. Przebijają pancerz.',
  'role.raiders': 'Przybysze zza morza.',
  'role.raiderArchers': 'Strzelają z plaży. Flankuj ich albo ostrzelaj jeszcze na łodzi.',
  'role.armored': 'Strzały ledwo ich ranią. Włócznicy przebijają pancerz, a tył chroni ich słabiej.',
  'trait.fast': 'szybki',
  'trait.strong': 'silny',
  'trait.careful': 'ostrożny',
  'trait.calm': 'spokojny',
  'trait.none': '',
  'building.granary': 'Spichlerz',
  'building.workshop': 'Warsztat bursztynnika',
  'building.lighthouse': 'Latarnia',
  'dir.S': 'od południa',
  'dir.E': 'od wschodu',
  'dir.W': 'od zachodu',
  'dir.N': 'od północy',

  'hint.0': 'Wybierz oddział klawiszem 1-3 lub kliknięciem.',
  'hint.1': 'Prawy przycisk: marsz. Przeciągnij, by ustawić front.',
  'hint.2': 'Spacja zatrzymuje czas - rozkazy możesz wydawać w pauzie.',
  'hint.3': 'Łucznicy na wzgórzu przy bramie strzelają dalej. Włócznicy najlepiej witają gości na plaży.',
  'hint.4': 'Gdy będziesz gotów, wezwij falę albo poczekaj, aż mgła przyniesie łodzie.',

  'msg.boat': 'Łódź na horyzoncie {dir}.',
  'msg.waveCleared': 'Fala {n} odparta. Chwila oddechu.',
  'msg.routed': '{unit} cofają się do grodu.',
  'msg.rallied': '{unit} znów gotowi.',
  'msg.buildingFell': '{name} padł.',
  'msg.enemyFlee': 'Najeźdźcy uciekają do łodzi.',
  'toast.needGuard': 'Osłonę tarczami unoszą drużynnicy (klawisz 1).',
  'toast.shieldNotReady': 'Tarcze jeszcze nie gotowe.',
  'toast.hornResting': 'Róg jeszcze odpoczywa.',
  'toast.waveRetry': 'Fala {n} - jeszcze raz, spokojnie.',
  'toast.deaf': 'Oddział nie słucha - cofa się.',
  'live.selected': 'Wybrano: {unit}, morale {n}.',

  'title.heading': 'Wolin: Strażnicy Odry',
  'title.subtitle': 'Około roku 970. Poranek nad ujściem Odry.',
  'title.body':
    'Do kupieckiego grodu na wyspie przypływają ludzie z wielu brzegów - i nie wszyscy z dobrymi zamiarami. Masz trzy oddziały, palisadę i trochę czasu, zanim mgła się rozejdzie.',
  'title.pauseHint': 'Spacja zatrzymuje czas. Rozkazy wydasz spokojnie, w pauzie.',
  'title.difficulty': 'Trudność',
  'difficulty.easy': 'Łatwa',
  'difficulty.normal': 'Normalna',
  'difficulty.hard': 'Trudna',
  'difficulty.brutal': 'Brutalna',
  'title.loading': 'Ładowanie…',
  'title.start': 'Rozpocznij',
  'title.needServer': 'Wymagany serwer',
  'title.fileWarning':
    'Gra nie uruchomi się z pliku otwartego bezpośrednio z dysku (file://). Uruchom <kbd>npm run preview</kbd> i otwórz <a href="http://localhost:4173">http://localhost:4173</a>.',

  'settings.title': 'Ustawienia',
  'settings.music': 'Muzyka',
  'settings.sfx': 'Efekty',
  'settings.ambient': 'Otoczenie',
  'settings.motion': 'Ograniczony ruch',
  'settings.text': 'Większy tekst',
  'settings.language': 'Język',
  'settings.quality': 'Grafika',
  'quality.low': 'Niska',
  'quality.medium': 'Średnia',
  'quality.high': 'Wysoka',
  'quality.reload': 'Zmiana jakości grafiki odświeża stronę i bieżąca gra przepadnie. Kontynuować?',
  'settings.controls': 'Sterowanie',
  'settings.close': 'Zamknij',
  'ctl.select': '<kbd>1</kbd>-<kbd>3</kbd> lub lewy przycisk: wybór oddziału (drugie naciśnięcie: kamera)',
  'ctl.move': 'Prawy przycisk: marsz; przeciągnij, by ustawić front; na wrogu: atak',
  'ctl.keys': '<kbd>Spacja</kbd> pauza, <kbd>Esc</kbd> odznacz, <kbd>R</kbd> restart, <kbd>M</kbd> cisza',
  'ctl.abilities': '<kbd>F</kbd> osłona tarczami, <kbd>G</kbd> róg, potem kliknięcie',
  'ctl.rotate': 'Przeciągnij lewym przyciskiem: obrót wyspy o 360° (góra/dół: pochylenie); <kbd>Q</kbd>/<kbd>E</kbd> też obracają',
  'ctl.camera': '<kbd>WASD</kbd>/strzałki: przesuwanie widoku, kółko: zbliżenie',

  'end.won.title': 'Gród ocalał',
  'end.won.text': 'Mgła opadła, łodzie odpłynęły. Ocalało: {buildings}.',
  'end.lost.title': 'Tym razem się nie udało',
  'end.lost.text': 'Możesz powtórzyć ostatnią falę od jej początku albo zacząć od poranka.',
  'end.fallen': '{name} ({unit}) - odszedł w fali {n}',
  'end.retryWave': 'Spróbuj ponownie falę',
  'end.restart': 'Od nowa',
  'restart.title': 'Zacząć od nowa?',
  'restart.text': 'Misja zacznie się od poranka, z tym samym seedem.',
  'common.cancel': 'Anuluj',
  'error.graphics': 'Nie udało się uruchomić grafiki (WebGPU/WebGL 2). Spróbuj innej przeglądarki lub dodaj ?webgl=1 do adresu.',
  'noscript': 'Ta gra wymaga JavaScriptu.',
};

const dicts: Record<Lang, Record<Key, string>> = { en, pl };
let current: Lang = 'en';

export function detectLang(nav: { language?: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator): Lang {
  return nav?.language?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

export function isLang(x: unknown): x is Lang {
  return x === 'en' || x === 'pl';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Looks up a key in the current language and fills {placeholders}. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const text = dicts[current][key] ?? en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : text;
}

export const unitName = (type: SquadType): string => t(`unit.${type}` as Key);
export const unitRole = (type: SquadType): string => t(`role.${type}` as Key);
export const traitName = (trait: Trait): string => t(`trait.${trait}` as Key);
export const buildingName = (key: BuildingKey): string => t(`building.${key}` as Key);
export const dirName = (dir: LaneDir): string => t(`dir.${dir}` as Key);

/**
 * Applies the current language to static markup:
 * data-i18n (text), data-i18n-html (trusted dictionary HTML), data-i18n-title, data-i18n-aria (aria-label).
 */
export function applyStatic(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  document.documentElement.lang = current;
  document.title = t('doc.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('doc.description'));
}

/** Exposed for tests: both dictionaries. */
export const dictionaries = dicts;
