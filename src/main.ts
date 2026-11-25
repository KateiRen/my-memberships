import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { barcodeSvg, backupJson, FORMATS, MAX_BACKUP_BYTES, membershipBarcodeValue, parseBackup, sortCards, validateCard, WalletError, type Card, type Language, type Snapshot } from './model';
import { WalletStore } from './storage';
import { translate, type MessageKey } from './i18n';
import { nearbyCards, requestPosition, LocationError, POSITION_MAX_AGE_MS, type CurrentPosition } from './nearby';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing application root');
const app = root;
let language: Language = navigator.language.startsWith('de') ? 'de' : 'en';
let store: WalletStore | undefined;
let snapshot: Snapshot = { revision: 0, cards: [] };
let dirty = false;
let busy = false;
let search = '';
let route = '';
let updateAvailable = false;
let pendingRestore: Card[] | null = null;
let channel: BroadcastChannel | undefined;
let notice: { key: MessageKey; error: boolean } | null = null;
let position: CurrentPosition | null = null;
let locationPermission: PermissionState = 'prompt';
let locationMessage: MessageKey = 'nearbyOptIn';
let locationRequest: Promise<void> | undefined;
let locationEpoch = 0;
let positionExpiry: ReturnType<typeof setTimeout> | undefined;
let nearbyEnabled: boolean | undefined;
let nearbyInitialization: Promise<void> | undefined;
const t = (key: MessageKey) => translate(language, key);
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const icon = (name: 'wallet' | 'plus' | 'search' | 'settings' | 'arrow' | 'bag' | 'shield' | 'pin') => {
  const paths = {
    wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-5 5h5M7 5V3h11v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    arrow: '<path d="m14 5-7 7 7 7M7 12h14"/>',
    bag: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
function button(action: string, label: string, className = 'button secondary', extra = ''): string {
  return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`;
}
function alertHtml(): string {
  return notice ? `<div class="notice ${notice.error ? 'error' : ''}" role="${notice.error ? 'alert' : 'status'}">
    <span>${escape(t(notice.key))}</span>
    ${notice.error ? button('reload', escape(t('reload')), 'text-button') : ''}
    ${button('dismiss', '×', 'icon-button', `aria-label="${escape(t('dismiss'))}"`)}
  </div>` : '';
}
function showNotice(key: MessageKey, error = false): void {
  notice = { key, error };
  const region = document.querySelector('#notices');
  if (region) {
    region.innerHTML = alertHtml();
    if (error) region.scrollIntoView({ block: 'start' });
  }
}
function report(error: unknown, fallback: MessageKey = 'storage'): void {
  showNotice(error instanceof WalletError || error instanceof LocationError ? error.code : fallback, true);
}
async function run(action: () => Promise<void>, fallback: MessageKey = 'storage'): Promise<void> {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button[type="submit"], [data-action="replace"], [data-action="save-location"]').forEach((el) => { el.disabled = true; });
  try { await action(); } catch (error) { report(error, fallback); }
  finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>('button[type="submit"], [data-action="replace"], [data-action="save-location"]').forEach((el) => { el.disabled = false; });
  }
}
function currentCard(): Card | undefined {
  const match = /^(?:card|edit)\/(.+)$/.exec(route);
  return match ? snapshot.cards.find((card) => card.id === match[1]) : undefined;
}
function go(next: string): void {
  if (busy || (dirty && !confirm(t('discard')))) return;
  dirty = false;
  pendingRestore = null;
  route = next;
  location.hash = next;
  render();
  refreshNearbyOnNavigation();
}
function freshPosition(): CurrentPosition | null {
  return nearbyEnabled !== false && locationPermission === 'granted' && position && Date.now() - position.timestamp <= POSITION_MAX_AGE_MS ? position : null;
}
function nearbyActionKey(): MessageKey {
  return locationPermission === 'denied' || nearbyEnabled === false
    ? 'askLocationAgain' : locationPermission === 'granted' ? 'refreshNearby' : 'enableNearby';
}
function nearbyControlsHtml(): string {
  return `<div class="nearby-controls">
    <p class="hint" aria-live="polite">${escape(t(locationRequest ? 'locationChecking' : locationMessage))}</p>
    ${button('enable-nearby', escape(t(nearbyActionKey())), 'text-button', locationRequest ? 'disabled' : '')}
    ${button('disable-nearby', escape(t('disableNearby')), 'text-button', nearbyEnabled !== false && locationPermission === 'granted' ? '' : 'hidden')}
    </div>`;
}
function locationStateHtml(): string {
  const state: MessageKey = locationPermission === 'denied' ? 'geoBlocked'
    : nearbyEnabled === false ? 'geoDisabled' : locationPermission === 'granted' ? 'geoEnabled' : 'geoNotEnabled';
  return `<span class="location-state ${state === 'geoEnabled' ? 'is-enabled' : ''}">${icon('pin')}${escape(t(state))}</span>`;
}
function canSaveLocation(card: Card): boolean {
  return nearbyEnabled !== false && locationPermission === 'granted' && card.locations.length === 0;
}
function saveLocationHtml(card: Card): string {
  return button('save-location', `${icon('pin')}${escape(t('saveCurrentLocation'))}`, 'button secondary save-location',
    `${canSaveLocation(card) ? '' : 'hidden'} ${busy ? 'disabled' : ''}`);
}
function updateNearbyUi(): void {
  const controls = document.querySelector('#nearby-controls');
  const message = controls?.querySelector('p');
  if (message) message.textContent = t(locationRequest ? 'locationChecking' : locationMessage);
  const enable = controls?.querySelector<HTMLButtonElement>('[data-action="enable-nearby"]');
  if (enable) { enable.textContent = t(nearbyActionKey()); enable.disabled = Boolean(locationRequest); }
  const disable = controls?.querySelector<HTMLButtonElement>('[data-action="disable-nearby"]');
  if (disable) disable.hidden = nearbyEnabled === false || locationPermission !== 'granted';
  const state = document.querySelector('#location-state');
  if (state) state.innerHTML = locationStateHtml();
  const action = document.querySelector<HTMLButtonElement>('[data-action="save-location"]');
  const card = currentCard();
  if (action && card) { action.hidden = !canSaveLocation(card); action.disabled = busy; }
  const detailStatus = document.querySelector('#location-detail-status');
  if (detailStatus) detailStatus.textContent = locationRequest ? t('locationChecking') : '';
  const grid = document.querySelector('#card-grid');
  if (grid) grid.innerHTML = listHtml();
}
async function refreshLocation(userInitiated = false): Promise<void> {
  if (locationRequest) return locationRequest;
  if (document.hidden || nearbyEnabled === false || (!userInitiated && (locationPermission !== 'granted' || freshPosition()))) return;
  const epoch = locationEpoch;
  locationRequest = (async () => {
    try {
      const here = await requestPosition();
      if (epoch !== locationEpoch || document.hidden) return;
      position = here;
      locationPermission = 'granted';
      locationMessage = 'nearbyActive';
      clearTimeout(positionExpiry);
      positionExpiry = setTimeout(() => {
        position = null;
        locationMessage = 'locationStale';
        updateNearbyUi();
      }, Math.max(0, POSITION_MAX_AGE_MS - (Date.now() - here.timestamp)));
    } catch (error) {
      if (epoch !== locationEpoch || document.hidden) return;
      clearTimeout(positionExpiry);
      position = null;
      if (error instanceof LocationError && error.code === 'locationDenied') {
        locationPermission = 'denied';
        try { await setNearbyDecision(false); } catch (storageError) { report(storageError); }
      }
      locationMessage = error instanceof LocationError ? error.code : 'locationUnavailable';
    } finally {
      locationRequest = undefined;
      updateNearbyUi();
    }
  })();
  updateNearbyUi();
  return locationRequest;
}
async function setNearbyDecision(enabled: boolean): Promise<void> {
  if (!store) throw new WalletError('storage');
  await store.setNearbyEnabled(enabled);
  nearbyEnabled = enabled;
  if (!enabled) {
    locationEpoch++;
    position = null;
    clearTimeout(positionExpiry);
    locationMessage = locationPermission === 'denied' ? 'locationDenied' : 'nearbyDisabled';
  }
  updateNearbyUi();
}
async function enableNearby(): Promise<void> {
  await setNearbyDecision(true);
  await refreshLocation(true);
}
async function offerImportedNearby(): Promise<void> {
  await nearbyInitialization;
  if (nearbyEnabled !== undefined || !snapshot.cards.some((card) => card.locations.length) || locationPermission === 'granted') return;
  if (locationPermission === 'denied') { await setNearbyDecision(false); return; }
  if (confirm(t('importNearbyPrompt'))) await enableNearby();
  else await setNearbyDecision(false);
}
function refreshNearbyOnNavigation(): void {
  if (route === '' || route.startsWith('card/')) void refreshLocation();
}
async function initializeNearby(): Promise<void> {
  if (!navigator.geolocation) { locationMessage = 'locationUnavailable'; updateNearbyUi(); return; }
  if (!navigator.permissions?.query) { locationMessage = 'locationPermissionUnknown'; updateNearbyUi(); return; }
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    const changed = () => {
      locationPermission = permission.state;
      if (permission.state === 'granted') void refreshLocation();
      else {
        locationEpoch++;
        clearTimeout(positionExpiry);
        position = null;
        locationMessage = nearbyEnabled === false ? 'nearbyDisabled' : permission.state === 'denied' ? 'locationDenied' : 'nearbyOptIn';
        if (permission.state === 'denied' && nearbyEnabled !== false) void setNearbyDecision(false).catch((error: unknown) => report(error));
      }
      updateNearbyUi();
    };
    permission.addEventListener('change', changed);
    changed();
  } catch {
    locationMessage = 'locationPermissionUnknown';
    updateNearbyUi();
  }
}
function shell(content: string): void {
  document.documentElement.lang = language;
  app.innerHTML = `
    <header class="masthead">
      <a href="#" class="brand" data-route="" aria-label="My Memberships">${icon('wallet')}<span>My<span class="brand-light">Memberships</span></span></a>
      <span class="privacy-pill">${icon('shield')}${escape(t('localBadge'))}</span>
    </header>
    <main id="main">
      <div id="notices" class="notices" aria-live="polite">${alertHtml()}</div>
      ${updateAvailable ? `<div class="update-banner"><span>${escape(t('updateReady'))}</span>${button('update', escape(t('update')), 'text-button')}</div>` : ''}
      ${content}
    </main>
    <nav class="bottom-nav" aria-label="${escape(t('wallet'))}">
      <a href="#" data-route="" ${route === '' ? 'aria-current="page"' : ''}>${icon('wallet')}<span>${escape(t('wallet'))}</span></a>
      ${button('new', `${icon('plus')}<span>${escape(t('addCard'))}</span>`, 'nav-add')}
      <a href="#settings" data-route="settings" ${route === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>${escape(t('settings'))}</span></a>
    </nav>
    <footer><span class="connection-dot ${navigator.onLine ? '' : 'is-offline'}"></span><span id="connection">${escape(t(navigator.onLine ? 'online' : 'offline'))}</span></footer>`;
  app.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function countLabel(count: number): string { return `${count} ${t(count === 1 ? 'card' : 'cards')}`; }
function listHtml(): string {
  const cards = sortCards(snapshot.cards, language, search);
  if (!cards.length) return `<section class="no-results"><h2>${escape(t('noResults'))}</h2><p>${escape(t('noResultsText'))}</p>${button('clear-search', escape(t('clearSearch')))}</section>`;
  const nearby = nearbyCards(cards, freshPosition());
  return `${nearby.length ? `<section id="nearby-cards" class="wallet-section" aria-labelledby="nearby-heading">
      <h2 id="nearby-heading">${escape(t('nearbyCard'))}</h2>
      <div class="card-grid">${nearby.map((card) => membershipCardHtml(card, true)).join('')}</div>
    </section>` : ''}
    <section id="all-cards" class="wallet-section" aria-labelledby="all-cards-heading">
      <h2 id="all-cards-heading">${escape(t('allCards'))}</h2>
      <div class="card-grid">${cards.map((card) => membershipCardHtml(card)).join('')}</div>
    </section>`;
}
function membershipCardHtml(card: Card, nearby = false): string {
  return `<a href="#card/${escape(card.id)}" data-route="card/${escape(card.id)}" class="membership-card" aria-label="${escape(t('openCard'))}: ${escape(card.name)}">
      <div class="card-art" style="--color-one:${card.colors[0]};--color-two:${card.colors[1]}">
        <span class="card-emblem">${icon('bag')}</span><span class="card-category">${escape(card.category || t('card'))}</span>
        <span class="card-monogram" aria-hidden="true">${escape(Array.from(card.name)[0] ?? '')}</span>
      </div>
      <div class="card-caption"><div><h3>${escape(card.name)}</h3>${nearby ? `<span class="nearby-badge">${icon('pin')}${escape(t('nearbyCard'))}</span>` : ''}<p class="mono">•••• ${escape(card.number.slice(-4))}</p></div><span class="card-open" aria-hidden="true">↗</span></div>
    </a>`;
}
function renderList(): void {
  shell(`<section class="page-heading"><div><p class="eyebrow">${escape(t('localNote'))}</p><h1 tabindex="-1">${escape(t('yourCards'))}<span class="count">${snapshot.cards.length}</span></h1></div>
    ${button('new', `${icon('plus')}${escape(t('addCard'))}`, 'button primary desktop-add')}</section>
    <section id="nearby-controls" aria-label="${escape(t('nearbyTitle'))}">${nearbyControlsHtml()}</section>
    ${snapshot.cards.length ? `<label class="search-box">${icon('search')}<input id="search" type="search" maxlength="100" placeholder="${escape(t('search'))}" aria-label="${escape(t('search'))}" value="${escape(search)}" autocomplete="off"></label>
      <div id="card-grid">${listHtml()}</div>` : `<section class="empty-state">
      <img src="${import.meta.env.BASE_URL}branding/cards.webp" width="300" height="300" alt="" fetchpriority="low">
      <p class="eyebrow">${escape(t('tagline'))}</p><h2>${escape(t('emptyTitle')).replace('\n', '<br>')}</h2><p>${escape(t('emptyText'))}</p>
      ${button('new', `${icon('plus')}${escape(t('addCard'))}`, 'button primary')}
    </section>`}
    <p class="wallet-footnote">${icon('shield')}${escape(t('localNote'))}</p>`);
}
function backLink(): string {
  return `<a class="back-link" href="#" data-route="">${icon('arrow')}${escape(t('back'))}</a>`;
}
function field(name: string, label: MessageKey, value: string, options = ''): string {
  return `<label class="field"><span>${escape(t(label))}</span><input name="${name}" value="${escape(value)}" ${options}></label>`;
}
function locationRow(location: Card['locations'][number], index: number): string {
  return `<fieldset class="location-row" data-location-index="${index}"><legend class="sr-only">${escape(t('locations'))}</legend>
    ${field('location-label', 'locationLabel', String(location.label), 'maxlength="150"')}
    <p class="mono">${escape(location.latitude)}, ${escape(location.longitude)}</p>
    ${button('remove-location', escape(t('removeLocation')), 'text-button danger')}</fieldset>`;
}
function renderEditor(card?: Card): void {
  const colors = card?.colors ?? ['#c5ed76', '#275c4b'];
  const barcode = card?.barcode;
  const sameNumber = !barcode || barcode.value === membershipBarcodeValue(card?.number ?? '');
  shell(`${backLink()}<section class="page-heading"><div><p class="eyebrow">${escape(t('formIntro'))}</p><h1 tabindex="-1">${escape(t(card ? 'editCard' : 'newCard'))}</h1></div></section>
    <form id="card-form" class="editor" autocomplete="off">
      <p class="muted">${escape(t('requiredNote'))}</p>
      <section class="panel"><h2>${escape(t('cardDetails'))}</h2>
        ${field('name', 'name', card?.name ?? '', `required maxlength="100" placeholder="${escape(t('namePlaceholder'))}"`)}
        ${field('number', 'number', card?.number ?? '', 'required maxlength="200"')}
        <label class="field"><span>${escape(t('description'))} <small>${escape(t('optional'))}</small></span><textarea name="description" rows="3" maxlength="2000" placeholder="${escape(t('descriptionPlaceholder'))}">${escape(card?.description ?? '')}</textarea></label>
        ${field('category', 'category', card?.category ?? '', `maxlength="60" list="categories" placeholder="${escape(t('categoryPlaceholder'))}"`)}
        <datalist id="categories">${[...new Set(snapshot.cards.map((item) => item.category).filter(Boolean))].sort().map((category) => `<option value="${escape(category)}"></option>`).join('')}</datalist>
      </section>
      <section class="panel"><h2>${escape(t('colors'))}</h2><div class="field-pair">
        ${field('color-one', 'primaryColor', colors[0], 'type="color" required')}
        ${field('color-two', 'secondaryColor', colors[1], 'type="color" required')}
      </div></section>
      <section class="panel"><h2>${escape(t('barcode'))}</h2><p class="muted">${escape(t('barcodeHelp'))}</p>
        <label class="field"><span>${escape(t('barcodeFormat'))}</span><select name="barcode-format" id="barcode-format"><option value="">${escape(t('noBarcode'))}</option>${FORMATS.map((format) => `<option value="${format}" ${barcode?.format === format ? 'selected' : ''}>${({ code128: 'Code 128', code39: 'Code 39', ean13: 'EAN-13', ean8: 'EAN-8', qrcode: 'QR' })[format]}</option>`).join('')}</select></label>
        <div id="barcode-fields" ${barcode ? '' : 'hidden'}>
          <label class="checkbox"><input type="checkbox" id="same-number" ${sameNumber ? 'checked' : ''}>${escape(t('sameNumber'))}</label>
          ${field('barcode-value', 'barcodeValue', barcode?.value ?? membershipBarcodeValue(card?.number ?? ''), `maxlength="1024" ${sameNumber ? 'readonly' : ''}`)}
          <p class="hint">${escape(t('eanHelp'))}</p>
        </div>
      </section>
      <section class="panel"><h2>${escape(t('locations'))}</h2><p class="muted">${escape(t('locationHelp'))}</p>
        <div id="locations">${card?.locations.map(locationRow).join('') ?? ''}</div>
      </section>
      <div class="form-actions"><button type="submit" class="button primary">${escape(t('save'))}</button>${button('cancel', escape(t('cancel')))}</div>
    </form>`);
}
function renderDetail(card: Card): void {
  let barcode = '';
  const displayedBarcodeValue = card.barcode?.value === membershipBarcodeValue(card.number) ? card.number : card.barcode?.value ?? '';
  try { barcode = card.barcode ? barcodeSvg(card.barcode) : ''; }
  catch (error) { report(error); }
  shell(`${backLink()}
    <section class="detail-title"><span class="detail-emblem" style="--color-one:${card.colors[0]};--color-two:${card.colors[1]}">${icon('bag')}</span>
      <p class="eyebrow">${escape(card.category || t('card'))}</p><h1 tabindex="-1">${escape(card.name)}</h1>
      <span id="save-location">${saveLocationHtml(card)}</span>
      <p id="location-detail-status" class="hint" aria-live="polite">${locationRequest ? escape(t('locationChecking')) : ''}</p></section>
    <section class="scan-panel ${card.barcode?.format === 'qrcode' ? 'qr' : ''}" aria-label="${escape(t('barcode'))}">
      <p class="eyebrow">${escape(t('showToScan'))}</p>
      ${barcode ? `<div class="barcode-image" role="img" aria-label="${escape(t('barcode'))}: ${escape(card.barcode?.value ?? '')}">${barcode}</div><p class="barcode-value mono preserve-lines">${escape(displayedBarcodeValue)}</p>` : ''}
      <p class="muted">${escape(t(barcode ? 'scanHint' : 'noBarcodeHint'))}</p>
    </section>
    <section class="panel detail-info"><dl><div><dt>${escape(t('number'))}</dt><dd class="mono preserve-lines">${escape(card.number)}</dd></div>
      ${card.description ? `<div><dt>${escape(t('description'))}</dt><dd class="preserve-lines">${escape(card.description)}</dd></div>` : ''}
      <div><dt>${escape(t('added'))}</dt><dd>${escape(new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(card.addedAt)))}</dd></div>
      ${card.locations.length ? `<div><dt>${escape(t('locations'))}</dt><dd><ul class="location-list">${card.locations.map((item) => `<li>${item.label ? `<strong>${escape(item.label)}</strong><br>` : ''}${escape(item.latitude)}, ${escape(item.longitude)}</li>`).join('')}</ul></dd></div>` : ''}
    </dl></section>
    <div class="form-actions">${button('edit', escape(t('edit')), 'button primary')}${button('delete', escape(t('delete')), 'button danger-outline')}</div>`);
}
function renderSettings(): void {
  shell(`<section class="page-heading"><div><p class="eyebrow">MY MEMBERSHIPS</p><h1 tabindex="-1">${escape(t('settings'))}</h1></div></section>
    <section class="panel about-panel">${icon('shield')}<h2>${escape(t('aboutTitle'))}</h2><p>${escape(t('aboutText'))}</p></section>
    <section class="panel"><h2>${escape(t('nearbyTitle'))}</h2><p id="location-state" aria-live="polite">${locationStateHtml()}</p>
      <p>${escape(t('nearbyPrivacy'))}</p><div id="nearby-controls">${nearbyControlsHtml()}</div></section>
    <section class="panel"><label class="field"><span>${escape(t('language'))}</span><select id="language"><option value="en" ${language === 'en' ? 'selected' : ''}>English</option><option value="de" ${language === 'de' ? 'selected' : ''}>Deutsch</option></select></label></section>
    <section class="panel"><h2>${escape(t('backupTitle'))}</h2><p>${escape(t('backupText'))}</p><p class="hint">${escape(t('backupWarning'))}</p>
      <div class="stack-actions">${button('export', escape(t('export')), 'button primary')}
        <label class="button secondary file-button">${escape(t('restore'))}<input type="file" id="restore-file" accept=".json,application/json"></label></div>
      <p class="hint">${escape(t('restoreHelp'))}</p>
      ${pendingRestore ? `<section class="restore-preview"><h3>${escape(t('preview'))} · ${escape(countLabel(pendingRestore.length))}</h3>
        ${pendingRestore.length ? `<ul>${sortCards(pendingRestore, language).slice(0, 8).map((card) => `<li>${escape(card.name)}</li>`).join('')}</ul>${pendingRestore.length > 8 ? `<p>${escape(t('previewMore'))}</p>` : ''}` : `<p role="alert">${escape(t('emptyBackup'))}</p>`}
        ${button('replace', escape(t('replace')), 'button danger-solid')}${button('cancel-restore', escape(t('cancel')), 'text-button')}</section>` : ''}
    </section>
    <section class="panel"><h2>${escape(t('storageTitle'))}</h2><p>${escape(t('storageText'))}</p>${button('persist', escape(t('protect')))}</section>
    <section class="panel"><h2>${escape(t('installTitle'))}</h2><p>${escape(t('installText'))}</p></section>`);
}
function render(): void {
  if (route === 'settings') renderSettings();
  else if (route === 'new') renderEditor();
  else {
    const card = currentCard();
    if (card && route.startsWith('edit/')) renderEditor(card);
    else if (card) renderDetail(card);
    else renderList();
  }
}
function readForm(form: HTMLFormElement): Card {
  const data = new FormData(form);
  const value = (name: string) => String(data.get(name) ?? '');
  const existing = currentCard();
  const format = value('barcode-format');
  const number = value('number');
  const barcodeValue = form.querySelector<HTMLInputElement>('#same-number')?.checked ? membershipBarcodeValue(number) : value('barcode-value');
  return validateCard({
    id: existing?.id ?? crypto.randomUUID(), name: value('name').trim(), number,
    description: value('description'), category: value('category').trim(),
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    colors: [value('color-one'), value('color-two')],
    locations: Array.from(form.querySelectorAll('.location-row')).map((row) => {
      const location = existing?.locations[Number(row.getAttribute('data-location-index'))];
      if (!location) throw new WalletError('invalidCard');
      return { ...location, label: row.querySelector<HTMLInputElement>('[name="location-label"]')?.value ?? '' };
    }),
    barcode: format ? { format, value: barcodeValue } : null,
  });
}
async function commit(cards: Card[]): Promise<void> {
  if (!store) throw new WalletError('storage');
  snapshot = await store.replace(cards, snapshot.revision);
  channel?.postMessage('changed');
}
async function downloadBackup(): Promise<void> {
  if (!store) throw new WalletError('storage');
  const latest = await store.read();
  const blob = new Blob([backupJson(latest.cards)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wallet.memberships.json';
    document.body.append(link);
    link.click();
    link.remove();
    showNotice('exported');
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'card-form') return;
  event.preventDefault();
  void run(async () => {
    const card = readForm(form);
    await commit([...snapshot.cards.filter((item) => item.id !== card.id), card]);
    dirty = false;
    route = `card/${card.id}`;
    location.hash = route;
    showNotice('saved');
    render();
    refreshNearbyOnNavigation();
  });
});
app.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
  if (input.closest('#card-form')) dirty = true;
  if (input.id === 'search') {
    search = input.value;
    const grid = document.querySelector('#card-grid');
    if (grid) grid.innerHTML = listHtml();
  }
  if (input.getAttribute('name') === 'number' && document.querySelector<HTMLInputElement>('#same-number')?.checked) {
    const barcode = document.querySelector<HTMLInputElement>('[name="barcode-value"]');
    if (barcode) barcode.value = membershipBarcodeValue(input.value);
  }
});
app.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
  if (input.closest('#card-form')) dirty = true;
  if (input.id === 'barcode-format') {
    const fields = document.querySelector<HTMLElement>('#barcode-fields');
    if (fields) fields.hidden = !input.value;
  }
  if (input.id === 'same-number' && input instanceof HTMLInputElement) {
    const barcode = document.querySelector<HTMLInputElement>('[name="barcode-value"]');
    if (barcode) {
      barcode.readOnly = input.checked;
      if (input.checked) barcode.value = membershipBarcodeValue(document.querySelector<HTMLInputElement>('[name="number"]')?.value ?? '');
    }
  }
  if (input.id === 'language') void run(async () => {
    if (input.value !== 'en' && input.value !== 'de') return;
    if (!store) throw new WalletError('storage');
    await store.setLanguage(input.value);
    language = input.value;
    render();
  });
  if (input.id === 'restore-file' && input instanceof HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    void run(async () => {
      pendingRestore = null;
      document.querySelector('.restore-preview')?.remove();
      if (file.size > MAX_BACKUP_BYTES) throw new WalletError('fileTooLarge');
      pendingRestore = parseBackup(await file.text());
      renderSettings();
    }, 'fileError');
    input.value = '';
  }
});
app.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLElement>('[data-route]');
  if (link) {
    event.preventDefault();
    go(link.dataset.route ?? '');
    return;
  }
  const target = event.target.closest<HTMLElement>('[data-action]');
  if (!target || busy) return;
  const action = target.dataset.action;
  if (action === 'new') go('new');
  if (action === 'cancel') go(currentCard() ? `card/${currentCard()?.id}` : '');
  if (action === 'edit') go(`edit/${currentCard()?.id}`);
  if (action === 'enable-nearby') void enableNearby().catch((error: unknown) => report(error));
  if (action === 'disable-nearby') void setNearbyDecision(false).catch((error: unknown) => report(error));
  if (action === 'save-location') void run(async () => {
    const card = currentCard();
    if (!card) throw new WalletError('conflict');
    if (!canSaveLocation(card)) { showNotice(card.locations.length ? 'locationAlreadySaved' : 'locationDenied', true); return; }
    await refreshLocation(true);
    const here = freshPosition();
    if (!here) { showNotice(locationMessage, true); return; }
    const updated = { ...card, locations: [...card.locations, { label: '', latitude: here.latitude, longitude: here.longitude }] };
    await commit(snapshot.cards.map((item) => item.id === card.id ? updated : item));
    showNotice('locationSaved');
    render();
  });
  if (action === 'dismiss') { notice = null; document.querySelector('#notices')?.replaceChildren(); }
  if (action === 'clear-search') { search = ''; renderList(); document.querySelector<HTMLInputElement>('#search')?.focus(); }
  if (action === 'remove-location') { target.closest('.location-row')?.remove(); dirty = true; }
  if (action === 'delete' && confirm(t('deleteConfirm'))) void run(async () => {
    const card = currentCard();
    if (!card) throw new WalletError('conflict');
    await commit(snapshot.cards.filter((item) => item.id !== card.id));
    route = '';
    location.hash = '';
    showNotice('deleted');
    render();
  });
  if (action === 'reload' && (!dirty || confirm(t('discard')))) void run(async () => {
    if (!store) { location.reload(); return; }
    snapshot = await store.read();
    dirty = false;
    pendingRestore = null;
    notice = null;
    render();
  });
  if (action === 'export') void run(downloadBackup, 'fileError');
  if (action === 'cancel-restore') { pendingRestore = null; renderSettings(); }
  if (action === 'replace' && pendingRestore && confirm(t('replaceConfirm'))) void run(async () => {
    if (!pendingRestore) return;
    await commit(pendingRestore);
    pendingRestore = null;
    showNotice('restored');
    renderSettings();
    void offerImportedNearby().catch((error: unknown) => report(error));
  });
  if (action === 'persist') void run(async () => {
    const granted = await navigator.storage?.persist?.();
    showNotice(granted ? 'protected' : 'notProtected');
  });
  if (action === 'update' && (!dirty || confirm(t('discard'))) && confirm(t('updateConfirm'))) {
    dirty = false;
    void updateSW(true).catch(() => showNotice('updateFailed', true));
  }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next === route) return;
  if (busy || (dirty && !confirm(t('discard')))) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${route}`);
    return;
  }
  dirty = false;
  pendingRestore = null;
  route = next;
  render();
  refreshNearbyOnNavigation();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    locationEpoch++;
    position = null;
    clearTimeout(positionExpiry);
    locationMessage = 'locationStale';
    updateNearbyUi();
  } else void refreshLocation();
});
for (const name of ['online', 'offline']) window.addEventListener(name, () => {
  const connection = document.querySelector('#connection');
  if (connection) connection.textContent = t(navigator.onLine ? 'online' : 'offline');
  document.querySelector('.connection-dot')?.classList.toggle('is-offline', !navigator.onLine);
});
const updateSW = registerSW({
  onNeedRefresh() { updateAvailable = true; if (!dirty) render(); },
  onOfflineReady() { showNotice('offlineReady'); },
  onRegisterError() { showNotice('updateFailed', true); },
});
async function start(): Promise<void> {
  app.textContent = t('loading');
  try {
    store = await WalletStore.open(() => {
      store = undefined;
      showNotice('storage', true);
    });
    snapshot = await store.read();
    language = await store.language() ?? language;
    nearbyEnabled = await store.nearbyEnabled();
    if (nearbyEnabled === false) locationMessage = 'nearbyDisabled';
    route = location.hash.slice(1);
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('my-memberships');
      channel.onmessage = () => showNotice('externalChange', true);
    }
    render();
    nearbyInitialization = initializeNearby();
  } catch (error) { render(); report(error); }
}
void start();
