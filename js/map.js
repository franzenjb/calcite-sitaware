/* ===================================================================
   Calcite SitAware — The Map
   ArcGIS MapView + 4 data layers + Calcite panel interactions
   =================================================================== */

(async function () {
  await customElements.whenDefined('calcite-shell');

  const SA = window.SitAware;
  SA.initTheme();
  SA.loadSelectedStates();
  SA.loadCachedData();

  // Swap ArcGIS CSS theme if dark
  updateEsriTheme();

  // Parse URL params for deep links
  const params = new URLSearchParams(window.location.search);
  const urlStates = params.get('state');
  if (urlStates && !SA.state.selectedStates.length) {
    SA.state.selectedStates = urlStates.split(',').map(s => s.trim().toUpperCase());
    SA.saveSelectedStates();
  }
  const urlLayer = params.get('layer');

  // Populate state pickers
  populateStatePicker('statePicker');
  populateStatePicker('statePickerPanel');
  populateStatePicker('statePickerMobile');

  // ---- ArcGIS Map ----
  let view, nwsLayer, femaLayer, firesLayer, quakesLayer;

  require([
    'esri/Map',
    'esri/views/MapView',
    'esri/Graphic',
    'esri/layers/GraphicsLayer',
    'esri/layers/GeoJSONLayer',
    'esri/geometry/Point',
    'esri/geometry/Polygon',
    'esri/symbols/SimpleFillSymbol',
    'esri/symbols/SimpleMarkerSymbol',
    'esri/symbols/PictureMarkerSymbol',
    'esri/PopupTemplate'
  ], function (Map, MapView, Graphic, GraphicsLayer, GeoJSONLayer, Point, Polygon,
               SimpleFillSymbol, SimpleMarkerSymbol, PictureMarkerSymbol, PopupTemplate) {

    const map = new Map({ basemap: 'gray-vector' });

    view = new MapView({
      container: 'viewDiv',
      map: map,
      center: [-98.5, 39.8],
      zoom: 4,
      popup: { autoOpenEnabled: false },
      ui: { components: ['zoom', 'compass'] }
    });

    // Create graphics layers (order = draw order)
    nwsLayer = new GraphicsLayer({ title: 'NWS Alerts', id: 'nws' });
    femaLayer = new GraphicsLayer({ title: 'FEMA Declarations', id: 'fema' });
    firesLayer = new GraphicsLayer({ title: 'Wildfires', id: 'fires' });
    quakesLayer = new GraphicsLayer({ title: 'Earthquakes', id: 'quakes' });
    map.addMany([nwsLayer, femaLayer, firesLayer, quakesLayer]);

    // Handle deep link layer focus
    if (urlLayer) {
      const toggleMap = { nws: 'toggleNws', fema: 'toggleFema', fires: 'toggleFires', quakes: 'toggleQuakes' };
      Object.entries(toggleMap).forEach(([key, id]) => {
        if (key !== urlLayer) {
          const sw = document.getElementById(id);
          if (sw) sw.checked = false;
        }
      });
    }

    // ---- Render Functions ----

    function renderNwsLayer() {
      nwsLayer.removeAll();
      const alerts = SA.state.nws.filtered;
      const sevFilter = getSelectedSeverities();

      alerts.forEach(alert => {
        if (!sevFilter.includes(alert.severity)) return;
        if (!alert.geometry || alert.geometry.type !== 'Polygon') return;

        const color = severityColor(alert.severity);
        const graphic = new Graphic({
          geometry: new Polygon({ rings: alert.geometry.coordinates, spatialReference: { wkid: 4326 } }),
          symbol: new SimpleFillSymbol({
            color: [...color, 0.25],
            outline: { color: [...color, 0.8], width: 1.5 }
          }),
          attributes: { ...alert, _source: 'nws' },
          popupTemplate: null
        });
        nwsLayer.add(graphic);
      });
    }

    function renderFemaLayer() {
      femaLayer.removeAll();
      // State centroids for FEMA (state-level markers)
      const centroids = {
        AL:[32.8,-86.8],AK:[64.2,-152.5],AZ:[34.3,-111.7],AR:[34.8,-92.2],CA:[36.8,-119.4],
        CO:[39.0,-105.5],CT:[41.6,-72.7],DE:[38.9,-75.5],FL:[27.8,-81.7],GA:[33.0,-83.5],
        HI:[19.9,-155.6],ID:[44.1,-114.7],IL:[40.0,-89.0],IN:[39.8,-86.1],IA:[42.0,-93.5],
        KS:[38.5,-98.3],KY:[37.8,-84.3],LA:[31.2,-91.9],ME:[45.4,-69.2],MD:[39.0,-76.6],
        MA:[42.2,-71.5],MI:[44.3,-84.5],MN:[46.3,-94.2],MS:[32.7,-89.7],MO:[38.5,-92.3],
        MT:[46.9,-110.4],NE:[41.5,-99.8],NV:[38.8,-116.4],NH:[43.7,-71.6],NJ:[40.1,-74.5],
        NM:[34.5,-106.0],NY:[43.0,-75.5],NC:[35.6,-79.8],ND:[47.5,-100.5],OH:[40.4,-82.8],
        OK:[35.5,-97.5],OR:[44.0,-120.5],PA:[41.2,-77.2],RI:[41.7,-71.5],SC:[34.0,-81.0],
        SD:[44.5,-100.2],TN:[35.9,-86.4],TX:[31.5,-99.3],UT:[39.3,-111.7],VT:[44.0,-72.7],
        VA:[37.5,-79.0],WA:[47.4,-120.7],WV:[38.6,-80.6],WI:[44.5,-89.8],WY:[43.0,-107.6],
        DC:[38.9,-77.0],PR:[18.2,-66.5],VI:[18.3,-64.9],GU:[13.4,144.8],AS:[-14.3,-170.7],MP:[15.2,145.7]
      };

      const ops = SA.state.fema.filtered;
      // Group by state to avoid stacking
      const byState = {};
      ops.forEach(d => { if (!byState[d.state]) byState[d.state] = []; byState[d.state].push(d); });

      Object.entries(byState).forEach(([st, decls]) => {
        const coords = centroids[st];
        if (!coords) return;
        const graphic = new Graphic({
          geometry: new Point({ longitude: coords[1], latitude: coords[0] }),
          symbol: new SimpleMarkerSymbol({
            style: 'square',
            color: [30, 74, 109, 0.85],
            size: Math.min(8 + decls.length * 3, 20),
            outline: { color: [255, 255, 255, 0.9], width: 1.5 }
          }),
          attributes: { ...decls[0], _count: decls.length, _all: decls, _source: 'fema' }
        });
        femaLayer.add(graphic);
      });
    }

    function renderFiresLayer() {
      firesLayer.removeAll();
      const fires = SA.state.fires.filtered;

      fires.forEach(f => {
        if (!f.longitude || !f.latitude) return;
        const acres = f.DailyAcres || f.CalculatedAcres || 0;
        const pct = f.PercentContained ?? 0;
        const color = pct < 25 ? [220, 38, 38] : pct < 75 ? [234, 138, 0] : [34, 139, 34];
        const size = Math.min(6 + Math.sqrt(acres) * 0.15, 24);

        const graphic = new Graphic({
          geometry: new Point({ longitude: f.longitude, latitude: f.latitude }),
          symbol: new SimpleMarkerSymbol({
            style: 'triangle',
            color: [...color, 0.85],
            size: size,
            outline: { color: [255, 255, 255, 0.9], width: 1 }
          }),
          attributes: { ...f, _source: 'fires' }
        });
        firesLayer.add(graphic);
      });
    }

    function renderQuakesLayer() {
      quakesLayer.removeAll();
      const minMag = parseFloat(document.getElementById('filterQuakeMag')?.value || '4.0');

      const quakes = SA.state.quakes.filtered.filter(q => q.mag >= minMag);

      quakes.forEach(q => {
        if (!q.longitude || !q.latitude) return;
        const color = q.alert === 'red' ? [220, 38, 38] :
                      q.alert === 'orange' ? [234, 138, 0] :
                      q.alert === 'yellow' ? [202, 178, 0] : [109, 76, 141];
        const size = Math.max(6, (q.mag - 2) * 6);

        const graphic = new Graphic({
          geometry: new Point({ longitude: q.longitude, latitude: q.latitude }),
          symbol: new SimpleMarkerSymbol({
            style: 'circle',
            color: [...color, 0.7],
            size: size,
            outline: { color: [...color, 1], width: 1.5 }
          }),
          attributes: { ...q, _source: 'quakes' }
        });
        quakesLayer.add(graphic);
      });
    }

    function renderAllLayers() {
      if (document.getElementById('toggleNws')?.checked) renderNwsLayer(); else nwsLayer.removeAll();
      if (document.getElementById('toggleFema')?.checked) renderFemaLayer(); else femaLayer.removeAll();
      if (document.getElementById('toggleFires')?.checked) renderFiresLayer(); else firesLayer.removeAll();
      if (document.getElementById('toggleQuakes')?.checked) renderQuakesLayer(); else quakesLayer.removeAll();
      updateSummary();
    }

    // ---- Feature Click → Detail ----

    view.on('click', async (event) => {
      const resp = await view.hitTest(event);
      const hit = resp.results.find(r => r.graphic?.attributes?._source);
      if (!hit) return;

      const attrs = hit.graphic.attributes;
      const html = buildDetailHtml(attrs);
      const isMobile = window.innerWidth <= 768;

      if (isMobile) {
        document.getElementById('mobileDetailContent').innerHTML = html;
        document.getElementById('mobileDetailSheet').open = true;
      } else {
        showDetailPanel(html, attrs._source);
      }
    });

    function buildDetailHtml(attrs) {
      const src = attrs._source;
      if (src === 'nws') {
        return `
          <div class="detail-header">
            <calcite-icon icon="exclamation-mark-triangle" scale="m"></calcite-icon>
            <h3 class="detail-title">${esc(attrs.event)}</h3>
          </div>
          <calcite-chip kind="${SA.nwsSeverityKind(attrs.severity)}" appearance="outline-fill" scale="s">${esc(attrs.severity)}</calcite-chip>
          <div class="detail-grid" style="margin-top: 12px;">
            <span class="detail-label">Area</span>
            <span class="detail-value">${esc(attrs.areaDesc)}</span>
            <span class="detail-label">Effective</span>
            <span class="detail-value">${SA.formatDate(attrs.effective)}</span>
            <span class="detail-label">Expires</span>
            <span class="detail-value">${SA.formatDate(attrs.expires)} (${SA.timeUntil(attrs.expires)})</span>
            <span class="detail-label">Urgency</span>
            <span class="detail-value">${esc(attrs.urgency)}</span>
            <span class="detail-label">Sender</span>
            <span class="detail-value">${esc(attrs.senderName)}</span>
          </div>
          ${attrs.description ? `<p style="font-size:13px; margin-top:12px; color:var(--dragon-text-secondary);">${esc(attrs.description).substring(0, 300)}${attrs.description.length > 300 ? '...' : ''}</p>` : ''}
        `;
      }
      if (src === 'fema') {
        const count = attrs._count || 1;
        const all = attrs._all || [attrs];
        return `
          <div class="detail-header">
            <calcite-icon icon="organization" scale="m"></calcite-icon>
            <h3 class="detail-title">${esc(attrs.state)} — ${count} Declaration${count > 1 ? 's' : ''}</h3>
          </div>
          <calcite-list>
            ${all.map(d => `
              <calcite-list-item label="${esc(d.declarationTitle)}" description="${SA.formatDate(d.declarationDate)} · ${esc(d.incidentType)}">
                <calcite-chip slot="content-end" scale="s" appearance="outline-fill" kind="brand">${esc(d.incidentType)}</calcite-chip>
              </calcite-list-item>
            `).join('')}
          </calcite-list>
        `;
      }
      if (src === 'fires') {
        const acres = attrs.DailyAcres || attrs.CalculatedAcres || 0;
        const pct = attrs.PercentContained ?? 0;
        return `
          <div class="detail-header">
            <calcite-icon icon="fire" scale="m"></calcite-icon>
            <h3 class="detail-title">${esc(attrs.IncidentName || 'Unknown Fire')}</h3>
          </div>
          <calcite-chip kind="${SA.containmentKind(pct)}" appearance="outline-fill" scale="s">${pct}% contained</calcite-chip>
          <div class="detail-grid" style="margin-top: 12px;">
            <span class="detail-label">Acreage</span>
            <span class="detail-value mono">${SA.formatAcres(acres)}</span>
            <span class="detail-label">Location</span>
            <span class="detail-value">${esc(attrs.POOState || '')}${attrs.POOCounty ? ', ' + esc(attrs.POOCounty) : ''}</span>
            <span class="detail-label">Personnel</span>
            <span class="detail-value mono">${SA.formatNumber(attrs.TotalIncidentPersonnel)}</span>
            <span class="detail-label">Complexity</span>
            <span class="detail-value">${esc(attrs.FireMgmtComplexity || '—')}</span>
            <span class="detail-label">Cause</span>
            <span class="detail-value">${esc(attrs.FireCause || '—')}</span>
            <span class="detail-label">Discovered</span>
            <span class="detail-value">${attrs.FireDiscoveryDateTime ? SA.formatDate(new Date(attrs.FireDiscoveryDateTime).toISOString()) : '—'}</span>
            ${attrs.ResidencesDestroyed ? `<span class="detail-label">Residences Lost</span><span class="detail-value mono">${SA.formatNumber(attrs.ResidencesDestroyed)}</span>` : ''}
          </div>
        `;
      }
      if (src === 'quakes') {
        return `
          <div class="detail-header">
            <calcite-icon icon="pin-tear" scale="m"></calcite-icon>
            <h3 class="detail-title">M${attrs.mag.toFixed(1)} Earthquake</h3>
          </div>
          ${attrs.alert ? `<calcite-chip kind="${attrs.alert === 'red' ? 'danger' : 'warning'}" appearance="outline-fill" scale="s">PAGER: ${esc(attrs.alert)}</calcite-chip>` : ''}
          <div class="detail-grid" style="margin-top: 12px;">
            <span class="detail-label">Location</span>
            <span class="detail-value">${esc(attrs.place)}</span>
            <span class="detail-label">Magnitude</span>
            <span class="detail-value mono">${attrs.mag.toFixed(1)} ${esc(attrs.magType || '')}</span>
            <span class="detail-label">Depth</span>
            <span class="detail-value mono">${attrs.depth ? attrs.depth.toFixed(1) + ' km' : '—'}</span>
            <span class="detail-label">Time</span>
            <span class="detail-value">${SA.timeAgo(new Date(attrs.time).toISOString())}</span>
            <span class="detail-label">Felt Reports</span>
            <span class="detail-value mono">${attrs.felt || '—'}</span>
            <span class="detail-label">Tsunami</span>
            <span class="detail-value">${attrs.tsunami ? 'Yes' : 'No'}</span>
          </div>
          ${attrs.url ? `<calcite-button appearance="outline" scale="s" icon-start="launch" style="margin-top:12px;" onclick="window.open('${attrs.url}','_blank')">USGS Page</calcite-button>` : ''}
        `;
      }
      return '<div class="empty-state">Unknown feature type</div>';
    }

    function showDetailPanel(html, source) {
      const panel = document.getElementById('panelDetail');
      document.getElementById('detailContent').innerHTML = html;
      panel.heading = source === 'nws' ? 'NWS Alert' : source === 'fema' ? 'FEMA Declaration' : source === 'fires' ? 'Wildfire' : 'Earthquake';
      panel.hidden = false;
      // Switch action bar to info
      setActiveAction('actionInfo');
      showPanel('panelDetail');
    }

    // ---- Helpers ----

    function severityColor(sev) {
      switch (sev) {
        case 'Extreme': return [220, 38, 38];
        case 'Severe': return [234, 138, 0];
        case 'Moderate': return [202, 178, 0];
        default: return [100, 149, 237];
      }
    }

    function getSelectedSeverities() {
      const sevs = [];
      if (document.getElementById('filterNwsExtreme')?.checked) sevs.push('Extreme');
      if (document.getElementById('filterNwsSevere')?.checked) sevs.push('Severe');
      if (document.getElementById('filterNwsModerate')?.checked) sevs.push('Moderate');
      if (document.getElementById('filterNwsMinor')?.checked) sevs.push('Minor');
      return sevs.length ? sevs : ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
    }

    function updateSummary() {
      document.getElementById('statNws').textContent = SA.state.nws.filtered.length;
      document.getElementById('statFema').textContent = SA.state.fema.filtered.length;
      document.getElementById('statFires').textContent = SA.state.fires.filtered.length;
      document.getElementById('statQuakes').textContent = SA.state.quakes.filtered.length;
    }

    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ---- Panel Switching (action bar) ----

    function setActiveAction(activeId) {
      ['actionLayers', 'actionFilter', 'actionInfo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.active = (id === activeId);
      });
    }

    function showPanel(showId) {
      ['panelLayers', 'panelFilter', 'panelDetail'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = (id !== showId);
      });
    }

    document.getElementById('actionLayers')?.addEventListener('click', () => { setActiveAction('actionLayers'); showPanel('panelLayers'); });
    document.getElementById('actionFilter')?.addEventListener('click', () => { setActiveAction('actionFilter'); showPanel('panelFilter'); });
    document.getElementById('actionInfo')?.addEventListener('click', () => { setActiveAction('actionInfo'); showPanel('panelDetail'); });
    document.getElementById('closeDetail')?.addEventListener('click', () => { setActiveAction('actionLayers'); showPanel('panelLayers'); });

    // ---- Layer Toggles ----

    ['toggleNws', 'toggleFema', 'toggleFires', 'toggleQuakes'].forEach(id => {
      document.getElementById(id)?.addEventListener('calciteSwitchChange', () => renderAllLayers());
    });
    // Mobile toggles sync
    ['toggleNwsMobile', 'toggleFemaMobile', 'toggleFiresMobile', 'toggleQuakesMobile'].forEach((mobileId, i) => {
      const desktopId = ['toggleNws', 'toggleFema', 'toggleFires', 'toggleQuakes'][i];
      document.getElementById(mobileId)?.addEventListener('calciteSwitchChange', (e) => {
        const desktop = document.getElementById(desktopId);
        if (desktop) desktop.checked = e.target.checked;
        renderAllLayers();
      });
    });

    // Filter changes
    ['filterNwsExtreme', 'filterNwsSevere', 'filterNwsModerate', 'filterNwsMinor'].forEach(id => {
      document.getElementById(id)?.addEventListener('calciteCheckboxChange', () => renderAllLayers());
    });
    document.getElementById('filterQuakeMag')?.addEventListener('calciteSliderChange', () => renderAllLayers());

    // ---- State Picker ----

    function onStateChange(sourceId) {
      SA.state.selectedStates = getComboboxValues(sourceId);
      SA.saveSelectedStates();
      syncAllPickers(sourceId);
      SA.filterBySelectedStates();
      SA.computeStatus();
      renderAllLayers();
    }

    document.getElementById('statePicker')?.addEventListener('calciteComboboxChange', () => onStateChange('statePicker'));
    document.getElementById('statePickerPanel')?.addEventListener('calciteComboboxChange', () => onStateChange('statePickerPanel'));
    document.getElementById('statePickerMobile')?.addEventListener('calciteComboboxChange', () => onStateChange('statePickerMobile'));

    function syncAllPickers(sourceId) {
      const sel = SA.state.selectedStates;
      ['statePicker', 'statePickerPanel', 'statePickerMobile'].forEach(id => {
        if (id === sourceId) return;
        const combo = document.getElementById(id);
        if (!combo) return;
        combo.querySelectorAll('calcite-combobox-item').forEach(item => {
          item.selected = sel.includes(item.value);
        });
      });
    }

    // ---- Mobile Controls ----

    document.getElementById('mobileFab')?.addEventListener('click', () => {
      document.getElementById('mobileFilterSheet').open = true;
    });
    document.getElementById('mobileFilterPanel')?.addEventListener('calcitePanelClose', () => {
      document.getElementById('mobileFilterSheet').open = false;
    });
    document.getElementById('mobileDetailPanel')?.addEventListener('calcitePanelClose', () => {
      document.getElementById('mobileDetailSheet').open = false;
    });
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
      document.getElementById('mobileSheet').open = true;
    });
    document.getElementById('mobilePanel')?.addEventListener('calcitePanelClose', () => {
      document.getElementById('mobileSheet').open = false;
    });

    // ---- Theme ----

    document.getElementById('themeToggle')?.addEventListener('click', () => { SA.toggleTheme(); updateEsriTheme(); updateThemeIcon(); });
    document.getElementById('themeToggleMobile')?.addEventListener('click', () => {
      SA.toggleTheme();
      updateEsriTheme();
      updateThemeIcon();
      document.getElementById('mobileSheet').open = false;
    });

    // ---- Data Events ----

    window.addEventListener('sitaware-data-ready', () => renderAllLayers());

    // ---- Init Data + Render ----

    SA.filterBySelectedStates();
    SA.computeStatus();

    view.when(() => {
      renderAllLayers();
      // Fetch fresh data in background
      SA.fetchAllData();
      SA.startAutoRefresh();
    });

  }); // end require

  // ---- Non-require helpers ----

  function populateStatePicker(id) {
    const combo = document.getElementById(id);
    if (!combo) return;
    Object.entries(SA.US_STATES).forEach(([abbr, name]) => {
      const item = document.createElement('calcite-combobox-item');
      item.value = abbr;
      item.textLabel = `${abbr} — ${name}`;
      if (SA.state.selectedStates.includes(abbr)) item.selected = true;
      combo.appendChild(item);
    });
  }

  function getComboboxValues(id) {
    const combo = document.getElementById(id);
    if (!combo) return [];
    return Array.from(combo.querySelectorAll('calcite-combobox-item[selected]')).map(i => i.value);
  }

  function updateEsriTheme() {
    const shell = document.querySelector('calcite-shell');
    const isDark = shell?.classList.contains('calcite-mode-dark');
    const link = document.getElementById('esriThemeLight');
    if (link) {
      link.href = isDark
        ? 'https://js.arcgis.com/4.31/esri/themes/dark/main.css'
        : 'https://js.arcgis.com/4.31/esri/themes/light/main.css';
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

  updateThemeIcon();

})();
