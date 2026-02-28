/* ===================================================================
   Calcite SitAware — Brief Page Renderer
   =================================================================== */

(async function () {
  // Wait for Calcite to hydrate
  await customElements.whenDefined('calcite-shell');

  const SA = window.SitAware;

  // ---- Init theme & state picker ----
  SA.initTheme();
  SA.loadSelectedStates();
  SA.loadCachedData();

  // Populate state pickers (desktop + mobile)
  populateStatePicker('statePicker');
  populateStatePicker('statePickerMobile');

  // ---- Wire up controls ----
  document.getElementById('themeToggle')?.addEventListener('click', SA.toggleTheme);
  document.getElementById('themeToggleMobile')?.addEventListener('click', () => {
    SA.toggleTheme();
    document.getElementById('mobileSheet').open = false;
  });

  document.getElementById('refreshBtn')?.addEventListener('click', manualRefresh);
  document.getElementById('refreshBtnMobile')?.addEventListener('click', () => {
    manualRefresh();
    document.getElementById('mobileSheet').open = false;
  });

  // Mobile menu
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('mobileSheet').open = true;
  });
  document.getElementById('mobilePanel')?.addEventListener('calcitePanelClose', () => {
    document.getElementById('mobileSheet').open = false;
  });

  // State picker change (desktop)
  document.getElementById('statePicker')?.addEventListener('calciteComboboxChange', (e) => {
    SA.state.selectedStates = getComboboxValues('statePicker');
    SA.saveSelectedStates();
    syncPickers('statePicker', 'statePickerMobile');
    onStateChange();
  });

  // State picker change (mobile)
  document.getElementById('statePickerMobile')?.addEventListener('calciteComboboxChange', (e) => {
    SA.state.selectedStates = getComboboxValues('statePickerMobile');
    SA.saveSelectedStates();
    syncPickers('statePickerMobile', 'statePicker');
    onStateChange();
  });

  // ---- Listen for data events ----
  window.addEventListener('sitaware-data-ready', renderAll);

  // ---- Fetch data ----
  await SA.fetchAllData();
  SA.startAutoRefresh();

  // ---- Render Functions ----

  function renderAll() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('briefContent').style.display = 'block';

    renderStatusBanner();
    renderNeedsAction();
    renderWeather();
    renderOps();
    renderFires();
    renderQuakes();
    renderFreshness();
    updateThemeIcon();
  }

  function renderStatusBanner() {
    const el = document.getElementById('statusBanner');
    const level = SA.state.statusLevel;
    const sel = SA.state.selectedStates;
    const scope = sel.length ? sel.join(', ') : 'National';

    let msg = '';
    if (level === 'success') {
      msg = `All clear \u2014 no critical events ${sel.length ? 'in ' + scope : 'nationally'}`;
    } else if (level === 'warning') {
      const count = SA.state.needsAction.length || 'active';
      msg = `Active watches \u2014 ${count} advisory items ${sel.length ? 'in ' + scope : 'nationally'}`;
    } else {
      msg = `Action needed \u2014 critical events require attention ${sel.length ? 'in ' + scope : ''}`;
    }

    el.innerHTML = `
      <calcite-notice kind="${level}" open icon="${level === 'success' ? 'check-circle' : level === 'warning' ? 'exclamation-mark-triangle' : 'exclamation-mark-circle'}" scale="l" width="full">
        <span slot="title">${msg}</span>
        <span slot="message">Monitoring ${SA.state.fema.filtered.length} operations \u00B7 ${SA.state.nws.filtered.length} weather alerts \u00B7 ${SA.state.fires.filtered.length} active fires \u00B7 ${SA.state.quakes.filtered.length} significant quakes</span>
      </calcite-notice>
    `;
  }

  function renderNeedsAction() {
    const el = document.getElementById('needsActionSection');
    const items = SA.state.needsAction;

    if (!items.length) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';
    el.innerHTML = `
      <h2 class="visually-hidden">Needs Action</h2>
      <div class="needs-action-grid">
        ${items.map(item => `
          <calcite-card data-source="${item.source}">
            <span slot="heading">
              <div class="card-header">
                <calcite-icon icon="${item.icon}" scale="s"></calcite-icon>
                <span class="card-headline">${escHtml(item.headline)}</span>
              </div>
            </span>
            <span slot="description">
              <div class="card-meta">
                <calcite-chip scale="s" kind="${item.chipKind}" appearance="outline-fill">${escHtml(item.chipLabel)}</calcite-chip>
                ${item.detail ? `<span>${escHtml(item.detail)}</span>` : ''}
                ${item.time ? `<span>\u00B7 ${SA.timeAgo(item.time)}</span>` : ''}
              </div>
            </span>
            <calcite-button
              slot="footer-end"
              appearance="outline"
              scale="s"
              icon-start="map"
              onclick="window.location.href='map.html?layer=${item.source}'"
            >View on Map</calcite-button>
          </calcite-card>
        `).join('')}
      </div>
    `;
  }

  function renderWeather() {
    const el = document.getElementById('weatherSection');
    const alerts = SA.state.nws.filtered;
    const severeUp = alerts.filter(a => a.severity === 'Extreme' || a.severity === 'Severe');

    // Group by event type
    const groups = {};
    severeUp.forEach(a => {
      const key = a.event || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });

    const groupEntries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const showMax = 5;
    const hasOverflow = groupEntries.length > showMax;
    const visibleGroups = groupEntries.slice(0, showMax);

    const isMobile = window.innerWidth <= 768;

    el.innerHTML = `
      <calcite-block
        heading="Weather Outlook"
        description="${severeUp.length} severe/extreme alerts"
        icon-start="lightning-bolt"
        collapsible
        ${isMobile && !severeUp.length ? '' : 'open'}
      >
        ${severeUp.length === 0 ? `
          <div class="empty-state">
            <calcite-icon icon="check-circle" scale="l"></calcite-icon>
            <p>No severe or extreme weather alerts</p>
          </div>
        ` : `
          <calcite-list>
            ${visibleGroups.map(([event, items]) => {
              const soonest = items.reduce((a, b) =>
                new Date(a.expires) < new Date(b.expires) ? a : b
              );
              const severity = items[0].severity;
              return `
                <calcite-list-item
                  label="${escHtml(event)}"
                  description="Expires in ${SA.timeUntil(soonest.expires)}"
                >
                  <calcite-chip slot="content-end" scale="s" kind="${SA.nwsSeverityKind(severity)}" appearance="outline-fill">
                    ${items.length}
                  </calcite-chip>
                </calcite-list-item>
              `;
            }).join('')}
          </calcite-list>
          ${hasOverflow ? `
            <div class="show-all-link" id="showAllWeather" onclick="this.parentElement.querySelector('.weather-overflow').style.display='block'; this.style.display='none';">
              Show all (${groupEntries.length})
            </div>
            <div class="weather-overflow" style="display:none;">
              <calcite-list>
                ${groupEntries.slice(showMax).map(([event, items]) => {
                  const soonest = items.reduce((a, b) =>
                    new Date(a.expires) < new Date(b.expires) ? a : b
                  );
                  return `
                    <calcite-list-item
                      label="${escHtml(event)}"
                      description="Expires in ${SA.timeUntil(soonest.expires)}"
                    >
                      <calcite-chip slot="content-end" scale="s" kind="${SA.nwsSeverityKind(items[0].severity)}" appearance="outline-fill">
                        ${items.length}
                      </calcite-chip>
                    </calcite-list-item>
                  `;
                }).join('')}
              </calcite-list>
            </div>
          ` : ''}
        `}
      </calcite-block>
    `;
  }

  function renderOps() {
    const el = document.getElementById('opsSection');
    const ops = SA.state.fema.filtered;

    el.innerHTML = `
      <calcite-block
        heading="Active Operations"
        description="${ops.length} FEMA declarations"
        icon-start="organization"
        collapsible
        open
      >
        ${ops.length === 0 ? `
          <div class="empty-state">
            <calcite-icon icon="check-circle" scale="l"></calcite-icon>
            <p>No active FEMA declarations in scope</p>
          </div>
        ` : `
          <calcite-list>
            ${ops.slice(0, 15).map(d => `
              <calcite-list-item
                label="${escHtml(d.state)} \u2014 ${escHtml(d.declarationTitle)}"
                description="${SA.formatDate(d.declarationDate)}"
              >
                <calcite-icon slot="content-start" icon="${SA.femaIcon(d.incidentType)}" scale="s"></calcite-icon>
                <calcite-chip slot="content-end" scale="s" appearance="outline-fill" kind="brand">
                  ${escHtml(d.incidentType)}
                </calcite-chip>
              </calcite-list-item>
            `).join('')}
          </calcite-list>
          ${ops.length > 15 ? `
            <div class="show-all-link">+ ${ops.length - 15} more</div>
          ` : ''}
        `}
      </calcite-block>
    `;
  }

  function renderFires() {
    const el = document.getElementById('fireSection');
    const fires = SA.state.fires.filtered
      .sort((a, b) => (b.DailyAcres || b.CalculatedAcres || 0) - (a.DailyAcres || a.CalculatedAcres || 0))
      .slice(0, 10);

    const isMobile = window.innerWidth <= 768;

    el.innerHTML = `
      <calcite-block
        heading="Fire Monitor"
        description="${SA.state.fires.filtered.length} active fires"
        icon-start="fire"
        collapsible
        ${isMobile ? '' : 'open'}
      >
        ${fires.length === 0 ? `
          <div class="empty-state">
            <calcite-icon icon="check-circle" scale="l"></calcite-icon>
            <p>No significant active fires</p>
          </div>
        ` : `
          <calcite-list>
            ${fires.map(f => {
              const acres = f.DailyAcres || f.CalculatedAcres || 0;
              const pct = f.PercentContained ?? 0;
              return `
                <calcite-list-item
                  label="${escHtml(f.IncidentName || 'Unknown Fire')}"
                  description="${escHtml(f.POOState || '')}${f.POOCounty ? ', ' + escHtml(f.POOCounty) : ''}"
                >
                  <span slot="content-start" class="acres-display">${SA.formatAcres(acres)}</span>
                  <calcite-chip slot="content-end" scale="s" kind="${SA.containmentKind(pct)}" appearance="outline-fill">
                    ${pct}%
                  </calcite-chip>
                </calcite-list-item>
              `;
            }).join('')}
          </calcite-list>
        `}
      </calcite-block>
    `;
  }

  function renderQuakes() {
    const el = document.getElementById('quakeSection');
    const quakes = SA.state.quakes.filtered
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 10);

    const isMobile = window.innerWidth <= 768;

    el.innerHTML = `
      <calcite-block
        heading="Seismic Monitor"
        description="${SA.state.quakes.filtered.length} significant earthquakes (7 days)"
        icon-start="pin-tear"
        collapsible
        ${isMobile ? '' : 'open'}
      >
        ${quakes.length === 0 ? `
          <div class="empty-state">
            <calcite-icon icon="check-circle" scale="l"></calcite-icon>
            <p>No significant seismic activity (M4.0+)</p>
          </div>
        ` : `
          <calcite-list>
            ${quakes.map(q => {
              const pagerKind = q.alert === 'red' ? 'danger' : q.alert === 'orange' ? 'warning' : q.alert === 'yellow' ? 'warning' : 'neutral';
              return `
                <calcite-list-item
                  label="M${q.mag.toFixed(1)} \u2014 ${escHtml(q.place || 'Unknown')}"
                  description="${SA.timeAgo(new Date(q.time).toISOString())}"
                >
                  <span slot="content-start" class="mag-display">${q.mag.toFixed(1)}</span>
                  ${q.alert ? `
                    <calcite-chip slot="content-end" scale="s" kind="${pagerKind}" appearance="outline-fill">
                      PAGER: ${q.alert}
                    </calcite-chip>
                  ` : ''}
                </calcite-list-item>
              `;
            }).join('')}
          </calcite-list>
        `}
      </calcite-block>
    `;
  }

  function renderFreshness() {
    const el = document.getElementById('dataFreshness');
    const feeds = [
      { name: 'FEMA', ts: SA.state.fema.lastFetch, status: SA.state.fema.status },
      { name: 'NWS', ts: SA.state.nws.lastFetch, status: SA.state.nws.status },
      { name: 'NIFC', ts: SA.state.fires.lastFetch, status: SA.state.fires.status },
      { name: 'USGS', ts: SA.state.quakes.lastFetch, status: SA.state.quakes.status }
    ];

    el.innerHTML = feeds.map(f => {
      const stale = SA.isFeedStale(f.ts);
      const isError = f.status === 'error';
      const cls = (stale || isError) ? 'feed-item stale' : 'feed-item';
      const age = f.status === 'error' ? 'error' : SA.feedAge(f.ts);
      return `<span class="${cls}">${f.name} ${age}</span>`;
    }).join('<span style="color: var(--dragon-text-muted);">\u00B7</span>');
  }

  // ---- Helpers ----

  function populateStatePicker(id) {
    const combo = document.getElementById(id);
    if (!combo) return;

    Object.entries(SA.US_STATES).forEach(([abbr, name]) => {
      const item = document.createElement('calcite-combobox-item');
      item.value = abbr;
      item.textLabel = `${abbr} — ${name}`;
      // Pre-select saved states
      if (SA.state.selectedStates.includes(abbr)) {
        item.selected = true;
      }
      combo.appendChild(item);
    });
  }

  function getComboboxValues(id) {
    const combo = document.getElementById(id);
    if (!combo) return [];
    const items = combo.querySelectorAll('calcite-combobox-item[selected]');
    return Array.from(items).map(i => i.value);
  }

  function syncPickers(sourceId, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const selected = SA.state.selectedStates;
    target.querySelectorAll('calcite-combobox-item').forEach(item => {
      item.selected = selected.includes(item.value);
    });
  }

  function onStateChange() {
    SA.filterBySelectedStates();
    SA.computeStatus();
    renderAll();
  }

  async function manualRefresh() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.loading = true;
    await SA.fetchAllData();
    if (btn) btn.loading = false;

    const toast = document.getElementById('toastAlert');
    const msg = document.getElementById('toastMessage');
    if (toast && msg) {
      const errors = ['fema', 'nws', 'fires', 'quakes'].filter(k => SA.state[k].status === 'error');
      if (errors.length) {
        toast.kind = 'warning';
        toast.icon = 'exclamation-mark-triangle';
        msg.textContent = `${errors.length} feed(s) had errors: ${errors.join(', ')}`;
      } else {
        toast.kind = 'success';
        toast.icon = 'check-circle';
        msg.textContent = 'All feeds refreshed successfully.';
      }
      toast.open = true;
    }
  }

  function updateThemeIcon() {
    const shell = document.querySelector('calcite-shell');
    const isDark = shell?.classList.contains('calcite-mode-dark');
    const icon = isDark ? 'brightness' : 'moon';
    document.getElementById('themeToggle')?.setAttribute('icon', icon);
    const mobileBtn = document.getElementById('themeToggleMobile');
    if (mobileBtn) mobileBtn.iconStart = icon;
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Freshness auto-update every 30 seconds
  setInterval(renderFreshness, 30000);

})();
