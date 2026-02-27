// map.js - full version 

// Initialize the map
var map = L.map('map').setView([37.5, -119.5], 6);
// Force map to resize/repaint once fully loaded
setTimeout(() => map.invalidateSize(), 200);

// Base Layer Options
var baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

const esriSat = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Tiles © Esri' }
);

const cartoLight = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  { attribution: '© Carto' }
);

const cartoDark = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  { attribution: '© Carto' }
);

// Marker for clicked location
var clickMarker = null;

// Variables (kept; not currently used)
let landslideRaster = null;

// Proj4 definition (kept)
proj4.defs(
  "EPSG:3310",
  "+proj=aea +lat_1=34 +lat_2=40.5 +lat_0=0 +lon_0=-120 +x_0=0 +y_0=-4000000 +datum=NAD83 +units=m +no_defs"
);

// About Button
document.getElementById('about-toggle').addEventListener('click', function () {
  document.getElementById('about-panel').classList.toggle('hidden');
});

function showSpinner() { document.getElementById("loading-spinner").classList.remove("hidden"); }
function hideSpinner() { document.getElementById("loading-spinner").classList.add("hidden"); }

/* ================================
   SERVICE URL CONFIG (ONE PLACE TO UPDATE)
   ================================ */

const SERVICES = {
  // CGS
  LANDSLIDE_MAPSERVER: "https://gis.conservation.ca.gov/server/rest/services/CGS/MS58_LandslideSusceptibility_Classes/MapServer",
  SHAKING_IMAGESERVER: "https://gis.conservation.ca.gov/server/rest/services/CGS/MS48_MMI_PGV_10pc50/ImageServer",

  // Fire Hazard Severity Zones
  FIRE_SRA: "https://socogis.sonomacounty.ca.gov/map/rest/services/CALFIREPublic/State_Responsibility_Area_Fire_Hazard_Severity_Zones/FeatureServer/0",
  FIRE_LRA: "https://services5.arcgis.com/t4zDNzBF9Dot8HEQ/arcgis/rest/services/FHSZ_LRA_25_/FeatureServer/0",

  // FEMA Flood
  FLOOD: "https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/S_FLD_HAZ_AR_Reduced_Set_CA_wm/FeatureServer/0",

  // CalEnviroScreen 4.0
  CALENVIRO_4: "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0",

  // Active incidents (WFIGS / NIFC)
  ACTIVE_FIRES: "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0",

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
  FIRE_STATIONS: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Structures_Medical_Emergency_Response_v1/FeatureServer/2"
};

/* ================================
   LANDSLIDE IDENTIFY CONFIG & HELPERS
   ================================ */

const CGS_LANDSLIDE_URL = SERVICES.LANDSLIDE_MAPSERVER;

const LANDSLIDE_CLASS_MAP = {
  10: { label: "X"  },
  9:  { label: "IX" },
  8:  { label: "VIII" },
  7:  { label: "VII" },
  6:  { label: "VI" },
  5:  { label: "V"  },
  4:  { label: "IV" },
  3:  { label: "III" },
  2:  { label: "II" },
  1:  { label: "I"  },
  0:  { label: "0"  }
};

function parseLandslideLabelFromIdentify(rawResponse, featureCollection) {
  if (rawResponse && Array.isArray(rawResponse.results) && rawResponse.results.length > 0) {
    const r0 = rawResponse.results[0];

    if (typeof r0.value !== "undefined" && r0.value !== null) {
      const v = Number(r0.value);
      if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
    }

    const attrs = r0.attributes || {};

    const exactKeys = ["UniqueValue.Pixel Value", "Raster.Value"];
    for (const k of exactKeys) {
      if (k in attrs && attrs[k] !== null && attrs[k] !== "") {
        const v = Number(attrs[k]);
        if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
      }
    }

    const numericLikeKey = Object.keys(attrs).find(k =>
      /(Pixel ?Value|^Value$|GRAY_INDEX|gridcode)$/i.test(k) &&
      attrs[k] !== null && attrs[k] !== "" && !Number.isNaN(Number(attrs[k]))
    );
    if (numericLikeKey) {
      const v = Number(attrs[numericLikeKey]);
      if (!Number.isNaN(v)) return LANDSLIDE_CLASS_MAP[v]?.label ?? String(v);
    }

    const textKeys = ["ClassName", "Class", "LABEL", "Class_Label", "CLASS_LABEL", "Category"];
    for (const k of textKeys) if (attrs[k]) return String(attrs[k]);
  }

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

function identifyLandslideAt(latlng, { tolerance = 8 } = {}) {
  return new Promise((resolve, reject) => {
    L.esri
      .identifyFeatures({ url: CGS_LANDSLIDE_URL })
      .on(map).at(latlng).tolerance(tolerance)
      .layers("visible:0")
      .returnGeometry(false)
      .run((error, featureCollection, rawResponse) => {
        if (error) return reject(error);
        const label = parseLandslideLabelFromIdentify(rawResponse, featureCollection);
        resolve(label);
      });
  });
}

/* ================================
   LAYERS
   ================================ */

// Dynamic Landslide Layer (visual only)
var landslideLayer = L.esri.dynamicMapLayer({
  url: SERVICES.LANDSLIDE_MAPSERVER,
  opacity: 0.6
});

// Fire Hazard Zones
function fireStyle(feature) {
  const hazard = feature.properties.FHSZ_Description;
  let color = "#ffffff";
  if (hazard === "Very High") color = "#d7191c";
  else if (hazard === "High") color = "#fdae61";
  else if (hazard === "Moderate") color = "#ffffbf";
  return { color, weight: 1, fillOpacity: 0.4 };
}

var fireHazardSRA = L.esri.featureLayer({
  url: SERVICES.FIRE_SRA,
  attribution: "CAL FIRE (SRA)",
  style: fireStyle
});

var fireHazardLRA = L.esri.featureLayer({
  url: SERVICES.FIRE_LRA,
  attribution: "CAL FIRE (LRA)",
  style: fireStyle
});

var fireHazardLayer = L.layerGroup([fireHazardSRA, fireHazardLRA]);

// Flood
var floodLayer = L.esri.featureLayer({
  url: SERVICES.FLOOD,
  style: function (feature) {
    const zone = feature.properties.ESRI_SYMBOLOGY;
    const colorMap = {
      "1% Annual Chance Flood Hazard": "#f03b20",
      "0.2% Annual Chance Flood Hazard": "#feb24c",
      "Regulatory Floodway": "#769ccd",
      "Area with Reduced Risk Due to Levee": "#e5d099"
    };
    return { color: colorMap[zone] || "#cccccc", weight: 0.5, fillOpacity: 0.6 };
  }
});

// CalEnviroScreen
var ozoneLayer = L.esri.featureLayer({
  url: SERVICES.CALENVIRO_4,
  where: "ozoneP IS NOT NULL",
  attribution: 'OEHHA - CalEnviroScreen 4.0',
  style: function (feature) {
    const p = feature.properties.ozoneP;
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
    return { color, weight: 0.5, fillOpacity: 0.6 };
  }
});

var pmLayer = L.esri.featureLayer({
  url: SERVICES.CALENVIRO_4,
  where: "pmP IS NOT NULL",
  attribution: 'OEHHA - CalEnviroScreen 4.0',
  style: function (feature) {
    const p = feature.properties.pmP;
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
    return { color, weight: 0.5, fillOpacity: 0.6 };
  }
});

var drinkP_Layer = L.esri.featureLayer({
  url: SERVICES.CALENVIRO_4,
  where: "drinkP IS NOT NULL",
  attribution: 'OEHHA - CalEnviroScreen 4.0',
  style: function (feature) {
    const p = feature.properties.drinkP;
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
    return { color, weight: 0.5, fillOpacity: 0.6 };
  }
});

/* ================================
   SHAKING (MS48: MMI from PGV, 10% in 50 years)
   ================================ */

const SHAKING_MMI_URL = SERVICES.SHAKING_IMAGESERVER;

var shakingMMI_10in50 = L.esri.imageMapLayer({
  url: SHAKING_MMI_URL,
  opacity: 0.6,
  format: 'png32',
  transparent: true,
  zIndex: 350,
  attribution: 'California Geological Survey (MS 48): MMI from PGV (10% in 50 years)',
  renderingRule: {
    rasterFunction: "Colormap",
    rasterFunctionArguments: {
      Colormap: [
        [4, 255, 255, 191],
        [5, 245, 245,   0],
        [6, 247, 206,   0],
        [7, 250, 125,   0],
        [8, 253,  42,   0],
        [9, 199,   8,   8],
        [10,140,   8,   8]
      ]
    }
  }
});

const MMI_CLASSES = {
  1: { roman: 'I',    desc: 'Not felt' },
  2: { roman: 'II',   desc: 'Weak' },
  3: { roman: 'III',  desc: 'Weak' },
  4: { roman: 'IV',   desc: 'Light' },
  5: { roman: 'V',    desc: 'Moderate' },
  6: { roman: 'VI',   desc: 'Strong' },
  7: { roman: 'VII',  desc: 'Very Strong' },
  8: { roman: 'VIII', desc: 'Severe' },
  9: { roman: 'IX',   desc: 'Violent' },
  10:{ roman: 'X+',   desc: 'Extreme' }
};

function formatMMI(mmi) {
  const intClass = Math.max(1, Math.min(10, Math.floor(mmi)));
  const meta = MMI_CLASSES[intClass] || { roman: '?', desc: 'Unknown' };
  return { label: `${meta.roman} – ${meta.desc}`, intClass, valueStr: mmi.toFixed(1) };
}

function identifyMMIAt(latlng) {
  return new Promise((resolve) => {
    L.esri.imageService({ url: SHAKING_MMI_URL })
      .identify()
      .at(latlng)
      .returnGeometry(false)
      .run((err, res, raw) => {
        if (err) return resolve(null);

        let val = null;
        if (raw && raw.pixel && typeof raw.pixel.value !== "undefined") val = Number(raw.pixel.value);
        else if (raw && typeof raw.value !== "undefined") val = Number(raw.value);
        else if (res && typeof res.value !== "undefined") val = Number(res.value);

        resolve(Number.isFinite(val) ? val : null);
      });
  });
}

/* ======= Other POIs / Infra ======= */

// Live Wildfire Incidents (FIXED)
var calFireLayer = L.esri.featureLayer({
  url: SERVICES.ACTIVE_FIRES,
  where: "POOState = 'US-CA'",
  attribution: 'National Interagency Fire Center',
  pointToLayer: function (geojson, latlng) {
    const acres = geojson.properties.IncidentSize || 0;
    let iconDetails = { size: 30, className: 'fire-icon fire-icon-sm' };
    if (acres >= 10000) iconDetails = { size: 60, className: 'fire-icon fire-icon-xl' };
    else if (acres >= 1000) iconDetails = { size: 50, className: 'fire-icon fire-icon-lg' };
    else if (acres >= 100) iconDetails = { size: 40, className: 'fire-icon fire-icon-md' };

    return L.marker(latlng, {
      icon: L.divIcon({
        html: "🔥",
        className: iconDetails.className,
        iconSize: L.point(iconDetails.size, iconDetails.size),
        iconAnchor: [iconDetails.size / 2, iconDetails.size / 2]
      })
    });
  },
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    const acres = (p.IncidentSize && p.IncidentSize > 0) ? Math.round(p.IncidentSize).toLocaleString() : 'N/A';
    const popupContent = `
      <strong>${p.IncidentName || 'Unknown Fire'}</strong><hr>
      <strong>Acres Burned:</strong> ${acres}<br>
      <strong>Percent Contained:</strong> ${p.PercentContained ?? 0}%<br>
      <strong>Cause:</strong> ${p.FireCause || 'Undetermined'}<br>
      <strong>Discovered:</strong> ${new Date(p.FireDiscoveryDateTime).toLocaleDateString()}<br>
      <strong>Last Updated:</strong> ${new Date(p.ModifiedOnDateTime_dt).toLocaleString()}
    `;
    layer.bindPopup(popupContent);
  }
});

// Caltrans highways
var highwayLayer = L.esri.featureLayer({
  url: SERVICES.NHS,
  attribution: 'Caltrans',
  style: () => ({ color: '#3c3c3c', weight: 3 })
});

var allRoadsLayer = L.esri.featureLayer({
  url: SERVICES.ALL_ROADS,
  attribution: 'Caltrans/DRISI',
  style: () => ({ color: '#5c5c5c', weight: 1 })
});

// Public schools (FIXED)
var schoolsLayer = L.esri.featureLayer({
  url: SERVICES.SCHOOLS,
  attribution: 'California Department of Education',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "🏫", className: "school-icon", iconSize: L.point(30, 30) })
  }),
  onEachFeature: function (feature, layer) {
    const p = feature.properties;
    const popup = `
      <strong>PUBLIC SCHOOL</strong><br>
      Name: ${p.SchoolName || "Unknown School"}<br>
      District: ${p.DistrictName || "Unknown District"}<br>
      Type: ${p.SchoolType || "N/A"}<br>
      Charter: ${p.Charter === "Y" ? "Yes" : (p.Charter === "N" ? "No" : "N/A")}<br>
      Magnet: ${p.Magnet === "Y" ? "Yes" : (p.Magnet === "N" ? "No" : "N/A")}<br>
      Enrollment: ${p.EnrollTotal ?? "N/A"}
    `;
    layer.bindPopup(popup);
  }
});

// Hospitals / health centers (FIXED)
var healthCentLayer = L.esri.featureLayer({
  url: SERVICES.HEALTH_CENTERS,
  attribution: 'California Office of Statewide Health Planning and Development',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "🏥", className: "healthCent-icon", iconSize: L.point(30, 30) })
  }),
  onEachFeature: function (feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>HOSPITAL/HEALTH CENTER</strong><br>
      Name: ${p.FacilityName || "Unknown Facility"}<br>
      Status: ${p.FacilityStatus || "Unknown Status"}<br>
      Type: ${p.LicenseType || "N/A"}<br>
    `);
  }
});

// Airports (FIXED)
var pubAirport = L.esri.featureLayer({
  url: SERVICES.PUBLIC_AIRPORTS,
  attribution: 'Caltrans Division of Aeronautics',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "✈️", className: "airport-icon", iconSize: L.point(30, 30) })
  }),
  onEachFeature: function (feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>PUBLIC AIRPORT</strong><br>
      Name: ${p.FACILITY || "Unknown Facility"}<br>
      Class: ${p.FNCTNLCLSS || "Unknown Class"}<br>
      Airport ID: ${p.AIRPORTID || "N/A"}<br>
    `);
  }
});

// Power plants
var powerPlants = L.esri.featureLayer({
  url: SERVICES.POWER_PLANTS,
  attribution: 'California Energy Commission',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "⚡", className: "power-icon", iconSize: L.point(30, 30) })
  }),
  onEachFeature: function (feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>POWER PLANT</strong><br>
      Name: ${p.PlantName || "Unknown Facility"}<br>
      Primary Energy Source: ${p.PriEnergySource || "Unknown"}<br>
      Capacity (MW): ${p.Capacity_Latest || "Unknown"}<br>
    `);
  }
});

// OpenChargeMap EV Chargers
const evChargersLayer = L.layerGroup();
const OCM_API_KEY = '166f53f4-5ccd-4fae-92fe-e03a24423a7b';
const OCM_ATTRIBUTION = '<a href="https://openchargemap.org/site">OpenChargeMap</a>';
let isLoadingChargers = false;

function getChargersInView() {
  if (isLoadingChargers) return;
  isLoadingChargers = true;

  const b = map.getBounds();
  const ocmUrl =
    `https://api.openchargemap.io/v3/poi/?output=json&boundingbox=(${b.getSouthWest().lat},${b.getSouthWest().lng}),(${b.getNorthEast().lat},${b.getNorthEast().lng})&maxresults=5000&key=${OCM_API_KEY}`;

  fetch(ocmUrl)
    .then(r => r.json())
    .then(data => {
      evChargersLayer.clearLayers();

      data.forEach(charger => {
        const ai = charger.AddressInfo || {};
        if (!ai.Latitude || !ai.Longitude) return;

        let totalPorts = 0;
        (charger.Connections || []).forEach(c => totalPorts += c.Quantity || 1);

        const status = charger.StatusType?.Title ?? 'Unknown Status';
        const usage  = charger.UsageType?.Title ?? 'Usage details not specified';
        const network = charger.OperatorInfo?.Title ?? 'Unknown Network';

        let equipmentInfo = '<li>No equipment details</li>';
        if (charger.Connections && charger.Connections.length > 0) {
          equipmentInfo = charger.Connections.map(conn => `
            <li>
              <strong>${conn.ConnectionType?.Title ?? 'Connector'} (${conn.Quantity || 1})</strong>:
              <br>${conn.PowerKW ?? 'N/A'} kW
              <br>${conn.Voltage ?? 'N/A'} V
              <br>${conn.Amps ?? 'N/A'} A
              <br>(${conn.Level?.Title ?? 'Level info unavailable'})
            </li>
          `).join('');
        }

        const marker = L.marker([ai.Latitude, ai.Longitude], {
          icon: L.divIcon({ html: "🔋", className: "evcharger-icon", iconSize: L.point(30, 30) })
        });

        const popupContent = `
          <div class="ev-popup">
            <strong>${ai.Title ?? 'EV Charger'}</strong><br><hr>
            <strong>Status:</strong> ${status} (${usage})<br>
            <strong>Network:</strong> ${network}<br>
            <strong>Total Charging Ports:</strong> ${totalPorts}<br><br>
            <strong>Equipment Breakdown:</strong>
            <ul>${equipmentInfo}</ul>
          </div>
        `;

        // Keep popup options simple; CSS will manage scrolling
        marker.bindPopup(popupContent, { autoPan: true }).addTo(evChargersLayer);
      });

      isLoadingChargers = false;
    })
    .catch(err => {
      console.error('OpenChargeMap error:', err);
      isLoadingChargers = false;
    });
}

map.on('moveend', getChargersInView);
getChargersInView();

// Colleges & Universities Layer (NCES, CA only, coded-value decoding)
const collegesUrl = SERVICES.COLLEGES;
const collegeDomains = {};

function buildDomainMaps(md) {
  if (!md || !Array.isArray(md.fields)) return;
  md.fields.forEach(f => {
    if (f.domain && f.domain.type === 'codedValue') {
      const dict = {};
      f.domain.codedValues.forEach(cv => { dict[String(cv.code)] = cv.name; });
      collegeDomains[f.name] = dict;
    }
  });
}

function decodeDomain(fieldName, value) {
  if (value == null) return "N/A";
  const dict = collegeDomains[fieldName];
  if (!dict) return value;
  const key = String(value);
  return dict[key] ?? value;
}

var universitiesLayer = L.esri.featureLayer({
  url: collegesUrl,
  where: "STABBR = 'CA'",
  attribution: 'National Center for Education Statistics (NCES)',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "🎓", className: 'university-icon', iconSize: L.point(30, 30) })
  }),
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    const popupContent = `
      <strong>${p.INSTNM || 'Unknown Institution'}</strong><hr>
      <strong>Highest level offering:</strong> ${decodeDomain('HLOFFER', p.HLOFFER)}<br>
      <strong>Institutional category:</strong> ${decodeDomain('INSTCAT', p.INSTCAT)}<br>
      <strong>Institution size category:</strong> ${decodeDomain('INSTSIZE', p.INSTSIZE)}<br>
      <strong>Institution has hospital:</strong> ${decodeDomain('HOSPITAL', p.HOSPITAL)}<br>
      <strong>City:</strong> ${p.CITY || 'N/A'}
    `;
    layer.bindPopup(popupContent);
  }
});

universitiesLayer.metadata((err, md) => {
  if (err) console.warn('Colleges metadata error:', err);
  else buildDomainMaps(md);
});

// Parks
var parksLayer = L.esri.featureLayer({
  url: SERVICES.PARKS,
  style: () => ({ color: "#2E8B57", weight: 1, fillOpacity: 0.5 }),
  attribution: 'CA Natural Resources Agency (CPAD)',
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>${p.LABEL_NAME || 'Unnamed Park Area'}</strong><hr>
      <strong>Access Type:</strong> ${p.ACCESS_TYP || 'N/A'}<br>
      <strong>Acres:</strong> ${p.ACRES || 'N/A'}<br>
      <strong>Manager:</strong> ${p.AGNCY_NAME || 'N/A'}
    `);
  }
});

// Fire stations
var fireStationsLayer = L.esri.featureLayer({
  url: SERVICES.FIRE_STATIONS,
  where: "STATE = 'CA'",
  attribution: 'Esri Federal Data/NGDA',
  pointToLayer: (geojson, latlng) => L.marker(latlng, {
    icon: L.divIcon({ html: "🚒", className: 'fire-station-icon', iconSize: L.point(30, 30) })
  }),
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>${p.NAME || 'Unknown Station'}</strong><hr>
      <strong>Address:</strong> ${p.ADDRESS || 'N/A'}<br>
      <strong>City:</strong> ${p.CITY || 'N/A'}<br>
    `);
  }
});

// EV charger attribution toggle
map.on('overlayadd', function(e) {
  if (e.layer === evChargersLayer) this.attributionControl.addAttribution(OCM_ATTRIBUTION);
});
map.on('overlayremove', function(e) {
  if (e.layer === evChargersLayer) this.attributionControl.removeAttribution(OCM_ATTRIBUTION);
});

// Bridges
var stateBridgesLayer = L.esri.featureLayer({
  url: SERVICES.STATE_BRIDGES,
  attribution: 'Caltrans',
  pointToLayer: (geojson, latlng) => L.circleMarker(latlng, {
    radius: 5, fillColor: "#636363", color: "#252525", weight: 1, opacity: 1, fillOpacity: 0.7
  }),
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>STATE BRIDGE</strong><br>
      Name: ${p.NAME || "Unknown Bridge"}<br>
      Year Built: ${p.YRBLT || "Unknown Year"}<br>
      Bridge ID: ${p.BRIDGE || "N/A"}
    `);
  }
});

var localBridgesLayer = L.esri.featureLayer({
  url: SERVICES.LOCAL_BRIDGES,
  attribution: 'Caltrans',
  pointToLayer: (geojson, latlng) => L.circleMarker(latlng, {
    radius: 5, fillColor: "#bdbdbd", color: "#636363", weight: 1, opacity: 1, fillOpacity: 0.7
  }),
  onEachFeature: function(feature, layer) {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>LOCAL BRIDGE</strong><br>
      Name: ${p.NAME || "Unknown Bridge"}<br>
      Year Built: ${p.YRBLT || "Unknown Year"}<br>
      Bridge ID: ${p.BRIDGE || "N/A"}
    `);
  }
});

// Zoom-based visibility
map.on('zoomend', function() {
  var z = map.getZoom();
  if (z <= 10) {
    if (map.hasLayer(allRoadsLayer)) map.removeLayer(allRoadsLayer);
    if (!map.hasLayer(highwayLayer)) map.addLayer(highwayLayer);
  } else {
    if (!map.hasLayer(allRoadsLayer)) map.addLayer(allRoadsLayer);
    if (map.hasLayer(highwayLayer)) map.removeLayer(highwayLayer);
  }
});

function toggleAtZoom(layer, minZoom) {
  map.on("zoomend", function () {
    if (map.getZoom() >= minZoom) { if (!map.hasLayer(layer)) map.addLayer(layer); }
    else { if (map.hasLayer(layer)) map.removeLayer(layer); }
  });
}

toggleAtZoom(schoolsLayer, 14);
toggleAtZoom(stateBridgesLayer, 14);
toggleAtZoom(localBridgesLayer, 14);
toggleAtZoom(healthCentLayer, 14);
toggleAtZoom(pubAirport, 14);
toggleAtZoom(powerPlants, 14);
toggleAtZoom(evChargersLayer, 14);
toggleAtZoom(universitiesLayer, 14);
toggleAtZoom(fireStationsLayer, 14);
toggleAtZoom(parksLayer, 14);

// Layer controls
L.control.layers(
  { "OpenStreetMap": baseOSM, "Esri Satellite": esriSat, "Carto Light": cartoLight, "Carto Dark": cartoDark },
  {
    // Infrastructure
    "Schools": schoolsLayer,
    "Universities": universitiesLayer,
    "Hospitals & Health Centers": healthCentLayer,
    "Power Plants": powerPlants,
    "Airports": pubAirport,
    "Fire Stations": fireStationsLayer,
    "Highway System": highwayLayer,
    "All Roads": allRoadsLayer,
    "State Bridges": stateBridgesLayer,
    "Local Bridges": localBridgesLayer,
    "EV Chargers": evChargersLayer,
    "Parks": parksLayer,

    // Hazards
    "Fire Hazard Zones": fireHazardLayer,
    "Flood Hazard Zones": floodLayer,
    "Landslide Susceptibility": landslideLayer,
    "Shaking Potential (MMI, 10%/50yr)": shakingMMI_10in50,
    "Active Fires": calFireLayer,

    // Health
    "Ozone Percentiles": ozoneLayer,
    "PM2.5 Concentration": pmLayer,
    "Water Quality": drinkP_Layer
  }
).addTo(map);

// Scale bar
L.control.scale({ imperial: true }).addTo(map);

// Home button
var homeButton = L.control({ position: 'topleft' });
homeButton.onAdd = function(map) {
  var btn = L.DomUtil.create('div', 'home-button leaflet-control leaflet-bar');
  btn.innerHTML = `<a href="#" id="home-button" title="Home"><span class="legend-icon">⌂</span></a>`;
  btn.title = 'Reset View';
  btn.onclick = function () { map.setView([37.5, -119.5], 6); };
  L.DomEvent.disableScrollPropagation(btn);
  L.DomEvent.disableClickPropagation(btn);
  return btn;
};
homeButton.addTo(map);

// Legend toggle button
const LegendToggleControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    const c = L.DomUtil.create('div', 'leaflet-bar custom-legend-button');
    c.innerHTML = '<span class="legend-icon">☰</span>';
    c.title = 'Toggle Legend';
    c.onclick = function () {
      const panels = document.getElementsByClassName('legend-panel');
      for (const p of panels) p.classList.toggle('hidden');
    };
    L.DomEvent.disableClickPropagation(c);
    return c;
  }
});
map.addControl(new LegendToggleControl());

// Legend panel
var legendPanel = L.control({ position: 'topright' });
legendPanel.onAdd = () => {
  var div = L.DomUtil.create('div', 'legend-panel hidden');
  div.addEventListener('touchstart', e => e.stopPropagation(), { passive: false });
  div.addEventListener('touchmove',  e => e.stopPropagation(), { passive: false });
  div.addEventListener('wheel',      e => e.stopPropagation(), { passive: false });
  div.innerHTML = `
    <h2>Legends</h2>
    <div class="legend-section">
      <strong>Fire Hazard Zones</strong>
      <div><i style="background:#d7191c;"></i> Very High</div>
      <div><i style="background:#fdae61;"></i> High</div>
      <div><i style="background:#ffffbf;"></i> Moderate</div>
    </div>
    <div class="legend-section">
      <strong>Flood Zones</strong>
      <div><i style="background:#f03b20;"></i> 1% Annual Chance Flood Hazard</div>
      <div><i style="background:#feb24c;"></i> 0.2% Annual Chance Flood Hazard</div>
      <div><i style="background:#e5d099;"></i> Area with Reduced Risk Due to Levee</div>
      <div><i style="background:#769ccd;"></i> Regulatory Floodway</div>
    </div>
    <div class="legend-section">
      <strong>Ozone (Ground-Level)</strong>
      <div>The indicator is the mean of summer months (May–Oct) of the daily max 8-hour ozone conc. (ppm).</div>
    </div>
    <div class="legend-section">
      <strong>PM2.5 (Fine Particulate Matter)</strong>
      <div>Annual concentration in µg/m³; higher values indicate worse air quality.</div>
    </div>
    <div class="legend-section">
      <strong>Drinking Water Contaminants</strong>
      <div>Score is the sum of contaminant and violation percentiles (higher is worse).</div>
    </div>
    <div class="legend-section">
      <strong>Landslide Susceptibility</strong>
      <div><i style="background:#9a1e13;"></i> X</div>
      <div><i style="background:#d32d1f;"></i> IX</div>
      <div><i style="background:#ec622b;"></i> VIII</div>
      <div><i style="background:#db9b36;"></i> VII</div>
      <div><i style="background:#f3ae3d;"></i> VI</div>
      <div><i style="background:#f8d58b;"></i> V</div>
      <div><i style="background:#ffffc5;"></i> III</div>
    </div>
    <div class="legend-section">
      <strong>Shaking Potential (MMI, 10%/50yr)</strong>
      <div>Values represent Modified Mercalli Intensity estimated from PGV.</div>
    </div>
  `;
  return div;
};
legendPanel.addTo(map);

// Legend scroll-wheel fix
document.addEventListener('DOMContentLoaded', function () {
  const lp = document.querySelector('.legend-panel');
  if (lp) {
    lp.addEventListener('mouseenter', () => map.scrollWheelZoom.disable());
    lp.addEventListener('mouseleave', () => map.scrollWheelZoom.enable());
  }
});

/* ================================
   DISTANCE HELPERS (for nearest zone messaging)
   ================================ */

function getDistanceToPolygonEdge(clickLatLng, feature) {
  const point = turf.point([clickLatLng.lng, clickLatLng.lat]);
  const geom = feature.geometry;

  let line;
  if (geom.type === "Polygon") line = turf.polygonToLine(turf.polygon(geom.coordinates));
  else if (geom.type === "MultiPolygon") line = turf.polygonToLine(turf.multiPolygon(geom.coordinates));
  else return NaN;

  const nearestPoint = turf.nearestPointOnLine(line, point);
  const distance = turf.distance(point, nearestPoint, { units: 'miles' });
  return distance.toFixed(2);
}

function getClosestFeatureByEdgeDistance(layer, clickLatLng, label, fieldName, _unused, callback) {
  layer.query().nearby(clickLatLng, 80467).run(function (err, fc) {
    if (!err && fc.features.length > 0) {
      let minDist = Infinity, bestFeature = null;
      fc.features.forEach(feature => {
        const dist = parseFloat(getDistanceToPolygonEdge(clickLatLng, feature));
        if (!isNaN(dist) && dist < minDist) {
          minDist = dist;
          bestFeature = feature;
        }
      });
      if (bestFeature) {
        const txt = `■ <strong>Nearest ${label}:</strong> ${bestFeature.properties[fieldName]}<br>📏 Distance: ${minDist} mi`;
        callback(txt);
        return;
      }
    }
    callback(`❌ <strong>${label}:</strong> No nearby zones found`);
  });
}

/* ================================
   CLICK EVENT: HAZARD QUERIES
   ================================ */

map.on("click", function (e) {
  showSpinner();

  if (clickMarker) map.removeLayer(clickMarker);
  clickMarker = L.marker(e.latlng).addTo(map);

  const lat = e.latlng.lat, lng = e.latlng.lng;
  document.getElementById("report-content").innerHTML =
    `<strong>Location:</strong><br>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}<br><em>Loading hazard information...</em>`;

  const results = {
    fire: "❌ Fire Hazard Zone: No data.",
    flood: "❌ Flood Hazard Zone: No data.",
    ozone: "❌ Ozone: No data.",
    pm: "❌ PM2.5: No data.",
    drink: "❌ Drinking Water: No data.",
    landslide: "❌ Landslide Susceptibility: No data.",
    shaking: "❌ Shaking Potential: No data."
  };

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
        results.shaking
      ];
      document.getElementById("report-content").innerHTML = ordered.join("<br><br>");
      hideSpinner();
    }
  }

  // --- Fire (LRA first, then SRA, then nearest across both)
  function queryContains(layer, latlng) {
    return new Promise((resolve) => {
      layer.query().contains(latlng).run((err, fc) => {
        if (err) return resolve({ err, fc: null });
        resolve({ err: null, fc });
      });
    });
  }

  function queryNearby(layer, latlng, meters = 80467) {
    return new Promise((resolve) => {
      layer.query().nearby(latlng, meters).run((err, fc) => {
        if (err) return resolve({ err, fc: null });
        resolve({ err: null, fc });
      });
    });
  }

  async function nearestByEdgeDistanceAcross(layers, latlng, label, fieldName) {
    let best = null;
    for (const lyr of layers) {
      // eslint-disable-next-line no-await-in-loop
      const { err, fc } = await queryNearby(lyr, latlng, 80467);
      if (err || !fc || !fc.features || fc.features.length === 0) continue;

      for (const f of fc.features) {
        const dist = parseFloat(getDistanceToPolygonEdge(latlng, f));
        if (!Number.isFinite(dist)) continue;
        if (!best || dist < best.dist) {
          best = {
            dist,
            text: `■ <strong>Nearest ${label}:</strong> ${f.properties[fieldName]}<br>📏 Distance: ${dist.toFixed(2)} mi`
          };
        }
      }
    }
    return best ? best.text : `❌ <strong>${label}:</strong> No nearby zones found`;
  }

  (async () => {
    try {
      const lraRes = await queryContains(fireHazardLRA, e.latlng);
      if (!lraRes.err && lraRes.fc?.features?.length) {
        const zone = lraRes.fc.features[0].properties.FHSZ_Description;
        results.fire = `■ <strong>Fire Hazard Zone (LRA):</strong><br>
This area falls within a <strong>${zone}</strong> fire hazard zone (Local Responsibility Area).`;
        checkDone();
        return;
      }

      const sraRes = await queryContains(fireHazardSRA, e.latlng);
      if (!sraRes.err && sraRes.fc?.features?.length) {
        const zone = sraRes.fc.features[0].properties.FHSZ_Description;
        results.fire = `■ <strong>Fire Hazard Zone (SRA):</strong><br>
This area falls within a <strong>${zone}</strong> fire hazard zone (State Responsibility Area).`;
        checkDone();
        return;
      }

      const nearestText = await nearestByEdgeDistanceAcross(
        [fireHazardLRA, fireHazardSRA],
        e.latlng,
        "Fire Hazard Zone",
        "FHSZ_Description"
      );

      results.fire = nearestText + `<br><em>Note: Zones are designated by CAL FIRE for planning and mitigation guidance.</em>`;
      checkDone();
    } catch (ex) {
      results.fire = "■ <strong>Fire Hazard Zone:</strong> Error fetching data.";
      checkDone();
    }
  })();

  // --- Flood
  floodLayer.query().contains(e.latlng).run((err, fc) => {
    if (!err && fc.features.length > 0) {
      const zone = fc.features[0].properties.ESRI_SYMBOLOGY;
      results.flood = `■ <strong>Flood Hazard Zone:</strong><br>
This location falls within a <strong>${zone}</strong> as designated by FEMA's National Flood Hazard Layer.<br>
Flood zones represent areas at varying levels of flood risk during extreme weather events and are used to inform insurance, development, and evacuation planning.`;
      checkDone();
    } else {
      getClosestFeatureByEdgeDistance(
        floodLayer, e.latlng, "Flood Hazard Zone", "ESRI_SYMBOLOGY",
        [], (nearestText) => {
          results.flood = nearestText + `<br><em>Note: FEMA flood zones help identify areas at high risk for flooding and guide floodplain management decisions across California.</em>`;
          checkDone();
        }
      );
    }
  });

  // --- Ozone
  ozoneLayer.query().contains(e.latlng).run((err, fc) => {
    if (!err && fc.features.length > 0) {
      const p = fc.features[0].properties;
      const ppm = p.ozone?.toFixed(3) ?? "unknown";
      const pct = p.ozoneP !== undefined ? Math.round(p.ozoneP) : "unknown";
      results.ozone = `■ <strong>Ozone (Ground-Level):</strong><br>
The indicator is the mean of summer months (May – October) of the daily maximum 8-hour ozone concentration (ppm).<br>
This census tract has a summed concentration of <strong>${ppm} ppm</strong>.<br>
The ozone percentile for this census tract is <strong>${pct}</strong> (higher than ${pct}% of CA tracts).<br>
<em>(Data from 2017 to 2019)</em>`;
    }
    checkDone();
  });

  // --- PM2.5
  pmLayer.query().contains(e.latlng).run((err, fc) => {
    if (!err && fc.features.length > 0) {
      const p = fc.features[0].properties;
      const value = p.pm?.toFixed(2) ?? "unknown";
      const pct = p.pmP !== undefined ? Math.round(p.pmP) : "unknown";
      results.pm = `■ <strong>PM2.5 (Fine Particulate Matter) Concentration:</strong><br>
This census tract has a concentration of <strong>${value} µg/m³</strong>.<br>
The PM2.5 percentile is <strong>${pct}</strong> (higher than ${pct}% of CA tracts).<br>
<em>(Data from 2015 to 2017)</em>`;
    }
    checkDone();
  });

  // --- Drinking water
  drinkP_Layer.query().contains(e.latlng).run((err, fc) => {
    if (!err && fc.features.length > 0) {
      const p = fc.features[0].properties;
      const value = p.drink?.toFixed(2) ?? "unknown";
      const pct = p.drinkP !== undefined ? Math.round(p.drinkP) : "unknown";
      results.drink = `■ <strong>Drinking Water Contaminants:</strong><br>
Score: <strong>${value}</strong> (sum of contaminant and violation percentiles).<br>
Percentile: <strong>${pct}</strong> (higher = worse).<br>
<em>(Data from 2011–2019 compliance cycle)</em>`;
    }
    checkDone();
  });

  // --- Landslide
  (async () => {
    try {
      const label = await identifyLandslideAt(e.latlng);
      if (label) {
        results.landslide = `■ <strong>Landslide Susceptibility:</strong><br>
Class <strong>${label}</strong> (California Geological Survey).`;
      }
    } catch (err) {
      results.landslide = "■ <strong>Landslide Susceptibility:</strong> Error fetching value.";
    } finally {
      checkDone();
    }
  })();

  // --- Shaking
  (async () => {
    try {
      const mmi = await identifyMMIAt(e.latlng);
      if (mmi != null) {
        const fmt = formatMMI(mmi);
        results.shaking = `■ <strong>Shaking Potential (MMI, 10%/50yr):</strong><br>
Estimated intensity: <strong>${fmt.valueStr}</strong> (${fmt.label}).`;
      }
    } catch (err) {
      results.shaking = "■ <strong>Shaking Potential:</strong> Error fetching value.";
    } finally {
      checkDone();
    }
  })();
});
