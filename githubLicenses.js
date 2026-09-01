const GITHUB_LICENSES_URL = 'https://api.github.com/licenses';
const CACHE_KEY = 'licensePicker.githubLicenses';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const RULE_LABELS = {
  'commercial-use': 'Commercial use',
  'modifications': 'Modification',
  'distribution': 'Distribution',
  'private-use': 'Private use',
  'patent-use': 'Patent use',
  'include-copyright': 'License and copyright notice',
  'document-changes': 'State changes',
  'disclose-source': 'Disclose source',
  'network-use-disclose': 'Network use is distribution',
  'same-license': 'Same license',
  'same-license--library': 'Same license (library)',
  'same-license--file': 'Same license (file)',
  'liability': 'Liability',
  'warranty': 'Warranty',
  'trademark-use': 'Trademark use',
  'no-endorsement-by-derivatives': 'No endorsement',
  'include-install-instructions': 'Include install instructions'
};

function ruleLabel(slug) {
  return RULE_LABELS[slug] || slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function mapLicense(api) {
  return {
    id: api.key,
    name: api.name,
    spdx: api.spdx_id || api.key,
    description: api.description || '',
    permissions: (api.permissions || []).map(ruleLabel),
    limitations: (api.limitations || []).map(ruleLabel),
    conditions: (api.conditions || []).map(ruleLabel),
    text: api.body || '',
    featured: Boolean(api.featured)
  };
}

function sortLicenses(licenses) {
  return [...licenses].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function fetchLicenseList() {
  const response = await fetch(`${GITHUB_LICENSES_URL}?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vscode-license-picker' }
  });
  if (!response.ok) {
    throw new Error(`GitHub license list failed (${response.status})`);
  }
  const list = await response.json();
  if (!Array.isArray(list) || !list.length) {
    throw new Error('GitHub license list was empty');
  }
  return list;
}

async function fetchLicenseDetail(key) {
  const response = await fetch(`${GITHUB_LICENSES_URL}/${encodeURIComponent(key)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vscode-license-picker' }
  });
  if (!response.ok) {
    throw new Error(`GitHub license "${key}" failed (${response.status})`);
  }
  return response.json();
}

async function fetchLicensesFromGitHub() {
  const list = await fetchLicenseList();
  const details = await Promise.all(list.map(item => fetchLicenseDetail(item.key)));
  return sortLicenses(details.map(mapLicense));
}

function readCache(globalState) {
  const cached = globalState.get(CACHE_KEY);
  if (!cached?.licenses?.length || !cached.fetchedAt) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
  return cached.licenses;
}

async function getLicenses(globalState) {
  try {
    const licenses = await fetchLicensesFromGitHub();
    await globalState.update(CACHE_KEY, { licenses, fetchedAt: Date.now() });
    return licenses;
  } catch (error) {
    const cached = globalState.get(CACHE_KEY)?.licenses;
    if (cached?.length) return cached;
    throw error;
  }
}

async function loadLicenses(globalState, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const freshCache = readCache(globalState);
    if (freshCache) return freshCache;
  }
  return getLicenses(globalState);
}

module.exports = {
  loadLicenses,
  mapLicense,
  sortLicenses
};
