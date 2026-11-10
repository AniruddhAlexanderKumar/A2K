const locations = [
  { name: "Bridgend", country: "Wales, United Kingdom", years: "2011–2014", lat: 51.5058, lng: -3.5772, description: "Born in Bridgend. I also lived in Swansea, Cardiff and parts of England during this period.", photoUrl: null },
  { name: "Kuala Lumpur", country: "Malaysia", years: "2015–2016", lat: 3.1390, lng: 101.6869, description: "A new country and a new environment during my early school years.", photoUrl: null },
  { name: "Hong Kong", country: "Hong Kong", years: "2016–2017", lat: 22.3193, lng: 114.1694, description: "An international city that added another perspective to growing up across cultures.", photoUrl: null },
  { name: "Shanghai", country: "China", years: "2018–2021", lat: 31.2304, lng: 121.4737, description: "A longer chapter of school life in China, across different learning environments.", photoUrl: null },
  { name: "Jamshedpur", country: "India", years: "2021–2022", lat: 22.8046, lng: 86.2029, description: "A return to India and another change in school and surroundings.", photoUrl: null },
  { name: "Kuwait", country: "Kuwait", years: "2022–2024", lat: 29.3759, lng: 47.9774, description: "A new international school environment and another stage of adapting to a different place.", photoUrl: null },
  { name: "Bengaluru", country: "India", years: "2025", lat: 12.9716, lng: 77.5946, description: "A year in Bengaluru before the next move within India.", photoUrl: null },
  { name: "Pune", country: "India", years: "2025–Present", lat: 18.5204, lng: 73.8567, description: "My current home, where I continue school, engineering projects and sport.", photoUrl: null }
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

document.getElementById("currentYear").textContent = new Date().getFullYear();

menuToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  menuToggle.textContent = isOpen ? "×" : "☰";
});

navLinks.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  navLinks.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
  menuToggle.textContent = "☰";
}));

document.querySelectorAll(".venture-action[aria-controls]").forEach(button => {
  const details = document.getElementById(button.getAttribute("aria-controls"));
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    details.hidden = expanded;
    button.lastElementChild.textContent = expanded ? "＋" : "−";
    button.lastElementChild.setAttribute("aria-hidden", "true");
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && navLinks.classList.contains("open")) {
    navLinks.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    menuToggle.textContent = "☰";
    menuToggle.focus();
  }
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !reducedMotion) {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach(item => revealObserver.observe(item));
} else {
  revealItems.forEach(item => item.classList.add("visible"));
}

const mapElement = document.getElementById("journeyMap");
const statusElement = document.getElementById("mapStatus");
const timeline = document.getElementById("mapTimeline");
const mapStatus = message => {
  statusElement.replaceChildren(document.createTextNode(message));
  statusElement.hidden = false;
};

locations.forEach((place, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-stop";
  button.dataset.index = String(index);
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", `Select ${place.name}, ${place.country}, ${place.years}`);
  const number = document.createElement("span");
  number.className = "stop-no";
  number.textContent = String(index + 1).padStart(2, "0");
  const name = document.createElement("strong");
  name.textContent = place.name;
  const years = document.createElement("small");
  years.textContent = place.years;
  button.append(number, name, years);
  timeline.append(button);
});

let activeIndex = 0;
let map;
let markers = [];
let routeSource;
let mapReady = false;
let mapVisible = false;
let introCancelled = false;
let introStarted = false;
let introTimer = 0;
let introFrame = 0;

const coordinate = place => [place.lng, place.lat];

function greatCircle(start, end, steps = 36) {
  const toRadians = value => value * Math.PI / 180;
  const toDegrees = value => value * 180 / Math.PI;
  const [lon1, lat1] = start.map(toRadians);
  const [lon2, lat2] = end.map(toRadians);
  const distance = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));
  if (distance < 1e-8) return [start, end];
  return Array.from({ length: steps + 1 }, (_, step) => {
    const fraction = step / steps;
    const a = Math.sin((1 - fraction) * distance) / Math.sin(distance);
    const b = Math.sin(fraction * distance) / Math.sin(distance);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))];
  });
}

const fullRoute = locations.slice(1).flatMap((place, index) =>
  greatCircle(coordinate(locations[index]), coordinate(place)).slice(index === 0 ? 0 : 1)
);
const introSegments = locations.slice(1).map((place, index) =>
  greatCircle(coordinate(locations[index]), coordinate(place), 24)
);

function stopIntro() {
  introCancelled = true;
  window.clearTimeout(introTimer);
  window.cancelAnimationFrame(introFrame);
  introTimer = 0;
  introFrame = 0;
  if (mapReady) {
    routeSource.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: fullRoute } });
    markers.forEach(marker => marker.getElement().removeAttribute("hidden"));
  }
}

function animateRouteSegment(segmentIndex) {
  if (!mapReady || segmentIndex >= locations.length - 1) {
    renderPlace(locations.length - 1, false, false);
    return;
  }
  markers[segmentIndex].getElement().removeAttribute("hidden");
  const points = introSegments[segmentIndex];
  const started = performance.now();
  const duration = 260;
  const draw = now => {
    if (!mapReady || !routeSource) return;
    const progress = Math.min(1, (now - started) / duration);
    const end = Math.max(2, Math.ceil(progress * (points.length - 1)) + 1);
    const traveled = points.slice(0, end);
    routeSource.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          ...introSegments.slice(0, segmentIndex).flatMap((segment, index) => segment.slice(index === 0 ? 0 : 1)),
          ...traveled.slice(segmentIndex === 0 ? 0 : 1)
        ]
      }
    });
    if (progress < 1) {
      introFrame = window.requestAnimationFrame(draw);
    } else {
      markers[segmentIndex + 1].getElement().removeAttribute("hidden");
      introTimer = window.setTimeout(() => animateRouteSegment(segmentIndex + 1), 110);
    }
  };
  introFrame = window.requestAnimationFrame(draw);
}

function startIntro() {
  if (!mapReady || !mapVisible || introStarted || introCancelled) return;
  introStarted = true;
  if (reducedMotion) {
    stopIntro();
    renderPlace(activeIndex, false, false);
    return;
  }
  animateRouteSegment(0);
}

function renderPlace(index, moveCamera = true, scrollTimeline = true) {
  activeIndex = Math.max(0, Math.min(locations.length - 1, index));
  const place = locations[activeIndex];
  document.getElementById("placeCount").textContent = `LOCATION ${String(activeIndex + 1).padStart(2, "0")} / ${String(locations.length).padStart(2, "0")}`;
  document.getElementById("placeName").textContent = place.name;
  document.getElementById("placeCountry").textContent = place.country;
  document.getElementById("placeDate").textContent = place.years;
  document.getElementById("placeDescription").textContent = place.description;
  document.getElementById("placeStep").textContent = `${String(activeIndex + 1).padStart(2, "0")} of ${String(locations.length).padStart(2, "0")}`;
  document.getElementById("mapProgress").style.width = `${((activeIndex + 1) / locations.length) * 100}%`;
  document.getElementById("prevPlace").disabled = activeIndex === 0;
  document.getElementById("nextPlace").disabled = activeIndex === locations.length - 1;
  const photo = document.getElementById("placePhoto");
  if (place.photoUrl) {
    photo.src = place.photoUrl;
    photo.alt = `${place.name}, ${place.country}`;
    photo.hidden = false;
  } else {
    photo.removeAttribute("src");
    photo.alt = "";
    photo.hidden = true;
  }
  timeline.querySelectorAll(".map-stop").forEach((button, indexInTimeline) => {
    const selected = indexInTimeline === activeIndex;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (selected && scrollTimeline) button.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  });
  markers.forEach((marker, markerIndex) => {
    const selected = markerIndex === activeIndex;
    const element = marker.getElement();
    element.classList.toggle("active", selected);
    element.setAttribute("aria-pressed", String(selected));
  });
  if (mapReady && moveCamera) {
    map.flyTo({ center: coordinate(place), zoom: 4.7, duration: reducedMotion ? 0 : 850, essential: true });
  }
}

function showMapError() {
  mapStatus("The world map could not be loaded. Check your internet connection and reload the page.");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Reload";
  retry.className = "map-retry";
  retry.addEventListener("click", () => window.location.reload());
  statusElement.append(" ", retry);
}

function initializeMap() {
  if (map || !mapElement) return;
  if (!window.maplibregl) {
    showMapError();
    return;
  }
  try {
    map = new maplibregl.Map({
      container: "mapCanvas",
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [55, 27],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 15,
      attributionControl: true,
      cooperativeGestures: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", event => {
      if (!mapReady && event.error) showMapError();
    });
    map.on("load", () => {
      mapReady = true;
      statusElement.hidden = true;
      map.addSource("residence-route", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } }
      });
      routeSource = map.getSource("residence-route");
      map.addLayer({
        id: "residence-route-line",
        type: "line",
        source: "residence-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#4c77a8",
          "line-width": 2,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.68, 3, 0],
          "line-dasharray": [1.4, 1.4]
        }
      });
      markers = locations.map((place, index) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `map-marker${index === activeIndex ? " active" : ""}`;
        element.setAttribute("aria-label", `Select ${place.name}, ${place.country}, ${place.years}`);
        element.setAttribute("aria-pressed", String(index === activeIndex));
        if (index > 0) element.hidden = true;
        const number = document.createElement("span");
        number.className = "map-marker-number";
        number.textContent = String(index + 1).padStart(2, "0");
        const label = document.createElement("span");
        label.className = "map-marker-label";
        label.textContent = place.name;
        element.append(number, label);
        element.addEventListener("click", () => {
          stopIntro();
          renderPlace(index);
        });
        return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(coordinate(place)).addTo(map);
      });
      map.fitBounds([[-12, -1], [130, 59]], { padding: { top: 72, right: 56, bottom: 60, left: 56 }, maxZoom: 2.4, duration: 0 });
      renderPlace(activeIndex, false, false);
      if (reducedMotion) {
        stopIntro();
      } else {
        startIntro();
      }
      window.requestAnimationFrame(() => map.resize());
    });
  } catch (error) {
    console.error("World map initialization failed:", error);
    showMapError();
  }
}

timeline.addEventListener("click", event => {
  const button = event.target.closest(".map-stop");
  if (!button) return;
  stopIntro();
  renderPlace(Number(button.dataset.index));
});
document.getElementById("prevPlace").addEventListener("click", () => {
  stopIntro();
  renderPlace(activeIndex - 1);
});
document.getElementById("nextPlace").addEventListener("click", () => {
  stopIntro();
  renderPlace(activeIndex + 1);
});
document.getElementById("skipMapIntro").addEventListener("click", () => {
  stopIntro();
  renderPlace(locations.length - 1);
});

if ("IntersectionObserver" in window) {
  const mapVisibilityThreshold = 0.4;
  const mapObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      mapVisible = entry.intersectionRatio >= mapVisibilityThreshold;
      if (mapVisible) {
        initializeMap();
        startIntro();
      }
    });
  }, { threshold: mapVisibilityThreshold });
  mapObserver.observe(mapElement);
} else {
  mapVisible = true;
  initializeMap();
}

window.addEventListener("resize", () => {
  if (mapReady) map.resize();
});

if ("ResizeObserver" in window) {
  const mapResizeObserver = new ResizeObserver(() => {
    if (mapReady) map.resize();
  });
  mapResizeObserver.observe(mapElement);
}
