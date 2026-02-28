/* ===================================================================
   Calcite SitAware — Data Engine
   Fetch, filter, cache, state management for FEMA/NWS/NIFC/USGS
   =================================================================== */

const CONFIG = {
  // API endpoints
  femaUrl: 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries',
  nwsAlertsUrl: 'https://api.weather.gov/alerts/active?status=actual',
  nwsUserAgent: '(calcite-sitaware, disaster-response@redcross.org)',
  nifcUrl: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/0/query',
  usgsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',

  // Refresh intervals (ms)
  femaRefreshMs: 5 * 60 * 1000,
  nwsRefreshMs: 2 * 60 * 1000,
  nifcRefreshMs: 15 * 60 * 1000,
  usgsRefreshMs: 5 * 60 * 1000,

  // Smart filter thresholds
  femaDaysBack: 30,
  needsActionHours: 48,
  fireAcresThreshold: 10000,
  fireContainmentThreshold: 50,
  quakeMinMag: 4.0,
  quakeActionMag: 5.0,

  // Cache keys (sessionStorage)
  cacheKeys: {
    fema: 'sitaware-fema',
    nws: 'sitaware-nws',
    fires: 'sitaware-fires',
    quakes: 'sitaware-quakes',
    femaTs: 'sitaware-fema-ts',
    nwsTs: 'sitaware-nws-ts',
    firesTs: 'sitaware-fires-ts',
    quakesTs: 'sitaware-quakes-ts'
  },

  // localStorage keys
  statePickerKey: 'sitaware-selected-states',
  themeKey: 'sitaware-theme',

  // AGOL OAuth
  agolAppId: '3s2hzDtggzFqA9j4',
  agolPortal: 'https://arc-nhq-gis.maps.arcgis.com'
};

// US state abbreviations + names for the picker
const US_STATES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'District of Columbia',PR:'Puerto Rico',VI:'US Virgin Islands',
  GU:'Guam',AS:'American Samoa',MP:'Northern Mariana Islands'
};

// ---- Application State ----
const state = {
  selectedStates: [],
  fema:   { raw: [], filtered: [], status: 'idle', lastFetch: null },
  nws:    { raw: [], filtered: [], status: 'idle', lastFetch: null },
  fires:  { raw: [], filtered: [], status: 'idle', lastFetch: null },
  quakes: { raw: [], filtered: [], status: 'idle', lastFetch: null },
  statusLevel: 'success',
  needsAction: [],
  refreshTimers: []
};

// ---- Cache Helpers ----
function cacheSet(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    console.warn('SitAware: sessionStorage full, clearing');
    sessionStorage.clear();
  }
}
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---- Fetch Functions ----

async function fetchFema() {
  state.fema.status = 'loading';
  dispatch('feed-update');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.femaDaysBack);
  const dateStr = cutoff.toISOString().split('T')[0];

  const url = `${CONFIG.femaUrl}?$filter=declarationDate ge '${dateStr}'&$orderby=declarationDate desc&$top=1000`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FEMA ${resp.status}`);
    const json = await resp.json();
    const all = json.DisasterDeclarationsSummaries || [];

    // Deduplicate by disasterNumber (keep first = most recent amendment)
    const seen = new Set();
    state.fema.raw = all.filter(d => {
      if (seen.has(d.disasterNumber)) return false;
      seen.add(d.disasterNumber);
      return true;
    });

    // Smart filter: active only (no end date or future end date)
    const now = new Date();
    state.fema.filtered = state.fema.raw.filter(d => {
      if (d.incidentEndDate) {
        return new Date(d.incidentEndDate) > now;
      }
      return true; // no end date = still active
    });

    state.fema.lastFetch = Date.now();
    state.fema.status = 'ok';
    cacheSet(CONFIG.cacheKeys.fema, state.fema.raw);
    sessionStorage.setItem(CONFIG.cacheKeys.femaTs, String(state.fema.lastFetch));
  } catch (err) {
    console.error('SitAware: FEMA fetch failed', err);
    state.fema.status = 'error';
  }
  dispatch('feed-update');
}

async function fetchNws() {
  state.nws.status = 'loading';
  dispatch('feed-update');

  try {
    const resp = await fetch(CONFIG.nwsAlertsUrl, {
      headers: { 'User-Agent': CONFIG.nwsUserAgent }
    });
    if (!resp.ok) throw new Error(`NWS ${resp.status}`);
    const json = await resp.json();

    state.nws.raw = (json.features || []).map(f => ({
      ...f.properties,
      geometry: f.geometry
    }));

    state.nws.lastFetch = Date.now();
    state.nws.status = 'ok';
    cacheSet(CONFIG.cacheKeys.nws, state.nws.raw);
    sessionStorage.setItem(CONFIG.cacheKeys.nwsTs, String(state.nws.lastFetch));
  } catch (err) {
    console.error('SitAware: NWS fetch failed', err);
    state.nws.status = 'error';
  }
  dispatch('feed-update');
}

async function fetchFires() {
  state.fires.status = 'loading';
  dispatch('feed-update');

  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'IncidentName,DailyAcres,PercentContained,FireDiscoveryDateTime,FireCause,POOState,POOCounty,GACC,TotalIncidentPersonnel,FireMgmtComplexity,CalculatedAcres,ResidencesDestroyed,Injuries,Fatalities,ModifiedOnDateTime',
    f: 'json',
    resultRecordCount: '2000'
  });

  try {
    const resp = await fetch(`${CONFIG.nifcUrl}?${params}`);
    if (!resp.ok) throw new Error(`NIFC ${resp.status}`);
    const json = await resp.json();

    const all = (json.features || []).map(f => ({
      ...f.attributes,
      longitude: f.geometry?.x,
      latitude: f.geometry?.y
    }));

    state.fires.raw = all;

    // Smart filter: active fires only
    state.fires.filtered = all.filter(f =>
      (f.PercentContained === null || f.PercentContained < 100) &&
      (f.DailyAcres > 0 || f.TotalIncidentPersonnel > 0)
    );

    state.fires.lastFetch = Date.now();
    state.fires.status = 'ok';
    cacheSet(CONFIG.cacheKeys.fires, state.fires.raw);
    sessionStorage.setItem(CONFIG.cacheKeys.firesTs, String(state.fires.lastFetch));
  } catch (err) {
    console.error('SitAware: NIFC fetch failed', err);
    state.fires.status = 'error';
  }
  dispatch('feed-update');
}

async function fetchQuakes() {
  state.quakes.status = 'loading';
  dispatch('feed-update');

  try {
    const resp = await fetch(CONFIG.usgsUrl);
    if (!resp.ok) throw new Error(`USGS ${resp.status}`);
    const json = await resp.json();

    const all = (json.features || []).map(f => ({
      ...f.properties,
      longitude: f.geometry?.coordinates?.[0],
      latitude: f.geometry?.coordinates?.[1],
      depth: f.geometry?.coordinates?.[2],
      id: f.id
    }));

    state.quakes.raw = all;

    // Smart filter: M4.0+ OR has PAGER alert
    state.quakes.filtered = all.filter(q =>
      q.mag >= CONFIG.quakeMinMag ||
      (q.alert && ['red', 'orange', 'yellow'].includes(q.alert))
    );

    state.quakes.lastFetch = Date.now();
    state.quakes.status = 'ok';
    cacheSet(CONFIG.cacheKeys.quakes, state.quakes.raw);
    sessionStorage.setItem(CONFIG.cacheKeys.quakesTs, String(state.quakes.lastFetch));
  } catch (err) {
    console.error('SitAware: USGS fetch failed', err);
    state.quakes.status = 'error';
  }
  dispatch('feed-update');
}

// ---- State Filter ----

function getStateFiltered(items, stateField) {
  if (!state.selectedStates.length) return items;
  return items.filter(item => {
    const val = item[stateField];
    if (!val) return false;
    // NWS areaDesc contains state names in a semicolon-delimited string
    if (stateField === '_stateMatch') return item._stateMatch;
    return state.selectedStates.includes(val);
  });
}

function filterBySelectedStates() {
  const sel = state.selectedStates;
  const noFilter = !sel.length;

  // FEMA: filter by state field
  state.fema.filtered = state.fema.raw.filter(d => {
    const now = new Date();
    const active = !d.incidentEndDate || new Date(d.incidentEndDate) > now;
    if (!active) return false;
    return noFilter || sel.includes(d.state);
  });

  // NWS: match by areaDesc containing state names
  state.nws.filtered = state.nws.raw.filter(a => {
    if (noFilter) return true;
    const desc = (a.areaDesc || '').toUpperCase();
    return sel.some(abbr => {
      const name = US_STATES[abbr];
      return name && desc.includes(name.toUpperCase());
    });
  });

  // Fires: POOState is full state name
  state.fires.filtered = state.fires.raw.filter(f => {
    const active = (f.PercentContained === null || f.PercentContained < 100) &&
                   (f.DailyAcres > 0 || f.TotalIncidentPersonnel > 0);
    if (!active) return false;
    if (noFilter) return true;
    const fState = (f.POOState || '').toUpperCase();
    return sel.some(abbr => {
      const name = US_STATES[abbr];
      return name && fState.includes(name.toUpperCase());
    });
  });

  // Quakes: parse state from place string ("34km NW of Anza, CA")
  state.quakes.filtered = state.quakes.raw.filter(q => {
    const magOk = q.mag >= CONFIG.quakeMinMag ||
                  (q.alert && ['red', 'orange', 'yellow'].includes(q.alert));
    if (!magOk) return false;
    if (noFilter) return true;
    const place = q.place || '';
    return sel.some(abbr => {
      // Check for ", CA" pattern at end or state name in place string
      if (place.endsWith(`, ${abbr}`)) return true;
      const name = US_STATES[abbr];
      return name && place.toUpperCase().includes(name.toUpperCase());
    });
  });
}

// ---- Status & Needs-Action Computation ----

function computeStatus() {
  const now = Date.now();
  const cutoff48h = now - (CONFIG.needsActionHours * 60 * 60 * 1000);
  const actions = [];

  // Check NWS for Extreme alerts
  const extremeAlerts = state.nws.filtered.filter(a => a.severity === 'Extreme');
  if (extremeAlerts.length) {
    const areas = [...new Set(extremeAlerts.map(a => a.areaDesc?.split(';')[0]?.trim()).filter(Boolean))];
    actions.push({
      source: 'nws',
      icon: 'exclamation-mark-triangle',
      headline: `Extreme weather: ${extremeAlerts[0].event}`,
      detail: areas.slice(0, 3).join(', '),
      severity: 'danger',
      time: extremeAlerts[0].effective,
      chipLabel: 'Extreme',
      chipKind: 'danger'
    });
  }

  // Check FEMA for new declarations (last 48h)
  const newDecl = state.fema.filtered.filter(d => {
    const dt = new Date(d.declarationDate).getTime();
    return dt > cutoff48h;
  });
  if (newDecl.length) {
    actions.push({
      source: 'fema',
      icon: 'organization',
      headline: `New FEMA declaration: ${newDecl[0].declarationTitle}`,
      detail: `${newDecl[0].state} — ${newDecl[0].incidentType}`,
      severity: 'danger',
      time: newDecl[0].declarationDate,
      chipLabel: newDecl[0].incidentType,
      chipKind: 'brand'
    });
  }

  // Check quakes for M5.0+ or PAGER red/orange
  const bigQuakes = state.quakes.filtered.filter(q =>
    q.mag >= CONFIG.quakeActionMag ||
    (q.alert && ['red', 'orange'].includes(q.alert))
  );
  if (bigQuakes.length) {
    const q = bigQuakes[0];
    actions.push({
      source: 'quakes',
      icon: 'pin-tear',
      headline: `M${q.mag.toFixed(1)} earthquake — ${q.place}`,
      detail: q.alert ? `PAGER: ${q.alert}` : '',
      severity: q.alert === 'red' ? 'danger' : 'warning',
      time: new Date(q.time).toISOString(),
      chipLabel: `M${q.mag.toFixed(1)}`,
      chipKind: q.mag >= 6 ? 'danger' : 'warning'
    });
  }

  // Check fires for >10K acres AND <50% contained
  const bigFires = state.fires.filtered.filter(f =>
    (f.DailyAcres || f.CalculatedAcres || 0) >= CONFIG.fireAcresThreshold &&
    (f.PercentContained === null || f.PercentContained < CONFIG.fireContainmentThreshold)
  );
  if (bigFires.length) {
    const f = bigFires[0];
    const acres = f.DailyAcres || f.CalculatedAcres || 0;
    actions.push({
      source: 'fires',
      icon: 'fire',
      headline: `${f.IncidentName} — ${formatAcres(acres)}`,
      detail: `${f.POOState || 'Unknown'} — ${f.PercentContained ?? 0}% contained`,
      severity: 'warning',
      time: f.FireDiscoveryDateTime ? new Date(f.FireDiscoveryDateTime).toISOString() : null,
      chipLabel: `${f.PercentContained ?? 0}%`,
      chipKind: f.PercentContained < 25 ? 'danger' : 'warning'
    });
  }

  state.needsAction = actions.slice(0, 3);

  // Determine overall status level
  if (actions.some(a => a.severity === 'danger')) {
    state.statusLevel = 'danger';
  } else if (actions.length > 0) {
    state.statusLevel = 'warning';
  } else {
    // Also check for Severe NWS or moderate fire activity
    const severeAlerts = state.nws.filtered.filter(a => a.severity === 'Severe');
    const activeBigFires = state.fires.filtered.filter(f =>
      (f.DailyAcres || f.CalculatedAcres || 0) >= CONFIG.fireAcresThreshold
    );
    if (severeAlerts.length || activeBigFires.length) {
      state.statusLevel = 'warning';
    } else {
      state.statusLevel = 'success';
    }
  }
}

// ---- Event Dispatch ----

function dispatch(type, detail = {}) {
  window.dispatchEvent(new CustomEvent(`sitaware-${type}`, { detail }));
}

// ---- Formatters ----

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function timeUntil(dateStr) {
  if (!dateStr) return '';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m`;
  }
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatAcres(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K acres`;
  return `${Math.round(n)} acres`;
}

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function feedAge(timestamp) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

function isFeedStale(timestamp) {
  if (!timestamp) return true;
  return (Date.now() - timestamp) > 10 * 60 * 1000; // >10 min
}

// ---- Containment chip kind ----
function containmentKind(pct) {
  if (pct == null || pct < 25) return 'danger';
  if (pct < 75) return 'warning';
  return 'success';
}

// ---- FEMA incident type icon ----
function femaIcon(type) {
  const map = {
    'Fire': 'fire',
    'Hurricane': 'hurricane',
    'Tornado': 'tornado',
    'Flood': 'effects-rain',
    'Severe Storm(s)': 'lightning-bolt',
    'Earthquake': 'pin-tear',
    'Snow': 'snowflake',
    'Severe Ice Storm': 'snowflake',
    'Typhoon': 'hurricane',
    'Coastal Storm': 'wave',
    'Mud/Landslide': 'mountain',
    'Drought': 'brightness',
    'Biological': 'biohazard'
  };
  return map[type] || 'exclamation-mark-circle';
}

// ---- NWS severity helpers ----
function nwsSeverityKind(severity) {
  switch (severity) {
    case 'Extreme': return 'danger';
    case 'Severe': return 'warning';
    case 'Moderate': return 'brand';
    default: return 'neutral';
  }
}

// ---- Init ----

function loadCachedData() {
  const fema = cacheGet(CONFIG.cacheKeys.fema);
  if (fema) {
    state.fema.raw = fema;
    state.fema.status = 'ok';
    state.fema.lastFetch = Number(sessionStorage.getItem(CONFIG.cacheKeys.femaTs)) || null;
  }
  const nws = cacheGet(CONFIG.cacheKeys.nws);
  if (nws) {
    state.nws.raw = nws;
    state.nws.status = 'ok';
    state.nws.lastFetch = Number(sessionStorage.getItem(CONFIG.cacheKeys.nwsTs)) || null;
  }
  const fires = cacheGet(CONFIG.cacheKeys.fires);
  if (fires) {
    state.fires.raw = fires;
    state.fires.status = 'ok';
    state.fires.lastFetch = Number(sessionStorage.getItem(CONFIG.cacheKeys.firesTs)) || null;
  }
  const quakes = cacheGet(CONFIG.cacheKeys.quakes);
  if (quakes) {
    state.quakes.raw = quakes;
    state.quakes.status = 'ok';
    state.quakes.lastFetch = Number(sessionStorage.getItem(CONFIG.cacheKeys.quakesTs)) || null;
  }
}

function loadSelectedStates() {
  try {
    const saved = localStorage.getItem(CONFIG.statePickerKey);
    state.selectedStates = saved ? JSON.parse(saved) : [];
  } catch { state.selectedStates = []; }
}

function saveSelectedStates() {
  localStorage.setItem(CONFIG.statePickerKey, JSON.stringify(state.selectedStates));
}

async function fetchAllData() {
  await Promise.all([fetchFema(), fetchNws(), fetchFires(), fetchQuakes()]);
  filterBySelectedStates();
  computeStatus();
  dispatch('data-ready', {
    fema: state.fema.filtered,
    nws: state.nws.filtered,
    fires: state.fires.filtered,
    quakes: state.quakes.filtered,
    statusLevel: state.statusLevel,
    needsAction: state.needsAction
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimers.push(
    setInterval(() => fetchFema().then(() => { filterBySelectedStates(); computeStatus(); dispatch('data-ready'); }), CONFIG.femaRefreshMs),
    setInterval(() => fetchNws().then(() => { filterBySelectedStates(); computeStatus(); dispatch('data-ready'); }), CONFIG.nwsRefreshMs),
    setInterval(() => fetchFires().then(() => { filterBySelectedStates(); computeStatus(); dispatch('data-ready'); }), CONFIG.nifcRefreshMs),
    setInterval(() => fetchQuakes().then(() => { filterBySelectedStates(); computeStatus(); dispatch('data-ready'); }), CONFIG.usgsRefreshMs)
  );
}

function stopAutoRefresh() {
  state.refreshTimers.forEach(clearInterval);
  state.refreshTimers = [];
}

// ---- Theme ----

function initTheme() {
  const saved = localStorage.getItem(CONFIG.themeKey);
  const shell = document.querySelector('calcite-shell');
  if (!shell) return;
  if (saved === 'dark') {
    shell.className = 'calcite-mode-dark';
  } else {
    shell.className = 'calcite-mode-light';
  }
}

function toggleTheme() {
  const shell = document.querySelector('calcite-shell');
  if (!shell) return;
  const isDark = shell.classList.contains('calcite-mode-dark');
  shell.className = isDark ? 'calcite-mode-light' : 'calcite-mode-dark';
  localStorage.setItem(CONFIG.themeKey, isDark ? 'light' : 'dark');
}

// ---- Public API ----

window.SitAware = {
  CONFIG,
  US_STATES,
  state,

  // Init & fetch
  loadCachedData,
  loadSelectedStates,
  saveSelectedStates,
  fetchAllData,
  fetchFema,
  fetchNws,
  fetchFires,
  fetchQuakes,
  filterBySelectedStates,
  computeStatus,

  // Refresh
  startAutoRefresh,
  stopAutoRefresh,

  // Theme
  initTheme,
  toggleTheme,

  // Formatters
  timeAgo,
  timeUntil,
  formatAcres,
  formatNumber,
  formatDate,
  feedAge,
  isFeedStale,

  // Helpers
  containmentKind,
  femaIcon,
  nwsSeverityKind,
  dispatch
};
