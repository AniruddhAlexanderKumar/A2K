const reader = document.getElementById("researchPdfReader");

if (reader) {
  const originalPdf = document.getElementById("original-pdf");
  const toolbar = reader.querySelector(".research-pdf-toolbar");
  const pagesElement = reader.querySelector("[data-pdf-pages]");
  const statusElement = reader.querySelector("[data-pdf-status]");
  const pageInput = reader.querySelector("[data-pdf-page]");
  const totalPageElements = [
    reader.querySelector("[data-pdf-total]"),
    document.querySelector("[data-pdf-total-label]")
  ];
  const previousPageButton = reader.querySelector("[data-pdf-previous-page]");
  const nextPageButton = reader.querySelector("[data-pdf-next-page]");
  const zoomLevel = reader.querySelector("[data-pdf-zoom-level]");
  const progressElement = reader.querySelector("[data-pdf-progress]");
  const searchForm = reader.querySelector("[data-pdf-search]");
  const searchInput = reader.querySelector("[data-pdf-search-input]");
  const searchStatus = reader.querySelector("[data-pdf-search-status]");
  const searchPreviousButton = reader.querySelector("[data-pdf-search-previous]");
  const searchNextButton = reader.querySelector("[data-pdf-search-next]");
  const fullscreenButton = reader.querySelector("[data-pdf-fullscreen]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let pdfDocument;
  let pdfjs;
  let pageRecords = [];
  let currentPage = 1;
  let zoom = 1;
  let scrollFrame = 0;
  let searchTimer = 0;
  let searchRequest = 0;
  let searchMatches = [];
  let activeMatch = -1;

  function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
    statusElement.hidden = !message;
  }

  function setSearchStatus(message) {
    searchStatus.textContent = message;
    searchPreviousButton.disabled = !searchMatches.length;
    searchNextButton.disabled = !searchMatches.length;
  }

  function updateControls() {
    pageInput.value = String(currentPage);
    pageInput.max = String(pageRecords.length);
    previousPageButton.disabled = currentPage <= 1;
    nextPageButton.disabled = currentPage >= pageRecords.length;
    const percentage = Math.round(zoom * 100);
    zoomLevel.textContent = zoom === 1 ? "Fit" : `${percentage}%`;
    reader.querySelector("[data-pdf-zoom-out]").disabled = zoom <= 0.6;
    reader.querySelector("[data-pdf-zoom-in]").disabled = zoom >= 2.5;
  }

  function readingEdge() {
    return pagesElement.getBoundingClientRect().top + parseFloat(getComputedStyle(pagesElement).paddingTop);
  }

  function updateProgress() {
    if (!pageRecords.length) return;

    const anchor = readingEdge() + 1;
    let activeIndex = 0;
    for (let index = 1; index < pageRecords.length; index++) {
      if (pageRecords[index].element.getBoundingClientRect().top > anchor) break;
      activeIndex = index;
    }
    const bounds = pageRecords[activeIndex].element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (anchor - bounds.top) / bounds.height));
    const atEnd = pagesElement.scrollTop + pagesElement.clientHeight >= pagesElement.scrollHeight - 1;
    currentPage = atEnd ? pageRecords.length : activeIndex + 1;
    let progress = atEnd ? 100 : ((activeIndex + fraction) / pageRecords.length) * 100;

    progress = Math.round(progress * 10) / 10;
    progressElement.setAttribute("aria-valuenow", String(Math.round(progress)));
    progressElement.setAttribute("aria-valuetext", `${Math.round(progress)}% read`);
    progressElement.querySelector("span").style.width = `${progress}%`;
    updateControls();
  }

  function scheduleProgressUpdate() {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      updateProgress();
      renderNearbyPages();
    });
  }

  function renderNearbyPages() {
    if (!pageRecords.length) return;
    const viewport = pagesElement.getBoundingClientRect();
    for (const record of pageRecords) {
      const bounds = record.element.getBoundingClientRect();
      const isNearViewport = bounds.bottom >= viewport.top - viewport.height && bounds.top <= viewport.bottom + viewport.height;
      if (isNearViewport) renderPage(record);
      else if (Math.abs(record.number - currentPage) > 2) releasePage(record);
    }
  }

  function createPlaceholder(pageNumber) {
    const placeholder = document.createElement("span");
    placeholder.className = "research-pdf-placeholder";
    placeholder.textContent = `Loading page ${pageNumber}`;
    return placeholder;
  }

  function releasePage(record) {
    if (!record.rendered && !record.renderTask) return;
    record.generation++;
    record.renderTask?.cancel();
    record.renderTask = null;
    record.renderPromise = null;
    record.rendered = false;
    record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    record.element.classList.remove("is-error");
    record.element.replaceChildren(record.placeholder);
  }

  function drawSearchHighlights(match, record) {
    record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    const cssWidth = record.element.clientWidth;
    const viewport = record.page.getViewport({ scale: cssWidth / record.width });
    for (const segment of match.segments) {
      const transform = pdfjs.Util.transform(viewport.transform, segment.item.transform);
      const height = Math.max(segment.item.height * viewport.scale, Math.hypot(transform[2], transform[3]));
      const highlight = document.createElement("span");
      highlight.className = "pdf-search-highlight";
      highlight.setAttribute("aria-hidden", "true");
      highlight.style.left = `${transform[4]}px`;
      highlight.style.top = `${transform[5] - height}px`;
      highlight.style.width = `${Math.max(segment.item.width * viewport.scale, 2)}px`;
      highlight.style.height = `${height}px`;
      record.element.append(highlight);
    }
  }

  async function renderPage(record, force = false) {
    if (record.renderPromise && !force) return record.renderPromise;
    if (record.rendered && !force) return;

    if (force) record.renderTask?.cancel();
    const generation = ++record.generation;
    record.element.dataset.renderState = "preparing";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Page ${record.number} of ${pageRecords.length}`);
    record.element.classList.remove("is-error");
    record.element.replaceChildren(canvas, record.placeholder);

    const renderPromise = (async () => {
      try {
        const page = record.page || await pdfDocument.getPage(record.number);
        const cssWidth = record.element.clientWidth;
        const viewport = page.getViewport({ scale: cssWidth / record.width });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext("2d", { alpha: false });

        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);

        const task = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
          background: "#ffffff"
        });
        record.renderTask = task;
        record.element.dataset.renderState = "rendering";
        await task.promise;

        if (generation !== record.generation) return;
        record.placeholder.remove();
        record.rendered = true;
        record.element.dataset.renderState = "rendered";
        const highlightedMatch = searchMatches[activeMatch];
        if (highlightedMatch?.page === record.number) drawSearchHighlights(highlightedMatch, record);
      } catch (error) {
        if (generation !== record.generation || error?.name === "RenderingCancelledException") return;
        record.element.classList.add("is-error");
        record.element.dataset.renderState = "failed";
        record.placeholder.textContent = `Page ${record.number} could not be rendered.`;
        showPdfFallback(`Page ${record.number} could not be rendered.`);
      } finally {
        if (generation === record.generation) record.renderTask = null;
      }
    })();

    record.renderPromise = renderPromise;
    await renderPromise;
    if (record.renderPromise === renderPromise) record.renderPromise = null;
  }

  function scrollToPage(pageNumber, behavior = reduceMotion ? "auto" : "smooth") {
    if (!pageRecords.length) return;
    const number = Math.max(1, Math.min(pageRecords.length, Math.trunc(Number(pageNumber)) || 1));
    const pageTop = pageRecords[number - 1].element.getBoundingClientRect().top;
    pagesElement.scrollTo({ top: pagesElement.scrollTop + pageTop - readingEdge(), behavior });
    currentPage = number;
    updateControls();
  }

  function updateRenderedPages() {
    for (const record of pageRecords) {
      if (record.rendered || record.renderTask) renderPage(record, true);
    }
    scheduleProgressUpdate();
  }

  function setZoom(value) {
    zoom = value;
    reader.style.setProperty("--pdf-zoom", zoom);
    scrollToPage(currentPage, "auto");
    updateRenderedPages();
  }

  async function findMatches() {
    const request = ++searchRequest;
    const query = searchInput.value.trim().toLocaleLowerCase();
    searchMatches = [];
    activeMatch = -1;
    clearSearchHighlights();

    if (!query) {
      setSearchStatus("");
      return;
    }

    setSearchStatus("Searching…");
    const matches = [];

    try {
      for (const record of pageRecords) {
        if (request !== searchRequest) return;

        if (!record.text) {
          const content = await record.page.getTextContent();
          let text = "";
          record.textSegments = content.items
            .filter(item => typeof item.str === "string" && item.str.length)
            .map(item => {
              if (text) text += " ";
              const start = text.length;
              text += item.str;
              return { start, end: text.length, item };
            });
          record.text = text.toLocaleLowerCase();
        }

        let offset = record.text.indexOf(query);
        while (offset !== -1) {
          const end = offset + query.length;
          const segments = record.textSegments.filter(segment => segment.end > offset && segment.start < end);
          matches.push({ page: record.number, offset, segments });
          offset = record.text.indexOf(query, offset + query.length);
        }

        if (record.number % 4 === 0) {
          setSearchStatus(`Searching ${record.number}/${pageRecords.length}…`);
          await new Promise(resolve => window.setTimeout(resolve, 0));
        }
      }

      if (request !== searchRequest) return;
      searchMatches = matches;
      if (!searchMatches.length) {
        setSearchStatus("No matches");
        return;
      }

      activeMatch = 0;
      showMatch();
    } catch (error) {
      if (request === searchRequest) setSearchStatus("Search failed");
      console.error("Could not search the research paper.", error);
    }
  }

  function clearSearchHighlights() {
    for (const record of pageRecords) {
      record.element.querySelectorAll(".pdf-search-highlight").forEach(highlight => highlight.remove());
    }
  }

  async function showMatch() {
    if (!searchMatches.length) return;
    const match = searchMatches[activeMatch];
    const record = pageRecords[match.page - 1];
    clearSearchHighlights();
    scrollToPage(match.page);
    setSearchStatus(`Match ${activeMatch + 1} of ${searchMatches.length} · page ${match.page}`);
    await renderPage(record);
    if (searchMatches[activeMatch] !== match || !record.rendered) return;
    drawSearchHighlights(match, record);
  }

  function moveMatch(direction) {
    if (!searchMatches.length) return;
    activeMatch = (activeMatch + direction + searchMatches.length) % searchMatches.length;
    showMatch();
  }

  async function initializeReader() {
    reader.hidden = false;
    setStatus("Loading the research paper…");

    try {
      pdfjs = await import("./assets/vendor/pdfjs/pdf.mjs");
      // Resolve library resources beside this module, not relative to the nested article URL.
      const vendorBase = new URL("./assets/vendor/pdfjs/", import.meta.url);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", vendorBase).href;

      const loadingTask = pdfjs.getDocument({
        url: originalPdf.href,
        cMapUrl: new URL("cmaps/", vendorBase).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("standard_fonts/", vendorBase).href,
        wasmUrl: new URL("wasm/", vendorBase).href,
        iccUrl: new URL("iccs/", vendorBase).href,
        isEvalSupported: false
      });

      pdfDocument = await loadingTask.promise;
      const pageCount = pdfDocument.numPages;
      for (const element of totalPageElements) element.textContent = String(pageCount);

      const dimensions = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
        const page = await pdfDocument.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return { number: index + 1, width: viewport.width, height: viewport.height, page };
      }));

      const fragment = document.createDocumentFragment();
      pageRecords = dimensions.map(({ number, width, height, page }) => {
        const element = document.createElement("div");
        element.className = "research-pdf-page";
        element.dataset.pageNumber = String(number);
        element.style.aspectRatio = `${width} / ${height}`;
        const placeholder = createPlaceholder(number);
        const record = {
          number,
          width,
          page,
          element,
          placeholder,
          generation: 0,
          rendered: false,
          renderTask: null,
          renderPromise: null,
          text: "",
          textSegments: []
        };
        element.append(placeholder);
        fragment.append(element);
        return record;
      });

      toolbar.hidden = false;
      pagesElement.replaceChildren(fragment);
      setStatus("");
      updateProgress();
      renderNearbyPages();
    } catch (error) {
      console.error("Could not load the research paper.", error);
      showPdfFallback("The reader could not load the paper.");
    }
  }

  function showPdfFallback(message) {
    setStatus(message, true);
    const link = originalPdf.cloneNode(true);
    link.removeAttribute("id");
    statusElement.append(" ", link);
  }

  previousPageButton.addEventListener("click", () => scrollToPage(currentPage - 1));
  nextPageButton.addEventListener("click", () => scrollToPage(currentPage + 1));
  pageInput.addEventListener("change", () => scrollToPage(pageInput.value));
  pageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      scrollToPage(pageInput.value);
      pageInput.blur();
    }
  });
  reader.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => {
    setZoom(Math.min(2.5, Math.round((zoom + 0.15) * 100) / 100));
  });
  reader.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => {
    setZoom(Math.max(0.6, Math.round((zoom - 0.15) * 100) / 100));
  });
  reader.querySelector("[data-pdf-fit]").addEventListener("click", () => setZoom(1));
  searchForm.addEventListener("submit", event => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    findMatches();
  });
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(findMatches, 300);
  });
  searchPreviousButton.addEventListener("click", () => moveMatch(-1));
  searchNextButton.addEventListener("click", () => moveMatch(1));
  fullscreenButton.hidden = !document.fullscreenEnabled;
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === reader) await document.exitFullscreen();
      else await reader.requestFullscreen();
    } catch (error) {
      setStatus("Fullscreen mode is unavailable in this browser.", true);
      console.error("Could not change PDF reader fullscreen mode.", error);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    const isFullscreen = document.fullscreenElement === reader;
    fullscreenButton.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
    fullscreenButton.title = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
  });

  pagesElement.addEventListener("scroll", scheduleProgressUpdate, { passive: true });
  if ("ResizeObserver" in window) {
    new ResizeObserver(updateRenderedPages).observe(pagesElement);
  } else {
    window.addEventListener("resize", updateRenderedPages, { passive: true });
  }
  initializeReader();
}
