import { PRODUCT } from '@/shared/constants';
import { RpcClient } from '@/shared/rpc';
import { getSettings, isSiteDisabled, patchSettings } from '@/shared/storage';
import { describeCapability, isReady, needsDownload } from '@/engine/availability';
import { warmUpAll } from '@/engine/download';
import { onDownloadProgress } from '@/engine/session';

const rpc = new RpcClient();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function activeHostname(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
}

function setStatus(state: 'busy' | 'ready' | 'error', text: string): void {
  const element = $('status');
  element.dataset.state = state;
  element.innerHTML = '';
  const indicator = document.createElement('span');
  indicator.className = state === 'busy' ? 'spinner' : 'led';
  const label = document.createElement('span');
  label.textContent = text;
  element.append(indicator, label);
}

/** The header chip: green once the model is loaded and answering. */
function setPrivacyChip(state: 'checking' | 'ready' | 'pending' | 'off', title: string): void {
  const chip = $('privacy');
  chip.dataset.state = state;
  chip.title = title;
}

async function main(): Promise<void> {
  const settings = await getSettings();
  const hostname = await activeHostname();

  const enabled = $('enabled') as HTMLInputElement;
  enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => {
    void patchSettings({ enabled: enabled.checked });
  });

  const site = $('site') as HTMLInputElement;
  const siteLabel = $('site-label');
  if (hostname) {
    site.checked = !isSiteDisabled(settings, hostname);
    siteLabel.textContent = `Enabled on ${hostname}`;
    site.addEventListener('change', () => {
      const current = settings.disabledSites.filter((s) => s !== hostname);
      void patchSettings({
        disabledSites: site.checked ? current : [...current, hostname],
      });
    });
  } else {
    site.disabled = true;
    siteLabel.textContent = 'Not available on this page';
  }

  // Resolved up front: chrome.sidePanel.open() must be called synchronously
  // from the click, and awaiting tabs.query() first drops the user activation.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const panelWindowId = activeTab?.windowId;

  $('open-panel').addEventListener('click', () => {
    if (panelWindowId === undefined) return;
    chrome.sidePanel
      .open({ windowId: panelWindowId })
      .then(() => window.close())
      .catch(() => setStatus('error', 'Chrome refused to open the side panel.'));
  });

  $('options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });

  // Progress is reported by the engine module running in *this* page, because
  // that is where the download is started.
  onDownloadProgress((api, loaded) => {
    $('progress').textContent = `Downloading ${api}: ${Math.round(loaded * 100)}%`;
  });

  try {
    const report = await rpc.call('capabilities', undefined);
    if (isReady(report.languageModel)) {
      setStatus('ready', 'Model ready — nothing leaves this device');
      setPrivacyChip('ready', 'Model ready — every check runs on this device');
    } else if (needsDownload(report.languageModel)) {
      setStatus('error', 'Model not downloaded yet');
      setPrivacyChip('pending', describeCapability(report.languageModel));
      $('download').hidden = false;
      $('warmup').addEventListener('click', async () => {
        const button = $('warmup') as HTMLButtonElement;
        button.disabled = true;
        button.textContent = 'Downloading…';
        // Must run here, not over RPC: Chrome needs transient user activation
        // to start a download, and activation does not cross a message hop.
        const report = await warmUpAll(settings.translateTo);
        button.textContent = report.ok ? 'Models ready' : 'Some downloads failed';
        button.disabled = false;
        if (report.ok) {
          setStatus('ready', 'Model ready — nothing leaves this device');
          setPrivacyChip('ready', 'Model ready — every check runs on this device');
        }
        const failed = report.apis.filter((entry) => !entry.ready);
        $('progress').textContent =
          failed.length === 0
            ? 'All models downloaded.'
            : failed.map((entry) => `${entry.label}: ${entry.error}`).join('\n');
      });
    } else {
      setStatus('error', `${PRODUCT} is inactive: ${describeCapability(report.languageModel)}`);
      setPrivacyChip('off', describeCapability(report.languageModel));
    }
  } catch {
    setStatus('error', 'Could not reach the background worker');
    setPrivacyChip('off', 'Could not reach the background worker');
  }
}

void main();
