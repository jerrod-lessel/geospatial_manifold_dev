/* ============================================================================
  map.js - Geospatial Manifold (Leaflet + Esri Leaflet)
  VERSION: 2026-02-28.a

  WHAT THIS FILE DOES:
  - Initializes the map + basemap options
  - Creates ALL layers via "factory functions"
  - Registers layers in one place (LAYERS object)
  - Builds layer toggles from one place (LAYER_TOGGLES object)
  - Adds UI controls (layers control, home button, legend)
  - Implements click reporting (hazards + CalEnviroScreen indicators)
  - Implements EV charger overlay (OpenChargeMap) with:
      - debounced fetching
      - only fetch when overlay is enabled
      - one-scrollbar popup content (CSS handles this)

  DEBUGGING:
  - If UI disappears: open DevTools Console and look for errors.
============================================================================ */

/* ============================================================================
  0) GLOBAL SAFETY NETS (debug helpers)
============================================================================ */
window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
});

/* ============================================================================
  1) CENTRAL CONFIG
============================================================================ */

// Default map view (California)
const DEFAULT_VIEW = { lat: 37.5, lng: -119.5, zoom: 6 };

// Service URLs (single source of truth)
const SERVICES = {
  // CGS
  LANDSLIDE_MAPSERVER:
    "https://gis.conservation.ca.gov/server/rest/services/CGS/MS58_LandslideSusceptibility_Classes/MapServer",
  SHAKING_IMAGESERVER:
    "https://gis.conservation.ca.gov/server/rest/services/CGS/MS48_MMI_PGV_10pc50/ImageServer",

  // CGS Fault Activity Map (interactive line layers)
  // IMPORTANT: /15 is a GROUP layer (container). Use its Feature Layer children instead:
  //   17 = Quaternary Faults (Regional)  [good when zoomed out]
  //   21 = Quaternary Faults (Local)     [good when zoomed in]
  FAULTS_REGIONAL_QUAT: "https://gis.conservation.ca.gov/server/rest/services/CGS/FaultActivityMapCA/MapServer/17",
  FAULTS_LOCAL_QUAT: "https://gis.conservation.ca.gov/server/rest/services/CGS/FaultActivityMapCA/MapServer/21",

  // Fire Hazard Severity Zones
  FIRE_SRA:
    "https://socogis.sonomacounty.ca.gov/map/rest/services/CALFIREPublic/State_Responsibility_Area_Fire_Hazard_Severity_Zones/FeatureServer/0",
  FIRE_LRA: "https://services5.arcgis.com/t4zDNzBF9Dot8HEQ/arcgis/rest/services/FHSZ_LRA_25_/FeatureServer/0",

  // FEMA Flood
  FLOOD:
    "https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/S_FLD_HAZ_AR_Reduced_Set_CA_wm/FeatureServer/0",

  // CalEnviroScreen 4.0
  CALENVIRO_4:
    "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0",

  // Active incidents (WFIGS / NIFC)
  ACTIVE_FIRES:
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0",

  // Caltrans / Infra
  NHS: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/National_Highway_System/MapServer/0",
  ALL_ROADS: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/All_Roads/MapServer/0",
  PUBLIC_AIRPORTS: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHaviation/Public_Airport/FeatureServer/0",
  STATE_BRIDGES: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/State_Highway_Bridges/FeatureServer/0",
  LOCAL_BRIDGES: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Local_Bridges/FeatureServer/0",

  // Schools
  SCHOOLS: "https://services3.arcgis.com/fdvHcZVgB2QSRNkL/arcgis/rest/services/SchoolSites2324/FeatureServer/0",

  // Hospitals / health centers
  HEALTH_CENTERS: "https://services5.arcgis.com/fMBfBrOnc6OOzh7V/arcgis/rest/services/facilitylist/FeatureServer/0",

  // Power plants
  POWER_PLANTS: "https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/Power_Plant/FeatureServer/0",

  // Colleges & Universities
  COLLEGES: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/Colleges_and_Universities_View/FeatureServer/0",

  // Parks
  PARKS: "https://gis.cnra.ca.gov/arcgis/rest/services/Boundaries/CPAD_AccessType/MapServer/1",

  // Fire stations
  FIRE_STATIONS:
    "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Structures_Medical_Emergency_Response_v1/FeatureServer/2",
};

// UI knobs (tune behavior here)
const UI = {
  NEARBY_METERS: 80467, // ~50 miles (for nearest-zone fallback)
  POPUP_MAX_HEIGHT: 220,

  ZOOM_ROADS_SWITCH: 10, // <= this: highways only; > this: all roads
  ZOOM_POI_MIN: 14, // POIs appear at/above this zoom

  EV_FETCH_DEBOUNCE_MS: 600,
  EV_MAX_RESULTS: 5000,
};

// OpenChargeMap config
const OCM = {
  API_KEY: "166f53f4-5ccd-4fae-92fe-e03a24423a7b",
  ATTRIBUTION: '<a href="https://openchargemap.org/site">OpenChargeMap</a>',
};

/* ============================================================================
  2) SMALL UTILITIES
============================================================================ */

/**
 * Debounce a function so it runs only after the user pauses for `ms`.
 * Useful for expensive operations triggered by map movement.
 */
function debounce(fn, ms = 400) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Safer DOM helper: returns element or null */
function $(id) {
  return document.getElementById(id);
}

/* ============================================================================
  3) MAP INIT + BASEMAP FACTORY
============================================================================ */

/**
 * Create the Leaflet map.
 * If you ever change the HTML container id, update it here.
 */
function createMap() {
  const m = L.map("map").setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);

  // Force repaint after initial layout settles
  setTimeout(() => m.invalidateSize(), 200);

  return m;
}

/**
 * Create basemap layers.
 * Returned object is used by the basemap portion of L.control.layers().
 */
function createBasemaps() {
  const baseOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  });

  const esriSat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" }
  );

  const cartoLight = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© Carto",
  });

  const cartoDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© Carto",
  });

  return { baseOSM, esriSat, cartoLight, cartoDark };
}

/* ============================================================================
  4) UI HELPERS (About + Spinner)
============================================================================ */

function initAboutToggle() {
  $("about-toggle")?.addEventListener("click", function () {
    $("about-panel")?.classList.toggle("hidden");
  });
}

function showSpinner() {
  $("loading-spinner")?.classList.remove("hidden");
}
function hideSpinner() {
  $("loading-spinner")?.classList.add("hidden");
}

/* ============================================================================
  5) HAZARD IDENTIFY HELPERS (Landslide + Shaking)
============================================================================ */

// Landslide class mapping (adjust if service values are confirmed different later)
const LANDSLIDE_CLASS_MAP = {
  10: { label: "X" },
  9: { label: "IX" },
  8: { label: "VIII" },
  7: { label: "VII" },
  6: { label: "VI" },
  5: { label: "V" },
  4: { label: "IV" },
  3: { label: "III" },
  2: { label: "II" },
  1: { label: "I" },
  0: { label: "0" },
};

/**
 * Pull a landslide class label from a MapServer Identify response.
 * Defensive because ArcGIS responses vary by service.
 */
function parseLandslideLabelFromIdentify(rawResponse, featureCollection) {
  if (rawResponse && Array.isArray(rawResponse.results) && rawResponse.results.length > 0) {
    const r0 = rawResponse.results[0];

    // Sometimes identify includes a direct value
    if (typeof r0.value !== "undefined" && r0.value !== null) {
      const v = Number(r0.value);
      if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
    }

    const attrs = r0.attributes || {};

    // Keys you’ve seen before (service dependent)
    const exactKeys = ["UniqueValue.Pixel Value", "Raster.Value"];
    for (const k of exactKeys) {
      if (k in attrs && attrs[k] !== null && attrs[k] !== "") {
        const v = Number(attrs[k]);
        if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
      }
    }

    // Generic numeric-like key fallback
    const numericLikeKey = Object.keys(attrs).find(
      (k) =>
        /(Pixel ?Value|^Value$|GRAY_INDEX|gridcode)$/i.test(k) &&
        attrs[k] !== null &&
        attrs[k] !== "" &&
        !Number.isNaN(Number(attrs[k]))
    );

    if (numericLikeKey) {
      const v = Number(attrs[numericLikeKey]);
      if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
    }

    // Text label keys (if service returns strings)
    const textKeys = ["ClassName", "Class", "LABEL", "Class_Label", "CLASS_LABEL", "Category"];
    for (const k of textKeys) if (attrs[k]) return String(attrs[k]);
  }

  // FeatureCollection fallback
  const f = featureCollection?.features?.[0];
  const props = f?.properties || {};
  const textCandidates = ["ClassName", "Class", "LABEL", "Class_Label", "CLASS_LABEL", "Category", "CAT"];
  for (const k of textCandidates) if (props[k]) return String(props[k]);

  const numCandidates = ["Value", "GRAY_INDEX", "PixelValue", "gridcode", "CLASS_VAL"];
  for (const k of numCandidates) {
    if (props[k] != null && props[k] !== "" && !Number.isNaN(Number(props[k]))) {
      const v = Number(props[k]);
      return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
    }
  }

  return null;
}

/**
 * Identify landslide susceptibility at a point.
 * @param {object} map - Leaflet map instance
 * @param {L.LatLng} latlng
 * @param {object} options
 * @returns {Promise<string|null>}
 */
function identifyLandslideAt(map, latlng, { tolerance = 8 } = {}) {
  return new Promise((resolve, reject) => {
    L.esri
      .identifyFeatures({ url: SERVICES.LANDSLIDE_MAPSERVER })
      .on(map)
      .at(latlng)
      .tolerance(tolerance)
      .layers("visible:0")
      .returnGeometry(false)
      .run((error, featureCollection, rawResponse) => {
        if (error) return reject(error);
        resolve(parseLandslideLabelFromIdentify(rawResponse, featureCollection));
      });
  });
}

// Shaking (MMI) classes
const MMI_CLASSES = {
  1: { roman: "I", desc: "Not felt" },
  2: { roman: "II", desc: "Weak" },
  3: { roman: "III", desc: "Weak" },
  4: { roman: "IV", desc: "Light" },
  5: { roman: "V", desc: "Moderate" },
  6: { roman: "VI", desc: "Strong" },
  7: { roman: "VII", desc: "Very Strong" },
  8: { roman: "VIII", desc: "Severe" },
  9: { roman: "IX", desc: "Violent" },
  10: { roman: "X+", desc: "Extreme" },
};

function formatMMI(mmi) {
  const intClass = Math.max(1, Math.min(10, Math.floor(mmi)));
  const meta = MMI_CLASSES[intClass] || { roman: "?", desc: "Unknown" };
  return { label: `${meta.roman} – ${meta.desc}`, intClass, valueStr: mmi.toFixed(1) };
}

/**
 * Identify ImageServer pixel value at a point.
 * @returns {Promise<number|null>}
 */
function identifyMMIAt(latlng) {
  return new Promise((resolve) => {
    L.esri
      .imageService({ url: SERVICES.SHAKING_IMAGESERVER })
      .identify()
      .at(latlng)
      .returnGeometry(false)
      .run((err, res, raw) => {
        if (err) {
          console.warn("MMI identify error:", err);
          resolve(null);
          return;
        }

        let val = null;
        if (raw?.pixel && typeof raw.pixel.value !== "undefined") val = Number(raw.pixel.value);
        else if (typeof raw?.value !== "undefined") val = Number(raw.value);
        else if (typeof res?.value !== "undefined") val = Number(res.value);

        resolve(Number.isFinite(val) ? val : null);
      });
  });
}

/* ============================================================================
  6) LAYER FACTORIES
============================================================================ */

/** Fire hazard layer style */
function fireStyle(feature) {
  const hazard = feature.properties.FHSZ_Description;
  let color = "#ffffff";
  if (hazard === "Very High") color = "#d7191c";
  else if (hazard === "High") color = "#fdae61";
  else if (hazard === "Moderate") color = "#ffffbf";
  return { color, weight: 1, fillOpacity: 0.4 };
}

/**
 * Create fire layers (SRA + LRA) + a combined group for toggles.
 */
function createFireLayers() {
  const fireHazardSRA = L.esri.featureLayer({
    url: SERVICES.FIRE_SRA,
    attribution: "CAL FIRE (SRA)",
    style: fireStyle,
  });

  const fireHazardLRA = L.esri.featureLayer({
    url: SERVICES.FIRE_LRA,
    attribution: "CAL FIRE (LRA)",
    style: fireStyle,
  });

  const fireHazardLayer = L.layerGroup([fireHazardSRA, fireHazardLRA]);
  return { fireHazardSRA, fireHazardLRA, fireHazardLayer };
}

/** Create FEMA flood layer */
function createFloodLayer() {
  return L.esri.featureLayer({
    url: SERVICES.FLOOD,
    style: function (feature) {
      const zone = feature.properties.ESRI_SYMBOLOGY;
      const colorMap = {
        "1% Annual Chance Flood Hazard": "#f03b20",
        "0.2% Annual Chance Flood Hazard": "#feb24c",
        "Regulatory Floodway": "#769ccd",
        "Area with Reduced Risk Due to Levee": "#e5d099",
      };
      return { color: colorMap[zone] || "#cccccc", weight: 0.5, fillOpacity: 0.6 };
    },
  });
}

/** CalEnviroScreen percentile ramp */
function cesRamp(p) {
  let color = "#ffffcc";
  if (p >= 90) color = "#08306b";
  else if (p >= 80) color = "#08519c";
  else if (p >= 70) color = "#2171b5";
  else if (p >= 60) color = "#4292c6";
  else if (p >= 50) color = "#6baed6";
  else if (p >= 40) color = "#9ecae1";
  else if (p >= 30) color = "#c6dbef";
  else if (p >= 20) color = "#deebf7";
  else if (p >= 10) color = "#f7fbff";
  return color;
}

/**
 * Create a CalEnviroScreen layer given a percentile field.
 * @param {string} whereClause
 * @param {string} pctField - percentile field name (e.g. "ozoneP")
 */
function createCesLayer(whereClause, pctField) {
  return L.esri.featureLayer({
    url: SERVICES.CALENVIRO_4,
    where: whereClause,
    attribution: "OEHHA - CalEnviroScreen 4.0",
    style: (feature) => {
      const p = feature.properties[pctField];
      return { color: cesRamp(p), weight: 0.5, fillOpacity: 0.6 };
    },
  });
}

/** Landslide visual dynamic layer */
function createLandslideVisualLayer() {
  return L.esri.dynamicMapLayer({
    url: SERVICES.LANDSLIDE_MAPSERVER,
    opacity: 0.6,
  });
}

/**
 * Faults (interactive lines, no server labels/symbology).
 * - REGIONAL faults when zoomed out
 * - LOCAL faults when zoomed in
 *
 * Fixes:
 *  1) nicer gray / gray-blue styling
 *  2) robust attribute detection (no more "Unknown")
 */
function createFaultsInteractiveLayer(map) {
  // ---- Styling (tweak these to taste)
  function faultLineStyle() {
    return {
      color: "#8ea3b7",   // light gray-blue
      weight: 2,
      opacity: 0.9,
    };
  }

  // ---- Helpers: find the "best" property key by scoring candidates
  const NAME_HINTS = [
    "fault", "name", "faultname", "fault_name", "fault_name_",
    "faultnam", "faultnm", "faultnm_", "fault_nm", "f_name"
  ];
  const AGE_HINTS = [
    "age", "activity", "recency", "holocene", "pleistocene",
    "quaternary", "time", "ageclass", "age_class", "age_desc",
    "ageofmove", "age_of_move", "most_recent", "last_movement",
    "sliprate", "slip_rate"
  ];

  function normalizeKey(k) {
    return String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function scoreKey(key, hints) {
    const nk = normalizeKey(key);
    let score = 0;
    for (const h of hints) {
      const nh = normalizeKey(h);
      if (!nh) continue;
      if (nk === nh) score += 50;          // exact-ish match
      else if (nk.includes(nh)) score += 20; // partial match
    }
    // Prefer shorter keys when scores tie (often the “main” field)
    score += Math.max(0, 10 - Math.min(10, nk.length / 6));
    return score;
  }

  function pickBestKey(props, hints) {
    if (!props) return null;
    const keys = Object.keys(props);
    let best = null;

    for (const k of keys) {
      const v = props[k];
      if (v == null || v === "") continue;
      const s = scoreKey(k, hints);
      if (!best || s > best.score) best = { key: k, score: s };
    }

    // If nothing matched hints well, fall back to a reasonable string field
    if (!best || best.score < 15) {
      for (const k of keys) {
        const v = props[k];
        if (typeof v === "string" && v.trim().length >= 3) {
          return k;
        }
      }
      return null;
    }

    return best.key;
  }

  // ---- Bind popup with auto-detected fields per-feature (works even if layers differ)
  function bindFaultPopup(feature, layer) {
    const p = feature.properties || {};

    const nameKey = pickBestKey(p, NAME_HINTS);
    const ageKey = pickBestKey(p, AGE_HINTS);

    const nameVal = nameKey ? p[nameKey] : null;
    const ageVal = ageKey ? p[ageKey] : null;

    const nameStr = nameVal != null && String(nameVal).trim() ? String(nameVal) : "Unknown";
    const ageStr = ageVal != null && String(ageVal).trim() ? String(ageVal) : "Unknown";

    // Optional: show which fields were used (nice for debugging; set false to hide)
    const SHOW_KEYS = false;

    layer.bindPopup(`
      <strong>Fault:</strong> ${nameStr}<br>
      <strong>Age / Activity:</strong> ${ageStr}
      ${SHOW_KEYS ? `<hr style="margin:6px 0;">
        <small style="opacity:0.8">
          name field: ${nameKey || "n/a"}<br>
          age field: ${ageKey || "n/a"}
        </small>` : ""}
    `);
  }

  // ---- Build the two source layers
  const regional = L.esri.featureLayer({
    url: SERVICES.FAULTS_REGIONAL_QUAT,
    style: faultLineStyle,
    onEachFeature: bindFaultPopup,
  });

  const local = L.esri.featureLayer({
    url: SERVICES.FAULTS_LOCAL_QUAT,
    style: faultLineStyle,
    onEachFeature: bindFaultPopup,
  });

  // ---- Group that goes into the Layers control
  const group = L.layerGroup();

  // Tune this threshold if you want the swap earlier/later
  const SWITCH_ZOOM = 11;

  function syncToZoom() {
    const z = map.getZoom();
    const wantLocal = z >= SWITCH_ZOOM;

    group.clearLayers();
    group.addLayer(wantLocal ? local : regional);

    // Keep faults above filled overlays (best-effort)
    try {
      (wantLocal ? local : regional).bringToFront();
    } catch (e) {}
  }

  // Only switch while enabled
  group.on("add", () => {
    syncToZoom();
    map.on("zoomend", syncToZoom);
  });

  group.on("remove", () => {
    map.off("zoomend", syncToZoom);
    group.clearLayers();
  });

  // ---- Quick sanity check log (helps confirm the layer is actually returning attributes)
  // Toggle this true if you still see Unknowns, then click one line and read console output.
  const DEBUG_FIRST_FEATURE = false;
  function logOneFeatureOnce(layerObj, label) {
    if (!DEBUG_FIRST_FEATURE) return;
    let did = false;
    layerObj.once("load", function () {
      if (did) return;
      did = true;
      const any = layerObj.getLayers?.()[0];
      if (any && any.feature && any.feature.properties) {
        console.log(`[Faults ${label}] sample properties keys:`, Object.keys(any.feature.properties));
      } else {
        console.log(`[Faults ${label}] no sample feature found yet.`);
      }
    });
  }
  logOneFeatureOnce(regional, "regional");
  logOneFeatureOnce(local, "local");

  return group;
}

/** Shaking visual image layer */
function createShakingVisualLayer() {
  return L.esri.imageMapLayer({
    url: SERVICES.SHAKING_IMAGESERVER,
    opacity: 0.6,
    format: "png32",
    transparent: true,
    zIndex: 350,
    attribution: "California Geological Survey (MS 48): MMI from PGV (10% in 50 years)",
    renderingRule: {
      rasterFunction: "Colormap",
      rasterFunctionArguments: {
        Colormap: [
          [4, 255, 255, 191],
          [5, 245, 245, 0],
          [6, 247, 206, 0],
          [7, 250, 125, 0],
          [8, 253, 42, 0],
          [9, 199, 8, 8],
          [10, 140, 8, 8],
        ],
      },
    },
  });
}

/** Active fires layer */
function createActiveFiresLayer() {
  return L.esri.featureLayer({
    url: SERVICES.ACTIVE_FIRES,
    where: "POOState = 'US-CA'",
    attribution: "National Interagency Fire Center",
    pointToLayer: function (geojson, latlng) {
      const acres = geojson.properties.IncidentSize || 0;

      let iconDetails = { size: 30, className: "fire-icon fire-icon-sm" };
      if (acres >= 10000) iconDetails = { size: 60, className: "fire-icon fire-icon-xl" };
      else if (acres >= 1000) iconDetails = { size: 50, className: "fire-icon fire-icon-lg" };
      else if (acres >= 100) iconDetails = { size: 40, className: "fire-icon fire-icon-md" };

      return L.marker(latlng, {
        icon: L.divIcon({
          html: "🔥",
          className: iconDetails.className,
          iconSize: L.point(iconDetails.size, iconDetails.size),
          iconAnchor: [iconDetails.size / 2, iconDetails.size / 2],
        }),
      });
    },
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      const acres =
        p.IncidentSize && p.IncidentSize > 0 ? Math.round(p.IncidentSize).toLocaleString() : "N/A";

      layer.bindPopup(`
        <strong>${p.IncidentName || "Unknown Fire"}</strong><hr>
        <strong>Acres Burned:</strong> ${acres}<br>
        <strong>Percent Contained:</strong> ${p.PercentContained ?? 0}%<br>
        <strong>Cause:</strong> ${p.FireCause || "Undetermined"}<br>
        <strong>Discovered:</strong> ${
          p.FireDiscoveryDateTime ? new Date(p.FireDiscoveryDateTime).toLocaleDateString() : "N/A"
        }<br>
        <strong>Last Updated:</strong> ${
          p.ModifiedOnDateTime_dt ? new Date(p.ModifiedOnDateTime_dt).toLocaleString() : "N/A"
        }
      `);
    },
  });
}

/** Roads */
function createHighwayLayer() {
  return L.esri.featureLayer({
    url: SERVICES.NHS,
    attribution: "Caltrans",
    style: () => ({ color: "#3c3c3c", weight: 3 }),
  });
}
function createAllRoadsLayer() {
  return L.esri.featureLayer({
    url: SERVICES.ALL_ROADS,
    attribution: "Caltrans/DRISI",
    style: () => ({ color: "#5c5c5c", weight: 1 }),
  });
}

/** POI layers */
function createSchoolsLayer() {
  return L.esri.featureLayer({
    url: SERVICES.SCHOOLS,
    attribution: "California Department of Education",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, { icon: L.divIcon({ html: "🏫", className: "school-icon", iconSize: L.point(30, 30) }) }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>PUBLIC SCHOOL</strong><br>
        Name: ${p.SchoolName || "Unknown School"}<br>
        District: ${p.DistrictName || "Unknown District"}<br>
        Type: ${p.SchoolType || "N/A"}<br>
        Charter: ${p.Charter === "Y" ? "Yes" : p.Charter === "N" ? "No" : "N/A"}<br>
        Magnet: ${p.Magnet === "Y" ? "Yes" : p.Magnet === "N" ? "No" : "N/A"}<br>
        Enrollment: ${p.EnrollTotal ?? "N/A"}
      `);
    },
  });
}

function createHealthCentersLayer() {
  return L.esri.featureLayer({
    url: SERVICES.HEALTH_CENTERS,
    attribution: "California Office of Statewide Health Planning and Development",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, { icon: L.divIcon({ html: "🏥", className: "healthCent-icon", iconSize: L.point(30, 30) }) }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>HOSPITAL/HEALTH CENTER</strong><br>
        Name: ${p.FacilityName || "Unknown Facility"}<br>
        Status: ${p.FacilityStatus || "Unknown Status"}<br>
        Type: ${p.LicenseType || "N/A"}<br>
      `);
    },
  });
}

function createAirportsLayer() {
  return L.esri.featureLayer({
    url: SERVICES.PUBLIC_AIRPORTS,
    attribution: "Caltrans Division of Aeronautics",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, { icon: L.divIcon({ html: "✈️", className: "airport-icon", iconSize: L.point(30, 30) }) }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>PUBLIC AIRPORT</strong><br>
        Name: ${p.FACILITY || "Unknown Facility"}<br>
        Class: ${p.FNCTNLCLSS || "Unknown Class"}<br>
        Airport ID: ${p.AIRPORTID || "N/A"}<br>
      `);
    },
  });
}

function createPowerPlantsLayer() {
  return L.esri.featureLayer({
    url: SERVICES.POWER_PLANTS,
    attribution: "California Energy Commission",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, { icon: L.divIcon({ html: "⚡", className: "power-icon", iconSize: L.point(30, 30) }) }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>POWER PLANT</strong><br>
        Name: ${p.PlantName || "Unknown Facility"}<br>
        Primary Energy Source: ${p.PriEnergySource || "Unknown"}<br>
        Capacity (MW): ${p.Capacity_Latest || "Unknown"}<br>
      `);
    },
  });
}

function createStateBridgesLayer() {
  return L.esri.featureLayer({
    url: SERVICES.STATE_BRIDGES,
    attribution: "Caltrans",
    pointToLayer: (geojson, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        fillColor: "#636363",
        color: "#252525",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.7,
      }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>STATE BRIDGE</strong><br>
        Name: ${p.NAME || "Unknown Bridge"}<br>
        Year Built: ${p.YRBLT || "Unknown Year"}<br>
        Bridge ID: ${p.BRIDGE || "N/A"}
      `);
    },
  });
}

function createLocalBridgesLayer() {
  return L.esri.featureLayer({
    url: SERVICES.LOCAL_BRIDGES,
    attribution: "Caltrans",
    pointToLayer: (geojson, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        fillColor: "#bdbdbd",
        color: "#636363",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.7,
      }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>LOCAL BRIDGE</strong><br>
        Name: ${p.NAME || "Unknown Bridge"}<br>
        Year Built: ${p.YRBLT || "Unknown Year"}<br>
        Bridge ID: ${p.BRIDGE || "N/A"}
      `);
    },
  });
}

function createParksLayer() {
  return L.esri.featureLayer({
    url: SERVICES.PARKS,
    attribution: "CA Natural Resources Agency (CPAD)",
    style: () => ({ color: "#2E8B57", weight: 1, fillOpacity: 0.5 }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>${p.LABEL_NAME || "Unnamed Park Area"}</strong><hr>
        <strong>Access Type:</strong> ${p.ACCESS_TYP || "N/A"}<br>
        <strong>Acres:</strong> ${p.ACRES || "N/A"}<br>
        <strong>Manager:</strong> ${p.AGNCY_NAME || "N/A"}
      `);
    },
  });
}

function createFireStationsLayer() {
  return L.esri.featureLayer({
    url: SERVICES.FIRE_STATIONS,
    where: "STATE = 'CA'",
    attribution: "Esri Federal Data/NGDA",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, {
        icon: L.divIcon({ html: "🚒", className: "fire-station-icon", iconSize: L.point(30, 30) }),
      }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>${p.NAME || "Unknown Station"}</strong><hr>
        <strong>Address:</strong> ${p.ADDRESS || "N/A"}<br>
        <strong>City:</strong> ${p.CITY || "N/A"}<br>
      `);
    },
  });
}

/**
 * Colleges/universities: includes coded domain decoding.
 * Returns { layer, buildDomainMaps } so we can run metadata() later.
 */
function createUniversitiesLayer() {
  const collegeDomains = {};

  function buildDomainMaps(md) {
    if (!md || !Array.isArray(md.fields)) return;
    md.fields.forEach((f) => {
      if (f.domain && f.domain.type === "codedValue") {
        const dict = {};
        f.domain.codedValues.forEach((cv) => (dict[String(cv.code)] = cv.name));
        collegeDomains[f.name] = dict;
      }
    });
  }

  function decodeDomain(fieldName, value) {
    if (value == null) return "N/A";
    const dict = collegeDomains[fieldName];
    if (!dict) return String(value);
    return dict[String(value)] ?? String(value);
  }

  const layer = L.esri.featureLayer({
    url: SERVICES.COLLEGES,
    where: "STABBR = 'CA'",
    attribution: "National Center for Education Statistics (NCES)",
    pointToLayer: (geojson, latlng) =>
      L.marker(latlng, {
        icon: L.divIcon({ html: "🎓", className: "university-icon", iconSize: L.point(30, 30) }),
      }),
    onEachFeature: function (feature, layer) {
      const p = feature.properties;
      layer.bindPopup(`
        <strong>${p.INSTNM || "Unknown Institution"}</strong><hr>
        <strong>Highest level offering:</strong> ${decodeDomain("HLOFFER", p.HLOFFER)}<br>
        <strong>Institutional category:</strong> ${decodeDomain("INSTCAT", p.INSTCAT)}<br>
        <strong>Institution size category:</strong> ${decodeDomain("INSTSIZE", p.INSTSIZE)}<br>
        <strong>Institution has hospital:</strong> ${decodeDomain("HOSPITAL", p.HOSPITAL)}<br>
        <strong>City:</strong> ${p.CITY || "N/A"}
      `);
    },
  });

  return { layer, buildDomainMaps };
}

/**
 * EV Chargers layer factory:
 * Returns { layer, installHandlers(map) }
 */
function createEvChargersLayer(map) {
  const layer = L.layerGroup();
  let isLoading = false;

  function enabled() {
    return map.hasLayer(layer);
  }

  function fetchInView() {
    if (!enabled()) return;
    if (isLoading) return;

    isLoading = true;

    const b = map.getBounds();
    const url =
      `https://api.openchargemap.io/v3/poi/?output=json` +
      `&boundingbox=(${b.getSouthWest().lat},${b.getSouthWest().lng}),(${b.getNorthEast().lat},${b.getNorthEast().lng})` +
      `&maxresults=${UI.EV_MAX_RESULTS}` +
      `&key=${OCM.API_KEY}`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        layer.clearLayers();

        data.forEach((charger) => {
          const ai = charger.AddressInfo || {};
          if (!ai.Latitude || !ai.Longitude) return;

          let totalPorts = 0;
          (charger.Connections || []).forEach((c) => (totalPorts += c.Quantity || 1));

          const status = charger.StatusType?.Title ?? "Unknown Status";
          const usage = charger.UsageType?.Title ?? "Usage details not specified";
          const network = charger.OperatorInfo?.Title ?? "Unknown Network";

          let equipmentInfo = "<li>No equipment details</li>";
          if (charger.Connections?.length) {
            equipmentInfo = charger.Connections
              .map(
                (conn) => `
                  <li>
                    <strong>${conn.ConnectionType?.Title ?? "Connector"} (${conn.Quantity || 1})</strong>:
                    <br> ${conn.PowerKW ?? "N/A"} kW
                    <br> ${conn.Voltage ?? "N/A"} V
                    <br> ${conn.Amps ?? "N/A"} A
                    <br> (${conn.Level?.Title ?? "Level info unavailable"})
                  </li>`
              )
              .join("");
          }

          const marker = L.marker([ai.Latitude, ai.Longitude], {
            icon: L.divIcon({ html: "🔋", className: "evcharger-icon", iconSize: L.point(30, 30) }),
          });

          const popupContent = `
            <div class="ev-popup">
              <strong>${ai.Title || "EV Charger"}</strong><br><hr>
              <strong>Status:</strong> ${status} (${usage})<br>
              <strong>Network:</strong> ${network}<br>
              <strong>Total Charging Ports:</strong> ${totalPorts}<br><br>
              <strong>Equipment Breakdown:</strong>
              <ul>${equipmentInfo}</ul>
            </div>
          `;

          marker.bindPopup(popupContent, { maxHeight: UI.POPUP_MAX_HEIGHT, autoPan: true }).addTo(layer);
        });

        isLoading = false;
      })
      .catch((err) => {
        console.error("OpenChargeMap error:", err);
        isLoading = false;
      });
  }

  const fetchDebounced = debounce(fetchInView, UI.EV_FETCH_DEBOUNCE_MS);

  function installHandlers() {
    map.on("moveend", fetchDebounced);

    map.on("overlayadd", (e) => {
      if (e.layer === layer) {
        map.attributionControl.addAttribution(OCM.ATTRIBUTION);
        fetchInView(); // immediate fetch on enable
      }
    });

    map.on("overlayremove", (e) => {
      if (e.layer === layer) {
        map.attributionControl.removeAttribution(OCM.ATTRIBUTION);
        layer.clearLayers();
      }
    });
  }

  return { layer, installHandlers };
}

/* ============================================================================
  7) DISTANCE HELPERS (Turf) for nearest-zone text
============================================================================ */

function getDistanceToPolygonEdge(clickLatLng, feature) {
  const point = turf.point([clickLatLng.lng, clickLatLng.lat]);
  const geom = feature.geometry;

  let line;
  if (geom.type === "Polygon") line = turf.polygonToLine(turf.polygon(geom.coordinates));
  else if (geom.type === "MultiPolygon") line = turf.polygonToLine(turf.multiPolygon(geom.coordinates));
  else return NaN;

  const nearestPoint = turf.nearestPointOnLine(line, point);
  const distance = turf.distance(point, nearestPoint, { units: "miles" });

  return distance.toFixed(2);
}

function getClosestFeatureByEdgeDistance(layer, clickLatLng, label, fieldName, _unused, callback) {
  layer.query().nearby(clickLatLng, UI.NEARBY_METERS).run(function (err, fc) {
    if (!err && fc.features.length > 0) {
      let minDist = Infinity;
      let bestFeature = null;

      fc.features.forEach((feature) => {
        const dist = parseFloat(getDistanceToPolygonEdge(clickLatLng, feature));
        if (!isNaN(dist) && dist < minDist) {
          minDist = dist;
          bestFeature = feature;
        }
      });

      if (bestFeature) {
        callback(
          `■ <strong>Nearest ${label}:</strong> ${bestFeature.properties[fieldName]}<br>📏 Distance: ${minDist.toFixed(
            2
          )} mi`
        );
        return;
      }
    }

    callback(`❌ <strong>${label}:</strong> No nearby zones found`);
  });
}

/* ============================================================================
  8) ZOOM VISIBILITY HELPERS
============================================================================ */

/**
 * Toggle a layer on/off depending on zoom threshold.
 */
function toggleAtZoom(map, layer, minZoom) {
  map.on("zoomend", function () {
    if (map.getZoom() >= minZoom) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  });
}

/* ============================================================================
  9) UI CONTROLS (Home + Legend)
============================================================================ */

function addHomeButton(map) {
  const homeButton = L.control({ position: "topleft" });
  homeButton.onAdd = function () {
    const btn = L.DomUtil.create("div", "home-button leaflet-control leaflet-bar");
    btn.innerHTML = `<a href="#" id="home-button" title="Home"><span class="legend-icon">⌂</span></a>`;
    btn.title = "Reset View";
    btn.onclick = function () {
      map.setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
    };
    L.DomEvent.disableScrollPropagation(btn);
    L.DomEvent.disableClickPropagation(btn);
    return btn;
  };
  homeButton.addTo(map);
}

function addLegendControls(map) {
  const LegendToggleControl = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
      const c = L.DomUtil.create("div", "leaflet-bar custom-legend-button");
      c.innerHTML = '<span class="legend-icon">☰</span>';
      c.title = "Toggle Legend";
      c.onclick = function () {
        const panels = document.getElementsByClassName("legend-panel");
        for (const p of panels) p.classList.toggle("hidden");
      };
      L.DomEvent.disableClickPropagation(c);
      return c;
    },
  });
  map.addControl(new LegendToggleControl());

  const legendPanel = L.control({ position: "topright" });
  legendPanel.onAdd = () => {
    const div = L.DomUtil.create("div", "legend-panel hidden");

    div.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: false });
    div.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: false });
    div.addEventListener("wheel", (e) => e.stopPropagation(), { passive: false });

    div.innerHTML = `
      <h2>Legends</h2>
      
      <div class="legend-section">
        <strong>Flood Hazard Zones (FEMA)</strong>
            
        <div style="display:block; margin-top:6px;">
          <span class="legend-swatch" style="background:#feb24c;"></span>
          <em>0.2% Annual Chance Flood Hazard</em>
        </div>
        
        <div style="display:block; margin-top:6px;">
          <span class="legend-swatch" style="background:#f03b20;"></span>
          <em>1% Annual Chance Flood Hazard</em>
        </div>
        
        <div style="display:block; margin-top:6px;">
          <span class="legend-swatch" style="background:#769ccd;"></span>
          <em>Regulatory Floodway</em>
        </div>
      
        <div style="display:block; margin-top:6px;">
          <span class="legend-swatch" style="background:#e5d099;"></span>
          <em>Reduced Risk Due to Levee</em>
        </div>
      
        <div style="display:block; margin-top:6px;">
          FEMA NFHL zones showing flood hazard areas such as the 1% annual chance floodplain and regulatory floodway.
          Colors match the map symbology used here. Flood zones indicate mapped flood risk areas used for planning 
          and flood insurance guidance.
        </div>
      </div>

      <div class="legend-section">
        <strong>Fire Hazard Severity Zones</strong>
        
        <div class="legend-ramp">
          <span class="ramp-swatch" style="background:#ffffbf;"></span>
          <span class="ramp-swatch" style="background:#fdae61;"></span>
          <span class="ramp-swatch" style="background:#d7191c;"></span>
        </div>
        <div class="legend-ramp-labels">
          <span>Moderate</span><span>Very High</span>
        </div>
      
        <div style="display:block; margin-top:6px;">
          Fire Hazard Severity Zones indicate relative wildfire hazard based on fuels, terrain, and typical fire weather.
          (Shown here as the public SRA + LRA layers.)
        </div>
      </div>

      <div class="legend-section">
        <strong>Landslide Susceptibility (CGS)</strong>

        <div class="legend-ramp">
          <span class="ramp-swatch" style="background:#ffffc5;"></span>
          <span class="ramp-swatch" style="background:#f8d58b;"></span>
          <span class="ramp-swatch" style="background:#f3ae3d;"></span>
          <span class="ramp-swatch" style="background:#db9b36;"></span>
          <span class="ramp-swatch" style="background:#ec622b;"></span>
          <span class="ramp-swatch" style="background:#d32d1f;"></span>
          <span class="ramp-swatch" style="background:#9a1e13;"></span>
        </div>
        <div class="legend-ramp-labels">
          <span>Lower</span><span>Higher</span>
        </div>

        <div style="display:block; margin-top:6px;">
          Relative susceptibility classes. Higher classes generally indicate terrain more prone to slope failure
          under triggers like intense rainfall, earthquakes, and drainage changes.
        </div>
      </div>

      <div class="legend-section">
        <strong>Shaking Potential (MMI, 10% in 50 years)</strong>

        <div class="legend-ramp">
          <span class="ramp-swatch" style="background:rgb(255,255,191);"></span>
          <span class="ramp-swatch" style="background:rgb(245,245,0);"></span>
          <span class="ramp-swatch" style="background:rgb(247,206,0);"></span>
          <span class="ramp-swatch" style="background:rgb(250,125,0);"></span>
          <span class="ramp-swatch" style="background:rgb(253,42,0);"></span>
          <span class="ramp-swatch" style="background:rgb(199,8,8);"></span>
          <span class="ramp-swatch" style="background:rgb(140,8,8);"></span>
        </div>
        <div class="legend-ramp-labels">
          <span>MMI 4</span><span>MMI 10+</span>
        </div>

        <div style="display:block; margin-top:6px;">
          Modified Mercalli Intensity estimated from ground motion (PGV). Higher values generally mean stronger shaking
          and greater potential for damage.
        </div>
      </div>

      <div class="legend-section">
        <strong>CalEnviroScreen Indicators (Percentile)</strong>

        <div class="legend-ramp">
          <span class="ramp-swatch" style="background:#ffffcc;"></span>
          <span class="ramp-swatch" style="background:#f7fbff;"></span>
          <span class="ramp-swatch" style="background:#deebf7;"></span>
          <span class="ramp-swatch" style="background:#c6dbef;"></span>
          <span class="ramp-swatch" style="background:#9ecae1;"></span>
          <span class="ramp-swatch" style="background:#6baed6;"></span>
          <span class="ramp-swatch" style="background:#4292c6;"></span>
          <span class="ramp-swatch" style="background:#2171b5;"></span>
          <span class="ramp-swatch" style="background:#08519c;"></span>
          <span class="ramp-swatch" style="background:#08306b;"></span>
        </div>
        <div class="legend-ramp-labels">
          <span>0–10</span><span>90–100</span>
        </div>

        <div style="display:block; margin-top:6px;">
          Percentiles compare census tracts statewide. Higher percentiles generally indicate higher burden/worse conditions.
          The map report shows both the raw value (when available) and the percentile.
        </div>
        <div style="display:block; margin-top:6px;">
          <em>Ozone:</em> summer-season ozone summary.<br>
          <em>PM2.5:</em> annual average fine particulates.<br>
          <em>Drinking Water:</em> combined contaminant + violation score.
        </div>
      </div>

      <div class="legend-section">
        <strong>Active Fires (WFIGS / NIFC)</strong>
        <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
          <span style="font-size:16px;">🔥</span><span>Small incident</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
          <span style="font-size:26px;">🔥</span><span>Medium incident</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
          <span style="font-size:40px;">🔥</span><span>Large incident</span>
        </div>
        <div style="display:block; margin-top:6px;">
          Symbol size scales with reported fire size (acres) — larger 🔥 generally means a larger incident.
        </div>
      </div>
      
      <div class="legend-section">
        <strong>Faults</strong>
        <div style="display:block; margin-top:6px;">
          Click fault lines to see the fault name and age/activity. This layer swaps between “regional” and “local”
          fault lines as you zoom in/out so you get appropriate detail at each scale.
        </div>
      </div>
    `;

    return div;
  };
  legendPanel.addTo(map);

  document.addEventListener("DOMContentLoaded", function () {
    const lp = document.querySelector(".legend-panel");
    if (lp) {
      lp.addEventListener("mouseenter", () => map.scrollWheelZoom.disable());
      lp.addEventListener("mouseleave", () => map.scrollWheelZoom.enable());
    }
  });
}

/* ============================================================================
  10) CLICK REPORT
============================================================================ */

function installClickReport(map, layers) {
  let clickMarker = null;

  map.on("click", function (e) {
    showSpinner();

    if (clickMarker) map.removeLayer(clickMarker);
    clickMarker = L.marker(e.latlng).addTo(map);

    const lat = e.latlng.lat,
      lng = e.latlng.lng;

    const reportEl = $("report-content");
    if (reportEl) {
      reportEl.innerHTML = `<strong>Location:</strong><br>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(
        5
      )}<br><em>Loading hazard information...</em>`;
    }

    const results = {
      fire: "❌ Fire Hazard Zone: No data.",
      flood: "❌ Flood Hazard Zone: No data.",
      ozone: "❌ Ozone: No data.",
      pm: "❌ PM2.5: No data.",
      drink: "❌ Drinking Water: No data.",
      landslide: "❌ Landslide Susceptibility: No data.",
      shaking: "❌ Shaking Potential: No data.",
    };

    // ===============================
    // Report formatting helpers
    // ===============================
    function fmtFireInside(zone, whichArea /* "SRA" or "LRA" */) {
      return `■ <strong>Fire Hazard Zone (${whichArea}):</strong><br>
This location is within a <strong>${zone}</strong> Fire Hazard Severity Zone.<br>
These zones reflect expected fire behavior based on fuels, terrain, and typical fire weather, and are used to guide planning and mitigation.`;
    }

    function fmtFloodInside(zone) {
      return `■ <strong>Flood Hazard Zone:</strong><br>
This location is within <strong>${zone}</strong> (FEMA NFHL).<br>
Flood zones represent areas with varying flood probabilities and are used for floodplain management, insurance, and development decisions.`;
    }

    function fmtCalEnviro(indicatorKey, title, valueStr, pctStr, noteStr) {
      const EXPLAIN = {
        ozone: "Ground-level ozone is a lung irritant. This indicator summarizes warm-season ozone conditions (often tied to smog).",
        pm: "PM2.5 is tiny airborne particulate pollution that can get deep into your lungs. Higher values generally mean worse air quality.",
        drink: "Drinking water contaminants combines contaminant and violation info into a single score (higher is worse).",
      };

      const explainText = EXPLAIN[indicatorKey] || "Environmental indicator from CalEnviroScreen.";

      return `■ <strong>${title}:</strong><br>
${explainText}<br>
<strong>Value:</strong> ${valueStr}<br>
<strong>Percentile:</strong> ${pctStr}<br>
<span style="opacity:0.9">${noteStr}</span>`;
    }

    function fmtLandslide(label) {
      return `■ <strong>Landslide Susceptibility:</strong><br>
Class <strong>${label}</strong> (California Geological Survey).<br>
Higher classes generally indicate terrain more prone to slope failure under triggers like intense rainfall, earthquakes, and drainage changes.`;
    }

    function fmtShaking(_mmi, fmt) {
      return `■ <strong>Shaking Potential (MMI, 10%/50yr):</strong><br>
Estimated intensity: <strong>${fmt.valueStr}</strong> (${fmt.label}).<br>
MMI is a human-impact scale: higher values generally mean stronger shaking and greater potential for damage.`;
    }

    let completed = 0;
    const totalTasks = Object.keys(results).length;

    function checkDone() {
      completed++;
      if (completed === totalTasks) {
        const ordered = [
          results.fire,
          results.flood,
          results.ozone,
          results.pm,
          results.drink,
          results.landslide,
          results.shaking,
        ];
        if (reportEl) reportEl.innerHTML = ordered.join("<br><br>");
        hideSpinner();
      }
    }

    // ---- Fire: LRA contains -> SRA contains -> nearest across both
    function queryContains(layer, latlng) {
      return new Promise((resolve) => {
        layer.query().contains(latlng).run((err, fc) => resolve({ err, fc }));
      });
    }

    function queryNearby(layer, latlng, meters = UI.NEARBY_METERS) {
      return new Promise((resolve) => {
        layer.query().nearby(latlng, meters).run((err, fc) => resolve({ err, fc }));
      });
    }

    async function nearestByEdgeDistanceAcross(layersArr, latlng, label, fieldName) {
      let best = null;

      for (const lyr of layersArr) {
        // eslint-disable-next-line no-await-in-loop
        const { err, fc } = await queryNearby(lyr, latlng, UI.NEARBY_METERS);
        if (err || !fc?.features?.length) continue;

        for (const f of fc.features) {
          const dist = parseFloat(getDistanceToPolygonEdge(latlng, f));
          if (!Number.isFinite(dist)) continue;

          if (!best || dist < best.dist) {
            best = {
              dist,
              text: `■ <strong>Nearest ${label}:</strong> ${f.properties[fieldName]}<br>📏 Distance: ${dist.toFixed(
                2
              )} mi`,
            };
          }
        }
      }

      return best ? best.text : `❌ <strong>${label}:</strong> No nearby zones found`;
    }

    (async () => {
      try {
        const lraRes = await queryContains(layers.fireHazardLRA, e.latlng);
        if (!lraRes.err && lraRes.fc?.features?.length) {
          const zone = lraRes.fc.features[0].properties.FHSZ_Description;
          results.fire = fmtFireInside(zone, "LRA");
          return;
        }

        const sraRes = await queryContains(layers.fireHazardSRA, e.latlng);
        if (!sraRes.err && sraRes.fc?.features?.length) {
          const zone = sraRes.fc.features[0].properties.FHSZ_Description;
          results.fire = fmtFireInside(zone, "SRA");
          return;
        }

        const nearestText = await nearestByEdgeDistanceAcross(
          [layers.fireHazardLRA, layers.fireHazardSRA],
          e.latlng,
          "Fire Hazard Zone",
          "FHSZ_Description"
        );

        results.fire =
          nearestText + `<br><em>Note: Zones are designated by CAL FIRE for planning and mitigation guidance.</em>`;
      } catch (ex) {
        results.fire = "■ <strong>Fire Hazard Zone:</strong> Error fetching data.";
      } finally {
        checkDone();
      }
    })();

    // ---- Flood: contains -> nearest
    layers.floodLayer.query().contains(e.latlng).run((err, fc) => {
      try {
        if (!err && fc.features.length > 0) {
          const zone = fc.features[0].properties.ESRI_SYMBOLOGY;
          results.flood = fmtFloodInside(zone);
        } else {
          getClosestFeatureByEdgeDistance(
            layers.floodLayer,
            e.latlng,
            "Flood Hazard Zone",
            "ESRI_SYMBOLOGY",
            [],
            (txt) => {
              results.flood = txt + `<br><em>Note: FEMA flood zones guide insurance and floodplain decisions.</em>`;
              checkDone();
            }
          );
          return; // callback will call checkDone
        }
      } catch (e2) {
        results.flood = "■ <strong>Flood Hazard Zone:</strong> Error fetching data.";
      }
      checkDone();
    });

    // ---- Ozone
    layers.ozoneLayer.query().contains(e.latlng).run((err, fc) => {
      try {
        if (!err && fc.features.length > 0) {
          const p = fc.features[0].properties;
          const ppm = p.ozone?.toFixed(3) ?? "unknown";
          const pct = p.ozoneP !== undefined ? Math.round(p.ozoneP) : "unknown";
          results.ozone = fmtCalEnviro(
            "ozone",
            "Ozone (Ground-Level)",
            `${ppm} ppm`,
            `${pct}`,
            "<em>(Data from 2017–2019)</em>"
          );
        }
      } catch (e2) {
        results.ozone = "■ <strong>Ozone:</strong> Error fetching data.";
      }
      checkDone();
    });

    // ---- PM2.5
    layers.pmLayer.query().contains(e.latlng).run((err, fc) => {
      try {
        if (!err && fc.features.length > 0) {
          const p = fc.features[0].properties;
          const value = p.pm?.toFixed(2) ?? "unknown";
          const pct = p.pmP !== undefined ? Math.round(p.pmP) : "unknown";
          results.pm = fmtCalEnviro(
            "pm",
            "PM2.5 (Fine Particulate Matter)",
            `${value} µg/m³`,
            `${pct}`,
            "<em>(Data from 2015–2017)</em>"
          );
        }
      } catch (e2) {
        results.pm = "■ <strong>PM2.5:</strong> Error fetching data.";
      }
      checkDone();
    });

    // ---- Drinking water
    layers.drinkLayer.query().contains(e.latlng).run((err, fc) => {
      try {
        if (!err && fc.features.length > 0) {
          const p = fc.features[0].properties;
          const value = p.drink?.toFixed(2) ?? "unknown";
          const pct = p.drinkP !== undefined ? Math.round(p.drinkP) : "unknown";
          results.drink = fmtCalEnviro(
            "drink",
            "Drinking Water Contaminants",
            `${value}`,
            `${pct}`,
            "<em>(Data from 2011–2019 compliance cycle)</em>"
          );
        }
      } catch (e2) {
        results.drink = "■ <strong>Drinking Water:</strong> Error fetching data.";
      }
      checkDone();
    });

    // ---- Landslide identify
    (async () => {
      try {
        const label = await identifyLandslideAt(map, e.latlng);
        if (label) {
          results.landslide = fmtLandslide(label);
        }
      } catch (err2) {
        results.landslide = "■ <strong>Landslide Susceptibility:</strong> Error fetching value.";
      } finally {
        checkDone();
      }
    })();

    // ---- Shaking identify
    (async () => {
      try {
        const mmi = await identifyMMIAt(e.latlng);
        if (mmi != null) {
          const fmt = formatMMI(mmi);
          results.shaking = fmtShaking(mmi, fmt);
        }
      } catch (err2) {
        results.shaking = "■ <strong>Shaking Potential:</strong> Error fetching value.";
      } finally {
        checkDone();
      }
    })();
  });
}

/* ============================================================================
  11) BOOTSTRAP (build everything in a controlled order)
============================================================================ */

(function main() {
  // 1) Basic UI setup
  initAboutToggle();

  // 2) Create map + basemaps
  const map = createMap();
  const basemaps = createBasemaps();

  // Add a default basemap
  basemaps.baseOSM.addTo(map);

  // 3) Create layers via factories (registry pattern)
  const fire = createFireLayers();
  const ev = createEvChargersLayer(map);
  const universities = createUniversitiesLayer();

  // LAYERS: single place to find every layer later
  const LAYERS = {
    // Hazards
    landslideLayer: createLandslideVisualLayer(),
    shakingLayer: createShakingVisualLayer(),
    faultsLayer: createFaultsInteractiveLayer(map), // ✅ clickable + simple lines + zoom switching
    floodLayer: createFloodLayer(),
    fireHazardSRA: fire.fireHazardSRA,
    fireHazardLRA: fire.fireHazardLRA,
    fireHazardLayer: fire.fireHazardLayer,
    activeFires: createActiveFiresLayer(),

    // Env
    ozoneLayer: createCesLayer("ozoneP IS NOT NULL", "ozoneP"),
    pmLayer: createCesLayer("pmP IS NOT NULL", "pmP"),
    drinkLayer: createCesLayer("drinkP IS NOT NULL", "drinkP"),

    // Roads
    highwayLayer: createHighwayLayer(),
    allRoadsLayer: createAllRoadsLayer(),

    // POIs
    schoolsLayer: createSchoolsLayer(),
    healthCenters: createHealthCentersLayer(),
    airports: createAirportsLayer(),
    powerPlants: createPowerPlantsLayer(),
    stateBridges: createStateBridgesLayer(),
    localBridges: createLocalBridgesLayer(),
    parks: createParksLayer(),
    fireStations: createFireStationsLayer(),
    universities: universities.layer,

    // EV
    evChargers: ev.layer,
  };

  // 4) Install EV handlers (keeps EV logic isolated)
  ev.installHandlers();

  // 5) Roads zoom behavior (highway vs all roads)
  map.on("zoomend", function () {
    const z = map.getZoom();
    if (z <= UI.ZOOM_ROADS_SWITCH) {
      if (map.hasLayer(LAYERS.allRoadsLayer)) map.removeLayer(LAYERS.allRoadsLayer);
      if (!map.hasLayer(LAYERS.highwayLayer)) map.addLayer(LAYERS.highwayLayer);
    } else {
      if (!map.hasLayer(LAYERS.allRoadsLayer)) map.addLayer(LAYERS.allRoadsLayer);
      if (map.hasLayer(LAYERS.highwayLayer)) map.removeLayer(LAYERS.highwayLayer);
    }
  });

  // 6) POIs only show when zoomed in
  toggleAtZoom(map, LAYERS.schoolsLayer, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.stateBridges, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.localBridges, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.healthCenters, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.airports, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.powerPlants, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.evChargers, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.universities, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.fireStations, UI.ZOOM_POI_MIN);
  toggleAtZoom(map, LAYERS.parks, UI.ZOOM_POI_MIN);

  // 7) Layer controls (single source: LAYER_TOGGLES)
  const LAYER_TOGGLES = {
    // Infrastructure
    Schools: LAYERS.schoolsLayer,
    Universities: LAYERS.universities,
    "Hospitals & Health Centers": LAYERS.healthCenters,
    "Power Plants": LAYERS.powerPlants,
    Airports: LAYERS.airports,
    "Fire Stations": LAYERS.fireStations,
    "Highway System": LAYERS.highwayLayer,
    "All Roads": LAYERS.allRoadsLayer,
    "State Bridges": LAYERS.stateBridges,
    "Local Bridges": LAYERS.localBridges,
    "EV Chargers": LAYERS.evChargers,
    Parks: LAYERS.parks,

    // Hazards
    "Fire Hazard Zones": LAYERS.fireHazardLayer,
    "Flood Hazard Zones": LAYERS.floodLayer,
    "Landslide Susceptibility": LAYERS.landslideLayer,
    "Faults": LAYERS.faultsLayer,
    "Shaking Potential (MMI, 10%/50yr)": LAYERS.shakingLayer,
    "Active Fires": LAYERS.activeFires,

    // Health/Env
    "Ozone Percentiles": LAYERS.ozoneLayer,
    "PM2.5 Concentration": LAYERS.pmLayer,
    "Water Quality": LAYERS.drinkLayer,
  };

  L.control.layers(
    {
      OpenStreetMap: basemaps.baseOSM,
      "Esri Satellite": basemaps.esriSat,
      "Carto Light": basemaps.cartoLight,
      "Carto Dark": basemaps.cartoDark,
    },
    LAYER_TOGGLES
  ).addTo(map);

  // 8) Scale, home, legend
  L.control.scale({ imperial: true }).addTo(map);
  addHomeButton(map);
  addLegendControls(map);

  // 9) University domain decoding (metadata fetch after layer is created)
  LAYERS.universities.metadata((err, md) => {
    if (err) console.warn("Colleges metadata error:", err);
    else universities.buildDomainMaps(md);
  });

  // 10) Click reporting
  installClickReport(map, {
    fireHazardSRA: LAYERS.fireHazardSRA,
    fireHazardLRA: LAYERS.fireHazardLRA,
    floodLayer: LAYERS.floodLayer,
    ozoneLayer: LAYERS.ozoneLayer,
    pmLayer: LAYERS.pmLayer,
    drinkLayer: LAYERS.drinkLayer,
  });

  // 11) Optional: start roads behavior right away (forces initial state)
  map.fire("zoomend");
})();
