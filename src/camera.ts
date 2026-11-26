import { barcodeSvg, type Card, type Language } from './model';
import type { MessageKey } from './i18n';
import { startScanner } from './scanner';

const en = {
  scanCard: 'Scan your card', scanHelp: 'Point the rear camera at a QR, Aztec, Code 128, Code 39, EAN-13, or EAN-8 code. Scanning stays on this device.',
  cameraPreview: 'Live camera preview', scanAgain: 'Scan with camera', manualEntry: 'Enter manually',
  scanLooking: 'Looking for a code. You can also enter the card manually.',
  scanCaptured: 'Code captured. Review its value and format, add a card name, then save. Long QR text needs a separate membership number.',
  cameraUnavailable: 'Camera unavailable. Enter the code manually or try again.',
  cameraDenied: 'Camera access denied. Allow access in browser settings or enter the code manually.',
  cameraPaused: 'Camera stopped. You can continue manually or scan again.',
};
const de: Record<keyof typeof en, string> = {
  scanCard: 'Karte scannen', scanHelp: 'Richte die Rückkamera auf einen QR-, Aztec-, Code-128-, Code-39-, EAN-13- oder EAN-8-Code. Der Scan bleibt auf diesem Gerät.',
  cameraPreview: 'Live-Kameravorschau', scanAgain: 'Mit Kamera scannen', manualEntry: 'Manuell eingeben',
  scanLooking: 'Code wird gesucht. Du kannst die Karte auch manuell eingeben.',
  scanCaptured: 'Code erkannt. Prüfe Wert und Format, ergänze den Kartennamen und speichere. Lange QR-Texte benötigen eine separate Mitgliedsnummer.',
  cameraUnavailable: 'Kamera nicht verfügbar. Gib den Code manuell ein oder versuche es erneut.',
  cameraDenied: 'Kamerazugriff verweigert. Erlaube ihn in den Browsereinstellungen oder gib den Code manuell ein.',
  cameraPaused: 'Kamera gestoppt. Fahre manuell fort oder scanne erneut.',
};

export function mountCamera(host: HTMLElement, form: HTMLFormElement, language: Language, translate: (key: MessageKey) => string, onCaptured: () => void, autoStart: boolean): () => void {
  const labels = { ...(language === 'de' ? de : en), invalidBarcode: translate('invalidBarcode'), scanFailed: translate('scanFailed') };
  const t = (key: keyof typeof labels) => labels[key];
  host.innerHTML = `<h2>${t('scanCard')}</h2><p class="hint">${t('scanHelp')}</p>
    <video autoplay muted playsinline aria-label="${t('cameraPreview')}"></video>
    <p class="hint" id="scan-status" role="status"></p>
    <div class="stack-actions"><button type="button" class="button secondary" id="scan-start">${t('scanAgain')}</button>
    <button type="button" class="text-button" id="scan-manual">${t('manualEntry')}</button></div>`;
  const video = host.querySelector<HTMLVideoElement>('video')!;
  const status = host.querySelector<HTMLElement>('#scan-status')!;
  const start = host.querySelector<HTMLButtonElement>('#scan-start')!;
  const manual = host.querySelector<HTMLButtonElement>('#scan-manual')!;
  let stopScan: (() => void) | undefined;
  const message = (key: keyof typeof labels, error = false) => {
    stopScan?.();
    stopScan = undefined;
    video.hidden = true;
    start.hidden = false;
    status.setAttribute('role', error ? 'alert' : 'status');
    status.textContent = t(key);
  };
  const result = (barcode: NonNullable<Card['barcode']>) => {
    try { barcodeSvg(barcode); }
    catch { message('invalidBarcode', true); return; }
    const number = form.querySelector<HTMLInputElement>('[name="number"]')!;
    const format = form.querySelector<HTMLSelectElement>('#barcode-format')!;
    const value = form.querySelector<HTMLTextAreaElement>('[name="barcode-value"]')!;
    const sameNumber = form.querySelector<HTMLInputElement>('#same-number')!;
    number.value = barcode.value.length <= 200 ? barcode.value : '';
    format.value = barcode.format;
    value.value = barcode.value;
    form.dataset.barcodeValue = encodeURIComponent(barcode.value);
    value.readOnly = false;
    sameNumber.checked = false;
    form.querySelector<HTMLElement>('#barcode-fields')!.hidden = false;
    message('scanCaptured');
    onCaptured();
    form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
  };
  const begin = () => {
    stopScan?.();
    video.hidden = false;
    start.hidden = true;
    status.setAttribute('role', 'status');
    status.textContent = t('scanLooking');
    stopScan = startScanner(video, result, (error) => message(error, error !== 'cameraPaused'));
  };
  const editing = () => { if (stopScan) message('cameraPaused'); };
  start.addEventListener('click', begin);
  manual.addEventListener('click', () => {
    message('cameraPaused');
    form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
  });
  form.addEventListener('input', editing);
  if (autoStart) begin(); else message('cameraPaused');
  return () => {
    stopScan?.();
    form.removeEventListener('input', editing);
    start.removeEventListener('click', begin);
  };
}
